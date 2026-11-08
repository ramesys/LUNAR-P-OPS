"""Terrain screening (slope, roughness, DEM quality) of ROI points and stored candidates.

All physical quantities come from `lunar_core.landing_terrain`. Results are content-addressed:
the screen ID hashes the DEM content hash, the algorithm, the location and the constraints, so a
changed DEM or rule always yields a different ID. Computed metrics are cached in-process by the
same DEM content hash, so a replaced file can never be served from the cache.
"""

import hashlib
import json
import threading
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import asdict
from importlib.metadata import version
from pathlib import Path

import numpy as np
from lunar_core.landing_terrain import (
    ALGORITHM,
    LandingZoneConstraints,
    TerrainMetrics,
    landing_zone_screen,
    terrain_metrics,
)
from lunar_core.roi import ROIS, Roi, local_frame, stereographic_scale_factor
from lunar_core.terrain import (
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
    terrain_files,
)

from clps_api import terrain_store
from clps_api.schemas import (
    CandidateOut,
    SurfaceSlopeOut,
    TerrainCheckOut,
    TerrainProvenanceOut,
    TerrainQualityOut,
    TerrainRoughnessOut,
    TerrainScreenConstraints,
    TerrainScreenOut,
)

COORDINATE_REFERENCE = "MOON_ME; south polar stereographic (sphere R = 1737.4 km); local east/north"
DATASET_ID = "LDEM_80S_20MPP_ADJ"
_lock = threading.Lock()
_grids: dict[tuple[str, float, int], tuple[TerrainGrid, str]] = {}
_metrics: OrderedDict[tuple[object, ...], TerrainMetrics] = OrderedDict()
METRICS_CACHE_SIZE = 200_000


def clear_cache() -> None:
    with _lock:
        _grids.clear()
        _metrics.clear()


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def near_grid(window_id: str) -> tuple[TerrainGrid, str, str]:
    """(grid, sha256, source URL) of a terrain window's near-field DEM; raises if missing."""
    near, _ = terrain_files(terrain_store.terrain_dir(), window_id)
    if not near.is_file():
        raise FileNotFoundError("LOLA near-field terrain is unavailable")
    stat = near.stat()
    key = (str(near), stat.st_mtime, stat.st_size)
    with _lock:
        cached = _grids.get(key)
    if cached is None:
        grid = TerrainGrid.load(near)
        cached = (grid, _file_hash(near))
        with _lock:
            _grids.clear()  # keep only the current file version
            _grids[key] = cached
    grid, sha = cached
    return grid, sha, grid.source


def _constraints(rules: TerrainScreenConstraints) -> LandingZoneConstraints:
    return LandingZoneConstraints(
        max_local_slope_deg=rules.max_local_slope_deg,
        max_neighborhood_slope_deg=rules.max_neighborhood_slope_deg,
        max_roughness_rms_m=rules.max_roughness_rms_m,
        max_relief_m=rules.max_relief_m,
        min_coverage_fraction=rules.min_coverage_fraction,
    )


def _unavailable(
    rules: TerrainScreenConstraints,
    error: str,
    east: float | None = None,
    north: float | None = None,
) -> TerrainScreenOut:
    identity = {"error": error, "constraints": rules.model_dump(mode="json"), "e": east, "n": north}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return TerrainScreenOut(
        screen_id=f"terrain-screen-{digest}",
        status="UNAVAILABLE",
        verdict="NOT_ASSESSED",
        east_m=east,
        north_m=north,
        constraints=rules,
        not_assessed=["All terrain metrics: DEM unavailable"],
        errors=[error],
    )


def _output(
    metrics: TerrainMetrics,
    rules: TerrainScreenConstraints,
    provenance: TerrainProvenanceOut,
    lat: float,
    lon: float,
    east: float | None,
    north: float | None,
) -> TerrainScreenOut:
    screen = landing_zone_screen(metrics, _constraints(rules))
    body = TerrainScreenOut(
        screen_id="",
        status="COMPUTED_UNVERIFIED",
        verdict=screen.verdict,
        east_m=east,
        north_m=north,
        latitude_deg=lat,
        longitude_deg=lon,
        constraints=rules,
        slope=SurfaceSlopeOut(**asdict(metrics.slope)),
        roughness=TerrainRoughnessOut(**asdict(metrics.roughness)),
        quality=TerrainQualityOut(**asdict(metrics.quality)),
        checks=[TerrainCheckOut(**asdict(c)) for c in screen.checks],
        margin=screen.margin(),
        not_assessed=list(screen.not_assessed),
        provenance=provenance,
    )
    digest = hashlib.sha256(
        json.dumps(
            body.model_dump(mode="json", exclude={"screen_id"}),
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()
    return body.model_copy(update={"screen_id": f"terrain-screen-{digest}"})


def _cached_metrics(
    grid: TerrainGrid,
    sha: str,
    x: Sequence[float],
    y: Sequence[float],
    lon: Sequence[float],
    lat: Sequence[float],
    radius: float,
) -> list[TerrainMetrics]:
    keys = [(ALGORITHM, sha, radius, round(a, 6), round(b, 6)) for a, b in zip(x, y, strict=True)]
    with _lock:
        found = {k: _metrics[k] for k in keys if k in _metrics}
    missing = [i for i, k in enumerate(keys) if k not in found]
    if missing:
        computed = terrain_metrics(
            grid,
            [x[i] for i in missing],
            [y[i] for i in missing],
            [lon[i] for i in missing],
            [stereographic_scale_factor(lat[i]) for i in missing],
            neighborhood_radius_m=radius,
        )
        with _lock:
            for i, m in zip(missing, computed, strict=True):
                found[keys[i]] = m
                _metrics[keys[i]] = m
            while len(_metrics) > METRICS_CACHE_SIZE:
                _metrics.popitem(last=False)
    return [found[k] for k in keys]


def screen_roi_points(
    points: Sequence[tuple[float, float]], rules: TerrainScreenConstraints, roi: Roi | None = None
) -> list[TerrainScreenOut]:
    """Terrain screens at ROI-local east/north offsets (projected metres), in input order."""
    roi = roi or ROIS["shackleton-rim-b"]
    try:
        grid, sha, source = near_grid(roi.id)
    except FileNotFoundError as exc:
        return [_unavailable(rules, str(exc), e, n) for e, n in points]
    frame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
    xs, ys = frame.to_projected(
        np.array([p[0] for p in points], dtype=np.float64),
        np.array([p[1] for p in points], dtype=np.float64),
    )
    lats, lons = polar_stereographic_south_inverse(xs, ys)
    x, y = [float(v) for v in np.atleast_1d(xs)], [float(v) for v in np.atleast_1d(ys)]
    lat, lon = [float(v) for v in np.atleast_1d(lats)], [float(v) for v in np.atleast_1d(lons)]
    metrics = _cached_metrics(grid, sha, x, y, lon, lat, rules.neighborhood_radius_m)
    provenance = _provenance(grid, sha, source)
    return [
        _output(m, rules, provenance, lat[i], lon[i], points[i][0], points[i][1])
        for i, m in enumerate(metrics)
    ]


def screen_candidate(candidate: CandidateOut, rules: TerrainScreenConstraints) -> TerrainScreenOut:
    """Terrain screen at a stored candidate's location, on the DEM the candidate references."""
    try:
        grid, sha, source = near_grid(candidate.terrain_window_id)
    except FileNotFoundError as exc:
        return _unavailable(rules, str(exc))
    if candidate.terrain_dataset_sha256 and candidate.terrain_dataset_sha256 != sha:
        return _unavailable(rules, "terrain dataset differs from the one the candidate references")
    x, y = (
        float(v) for v in polar_stereographic_south(candidate.latitude_deg, candidate.longitude_deg)
    )
    (m,) = _cached_metrics(
        grid,
        sha,
        [x],
        [y],
        [candidate.longitude_deg],
        [candidate.latitude_deg],
        rules.neighborhood_radius_m,
    )
    east = north = None
    roi = ROIS.get(candidate.terrain_window_id)
    if roi is not None:
        frame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
        e, n = frame.from_projected(x, y)
        east, north = round(float(e), 6), round(float(n), 6)
    return _output(
        m,
        rules,
        _provenance(grid, sha, source),
        candidate.latitude_deg,
        candidate.longitude_deg,
        east,
        north,
    )


def _provenance(grid: TerrainGrid, sha: str, source: str) -> TerrainProvenanceOut:
    return TerrainProvenanceOut(
        algorithm=ALGORITHM,
        terrain_dataset_id=DATASET_ID if source.endswith(f"/{DATASET_ID}.TIF") else "unknown",
        terrain_source_url=source,
        terrain_dataset_sha256=sha,
        dem_resolution_m=grid.pixel_size_m,
        coordinate_reference=COORDINATE_REFERENCE,
        lunar_core_version=version("lunar-core"),
    )
