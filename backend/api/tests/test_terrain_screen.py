"""Terrain screening: API contract, real-DEM provenance and terrain-aware adaptive refinement."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from clps_api import brush, brush_store, candidate_store, evaluation, terrain_screen, terrain_store
from clps_api.schemas import (
    BrushDefinition,
    CandidateOut,
    EvaluationOut,
    EvaluationRequest,
    EvaluationSample,
    TerrainProvenanceOut,
    TerrainScreenConstraints,
    TerrainScreenOut,
)
from lunar_core.landing_terrain import (
    SurfaceSlope,
    TerrainMetrics,
    TerrainQuality,
    TerrainRoughness,
)
from pydantic import ValidationError

START = datetime(2026, 11, 7, tzinfo=UTC)
RULES = TerrainScreenConstraints(max_local_slope_deg=10, max_roughness_rms_m=1.5)
REAL = Path("/data") / "terrain"


def _slope(point: tuple[float, float]) -> float:
    """Synthetic field: steep in the west, gentle in the east."""
    return max(0.0, 10.0 - point[0] / 40.0)


def _fake_screens(
    points: list[tuple[float, float]], definition: BrushDefinition
) -> dict[tuple[float, float], TerrainScreenOut]:
    if definition.terrain is None:
        return {}
    provenance = TerrainProvenanceOut(
        algorithm="synthetic",
        terrain_dataset_id="synthetic",
        terrain_source_url="synthetic",
        terrain_dataset_sha256="0" * 64,
        dem_resolution_m=20,
        coordinate_reference="synthetic",
        lunar_core_version="test",
    )
    out: dict[tuple[float, float], TerrainScreenOut] = {}
    for p in points:
        s = _slope(p)
        metrics = TerrainMetrics(
            SurfaceSlope(s, s, s, 40, definition.terrain.neighborhood_radius_m),
            TerrainRoughness(0.5, 2.0, 5.0, definition.terrain.neighborhood_radius_m),
            TerrainQuality(20, 20, "synthetic", 25, 25, 1.0, True),
        )
        out[p] = terrain_screen._output(metrics, definition.terrain, provenance, -89.5, 0, *p)
    return out


def _fakes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> list[tuple[float, float]]:
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    evaluated: list[tuple[float, float]] = []

    def candidate(point: tuple[float, float], definition: BrushDefinition) -> CandidateOut:
        return CandidateOut(
            candidate_id=f"c{point}",
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
        east, north = (float(v) for v in c.candidate_id[2:-1].split(","))
        evaluated.append((east, north))
        visible = north >= 0  # synthetic visibility: the northern half passes
        sample = EvaluationSample(
            time_utc=c.selected_time_utc,
            sun_azimuth_deg=0,
            sun_elevation_deg=1 + north / 100,
            sun_horizon_deg=0,
            sun_visible=visible,
            earth_azimuth_deg=0,
            earth_elevation_deg=1,
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
    monkeypatch.setattr(brush, "_screen_points", _fake_screens)
    return evaluated


def _definition(**update: object) -> BrushDefinition:
    base: dict[str, object] = {
        "polygon": [
            {"east_m": x, "north_m": y}
            for x, y in [(-300, -300), (300, -300), (300, 300), (-300, 300)]
        ],
        "spacing_m": 100,
        "max_points": 10,
        "start_utc": START,
        "duration_hours": 1,
        "step_minutes": 60,
        "sampling": "adaptive",
        "constraints": {"min_simultaneous_fraction": 0.5},
    }
    return BrushDefinition.model_validate({**base, **update})


def test_terrain_evidence_requires_adaptive_sampling_and_constraints() -> None:
    with pytest.raises(ValidationError):
        _definition(evidence="visibility_terrain")
    with pytest.raises(ValidationError):
        _definition(evidence="visibility_terrain", sampling="grid", terrain=RULES.model_dump())


def test_experiment_b_never_spends_attempts_on_terrain_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evaluated = _fakes(monkeypatch, tmp_path)
    b = _definition(terrain=RULES.model_dump(), evidence="visibility_terrain")
    preview = brush.preview(b)
    assert preview.terrain_pool_size == 49
    assert preview.terrain_excluded_count == 21  # east < 0: slope above 10 degrees
    result = brush.execute(b, preview.preview_token)
    assert result.refinement_policy == "spatial-lattice-evidence-terrain-v1"
    assert len(result.results) == b.max_points
    assert all(_slope(p) <= 10 for p in evaluated)
    for r in result.results:
        assert r.sample.terrain is not None and r.sample.terrain.verdict == "PASS"
        assert r.sample.parent_terrain_screen_ids  # every attempt cites terrain evidence
        if r.sample.iteration:
            assert "terrain pre-screen excluded" in (r.sample.reason or "")
            assert r.sample.terrain.screen_id in r.sample.parent_terrain_screen_ids
            assert set(r.sample.parent_terrain_screen_ids) <= {
                s.sample.terrain.screen_id for s in result.results if s.sample.terrain
            }
        # Combined verdict: visibility must pass and terrain must pass.
        assert (r.verdict == "PASS") == (r.sample.north_m >= 0)
    assert any(r.pareto for r in result.results)
    again = brush.execute(b, brush.preview(b).preview_token)

    # Same scientific sequence; only the "already persisted" flags differ on the second run.
    def lineage(run: object) -> list[tuple[object, ...]]:
        return [
            (
                r.sample.east_m,
                r.sample.north_m,
                r.verdict,
                r.sample.reason,
                tuple(r.sample.parent_evaluation_ids),
                tuple(r.sample.parent_terrain_screen_ids),
            )
            for r in run.results  # type: ignore[attr-defined]
        ]

    assert lineage(again) == lineage(result)
    assert again.candidate_set_id == result.candidate_set_id
    assert brush_store.get(result.experiment_id or "") == result


def test_experiment_a_is_unchanged_by_terrain_and_reports_combined_verdicts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evaluated = _fakes(monkeypatch, tmp_path)
    plain = _definition()
    with_terrain = _definition(terrain=RULES.model_dump())
    base = brush.execute(plain, brush.preview(plain).preview_token)
    first = list(evaluated)
    a = brush.execute(with_terrain, brush.preview(with_terrain).preview_token)
    assert evaluated[len(first) :] == first  # identical visibility-only selection sequence
    assert a.refinement_policy == base.refinement_policy == "spatial-lattice-evidence-v1"
    assert [r.sample.reason for r in a.results] == [r.sample.reason for r in base.results]
    assert all(r.sample.terrain is None for r in base.results)
    assert all(r.verdict == r.visibility_verdict for r in base.results)
    for r in a.results:
        assert r.sample.terrain is not None
        if r.visibility_verdict == "PASS" and r.sample.terrain.verdict == "FAIL":
            assert r.verdict == "FAIL"
        else:
            assert r.verdict == r.visibility_verdict
    assert any(r.visibility_verdict == "PASS" and r.verdict == "FAIL" for r in a.results)
    assert any("not certified landing safety" in note for note in a.notes)


def test_missing_dem_is_not_assessed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: tmp_path)
    terrain_screen.clear_cache()
    (screen,) = terrain_screen.screen_roi_points([(0.0, 0.0)], RULES)
    assert screen.status == "UNAVAILABLE" and screen.verdict == "NOT_ASSESSED"
    assert screen.errors and screen.slope is None
    definition = _definition(terrain=RULES.model_dump())
    assert brush.combined_verdict("PASS", definition, screen) == "NOT_ASSESSED"
    assert brush.combined_verdict("FAIL", definition, screen) == "FAIL"
    assert brush.combined_verdict("PASS", _definition(), None) == "PASS"


@pytest.mark.skipif(
    not (REAL / "shackleton-rim-b_near.npz").is_file(), reason="Real LOLA window unavailable"
)
def test_real_dem_screen_is_reproducible_with_provenance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from clps_api.main import app
    from fastapi.testclient import TestClient

    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: REAL)
    terrain_screen.clear_cache()
    client = TestClient(app)
    created = client.post(
        "/api/rois/shackleton-rim-b/candidates",
        json={
            "east_m": -600,
            "north_m": 900,
            "observer_height_m": 3,
            "selected_time_utc": "2026-11-07T00:00:00Z",
        },
    )
    assert created.status_code == 200, created.text
    candidate = created.json()
    url = f"/api/candidates/{candidate['candidate_id']}/terrain-screen"
    first = client.get(url, params=RULES.model_dump(exclude_none=True))
    assert first.status_code == 200, first.text
    screen = TerrainScreenOut.model_validate(first.json())
    assert screen.status == "COMPUTED_UNVERIFIED"
    assert screen.provenance is not None
    assert screen.provenance.terrain_dataset_sha256 == candidate["terrain_dataset_sha256"]
    assert screen.provenance.terrain_dataset_id == "LDEM_80S_20MPP_ADJ"
    assert screen.east_m == pytest.approx(-600, abs=1e-6)
    assert screen.north_m == pytest.approx(900, abs=1e-6)
    assert screen.slope and screen.slope.local_slope_deg is not None
    assert screen.quality and screen.quality.coverage_fraction == 1.0
    assert screen.quality.vertical_uncertainty == "NOT_ASSESSED"
    assert any("uncertainty" in item for item in screen.not_assessed)
    checks = {c.name: c for c in screen.checks}
    assert checks["local_slope_deg"].status == (
        "PASS" if screen.slope.local_slope_deg <= 10 else "FAIL"
    )
    assert client.get(url, params=RULES.model_dump(exclude_none=True)).json() == first.json()
    # The ROI-point screen at the same offsets reports the same metrics.
    (same,) = terrain_screen.screen_roi_points([(-600.0, 900.0)], RULES)
    assert same.slope == screen.slope and same.roughness == screen.roughness
    stricter = client.get(
        url, params={**RULES.model_dump(exclude_none=True), "max_local_slope_deg": 0.1}
    ).json()
    assert stricter["screen_id"] != screen.screen_id and stricter["verdict"] == "FAIL"
    assert stricter["slope"] == first.json()["slope"]
    assert client.get("/api/candidates/missing/terrain-screen").status_code == 404
    assert client.get(url, params={"neighborhood_radius_m": 10}).status_code == 422
    assert client.get(url, params={"unknown": 1}).status_code == 422
    assert len(candidate_store.roots("shackleton-rim-b")) == 1
