"""Reproducibility manifests and recompute-and-compare for persisted evaluations (Sprint 06).

Manifests are built only from stored records. Provenance fields an older evaluation did not
record are reported as not recorded; nothing is inferred from the current server.
"""

import hashlib
import json
import math
from datetime import UTC, datetime, timedelta
from importlib.metadata import version
from typing import Literal

from lunar_core.terrain import terrain_files

from clps_api import candidate_store, evaluation, terrain_store
from clps_api.candidate import TERRAIN_WINDOWS
from clps_api.schemas import (
    EvaluationOut,
    ExperimentManifestOut,
    InputCheckOut,
    RecomputeReportOut,
)

NOT_RECORDED: str = "not_recorded"
ANGLE_TOLERANCE_DEG: float = 1e-9
DURATION_TOLERANCE_S: float = 1e-6


def output_sha256(result: EvaluationOut) -> str:
    """SHA-256 of the canonical generated outputs (samples, intervals and horizon)."""
    outputs = {
        "samples": [s.model_dump(mode="json") for s in result.samples],
        "intervals": {
            key: [i.model_dump(mode="json") for i in values]
            for key, values in result.intervals.items()
        },
        "horizon_azimuth_deg": result.horizon_azimuth_deg,
        "horizon_elevation_deg": result.horizon_elevation_deg,
    }
    return hashlib.sha256(
        json.dumps(outputs, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def manifest(stored: EvaluationOut) -> ExperimentManifestOut:
    provenance = stored.provenance
    missing: list[str] = []

    def field(key: str) -> object:
        if key in provenance:
            return provenance[key]
        missing.append(key)
        return NOT_RECORDED

    candidate = stored.candidate
    start = candidate.selected_time_utc.astimezone(UTC)
    parent = (
        None
        if candidate.parent_candidate_id is None
        else candidate_store.get(candidate.parent_candidate_id)
    )
    if candidate.parent_candidate_id is not None and parent is None:
        missing.append("parent_candidate")
    return ExperimentManifestOut(
        exported_at_utc=datetime.now(UTC),
        evaluation_id=stored.evaluation_id,
        candidate_id=candidate.candidate_id,
        parent_candidate_id=candidate.parent_candidate_id,
        candidate=candidate,
        candidate_ref=candidate_store.ref(candidate.candidate_id),
        parent_candidate=parent,
        request=stored.request,
        interval={
            "start_utc": start.isoformat(),
            "end_utc": (start + timedelta(hours=stored.request.duration_hours)).isoformat(),
            "step_minutes": stored.request.step_minutes,
            "sample_count": len(stored.samples),
            "sampling": field("time_sampling"),
        },
        terrain={
            "terrain_window_id": field("terrain_window_id"),
            "near": {
                "dataset_id": field("near_dataset_id"),
                "source_url": field("near_source"),
                "sha256": field("near_sha256"),
                "resolution_m": field("near_resolution_m"),
                "nodata": field("near_nodata"),
            },
            "far": {
                "source_url": field("far_source"),
                "sha256": field("far_sha256"),
                "resolution_m": field("far_resolution_m"),
                "nodata": field("far_nodata"),
            },
        },
        spice={
            "kernel_sha256": field("kernel_sha256"),
            "configuration": field("spice"),
            "moon_radii_m": field("spice_moon_radii_m"),
        },
        method={
            "algorithm": field("algorithm"),
            "coordinate_reference": field("coordinate_reference"),
            "horizon_azimuth_step_deg": field("horizon_azimuth_step_deg"),
            "near_limit_m": field("near_limit_m"),
            "max_distance_m": field("max_distance_m"),
            "visibility_rules": field("visibility_rules"),
        },
        software={
            "clps_api_version": field("clps_api_version"),
            "lunar_core_version": field("lunar_core_version"),
            "spiceypy_version": field("spiceypy_version"),
            "numpy_version": field("numpy_version"),
            "software_commit": field("software_commit"),
        },
        status={
            "execution_status": stored.status,
            "validation_status": "independently_validated"
            if stored.status == "VALIDATED"
            else "not_independently_validated",
            "errors": stored.errors,
            "warnings": stored.warnings,
        },
        outputs={
            "output_sha256": output_sha256(stored),
            "sample_count": len(stored.samples),
            "horizon_sample_count": len(stored.horizon_elevation_deg),
            "visible_seconds": {
                key: sum(i.duration_seconds for i in values)
                for key, values in stored.intervals.items()
            },
            "samples": [s.model_dump(mode="json") for s in stored.samples],
            "intervals": {
                key: [i.model_dump(mode="json") for i in values]
                for key, values in stored.intervals.items()
            },
            "horizon_azimuth_deg": stored.horizon_azimuth_deg,
            "horizon_elevation_deg": stored.horizon_elevation_deg,
        },
        not_recorded=missing,
    )


def _max_abs(a: list[float], b: list[float]) -> float | None:
    if len(a) != len(b):
        return None
    return max((abs(x - y) for x, y in zip(a, b, strict=True)), default=0.0)


def current_inputs(stored: EvaluationOut) -> dict[str, object]:
    """Identity of the data and code available now, read directly from the files."""
    window = stored.candidate.terrain_window_id
    if window not in TERRAIN_WINDOWS:
        return {"near_sha256": "unknown window", "far_sha256": "unknown window"}
    near, far = terrain_files(terrain_store.terrain_dir(), window)
    return {
        "near_sha256": evaluation.file_hash(near) if near.is_file() else "missing",
        "far_sha256": evaluation.file_hash(far) if far.is_file() else "missing",
        "kernel_sha256": evaluation.kernel_hashes(),
        "algorithm": evaluation.ALGORITHM,
        "lunar_core_version": version("lunar-core"),
    }


def recompute(stored: EvaluationOut) -> RecomputeReportOut:
    """Re-run the stored inputs with the current data and code; never persists the result."""
    current = candidate_store.get(stored.candidate_id)
    fresh = evaluation.compute(stored.candidate, stored.request)
    checks: list[InputCheckOut] = [
        InputCheckOut(
            name="stored candidate snapshot",
            stored=stored.candidate.candidate_id,
            current="missing" if current is None else current.candidate_id,
            match=current == stored.candidate,
        )
    ]
    for key, now in current_inputs(stored).items():
        before = stored.provenance.get(key, NOT_RECORDED)
        checks.append(
            InputCheckOut(
                name=key,
                stored=json.dumps(before, sort_keys=True),
                current=json.dumps(now, sort_keys=True),
                match=before == now,
            )
        )
    differences: dict[str, float | int | None] = {}
    sample_count_match = len(stored.samples) == len(fresh.samples)
    if sample_count_match:
        for field in (
            "sun_azimuth_deg",
            "sun_elevation_deg",
            "sun_horizon_deg",
            "earth_azimuth_deg",
            "earth_elevation_deg",
            "earth_horizon_deg",
        ):
            differences[f"{field}_max_abs"] = _max_abs(
                [getattr(s, field) for s in stored.samples],
                [getattr(s, field) for s in fresh.samples],
            )
        differences["visibility_flag_mismatches"] = sum(
            (a.sun_visible != b.sun_visible)
            + (a.earth_visible != b.earth_visible)
            + (a.simultaneous_visible != b.simultaneous_visible)
            + (a.time_utc != b.time_utc)
            for a, b in zip(stored.samples, fresh.samples, strict=True)
        )
    differences["horizon_elevation_deg_max_abs"] = _max_abs(
        stored.horizon_elevation_deg, fresh.horizon_elevation_deg
    )
    interval_mismatches = 0
    for key in set(stored.intervals) | set(fresh.intervals):
        a, b = stored.intervals.get(key, []), fresh.intervals.get(key, [])
        if len(a) != len(b):
            interval_mismatches += abs(len(a) - len(b)) or 1
            continue
        interval_mismatches += sum(
            x.start_utc != y.start_utc
            or x.end_utc != y.end_utc
            or x.truncated != y.truncated
            or abs(x.duration_seconds - y.duration_seconds) > DURATION_TOLERANCE_S
            for x, y in zip(a, b, strict=True)
        )
    differences["interval_mismatches"] = interval_mismatches
    angles_ok = all(
        value is not None and value <= ANGLE_TOLERANCE_DEG
        for key, value in differences.items()
        if key.endswith("_max_abs")
    )
    exact_ok = (
        sample_count_match
        and differences.get("visibility_flag_mismatches", 0) == 0
        and interval_mismatches == 0
        and stored.status == fresh.status
    )
    inputs_ok = all(check.match for check in checks)
    outcome: Literal["reproduced", "differs", "inputs_changed"] = (
        "inputs_changed" if not inputs_ok else "reproduced" if angles_ok and exact_ok else "differs"
    )
    notes = [
        "Reproducibility check with the current data files and code; the result is not stored "
        "and the original evaluation is unchanged.",
        "Matching outputs show the computation is repeatable, not that it is independently "
        "validated; validation status is unchanged.",
    ]
    if not inputs_ok:
        notes.append("Some recorded inputs differ from the current ones; see input_checks.")
    finite = {
        key: (value if value is None or math.isfinite(value) else None)
        for key, value in differences.items()
    }
    return RecomputeReportOut(
        evaluation_id=stored.evaluation_id,
        recomputed_at_utc=datetime.now(UTC),
        persisted=False,
        outcome=outcome,
        stored_status=stored.status,
        recomputed_status=fresh.status,
        stored_output_sha256=output_sha256(stored),
        recomputed_output_sha256=output_sha256(fresh),
        recomputed_errors=fresh.errors,
        input_checks=checks,
        tolerances={
            "angles_deg": ANGLE_TOLERANCE_DEG,
            "interval_duration_s": DURATION_TOLERANCE_S,
            "visibility_flags": "exact",
            "sample_times": "exact",
        },
        differences=finite,
        validation_status="not_independently_validated"
        if stored.status != "VALIDATED"
        else "independently_validated",
        notes=notes,
    )
