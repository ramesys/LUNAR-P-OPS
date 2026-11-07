"""Strict candidate-specific terrain/SPICE evaluation; never substitutes flat terrain."""

import hashlib
import json
import math
import os
from contextlib import closing
from datetime import UTC, timedelta
from importlib.metadata import version
from pathlib import Path
from typing import Literal

import numpy as np
import spiceypy as spice
from lunar_core.geometry import SPICE_LOCK, Body, SurfacePoint, horizontal_positions
from lunar_core.horizon import _destination, horizon_mask
from lunar_core.kernels import KERNELS
from lunar_core.terrain import MOON_RADIUS_M, TerrainGrid, polar_stereographic_south, terrain_files
from lunar_core.visibility import earth_center_visible, sun_upper_limb_visible
from lunar_core.windows import build_windows

from clps_api import candidate_store, terrain_store
from clps_api.candidate import TERRAIN_WINDOWS
from clps_api.schemas import (
    CandidateOut,
    EvaluationInterval,
    EvaluationOut,
    EvaluationRequest,
    EvaluationSample,
)

ALGORITHM = "candidate-horizon-spice-v1"
CREATE_TABLE = (
    "CREATE TABLE IF NOT EXISTS evaluations "
    "(id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, payload TEXT NOT NULL)"
)
_loaded_kernel_hashes: dict[str, str] | None = None


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def kernel_hashes() -> dict[str, str]:
    directory = Path(os.environ.get("CLPS_DATA_DIR", "data")) / "kernels"
    return {k.filename: file_hash(directory / k.filename) for k in KERNELS}


def moon_radii_m() -> tuple[float, float, float]:
    with SPICE_LOCK:
        _, radii = spice.bodvrd("MOON", "RADII", 3)
    return float(radii[0]) * 1000, float(radii[1]) * 1000, float(radii[2]) * 1000


def record_loaded_kernel_hashes() -> None:
    global _loaded_kernel_hashes
    _loaded_kernel_hashes = kernel_hashes()


def verify_coverage(candidate: CandidateOut, near: TerrainGrid, far: TerrainGrid) -> None:
    """Verify every grid sample used by the existing 0.5-degree horizon algorithm."""
    verify_point_coverage(candidate.latitude_deg, candidate.longitude_deg, near, far)


def verify_point_coverage(
    latitude_deg: float, longitude_deg: float, near: TerrainGrid, far: TerrainGrid
) -> None:
    """Raise ValueError if any discrete horizon ray sample at this point is missing or NaN."""
    az = np.radians(np.arange(0.0, 360.0, 0.5))[:, np.newaxis]
    for label, distances, grid in (
        ("near", np.arange(near.pixel_size_m, 8000.0, near.pixel_size_m), near),
        ("far", np.arange(8000.0, 200000.0, far.pixel_size_m), far),
    ):
        if distances.size == 0:
            raise ValueError(f"{label} terrain has no horizon samples")
        lat, lon = _destination(
            latitude_deg,
            longitude_deg,
            az,
            distances[np.newaxis, :] / MOON_RADIUS_M,
        )
        x, y = polar_stereographic_south(lat, lon)
        samples = grid.sample(x, y)
        missing = int(np.count_nonzero(~np.isfinite(samples)))
        if missing:
            raise ValueError(
                f"{label} DEM coverage/nodata: {missing} of {samples.size} ray samples unavailable"
            )


def save(result: EvaluationOut) -> EvaluationOut:
    with closing(candidate_store.connect()) as db, db:
        db.execute(CREATE_TABLE)
        db.execute(
            "INSERT OR IGNORE INTO evaluations VALUES (?, ?, ?)",
            (result.evaluation_id, result.candidate_id, result.model_dump_json()),
        )
        row = db.execute(
            "SELECT payload FROM evaluations WHERE id = ?", (result.evaluation_id,)
        ).fetchone()
        if row is None or EvaluationOut.model_validate_json(row[0]) != result:
            raise ValueError("evaluation identity collision")
    return result


def get(evaluation_id: str) -> EvaluationOut | None:
    with closing(candidate_store.connect()) as db:
        db.execute(CREATE_TABLE)
        row = db.execute(
            "SELECT payload FROM evaluations WHERE id = ?", (evaluation_id,)
        ).fetchone()
    return None if row is None else EvaluationOut.model_validate_json(row[0])


def list_for(candidate_id: str) -> list[EvaluationOut]:
    with closing(candidate_store.connect()) as db:
        db.execute(CREATE_TABLE)
        rows = db.execute(
            "SELECT payload FROM evaluations WHERE candidate_id = ? ORDER BY rowid", (candidate_id,)
        ).fetchall()
    return [EvaluationOut.model_validate_json(row[0]) for row in rows]


def evaluate(candidate: CandidateOut, request: EvaluationRequest) -> EvaluationOut:
    window = candidate.terrain_window_id
    if window not in TERRAIN_WINDOWS:
        window = "sample-a"  # Never derive a path from an unknown id; identity checks still fail.
    near_path, far_path = terrain_files(terrain_store.terrain_dir(), window)
    provenance: dict[str, object] = {
        "algorithm": ALGORITHM,
        "candidate_id": candidate.candidate_id,
        "terrain_window_id": candidate.terrain_window_id,
        "coordinate_reference": candidate.coordinate_reference,
        "horizon_azimuth_step_deg": 0.5,
        "near_limit_m": 8000,
        "max_distance_m": 200000,
        "visibility_rules": (
            "Sun upper limb > terrain horizon; Earth center > terrain horizon (0 deg clearance)"
        ),
        "time_sampling": (
            "[start, end), each sample represents until the next; "
            "transitions uncertain up to one step"
        ),
        "spice": (
            "MOON_ME DE421; LT+S; no refraction; observer radius = "
            "1737400 m + DEM elevation + observer height"
        ),
        "lunar_core_version": version("lunar-core"),
        "spiceypy_version": version("spiceypy"),
        "numpy_version": version("numpy"),
    }
    warnings = [
        "Independent scientific validation has not been established for this candidate.",
        "Geometric Earth visibility is not communication performance; "
        "sunlight is not a power analysis.",
        "Horizon is sampled at 0.5 degrees and finite radial intervals; "
        "unsampled terrain may be missed.",
    ]
    errors: list[str] = []
    status: Literal["COMPUTED_UNVERIFIED", "VALIDATED", "UNAVAILABLE", "ERROR"] = "UNAVAILABLE"
    samples: list[EvaluationSample] = []
    intervals: dict[str, list[EvaluationInterval]] = {}
    horizon_az: list[float] = []
    horizon_el: list[float] = []
    try:
        if candidate.terrain_window_id not in TERRAIN_WINDOWS:
            raise ValueError(f"unknown terrain window: {candidate.terrain_window_id}")
        if not near_path.is_file() or not far_path.is_file():
            raise ValueError("near or far LOLA terrain window unavailable")
        near_hash, far_hash = file_hash(near_path), file_hash(far_path)
        near, far = TerrainGrid.load(near_path), TerrainGrid.load(far_path)
        if file_hash(near_path) != near_hash or file_hash(far_path) != far_hash:
            raise ValueError("terrain files changed while loading")
        provenance.update(
            {
                "near_dataset_id": candidate.terrain_dataset_id,
                "near_source": near.source,
                "near_sha256": near_hash,
                "near_resolution_m": near.pixel_size_m,
                "near_nodata": "NaN in source GeoTIFF; cached NPZ has no separate mask",
                "far_source": far.source,
                "far_sha256": far_hash,
                "far_resolution_m": far.pixel_size_m,
                "far_nodata": "NaN in source GeoTIFF; cached NPZ has no separate mask",
            }
        )
        if (
            candidate.terrain_dataset_id != "LDEM_80S_20MPP_ADJ"
            or not near.source.endswith("/LDEM_80S_20MPP_ADJ.TIF")
            or not far.source.endswith("/LDEM_60S_240MPP_ADJ.TIF")
        ):
            raise ValueError("unexpected terrain dataset identity")
        if near.pixel_size_m != 20 or far.pixel_size_m != 240:
            raise ValueError("unexpected LOLA terrain resolution")
        if (
            near_hash != candidate.terrain_dataset_sha256
            or near.source != candidate.terrain_source_url
        ):
            raise ValueError(
                "candidate terrain dataset identity differs from current near-field window"
            )
        x, y = polar_stereographic_south(candidate.latitude_deg, candidate.longitude_deg)
        ground = float(near.sample(np.atleast_1d(x), np.atleast_1d(y))[0])
        if not math.isfinite(ground) or abs(ground - candidate.terrain_elevation_m) > 0.001:
            raise ValueError("candidate DEM sample is unavailable or differs from stored elevation")
        verify_coverage(candidate, near, far)
        current_kernels = kernel_hashes()
        provenance["kernel_sha256"] = current_kernels
        if _loaded_kernel_hashes is None or current_kernels != _loaded_kernel_hashes:
            raise ValueError("loaded SPICE kernel identity unavailable or changed; restart the API")
        radii = moon_radii_m()
        provenance["spice_moon_radii_m"] = list(radii)
        if any(abs(radius - MOON_RADIUS_M) > 0.001 for radius in radii):
            raise ValueError("SPICE lunar radii do not match the DEM reference sphere")
        mask = horizon_mask(
            candidate.latitude_deg,
            candidate.longitude_deg,
            near,
            far,
            observer_height_m=candidate.observer_height_m,
        )
        horizon_az = mask.azimuths_deg.tolist()
        horizon_el = mask.elevations_deg.tolist()
        start = candidate.selected_time_utc.astimezone(UTC)
        end = start + timedelta(hours=request.duration_hours)
        step = timedelta(minutes=request.step_minutes)
        count = math.ceil((end - start) / step)
        times = [start + i * step for i in range(count)]
        point = SurfacePoint(
            candidate.latitude_deg,
            candidate.longitude_deg,
            candidate.terrain_elevation_m + candidate.observer_height_m,
        )
        sun = horizontal_positions(Body.SUN, point, times)
        earth = horizontal_positions(Body.EARTH, point, times)
        for instant, s, e in zip(times, sun, earth, strict=True):
            sh, eh = float(mask.at(s.azimuth_deg)), float(mask.at(e.azimuth_deg))
            sv, ev = sun_upper_limb_visible(s, sh), earth_center_visible(e, eh)
            samples.append(
                EvaluationSample(
                    time_utc=instant,
                    sun_azimuth_deg=s.azimuth_deg,
                    sun_elevation_deg=s.elevation_deg,
                    sun_horizon_deg=sh,
                    sun_visible=sv,
                    earth_azimuth_deg=e.azimuth_deg,
                    earth_elevation_deg=e.elevation_deg,
                    earth_horizon_deg=eh,
                    earth_visible=ev,
                    simultaneous_visible=sv and ev,
                )
            )
        for key in ("sun", "earth", "simultaneous"):
            flags = [getattr(s, f"{key}_visible") for s in samples]
            intervals[key] = [
                EvaluationInterval(
                    start_utc=w.start,
                    end_utc=w.end,
                    duration_seconds=w.duration.total_seconds(),
                    truncated=w.truncated,
                )
                for w in build_windows(times, flags, end)
                if w.visible
            ]
        if kernel_hashes() != current_kernels:
            raise ValueError("SPICE kernel files changed during evaluation; restart API")
        status = "COMPUTED_UNVERIFIED"
    except (ValueError, FileNotFoundError) as exc:
        errors.append(str(exc))
    except Exception as exc:
        status = "ERROR"
        errors.append(f"{type(exc).__name__}: {exc}")
    if status != "COMPUTED_UNVERIFIED":
        horizon_az, horizon_el, samples, intervals = [], [], [], {}
    # Include the complete result in the identity, preserving errors and exact dataset versions.
    content = {
        "candidate": candidate.model_dump(mode="json"),
        "request": request.model_dump(mode="json"),
        "provenance": provenance,
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "intervals": {
            key: [item.model_dump(mode="json") for item in values]
            for key, values in intervals.items()
        },
        "horizon_azimuth": horizon_az,
        "samples": [s.model_dump(mode="json") for s in samples],
        "horizon": horizon_el,
    }
    identifier = hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return save(
        EvaluationOut(
            evaluation_id=f"evaluation-{identifier}",
            candidate_id=candidate.candidate_id,
            status=status,
            request=request,
            candidate=candidate,
            provenance=provenance,
            warnings=warnings,
            errors=errors,
            horizon_azimuth_deg=horizon_az,
            horizon_elevation_deg=horizon_el,
            samples=samples,
            intervals=intervals,
        )
    )
