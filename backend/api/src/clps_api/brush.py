"""Bounded, deterministic brush orchestration using existing candidate and science contracts."""

import hashlib
import json
import math
from datetime import timedelta
from typing import Literal

from lunar_core.roi import ROIS
from lunar_core.windows import build_windows

from clps_api import candidate, candidate_store, evaluation
from clps_api.schemas import (
    BrushDefinition,
    BrushExecutionOut,
    BrushMetrics,
    BrushPreviewOut,
    BrushResultOut,
    BrushSampleOut,
    CandidateOut,
    CandidateRequest,
    EvaluationOut,
    EvaluationRequest,
)

TOLERANCE_M = 1e-7
MAX_TEMPORAL_SAMPLES = 8192


def _cross(a: tuple[float, float], b: tuple[float, float], p: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _on_segment(a: tuple[float, float], b: tuple[float, float], p: tuple[float, float]) -> bool:
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    return (
        abs(_cross(a, b, p)) <= TOLERANCE_M * max(length, 1.0)
        and min(a[0], b[0]) - TOLERANCE_M <= p[0] <= max(a[0], b[0]) + TOLERANCE_M
        and min(a[1], b[1]) - TOLERANCE_M <= p[1] <= max(a[1], b[1]) + TOLERANCE_M
    )


def _intersects(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float], d: tuple[float, float]
) -> bool:
    ab_c, ab_d, cd_a, cd_b = _cross(a, b, c), _cross(a, b, d), _cross(c, d, a), _cross(c, d, b)
    return ((ab_c > 0 > ab_d or ab_d > 0 > ab_c) and (cd_a > 0 > cd_b or cd_b > 0 > cd_a)) or any(
        (_on_segment(a, b, c), _on_segment(a, b, d), _on_segment(c, d, a), _on_segment(c, d, b))
    )


def _inside(point: tuple[float, float], vertices: list[tuple[float, float]]) -> bool:
    inside = False
    x, y = point
    for a, b in zip(vertices, vertices[1:] + vertices[:1], strict=True):
        if _on_segment(a, b, point):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def sample_polygon(
    vertices: list[tuple[float, float]], spacing: float, max_points: int, half: float
) -> list[tuple[float, float]]:
    if len(vertices) < 3 or not math.isfinite(spacing) or spacing < 20:
        raise ValueError("Polygon needs at least three vertices and spacing of at least 20 m")
    if any(not math.isfinite(v) or abs(v) > half for point in vertices for v in point):
        raise ValueError("Polygon is outside the supported scientific ROI")
    edges = list(zip(vertices, vertices[1:] + vertices[:1], strict=True))
    if any(math.dist(a, b) <= TOLERANCE_M for a, b in edges):
        raise ValueError("Polygon has duplicate adjacent vertices")
    for i, (a, b) in enumerate(edges):
        for j, (c, d) in enumerate(edges):
            if j <= i or j == i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            if _intersects(a, b, c, d):
                raise ValueError("Polygon edges intersect")
    if abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)) <= TOLERANCE_M:
        raise ValueError("Polygon has zero area")
    # Alignment is the ROI origin, row order south to north and west to east.
    lo_e = math.ceil(min(p[0] for p in vertices) / spacing - 1e-12)
    hi_e = math.floor(max(p[0] for p in vertices) / spacing + 1e-12)
    lo_n = math.ceil(min(p[1] for p in vertices) / spacing - 1e-12)
    hi_n = math.floor(max(p[1] for p in vertices) / spacing + 1e-12)
    points = [
        (round(e * spacing, 9), round(n * spacing, 9))
        for n in range(lo_n, hi_n + 1)
        for e in range(lo_e, hi_e + 1)
        if _inside((e * spacing, n * spacing), vertices)
    ]
    if len(points) > max_points:
        raise ValueError(
            f"Sample count {len(points)} exceeds the configured maximum "
            f"{max_points}; increase spacing"
        )
    if not points:
        raise ValueError("No grid points fall within the polygon; reduce spacing")
    return points


def summarize(result: EvaluationOut) -> BrushMetrics:
    samples = result.samples
    if not samples:
        raise ValueError("Evaluation has no samples")
    times = [s.time_utc for s in samples]
    end = result.candidate.selected_time_utc + timedelta(hours=result.request.duration_hours)

    def gap(key: str) -> float:
        flags = [bool(getattr(sample, key)) for sample in samples]
        return max(
            (
                w.duration.total_seconds() / 3600
                for w in build_windows(times, flags, end)
                if not w.visible
            ),
            default=0.0,
        )

    count = len(samples)
    return BrushMetrics(
        sample_count=count,
        duration_hours=result.request.duration_hours,
        sun_fraction=sum(s.sun_visible for s in samples) / count,
        earth_fraction=sum(s.earth_visible for s in samples) / count,
        simultaneous_fraction=sum(s.simultaneous_visible for s in samples) / count,
        longest_darkness_hours=gap("sun_visible"),
        longest_earth_gap_hours=gap("earth_visible"),
    )


def _candidate(point: tuple[float, float], definition: BrushDefinition) -> CandidateOut:
    return candidate.create_roi_candidate(
        ROIS["shackleton-rim-b"],
        CandidateRequest(
            east_m=point[0],
            north_m=point[1],
            observer_height_m=definition.observer_height_m,
            selected_time_utc=definition.start_utc,
        ),
    )


def preview(definition: BrushDefinition) -> BrushPreviewOut:
    points = sample_polygon(
        [(p.east_m, p.north_m) for p in definition.polygon],
        definition.spacing_m,
        definition.max_points,
        ROIS["shackleton-rim-b"].half_width_m,
    )
    per_point = math.ceil(definition.duration_hours * 60 / definition.step_minutes)
    if per_point * len(points) > MAX_TEMPORAL_SAMPLES:
        raise ValueError(f"Workload exceeds {MAX_TEMPORAL_SAMPLES} location-time samples")
    samples: list[BrushSampleOut] = []
    for east, north in points:
        try:
            c = _candidate((east, north), definition)
            samples.append(
                BrushSampleOut(
                    east_m=east,
                    north_m=north,
                    latitude_deg=c.latitude_deg,
                    longitude_deg=c.longitude_deg,
                    elevation_m=c.terrain_elevation_m,
                    candidate_id=c.candidate_id,
                    status="READY",
                )
            )
        except (ValueError, FileNotFoundError) as exc:
            samples.append(
                BrushSampleOut(east_m=east, north_m=north, status="UNAVAILABLE", error=str(exc))
            )
    identity = {
        "definition": definition.model_dump(mode="json"),
        "samples": [s.model_dump(mode="json") for s in samples],
    }
    token = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return BrushPreviewOut(
        definition=definition,
        coordinate_reference=(
            "MOON_ME; south polar stereographic; ROI local east/north projected metres"
        ),
        alignment="ROI origin; south to north, west to east",
        tolerance_m=TOLERANCE_M,
        samples=samples,
        ready_count=sum(s.status == "READY" for s in samples),
        temporal_samples_per_point=per_point,
        estimated_total_samples=per_point * len(points),
        preview_token=token,
    )


def execute(definition: BrushDefinition, preview_token: str) -> BrushExecutionOut:
    checked = preview(definition)
    if checked.preview_token != preview_token:
        raise ValueError("Preview changed; preview the region again before executing")
    results: list[BrushResultOut] = []
    settings = EvaluationRequest(
        duration_hours=definition.duration_hours, step_minutes=definition.step_minutes
    )
    for sample in checked.samples:
        if sample.status != "READY":
            results.append(
                BrushResultOut(
                    sample=sample, verdict="UNAVAILABLE", errors=[sample.error or "DEM unavailable"]
                )
            )
            continue
        saved: CandidateOut | None = None
        try:
            c = _candidate((sample.east_m, sample.north_m), definition)
            if c.candidate_id != sample.candidate_id:
                raise ValueError("Candidate identity changed since preview")
            # In all mode save first, so partial failures are traceable and retries are idempotent.
            if definition.retention == "all":
                saved = candidate_store.save(c)
            result = evaluation.compute(c, settings)
            metrics = (
                summarize(result) if result.status in ("COMPUTED_UNVERIFIED", "VALIDATED") else None
            )
            verdict: Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED"]
            if metrics is None:
                verdict = "UNAVAILABLE" if result.status == "UNAVAILABLE" else "ERROR"
            else:
                rules = definition.constraints
                passed = (
                    metrics.sun_fraction >= rules.min_sun_fraction
                    and metrics.earth_fraction >= rules.min_earth_fraction
                    and metrics.simultaneous_fraction >= rules.min_simultaneous_fraction
                    and (
                        rules.max_darkness_hours is None
                        or metrics.longest_darkness_hours <= rules.max_darkness_hours
                    )
                    and (
                        rules.max_earth_gap_hours is None
                        or metrics.longest_earth_gap_hours <= rules.max_earth_gap_hours
                    )
                )
                verdict = "PASS" if passed else "FAIL"
            if definition.retention == "passing" and verdict == "PASS":
                saved = candidate_store.save(c)
            if saved is not None:
                evaluation.save(result)
            results.append(
                BrushResultOut(
                    sample=sample,
                    verdict=verdict,
                    metrics=metrics,
                    candidate=saved,
                    evaluation=result,
                    persisted=saved is not None,
                    errors=result.errors,
                )
            )
        except Exception as exc:
            results.append(
                BrushResultOut(
                    sample=sample,
                    verdict="ERROR",
                    candidate=saved,
                    persisted=saved is not None,
                    errors=[f"{type(exc).__name__}: {exc}"],
                )
            )
    return BrushExecutionOut(
        preview=checked,
        results=results,
        notes=[
            "Fractions count stored samples; gaps use sampled intervals "
            "and may differ by up to one step.",
            "Sun and Earth visibility are geometric, not power or communications performance.",
            "Computed results are not independently validated.",
        ],
    )
