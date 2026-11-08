"""Deterministic selection on a polygon-clipped lattice, using computed evidence only."""

from dataclasses import dataclass
from math import dist

Point = tuple[float, float]


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


@dataclass(frozen=True)
class Refinement:
    point: Point
    parent_candidate_ids: tuple[str, ...]
    parent_evaluation_ids: tuple[str, ...]
    reason: str
    priority: str


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
    pool: list[Point], evidence: list[Evidence], used: set[Point]
) -> Refinement | None:
    available = sorted(set(pool) - used)
    if not available or not evidence:
        return None
    ordered = sorted(evidence, key=lambda e: (e.point, e.evaluation_id))
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
            point = min(available, key=lambda p: (dist(p, midpoint), p))
            if dist(point, midpoint) <= dist(a.point, b.point) / 2:
                reason = (
                    "different computed verdicts or visibility/gap metrics"
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
