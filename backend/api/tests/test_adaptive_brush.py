"""Evidence-guided selection must be deterministic and auditable."""

from pathlib import Path

import pytest
from clps_api.adaptive_brush import Evidence, choose_refinement, choose_seeds


def test_seeds_are_distributed_and_repeatable():
    pool = [(float(x), float(y)) for y in range(3) for x in range(3)]
    seeds = choose_seeds(pool, 4)
    assert seeds == choose_seeds(pool, 4)
    assert len(set(seeds)) == 4
    assert (0.0, 0.0) in seeds and (2.0, 2.0) in seeds


def test_refinement_uses_evidence_and_reports_its_parents():
    pool = [(float(x), float(y)) for y in range(3) for x in range(5)]
    a = Evidence((0.0, 0.0), "a", "ea", 0.0, False)
    b = Evidence((4.0, 0.0), "b", "eb", 1.0, True)
    c = Evidence((0.0, 2.0), "c", "ec", 0.0, False)
    selected = choose_refinement(pool, [a, b, c], {a.point, b.point, c.point})
    assert selected is not None
    assert selected.point == (2.0, 0.0)
    assert selected.parent_evaluation_ids == ("ea", "eb")
    assert "different" in selected.reason
    changed = choose_refinement(
        pool, [a, Evidence(b.point, "b", "eb", 0.0, False), c], {a.point, b.point, c.point}
    )
    assert changed is not None
    assert (changed.point, changed.reason) != (selected.point, selected.reason)


def test_no_evidence_or_no_unused_points_produces_no_refinement():
    assert choose_refinement([(0.0, 0.0)], [], set()) is None
    e = Evidence((0.0, 0.0), "a", "ea", 0.5, True)
    assert choose_refinement([e.point], [e], {e.point}) is None


def test_adaptive_execution_is_budgeted_and_uses_prior_evaluations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from datetime import UTC, datetime

    from clps_api import brush, candidate_store, evaluation
    from clps_api.schemas import (
        BrushDefinition,
        CandidateOut,
        EvaluationOut,
        EvaluationRequest,
        EvaluationSample,
    )

    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    start = datetime(2026, 11, 7, tzinfo=UTC)

    def candidate(point: tuple[float, float], definition: BrushDefinition) -> CandidateOut:
        return CandidateOut(
            candidate_id=f"{point}",
            site_id="shackleton-rim-b",
            terrain_window_id="shackleton-rim-b",
            latitude_deg=-89.5,
            longitude_deg=0,
            terrain_elevation_m=0,
            observer_height_m=3,
            selected_time_utc=start,
            terrain_dataset_id="LOLA",
            terrain_source_url="u",
            dem_resolution_m=20,
            coordinate_reference="MOON_ME",
            validation_status="not_independently_validated",
            data_availability="available",
        )

    def compute(c: CandidateOut, req: EvaluationRequest) -> EvaluationOut:
        visible = c.candidate_id.startswith("(100")
        sample = EvaluationSample(
            time_utc=start,
            sun_azimuth_deg=0,
            sun_elevation_deg=0,
            sun_horizon_deg=0,
            sun_visible=visible,
            earth_azimuth_deg=0,
            earth_elevation_deg=0,
            earth_horizon_deg=0,
            earth_visible=visible,
            simultaneous_visible=visible,
        )
        return EvaluationOut(
            evaluation_id="e" + c.candidate_id,
            candidate_id=c.candidate_id,
            status="COMPUTED_UNVERIFIED",
            candidate=c,
            request=req,
            provenance={},
            warnings=[],
            errors=[],
            samples=[sample],
        )

    monkeypatch.setattr(brush, "_candidate", candidate)
    monkeypatch.setattr(evaluation, "compute", compute)
    definition = BrushDefinition.model_validate(
        {
            "polygon": [
                {"east_m": x, "north_m": y} for x, y in [(0, 0), (200, 0), (200, 200), (0, 200)]
            ],
            "spacing_m": 100,
            "max_points": 6,
            "start_utc": start,
            "duration_hours": 1,
            "step_minutes": 60,
            "sampling": "adaptive",
        }
    )
    from clps_api.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    assert client.get("/api/brush-experiments/missing").status_code == 404
    assert not (tmp_path / "candidates.sqlite3").exists()
    preview = brush.preview(definition)
    assert len(preview.samples) == 4
    assert not (tmp_path / "candidates.sqlite3").exists()
    result = brush.execute(definition, preview.preview_token)
    assert len(result.results) == 6
    refined = result.results[4:]
    assert all(r.sample.iteration > 0 and r.sample.parent_evaluation_ids for r in refined)
    assert all(r.sample.reason and r.evaluation for r in refined)
    for index, row in enumerate(result.results):
        previous = {r.evaluation.evaluation_id for r in result.results[:index] if r.evaluation}
        if row.sample.iteration:
            assert set(row.sample.parent_evaluation_ids) <= previous
    assert len(candidate_store.roots("shackleton-rim-b")) == 6
    from clps_api import brush_store

    assert result.experiment_id is not None
    assert result.candidate_set_id is not None
    retry = brush.execute(definition, preview.preview_token)
    assert retry.candidate_set_id == result.candidate_set_id
    restored = brush_store.get(result.experiment_id)
    assert restored == result
    assert restored.results[4].sample.parent_evaluation_ids
    response = client.get(f"/api/brush-experiments/{result.experiment_id}")
    assert response.status_code == 200
    assert response.json() == result.model_dump(mode="json")


def test_controlled_comparison_has_equal_budget_and_evidence_changes_sequence():
    from api.tests.adaptive_comparison import BUDGET, POOL, run

    uniform, _ = run("boundary", False)
    adaptive, _ = run("boundary", True)
    changed, _ = run("tradeoff", True)
    assert len(uniform) == len(adaptive) == len(changed) == BUDGET
    assert set(uniform) <= set(POOL) and set(adaptive) <= set(POOL)
    assert adaptive != uniform
    assert adaptive != changed
    assert adaptive == run("boundary", True)[0]


def test_refinement_reserves_periodic_spatial_exploration_despite_a_boundary():
    pool = [(float(x), float(y)) for y in range(5) for x in range(5)]
    points = [(0.0, 0.0), (4.0, 4.0), (0.0, 4.0), (4.0, 0.0), (0.0, 2.0), (0.0, 3.0)]
    evidence = [Evidence(p, str(p), str(p), float(p[1] >= 3), p[1] >= 3) for p in points]
    result = choose_refinement(pool, evidence, set(points))
    assert result is not None
    assert "explor" in result.reason.lower()
    assert result.point == (2.0, 1.0)


def test_individual_visibility_differences_can_trigger_refinement():
    pool = [(float(x), float(y)) for y in range(3) for x in range(5)]
    a = Evidence((0.0, 0.0), "a", "ea", 0.2, False, sun_fraction=0.2, earth_fraction=1.0)
    b = Evidence((4.0, 0.0), "b", "eb", 0.2, False, sun_fraction=1.0, earth_fraction=0.2)
    c = Evidence((0.0, 2.0), "c", "ec", 0.2, False, sun_fraction=0.2, earth_fraction=1.0)
    selected = choose_refinement(pool, [a, b, c], {a.point, b.point, c.point})
    assert selected is not None
    assert selected.point == (2.0, 0.0)
    assert selected.parent_evaluation_ids == ("ea", "eb")
    assert "visibility" in selected.reason.lower()


def test_boundary_reason_is_not_used_for_a_remote_unexplored_point():
    a = Evidence((0.0, 0.0), "a", "ea", 0.0, False)
    b = Evidence((4.0, 0.0), "b", "eb", 1.0, True)
    selected = choose_refinement([a.point, b.point, (20.0, 20.0)], [a, b], {a.point, b.point})
    assert selected is not None and selected.point == (20.0, 20.0)
    assert "explor" in selected.reason.lower()


def test_transition_refinement_recomputes_finer_samples_within_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from datetime import UTC, datetime, timedelta

    from clps_api import brush, evaluation
    from clps_api.schemas import (
        BrushDefinition,
        CandidateOut,
        EvaluationOut,
        EvaluationRequest,
        EvaluationSample,
    )

    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    start = datetime(2026, 11, 7, tzinfo=UTC)

    def candidate(point: tuple[float, float], definition: BrushDefinition) -> CandidateOut:
        return CandidateOut(
            candidate_id=f"{point}:{definition.start_utc.isoformat()}",
            site_id="s",
            terrain_window_id="shackleton-rim-b",
            latitude_deg=-89.5,
            longitude_deg=0,
            terrain_elevation_m=0,
            observer_height_m=3,
            selected_time_utc=definition.start_utc,
            terrain_dataset_id="LOLA",
            terrain_source_url="u",
            dem_resolution_m=20,
            coordinate_reference="MOON_ME",
            validation_status="not_independently_validated",
            data_availability="available",
        )

    def compute(c: CandidateOut, req: EvaluationRequest) -> EvaluationOut:
        count = int(req.duration_hours * 60 / req.step_minutes)
        samples = [
            EvaluationSample(
                time_utc=c.selected_time_utc + timedelta(minutes=i * req.step_minutes),
                sun_azimuth_deg=0,
                sun_elevation_deg=0,
                sun_horizon_deg=0,
                sun_visible=i > 0,
                earth_azimuth_deg=0,
                earth_elevation_deg=0,
                earth_horizon_deg=0,
                earth_visible=True,
                simultaneous_visible=i > 0,
            )
            for i in range(count)
        ]
        return EvaluationOut(
            evaluation_id=f"eval:{c.candidate_id}:{req.step_minutes}",
            candidate_id=c.candidate_id,
            status="COMPUTED_UNVERIFIED",
            candidate=c,
            request=req,
            provenance={},
            warnings=[],
            errors=[],
            samples=samples,
        )

    monkeypatch.setattr(brush, "_candidate", candidate)
    monkeypatch.setattr(evaluation, "compute", compute)
    definition = BrushDefinition.model_validate(
        {
            "polygon": [
                {"east_m": x, "north_m": y} for x, y in [(0, 0), (400, 0), (400, 400), (0, 400)]
            ],
            "spacing_m": 100,
            "max_points": 5,
            "start_utc": start,
            "duration_hours": 6,
            "step_minutes": 60,
            "sampling": "adaptive",
        }
    )
    preview = brush.preview(definition)
    outcome = brush.execute(definition, preview.preview_token)
    assert len(outcome.results) == 5
    refined = outcome.results[-1]
    assert "transition" in (refined.sample.reason or "").lower()
    assert refined.evaluation is not None and refined.evaluation.request.step_minutes == 30
    assert refined.evaluation.request.duration_hours == 1
    assert refined.evaluation.candidate.selected_time_utc >= start
    assert refined.evaluation.candidate.selected_time_utc + timedelta(hours=1) <= start + timedelta(
        hours=6
    )
    assert (
        sum(len(r.evaluation.samples) for r in outcome.results if r.evaluation)
        <= preview.estimated_total_samples
    )
    assert refined.sample.parent_evaluation_ids == [outcome.results[0].evaluation.evaluation_id]


def test_near_constraint_margin_guides_even_equal_verdicts_and_records_priority():
    pool = [(float(x), 0.0) for x in range(5)]
    a = Evidence((0.0, 0.0), "a", "ea", 0.4, False, constraint_margin=-0.01)
    b = Evidence((4.0, 0.0), "b", "eb", 0.4, False, constraint_margin=-0.01)
    choice = choose_refinement(pool, [a, b], {a.point, b.point})
    assert choice is not None and choice.point == (2.0, 0.0)
    assert "margin" in choice.reason.lower()
    assert "margin" in choice.priority.lower()


def test_pareto_comparison_preserves_feasible_tradeoffs():
    from clps_api.brush import pareto_indices
    from clps_api.schemas import BrushMetrics, BrushResultOut, BrushSampleOut

    def result(
        sun: float, earth: float, both: float, darkness: float, gap: float, verdict: str
    ) -> BrushResultOut:
        return BrushResultOut(
            sample=BrushSampleOut(east_m=0, north_m=0, status="READY"),
            verdict=verdict,
            metrics=BrushMetrics(
                sample_count=4,
                duration_hours=4,
                sun_fraction=sun,
                earth_fraction=earth,
                simultaneous_fraction=both,
                longest_darkness_hours=darkness,
                longest_earth_gap_hours=gap,
            ),
        )

    rows = [
        result(0.9, 0.5, 0.5, 1, 1, "PASS"),
        result(0.5, 0.9, 0.5, 1, 1, "PASS"),
        result(0.4, 0.4, 0.3, 2, 2, "PASS"),
        result(1, 1, 1, 0, 0, "FAIL"),
    ]
    assert pareto_indices(rows) == {0, 1}


def test_adaptive_preview_rejects_excessive_total_work_without_creating_records(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from datetime import UTC, datetime

    from clps_api import brush
    from clps_api.schemas import BrushDefinition

    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    definition = BrushDefinition.model_validate(
        {
            "polygon": [
                {"east_m": x, "north_m": y}
                for x, y in [(-500, -500), (500, -500), (500, 500), (-500, 500)]
            ],
            "spacing_m": 20,
            "max_points": 64,
            "start_utc": datetime(2026, 11, 7, tzinfo=UTC),
            "duration_hours": 168,
            "step_minutes": 1,
            "sampling": "adaptive",
        }
    )
    with pytest.raises(ValueError, match="8192"):
        brush.preview(definition)
    assert not (tmp_path / "candidates.sqlite3").exists()


def test_preview_reserves_budget_for_temporal_attempt_after_spatial_pool_is_exhausted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from datetime import UTC, datetime

    from clps_api import brush
    from clps_api.schemas import BrushDefinition

    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))

    def missing(*_args: object, **_kwargs: object) -> None:
        raise ValueError("DEM unavailable")

    monkeypatch.setattr(brush, "_candidate", missing)
    definition = BrushDefinition.model_validate(
        {
            "polygon": [
                {"east_m": x, "north_m": y} for x, y in [(0, 0), (100, 0), (100, 100), (0, 100)]
            ],
            "spacing_m": 100,
            "max_points": 5,
            "start_utc": datetime(2026, 11, 7, tzinfo=UTC),
            "duration_hours": 6,
            "step_minutes": 60,
            "sampling": "adaptive",
        }
    )
    preview = brush.preview(definition)
    assert len(preview.samples) == 4
    assert preview.estimated_total_samples == 30
    larger_budget = definition.model_copy(update={"max_points": 16})
    assert brush.preview(larger_budget).estimated_total_samples == 24
