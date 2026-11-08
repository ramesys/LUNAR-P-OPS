"""Bounded, deterministic brush orchestration using existing candidate and science contracts."""

import hashlib
import json
import math
from datetime import timedelta
from itertools import pairwise
from typing import Literal

from lunar_core.roi import ROIS, local_frame
from lunar_core.terrain import polar_stereographic_south_inverse
from lunar_core.windows import build_windows

from clps_api import brush_store, candidate, candidate_store, evaluation, terrain_screen
from clps_api.adaptive_brush import Evidence, TerrainScore, choose_refinement, choose_seeds
from clps_api.schemas import (
    BrushConstraints,
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
    TerrainScreenOut,
)

TOLERANCE_M = 1e-7
MAX_TEMPORAL_SAMPLES = 8192
MAX_TERRAIN_NODES = 60_000_000
"""Upper bound on DEM samples for one terrain pre-screen of the whole lattice."""
Point = tuple[float, float]


def _screen_points(
    points: list[Point], definition: BrushDefinition
) -> dict[Point, TerrainScreenOut]:
    """DEM terrain screens keyed by lattice point; tests may replace this function."""
    if definition.terrain is None or not points:
        return {}
    screens = terrain_screen.screen_roi_points(points, definition.terrain)
    return dict(zip(points, screens, strict=True))


def _terrain_pool(
    definition: BrushDefinition, pool: list[Point]
) -> dict[Point, TerrainScreenOut] | None:
    """Whole-lattice terrain screens under evidence B, before any visibility evaluation."""
    if definition.evidence != "visibility_terrain" or definition.terrain is None:
        return None
    nodes = (2 * math.floor(definition.terrain.neighborhood_radius_m / 20) + 3) ** 2
    if len(pool) * nodes > MAX_TERRAIN_NODES:
        raise ValueError(
            "Terrain pre-screen workload is too large; increase spacing or reduce the radius"
        )
    return _screen_points(pool, definition)


def _scores(screens: dict[Point, TerrainScreenOut]) -> dict[Point, TerrainScore]:
    return {p: TerrainScore(t.verdict, t.margin, t.screen_id) for p, t in screens.items()}


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
        100_000 if definition.sampling == "adaptive" else definition.max_points,
        ROIS["shackleton-rim-b"].half_width_m,
    )
    pool_size = len(points)
    budget = min(definition.max_points, pool_size)
    pool_screens = _terrain_pool(definition, points)
    excluded: int | None = None
    if pool_screens is not None:
        eligible = [p for p in points if pool_screens[p].verdict != "FAIL"]
        excluded = pool_size - len(eligible)
        if not eligible:
            raise ValueError(
                "Every lattice point fails the terrain screen; relax the terrain constraints"
            )
        points = choose_seeds(eligible, min(4, budget, len(eligible)))
    elif definition.sampling == "adaptive":
        points = choose_seeds(points, min(4, budget))
    screens = pool_screens if pool_screens is not None else _screen_points(points, definition)
    per_point = math.ceil(definition.duration_hours * 60 / definition.step_minutes)
    temporal_possible = (
        definition.step_minutes >= 2
        and math.ceil(definition.step_minutes / (definition.step_minutes // 2)) <= per_point
    )
    workload_points = (
        min(
            definition.max_points,
            pool_size + int(temporal_possible and pool_size == definition.max_points - 1),
        )
        if definition.sampling == "adaptive"
        else len(points)
    )
    if per_point * workload_points > MAX_TEMPORAL_SAMPLES:
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
            roi = ROIS["shackleton-rim-b"]
            frame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
            lat, lon = polar_stereographic_south_inverse(*frame.to_projected(east, north))
            samples.append(
                BrushSampleOut(
                    east_m=east,
                    north_m=north,
                    latitude_deg=float(lat),
                    longitude_deg=float(lon),
                    status="UNAVAILABLE",
                    error=str(exc),
                )
            )
    samples = [
        s.model_copy(update={"terrain": screens.get((s.east_m, s.north_m))}) for s in samples
    ]
    if definition.sampling == "adaptive":
        samples = [
            s.model_copy(
                update={
                    "reason": "Spatially distributed initial exploration"
                    + (
                        f" among {pool_size - (excluded or 0)} of {pool_size} lattice points "
                        "not failing the DEM terrain screen"
                        if pool_screens is not None
                        else ""
                    ),
                    "priority": "farthest-point seed order",
                    "parent_terrain_screen_ids": (
                        [s.terrain.screen_id] if pool_screens is not None and s.terrain else []
                    ),
                }
            )
            for s in samples
        ]
    existing = candidate_store.existing_ids(
        [s.candidate_id for s in samples if s.candidate_id is not None]
    )
    samples = [
        s.model_copy(update={"already_persisted": s.candidate_id in existing}) for s in samples
    ]
    # Existence can change after preview; retries retain the same scientific identity.
    identity = {
        "definition": definition.model_dump(mode="json"),
        "samples": [s.model_dump(mode="json", exclude={"already_persisted"}) for s in samples],
    }
    token = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return BrushPreviewOut(
        definition=definition,
        coordinate_reference=(
            "MOON_ME; south polar stereographic; ROI local east/north projected metres"
        ),
        alignment=(
            "ROI-aligned lattice; distributed seeds followed by evidence-guided selection"
            + ("; terrain-failing lattice points excluded" if pool_screens is not None else "")
            if definition.sampling == "adaptive"
            else "ROI origin; south to north, west to east"
        ),
        tolerance_m=TOLERANCE_M,
        samples=samples,
        ready_count=sum(s.status == "READY" for s in samples),
        new_count=sum(s.status == "READY" and not s.already_persisted for s in samples),
        existing_count=sum(s.status == "READY" and s.already_persisted for s in samples),
        temporal_samples_per_point=per_point,
        estimated_total_samples=per_point * workload_points,
        preview_token=token,
        terrain_pool_size=pool_size if pool_screens is not None else None,
        terrain_excluded_count=excluded,
    )


def meets_constraints(metrics: BrushMetrics, rules: BrushConstraints) -> bool:
    return (
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


def pareto_indices(results: list[BrushResultOut], terrain: bool = False) -> set[int]:
    """Non-dominated PASS results across the five reported sampled visibility metrics.

    With terrain constraints the neighbourhood slope and detrended RMS roughness are two more
    objectives (lower is better); results without those metrics are not compared.
    """

    def objectives(r: BrushResultOut) -> tuple[float, ...] | None:
        metrics = r.metrics
        if metrics is None:
            return None
        values: tuple[float, ...] = (
            metrics.sun_fraction,
            metrics.earth_fraction,
            metrics.simultaneous_fraction,
            -metrics.longest_darkness_hours,
            -metrics.longest_earth_gap_hours,
        )
        if not terrain:
            return values
        t = r.sample.terrain
        if t is None or t.slope is None or t.roughness is None:
            return None
        slope, rms = t.slope.neighborhood_slope_deg, t.roughness.rms_residual_m
        if slope is None or rms is None:
            return None
        return (*values, -slope, -rms)

    feasible = [
        (i, value)
        for i, r in enumerate(results)
        if r.verdict == "PASS" and (value := objectives(r)) is not None
    ]
    return {
        i
        for i, value in feasible
        if not any(
            all(a >= b for a, b in zip(other, value, strict=True))
            and any(a > b for a, b in zip(other, value, strict=True))
            for j, other in feasible
            if j != i
        )
    }


def combined_verdict(
    visibility: Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED"],
    definition: BrushDefinition,
    terrain: TerrainScreenOut | None,
) -> Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED", "NOT_ASSESSED"]:
    """Visibility verdict, further restricted by the terrain screen when one is configured."""
    if definition.terrain is None or visibility != "PASS":
        return visibility
    if terrain is None or terrain.verdict == "NOT_ASSESSED":
        return "NOT_ASSESSED"
    return terrain.verdict


def _refinement_evidence(result: BrushResultOut, definition: BrushDefinition) -> Evidence:
    """Experiment A uses visibility evidence only; B adds the location's terrain screen."""
    rules: BrushConstraints = definition.constraints
    if result.metrics is None or result.evaluation is None:
        raise ValueError("refinement requires computed metrics and evaluation")
    metrics, computed = result.metrics, result.evaluation
    with_terrain = definition.evidence == "visibility_terrain"
    margins = [
        value - threshold
        for value, threshold in (
            (metrics.sun_fraction, rules.min_sun_fraction),
            (metrics.earth_fraction, rules.min_earth_fraction),
            (metrics.simultaneous_fraction, rules.min_simultaneous_fraction),
        )
        if threshold > 0
    ]
    if rules.max_darkness_hours is not None:
        margins.append(
            (rules.max_darkness_hours - metrics.longest_darkness_hours) / metrics.duration_hours
        )
    if rules.max_earth_gap_hours is not None:
        margins.append(
            (rules.max_earth_gap_hours - metrics.longest_earth_gap_hours) / metrics.duration_hours
        )
    closest_clearance = min(
        min(
            abs(sample.sun_elevation_deg - sample.sun_horizon_deg),
            abs(sample.earth_elevation_deg - sample.earth_horizon_deg),
        )
        for sample in computed.samples
    )
    terrain = result.sample.terrain if with_terrain else None
    terrain_values: tuple[float, ...] = ()
    if terrain is not None:
        assessed = [c for c in terrain.checks if c.name != "coverage_fraction"]
        margins.extend(c.margin for c in assessed if c.margin is not None)
        terrain_values = tuple(
            min(c.value / c.limit, 4.0) if c.value is not None and c.limit > 0 else 0.0
            for c in assessed
        )
    return Evidence(
        (result.sample.east_m, result.sample.north_m),
        computed.candidate_id,
        computed.evaluation_id,
        metrics.simultaneous_fraction,
        (result.verdict if with_terrain else result.visibility_verdict) == "PASS",
        sun_fraction=metrics.sun_fraction,
        earth_fraction=metrics.earth_fraction,
        darkness_fraction=metrics.longest_darkness_hours / metrics.duration_hours,
        earth_gap_fraction=metrics.longest_earth_gap_hours / metrics.duration_hours,
        constraint_margin=min(margins) if margins else None,
        horizon_proximity=1 / (1 + closest_clearance),
        terrain_values=terrain_values,
        terrain_screen_id=terrain.screen_id if terrain is not None else None,
    )


def execute(definition: BrushDefinition, preview_token: str) -> BrushExecutionOut:
    checked = preview(definition)
    if checked.preview_token != preview_token:
        raise ValueError("Preview changed; preview the region again before executing")
    results: list[BrushResultOut] = []
    settings = EvaluationRequest(
        duration_hours=definition.duration_hours, step_minutes=definition.step_minutes
    )
    queue = list(checked.samples)
    pool = (
        sample_polygon(
            [(p.east_m, p.north_m) for p in definition.polygon],
            definition.spacing_m,
            100_000,
            ROIS["shackleton-rim-b"].half_width_m,
        )
        if definition.sampling == "adaptive"
        else []
    )
    used = {(s.east_m, s.north_m) for s in queue}
    pool_screens = _terrain_pool(definition, pool)
    scores = _scores(pool_screens) if pool_screens is not None else None
    index = 0
    temporal_definitions: dict[int, BrushDefinition] = {}
    while True:
        if (
            index == len(queue)
            and definition.sampling == "adaptive"
            and len(queue) < definition.max_points
        ):
            # Reserve the final attempt for one sampled transition when it fits the
            # same worst-case budget. No inferred transition is treated as evidence.
            temporal_parent: BrushResultOut | None = None
            transition_start = None
            if len(queue) == definition.max_points - 1 and definition.step_minutes >= 2:
                fine_step = definition.step_minutes // 2
                fine_count = math.ceil(definition.step_minutes / fine_step)
                if fine_count <= checked.temporal_samples_per_point:
                    for parent in results:
                        if parent.evaluation is None or parent.metrics is None:
                            continue
                        series = parent.evaluation.samples
                        for before, after in pairwise(series):
                            if (
                                before.sun_visible != after.sun_visible
                                or before.earth_visible != after.earth_visible
                            ):
                                temporal_parent, transition_start = parent, before.time_utc
                                break
                        if temporal_parent is not None:
                            break
            if (
                temporal_parent is not None
                and temporal_parent.evaluation is not None
                and transition_start is not None
            ):
                proposal_definition = definition.model_copy(
                    update={
                        "start_utc": transition_start,
                        "duration_hours": definition.step_minutes / 60,
                        "step_minutes": definition.step_minutes // 2,
                    }
                )
                point = (temporal_parent.sample.east_m, temporal_parent.sample.north_m)
                try:
                    c = _candidate(point, proposal_definition)
                    refined = BrushSampleOut(
                        east_m=point[0],
                        north_m=point[1],
                        latitude_deg=c.latitude_deg,
                        longitude_deg=c.longitude_deg,
                        elevation_m=c.terrain_elevation_m,
                        candidate_id=c.candidate_id,
                        status="READY",
                        already_persisted=c.candidate_id
                        in candidate_store.existing_ids([c.candidate_id]),
                        iteration=len(queue) - len(checked.samples) + 1,
                        reason=(
                            "Finer computed samples between consecutive Sun/Earth visibility "
                            "transition samples; full-window constraints are not rejudged"
                        ),
                        priority=(
                            "final reserved attempt; first computed visibility transition "
                            "in evaluation order"
                        ),
                        parent_candidate_ids=[temporal_parent.evaluation.candidate_id],
                        parent_evaluation_ids=[temporal_parent.evaluation.evaluation_id],
                        terrain=temporal_parent.sample.terrain,
                    )
                    temporal_definitions[len(queue)] = proposal_definition
                    queue.append(refined)
                    continue
                except (ValueError, FileNotFoundError):
                    # A failed temporal proposal does not authorize an invalid candidate.
                    pass
            evidence = [
                _refinement_evidence(r, definition)
                for r in results
                if r.metrics is not None
                and r.evaluation is not None
                and r.verdict != "NOT_EVALUATED"
            ]
            choice = choose_refinement(pool, evidence, used, scores)
            if choice is not None:
                used.add(choice.point)
                east, north = choice.point
                point_terrain = (
                    pool_screens[choice.point]
                    if pool_screens is not None
                    else _screen_points([choice.point], definition).get(choice.point)
                )
                parent_screens = list(choice.parent_terrain_screen_ids)
                try:
                    c = _candidate(choice.point, definition)
                    next_sample = BrushSampleOut(
                        east_m=east,
                        north_m=north,
                        latitude_deg=c.latitude_deg,
                        longitude_deg=c.longitude_deg,
                        elevation_m=c.terrain_elevation_m,
                        candidate_id=c.candidate_id,
                        status="READY",
                        already_persisted=c.candidate_id
                        in candidate_store.existing_ids([c.candidate_id]),
                        iteration=len(queue) - len(checked.samples) + 1,
                        reason=choice.reason,
                        priority=choice.priority,
                        parent_candidate_ids=list(choice.parent_candidate_ids),
                        parent_evaluation_ids=list(choice.parent_evaluation_ids),
                        terrain=point_terrain,
                        parent_terrain_screen_ids=parent_screens,
                    )
                except (ValueError, FileNotFoundError) as exc:
                    next_sample = BrushSampleOut(
                        east_m=east,
                        north_m=north,
                        status="UNAVAILABLE",
                        error=str(exc),
                        iteration=len(queue) - len(checked.samples) + 1,
                        reason=choice.reason,
                        priority=choice.priority,
                        parent_candidate_ids=list(choice.parent_candidate_ids),
                        parent_evaluation_ids=list(choice.parent_evaluation_ids),
                        terrain=point_terrain,
                        parent_terrain_screen_ids=parent_screens,
                    )
                queue.append(next_sample)
        if index == len(queue):
            break
        sample = queue[index]
        temporal = temporal_definitions.get(index)
        index += 1
        if sample.status != "READY":
            results.append(
                BrushResultOut(
                    sample=sample, verdict="UNAVAILABLE", errors=[sample.error or "DEM unavailable"]
                )
            )
            continue
        saved: CandidateOut | None = None
        try:
            c = _candidate((sample.east_m, sample.north_m), temporal or definition)
            if c.candidate_id != sample.candidate_id:
                raise ValueError("Candidate identity changed since preview")
            # In all mode save first, so partial failures are traceable and retries are idempotent.
            if definition.retention == "all":
                saved = candidate_store.save(c)
            current_settings = (
                EvaluationRequest(
                    duration_hours=temporal.duration_hours, step_minutes=temporal.step_minutes
                )
                if temporal is not None
                else settings
            )
            result = evaluation.compute(c, current_settings)
            metrics = (
                summarize(result) if result.status in ("COMPUTED_UNVERIFIED", "VALIDATED") else None
            )
            visibility: Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED"]
            if metrics is None:
                visibility = "UNAVAILABLE" if result.status == "UNAVAILABLE" else "ERROR"
            elif temporal is not None:
                visibility = "NOT_EVALUATED"
            else:
                visibility = (
                    "PASS" if meets_constraints(metrics, definition.constraints) else "FAIL"
                )
            verdict = combined_verdict(visibility, definition, sample.terrain)
            if definition.retention == "passing" and verdict == "PASS":
                saved = candidate_store.save(c)
            if saved is not None:
                evaluation.save(result)
            results.append(
                BrushResultOut(
                    sample=sample,
                    verdict=verdict,
                    visibility_verdict=visibility,
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
    frontier = pareto_indices(results, terrain=definition.terrain is not None)
    results = [
        r.model_copy(update={"pareto": i in frontier}) if r.verdict == "PASS" else r
        for i, r in enumerate(results)
    ]
    candidate_set = [
        {
            "east_m": r.sample.east_m,
            "north_m": r.sample.north_m,
            "candidate_id": r.sample.candidate_id,
            "iteration": r.sample.iteration,
            "evaluation_id": r.evaluation.evaluation_id if r.evaluation is not None else None,
        }
        for r in results
    ]
    set_hash = hashlib.sha256(
        json.dumps(candidate_set, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    output = BrushExecutionOut(
        preview=checked,
        candidate_set_id=f"candidate-set-{set_hash}" if definition.sampling == "adaptive" else None,
        results=results,
        notes=[
            "Fractions count stored samples; gaps use sampled intervals "
            "and may differ by up to one step.",
            "Sun and Earth visibility are geometric, not power or communications performance.",
            "Computed results are not independently validated.",
            *(
                [
                    "Terrain screening uses the 20 m interpolated LOLA DEM: coarse screening, "
                    "not certified landing safety; DEM uncertainty and sub-resolution hazards "
                    "are NOT_ASSESSED.",
                ]
                if definition.terrain is not None
                else []
            ),
        ],
        refinement_policy=(
            None
            if definition.sampling != "adaptive"
            else "spatial-lattice-evidence-terrain-v1"
            if definition.evidence == "visibility_terrain"
            else "spatial-lattice-evidence-v1"
        ),
    )
    return brush_store.save(output) if definition.sampling == "adaptive" else output
