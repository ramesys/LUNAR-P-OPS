"""Controlled comparison: Experiment A (visibility-only) vs B (visibility + terrain) evidence.

Both runs use the real LOLA windows and SPICE kernels with an identical region, time interval,
attempt budget, visibility constraints and terrain constraints; only `evidence` differs. Run
with a disposable database (CLPS_DATA_DIR pointing at a temporary directory that links the
kernels and terrain read-only):

    python -m api.tests.terrain_comparison

Prints JSON with every attempted location and summary counts. Results are COMPUTED_UNVERIFIED.
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

from clps_api import brush, evaluation, terrain_screen, terrain_store
from clps_api.schemas import BrushDefinition, BrushExecutionOut
from lunar_core.kernels import load_kernels

SOURCE = Path(os.environ.get("CLPS_SOURCE_DATA", "/data"))
HALF = 800
SETTINGS: dict[str, object] = {
    "polygon": [
        {"east_m": e, "north_m": n}
        for e, n in [(-HALF, -HALF), (HALF, -HALF), (HALF, HALF), (-HALF, HALF)]
    ],
    "spacing_m": 100,
    "max_points": 12,
    "observer_height_m": 3,
    "start_utc": "2027-04-10T00:00:00Z",
    "duration_hours": 168,
    "step_minutes": 360,
    "sampling": "adaptive",
    "retention": "all",
    "constraints": {"min_sun_fraction": 0.55, "min_earth_fraction": 0.8},
    "terrain": {
        "neighborhood_radius_m": 100,
        "max_local_slope_deg": 12,
        "max_neighborhood_slope_deg": 12,
        "max_roughness_rms_m": 1.5,
        "min_coverage_fraction": 1,
    },
}

SCENARIOS: dict[str, dict[str, object]] = {
    # Sun fractions vary spatially in this week (about 0.46-0.61 at sample points).
    "april-2027": {},
    # Sun fraction is near zero everywhere: no location can meet the visibility constraint.
    "november-2026": {"start_utc": "2026-11-07T00:00:00Z"},
}


def summary(run: BrushExecutionOut, seconds: float) -> dict[str, object]:
    spatial = [r for r in run.results if r.verdict != "NOT_EVALUATED"]
    terrain = [r.sample.terrain.verdict if r.sample.terrain else None for r in spatial]
    combined = [r for r in spatial if r.verdict == "PASS"]
    return {
        "policy": run.refinement_policy,
        "attempts": len(run.results),
        "full_window_attempts": len(spatial),
        "location_time_samples": sum(
            len(r.evaluation.samples) for r in run.results if r.evaluation
        ),
        "visibility_pass": sum(r.visibility_verdict == "PASS" for r in spatial),
        "terrain_pass": terrain.count("PASS"),
        "terrain_fail_attempts": terrain.count("FAIL"),
        "combined_pass": len(combined),
        "best_combined_sun_fraction": max(
            (r.metrics.sun_fraction for r in combined if r.metrics), default=None
        ),
        "pareto_count": sum(bool(r.pareto) for r in run.results),
        "terrain_pool_size": run.preview.terrain_pool_size,
        "terrain_excluded": run.preview.terrain_excluded_count,
        "seconds": round(seconds, 2),
        "sequence": [
            {
                "east_m": r.sample.east_m,
                "north_m": r.sample.north_m,
                "iteration": r.sample.iteration,
                "verdict": r.verdict,
                "visibility": r.visibility_verdict,
                "terrain": r.sample.terrain.verdict if r.sample.terrain else None,
                "local_slope_deg": r.sample.terrain.slope.local_slope_deg
                if r.sample.terrain and r.sample.terrain.slope
                else None,
                "rms_m": r.sample.terrain.roughness.rms_residual_m
                if r.sample.terrain and r.sample.terrain.roughness
                else None,
                "sun_fraction": r.metrics.sun_fraction if r.metrics else None,
                "reason": r.sample.reason,
            }
            for r in run.results
        ],
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "kernels").symlink_to(SOURCE / "kernels", target_is_directory=True)
        os.environ["CLPS_DATA_DIR"] = tmp
        terrain_store.terrain_dir = lambda: SOURCE / "terrain"  # type: ignore[assignment]
        load_kernels(SOURCE / "kernels")
        evaluation.record_loaded_kernel_hashes()
        out: dict[str, object] = {"settings": SETTINGS}
        for scenario, update in SCENARIOS.items():
            for label, evidence in (("A", "visibility"), ("B", "visibility_terrain")):
                terrain_screen.clear_cache()
                definition = BrushDefinition.model_validate(
                    {**SETTINGS, **update, "evidence": evidence}
                )
                start = time.perf_counter()
                run = brush.execute(definition, brush.preview(definition).preview_token)
                out[f"{scenario}:{label}"] = summary(run, time.perf_counter() - start)
        # Terrain screen of the whole lattice, for context (cheap; no visibility evaluation).
        pool = brush.sample_polygon(
            [(p["east_m"], p["north_m"]) for p in SETTINGS["polygon"]],  # type: ignore[index, union-attr]
            100,
            100_000,
            2000,
        )
        screens = terrain_screen.screen_roi_points(
            pool,
            BrushDefinition.model_validate(SETTINGS).terrain,  # type: ignore[arg-type]
        )
        out["lattice_terrain"] = {
            v: sum(s.verdict == v for s in screens) for v in ("PASS", "FAIL", "NOT_ASSESSED")
        }
    json.dump(out, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
