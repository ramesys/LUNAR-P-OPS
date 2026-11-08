"""Controlled synthetic fields; none of these values represent lunar observations."""

from math import dist
from time import perf_counter

from clps_api.adaptive_brush import Evidence, choose_refinement, choose_seeds

POOL = [(float(x), float(y)) for y in range(5) for x in range(5)]
GRID = [(float(x), float(y)) for y in (0, 2, 4) for x in (0, 2, 4)]
BUDGET = 9


def field(point: tuple[float, float], scenario: str) -> tuple[float, float] | None:
    x, y = point
    if scenario == "obstructed" and x == 2 and y == 2:
        return None
    if scenario == "boundary":
        return (max(0.0, min(1.0, x / 4)), max(0.0, min(1.0, y / 4)))
    if scenario == "tradeoff":
        return (1 - x / 4, x / 4 * (0.5 + y / 8))
    return (max(0.0, 1 - dist(point, (3, 1)) / 5), max(0.0, 1 - dist(point, (1, 3)) / 5))


def run(scenario: str, adaptive: bool) -> tuple[list[tuple[float, float]], dict[str, float]]:
    start = perf_counter()
    chosen = choose_seeds(POOL, 4) if adaptive else GRID[:]
    evidence: list[Evidence] = []
    values: list[tuple[float, float]] = []
    index = 0
    while index < len(chosen) and index < BUDGET:
        p = chosen[index]
        index += 1
        result = field(p, scenario)
        if result is not None:
            sun, earth = result
            values.append(result)
            evidence.append(
                Evidence(
                    p,
                    str(p),
                    f"evaluation:{p}",
                    min(sun, earth),
                    sun >= 0.5 and earth >= 0.5,
                    sun_fraction=sun,
                    earth_fraction=earth,
                    constraint_margin=min(sun - 0.5, earth - 0.5),
                )
            )
        if adaptive and index == len(chosen) and len(chosen) < BUDGET:
            next_point = choose_refinement(POOL, evidence, set(chosen))
            if next_point is not None:
                chosen.append(next_point.point)
    feasible = [(s, e) for s, e in values if s >= 0.5 and e >= 0.5]
    pareto = [
        v for v in values if not any(w != v and w[0] >= v[0] and w[1] >= v[1] for w in values)
    ]
    signs = {e.passes for e in evidence}
    boundary_pairs = sum(
        a.passes != b.passes
        for i, a in enumerate(evidence)
        for b in evidence[i + 1 :]
        if dist(a.point, b.point) <= 2
    )
    coverage = sum(min(dist(p, q) for q in chosen) for p in POOL) / len(POOL)
    return chosen, {
        "feasible_per_evaluation": len(feasible) / len(chosen),
        "best_simultaneous": max((min(s, e) for s, e in values), default=0),
        "boundary_pairs_within_2": float(boundary_pairs),
        "both_verdicts": float(len(signs) == 2),
        "mean_distance_to_sample": coverage,
        "pareto_count": float(len(set(pareto))),
        "seconds": perf_counter() - start,
    }


if __name__ == "__main__":
    import json

    report = {}
    for scenario in ("boundary", "obstructed", "tradeoff"):
        report[scenario] = {}
        for adaptive in (False, True):
            points, metrics = run(scenario, adaptive)
            report[scenario]["adaptive" if adaptive else "uniform"] = {
                "sequence": points,
                "metrics": metrics,
            }
    print(json.dumps(report, indent=2))
