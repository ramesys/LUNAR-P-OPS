"""Deterministic selection on a polygon-clipped lattice, using computed evidence only.

Without a terrain context the policy is the visibility-only Experiment A policy. With one
(Experiment B), lattice points whose DEM terrain screen FAILs are never proposed, terrain metric
differences between parents count as evidence, and ties near a proposed location go to the
point with the larger terrain margin. Points whose terrain is NOT_ASSESSED stay eligible but rank
after assessed ones.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from math import dist

Point = tuple[float, float]


@dataclass(frozen=True)
class TerrainScore:
    """DEM terrain screen of one lattice point, computed before any evaluation there."""

    verdict: str
    margin: float | None
    screen_id: str


@dataclass(frozen=True)
class Evidence:
    point: Point
    candidate_id: str
    evaluation_id: str
    simultaneous_fraction: float
    passes: bool
    sun_fraction: float = 0.0
    earth_fraction: float = 0.0
    darkness_fraction: float = 0.0
    earth_gap_fraction: float = 0.0
    constraint_margin: float | None = None
    horizon_proximity: float = 0.0
    terrain_values: tuple[float, ...] = ()
    """Normalized terrain metrics (value / limit); empty for visibility-only evidence."""
    terrain_screen_id: str | None = None


@dataclass(frozen=True)
class Refinement:
    point: Point
    parent_candidate_ids: tuple[str, ...]
    parent_evaluation_ids: tuple[str, ...]
    reason: str
    priority: str
    parent_terrain_screen_ids: tuple[str, ...] = ()


def choose_seeds(pool: list[Point], count: int) -> list[Point]:
    remaining = sorted(set(pool))
    if not remaining or count <= 0:
        return []
    selected = [remaining.pop(0)]
    while remaining and len(selected) < count:
        point = max(remaining, key=lambda p: (min(dist(p, s) for s in selected), -p[0], -p[1]))
        selected.append(point)
        remaining.remove(point)
    return selected


def choose_refinement(
    pool: list[Point],
    evidence: list[Evidence],
    used: set[Point],
    terrain: Mapping[Point, TerrainScore] | None = None,
) -> Refinement | None:
    unattempted = sorted(set(pool) - used)
    available = (
        unattempted
        if terrain is None
        else [p for p in unattempted if p in terrain and terrain[p].verdict != "FAIL"]
    )
    if not available or not evidence:
        return None
    ordered = sorted(evidence, key=lambda e: (e.point, e.evaluation_id))
    choice = _choose(available, ordered, used, terrain)
    if terrain is None:
        return choice
    score = terrain[choice.point]
    excluded = len(unattempted) - len(available)
    margin = "not assessed" if score.margin is None else f"{score.margin:.3g}"
    return Refinement(
        choice.point,
        choice.parent_candidate_ids,
        choice.parent_evaluation_ids,
        f"{choice.reason}; terrain pre-screen excluded {excluded} of {len(unattempted)} "
        f"unattempted lattice points (LandingZoneScreen FAIL)",
        f"{choice.priority}; selected point terrain {score.verdict}, margin {margin}",
        (
            *(
                e.terrain_screen_id
                for e in ordered
                if e.evaluation_id in choice.parent_evaluation_ids and e.terrain_screen_id
            ),
            score.screen_id,
        ),
    )


def _choose(
    available: list[Point],
    ordered: list[Evidence],
    used: set[Point],
    terrain: Mapping[Point, TerrainScore] | None,
) -> Refinement:
    def terrain_rank(p: Point) -> tuple[int, float]:
        if terrain is None:
            return (0, 0.0)
        m = terrain[p].margin
        return (1, 0.0) if m is None else (0, -m)

    # Reserve every third post-seed proposal for spatial coverage, including failed
    # attempts in the coverage set so unavailable locations are not repeatedly tried.
    if len(used) >= 6 and (len(used) - 4) % 3 == 2:
        point = max(available, key=lambda p: (min(dist(p, q) for q in used), -p[0], -p[1]))
        parent = min(ordered, key=lambda e: (dist(point, e.point), e.point, e.evaluation_id))
        return Refinement(
            point,
            (parent.candidate_id,),
            (parent.evaluation_id,),
            "Periodic exploration of an underexplored location; nearest computed evidence",
            "periodic spatial exploration; maximize distance to attempted locations",
        )

    def difference(a: Evidence, b: Evidence) -> float:
        return max(
            abs(a.simultaneous_fraction - b.simultaneous_fraction),
            abs(a.sun_fraction - b.sun_fraction),
            abs(a.earth_fraction - b.earth_fraction),
            abs(a.darkness_fraction - b.darkness_fraction),
            abs(a.earth_gap_fraction - b.earth_gap_fraction),
            *(abs(x - y) for x, y in zip(a.terrain_values, b.terrain_values, strict=False)),
        )

    def margin_distance(a: Evidence, b: Evidence) -> float:
        values = [abs(v) for v in (a.constraint_margin, b.constraint_margin) if v is not None]
        return min(values, default=float("inf"))

    pairs = [(a, b) for i, a in enumerate(ordered) for b in ordered[i + 1 :]]
    if pairs:
        a, b = max(
            pairs,
            key=lambda pair: (
                pair[0].passes != pair[1].passes,
                -margin_distance(pair[0], pair[1]),
                difference(pair[0], pair[1]),
                max(pair[0].horizon_proximity, pair[1].horizon_proximity),
                -dist(pair[0].point, pair[1].point),
            ),
        )
        margin = margin_distance(a, b)
        proximity = max(a.horizon_proximity, b.horizon_proximity)
        if a.passes != b.passes or difference(a, b) > 0 or margin <= 0.1 or proximity >= 0.5:
            midpoint = ((a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2)
            point = min(available, key=lambda p: (dist(p, midpoint), terrain_rank(p), p))
            if dist(point, midpoint) <= dist(a.point, b.point) / 2:
                reason = (
                    (
                        "different computed verdicts or visibility/gap/terrain metrics"
                        if terrain is not None
                        else "different computed verdicts or visibility/gap metrics"
                    )
                    if a.passes != b.passes or difference(a, b) > 0
                    else "near an active constraint margin or sampled horizon"
                )
                return Refinement(
                    point,
                    (a.candidate_id, b.candidate_id),
                    (a.evaluation_id, b.evaluation_id),
                    reason,
                    f"verdict difference={a.passes != b.passes}; margin distance={margin:.6g}; "
                    f"metric difference={difference(a, b):.6g}; horizon proximity={proximity:.6g}; "
                    f"parent distance={dist(a.point, b.point):.6g}",
                )
    point = max(available, key=lambda p: (min(dist(p, q) for q in used), -p[0], -p[1]))
    nearest = min(ordered, key=lambda e: (dist(point, e.point), e.point, e.evaluation_id))
    return Refinement(
        point,
        (nearest.candidate_id,),
        (nearest.evaluation_id,),
        "Underexplored location; nearest computed evidence, no eligible difference-guided point",
        "spatial exploration; maximize distance to attempted locations",
    )
