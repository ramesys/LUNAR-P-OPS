from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from clps_api.brush import sample_polygon, summarize
from clps_api.schemas import CandidateOut, EvaluationOut, EvaluationRequest, EvaluationSample


def test_sampling_is_deterministic_and_includes_boundary():
    polygon = [(-100.0, -100.0), (100.0, -100.0), (100.0, 100.0), (-100.0, 100.0)]
    points = sample_polygon(polygon, 100, 16, 2000)
    assert points == [(e, n) for n in (-100, 0, 100) for e in (-100, 0, 100)]
    assert sample_polygon(polygon, 100, 16, 2000) == points
    with pytest.raises(ValueError, match="exceeds"):
        sample_polygon(polygon, 100, 8, 2000)


def test_rejects_invalid_or_outside_polygons():
    with pytest.raises(ValueError, match="intersect"):
        sample_polygon([(-100, -100), (100, 100), (-100, 100), (100, -100)], 100, 16, 2000)
    with pytest.raises(ValueError, match="outside"):
        sample_polygon([(0, 0), (3000, 0), (0, 100)], 100, 16, 2000)


def test_temporal_metrics_use_sample_fractions_and_partial_final_interval():
    from clps_api.schemas import CandidateOut

    start = datetime(2026, 11, 7, tzinfo=UTC)
    candidate = CandidateOut(
        candidate_id="c",
        site_id="s",
        latitude_deg=-89.5,
        longitude_deg=0,
        terrain_elevation_m=0,
        observer_height_m=2,
        selected_time_utc=start,
        terrain_dataset_id="LOLA",
        terrain_source_url="u",
        dem_resolution_m=20,
        coordinate_reference="MOON_ME",
        validation_status="not_independently_validated",
        data_availability="available",
    )
    samples = [
        EvaluationSample(
            time_utc=start + timedelta(hours=i),
            sun_azimuth_deg=0,
            sun_elevation_deg=0,
            sun_horizon_deg=0,
            sun_visible=sun,
            earth_azimuth_deg=0,
            earth_elevation_deg=0,
            earth_horizon_deg=0,
            earth_visible=earth,
            simultaneous_visible=sun and earth,
        )
        for i, (sun, earth) in enumerate([(True, False), (False, False), (False, True)])
    ]
    result = EvaluationOut(
        evaluation_id="e",
        candidate_id="c",
        status="COMPUTED_UNVERIFIED",
        candidate=candidate,
        request=EvaluationRequest(duration_hours=2.5, step_minutes=60),
        provenance={},
        warnings=[],
        errors=[],
        samples=samples,
    )
    metrics = summarize(result)
    assert metrics.sun_fraction == pytest.approx(1 / 3)
    assert metrics.earth_fraction == pytest.approx(1 / 3)
    assert metrics.simultaneous_fraction == 0
    assert metrics.longest_darkness_hours == pytest.approx(1.5)
    assert metrics.longest_earth_gap_hours == pytest.approx(2)


def test_real_brush_preview_execution_and_retry_are_isolated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from clps_api import candidate_store, evaluation, terrain_store
    from clps_api.main import app
    from fastapi.testclient import TestClient
    from lunar_core.kernels import KERNELS, load_kernels
    from lunar_core.terrain import terrain_files

    real = Path("/data")
    near, far = terrain_files(real / "terrain", "shackleton-rim-b")
    if (
        not near.is_file()
        or not far.is_file()
        or not all((real / "kernels" / k.filename).is_file() for k in KERNELS)
    ):
        pytest.skip("Real LOLA windows or SPICE kernels unavailable")
    (tmp_path / "kernels").symlink_to(real / "kernels", target_is_directory=True)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: real / "terrain")
    load_kernels(real / "kernels")
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", evaluation.kernel_hashes())
    client = TestClient(app)
    definition = {
        "polygon": [
            {"east_m": -50, "north_m": -50},
            {"east_m": 50, "north_m": -50},
            {"east_m": 50, "north_m": 50},
            {"east_m": -50, "north_m": 50},
        ],
        "spacing_m": 100,
        "max_points": 16,
        "observer_height_m": 3,
        "start_utc": "2026-11-07T00:00:00Z",
        "duration_hours": 2,
        "step_minutes": 60,
    }
    response = client.post("/api/rois/shackleton-rim-b/brush/preview", json=definition)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["ready_count"] == 1 and preview["estimated_total_samples"] == 2
    assert preview["new_count"] == 1 and preview["existing_count"] == 0
    assert not (tmp_path / "candidates.sqlite3").exists()
    assert candidate_store.roots("shackleton-rim-b") == []
    body = {"definition": definition, "preview_token": preview["preview_token"], "confirmed": True}
    assert (
        client.post(
            "/api/rois/shackleton-rim-b/brush/execute", json={**body, "confirmed": False}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/rois/shackleton-rim-b/brush/execute", json={**body, "preview_token": "stale"}
        ).status_code
        == 422
    )
    assert candidate_store.roots("shackleton-rim-b") == []
    result = client.post("/api/rois/shackleton-rim-b/brush/execute", json=body)
    assert result.status_code == 200, result.text
    item = result.json()["results"][0]
    assert item["verdict"] == "PASS" and item["persisted"] is True
    assert item["candidate"]["parent_candidate_id"] is None
    assert item["evaluation"]["status"] == "COMPUTED_UNVERIFIED"
    assert item["evaluation"]["candidate_id"] == item["candidate"]["candidate_id"]
    assert item["metrics"]["sample_count"] == 2
    assert evaluation.get(item["evaluation"]["evaluation_id"]) is not None
    retry = client.post("/api/rois/shackleton-rim-b/brush/execute", json=body).json()["results"][0]
    assert retry["candidate"]["candidate_id"] == item["candidate"]["candidate_id"]
    assert retry["evaluation"]["evaluation_id"] == item["evaluation"]["evaluation_id"]
    assert len(candidate_store.roots("shackleton-rim-b")) == 1
    assert len(evaluation.list_for(item["candidate"]["candidate_id"])) == 1
    after_retry = client.post("/api/rois/shackleton-rim-b/brush/preview", json=definition).json()
    assert after_retry["new_count"] == 0 and after_retry["existing_count"] == 1
    assert after_retry["preview_token"] == preview["preview_token"]

    # A failure after saving a new C0 is explicit; retry reuses that C0 and saves its result.
    changed = {**definition, "observer_height_m": 4}
    second_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=changed).json()
    second_body = {
        "definition": changed,
        "preview_token": second_preview["preview_token"],
        "confirmed": True,
    }
    original_compute = evaluation.compute

    def fail_once(*_args: object, **_kwargs: object) -> EvaluationOut:
        raise RuntimeError("simulated interruption")

    monkeypatch.setattr(evaluation, "compute", fail_once)
    failed = client.post("/api/rois/shackleton-rim-b/brush/execute", json=second_body).json()[
        "results"
    ][0]
    assert failed["verdict"] == "ERROR" and failed["persisted"] is True
    assert failed["evaluation"] is None and "simulated interruption" in failed["errors"][0]
    assert len(candidate_store.roots("shackleton-rim-b")) == 2
    monkeypatch.setattr(evaluation, "compute", original_compute)
    recovered = client.post("/api/rois/shackleton-rim-b/brush/execute", json=second_body).json()[
        "results"
    ][0]
    assert recovered["candidate"]["candidate_id"] == failed["candidate"]["candidate_id"]
    assert recovered["evaluation"]["status"] == "COMPUTED_UNVERIFIED"
    assert len(candidate_store.roots("shackleton-rim-b")) == 2
    assert len(evaluation.list_for(recovered["candidate"]["candidate_id"])) == 1

    # Passing-only mode computes the same science but saves no failing location.
    from clps_api import brush

    passing_definition = {**definition, "observer_height_m": 5, "retention": "passing"}
    passing_preview = client.post(
        "/api/rois/shackleton-rim-b/brush/preview", json=passing_definition
    ).json()
    passing_body = {
        "definition": passing_definition,
        "preview_token": passing_preview["preview_token"],
        "confirmed": True,
    }
    original_rules = brush.meets_constraints
    monkeypatch.setattr(brush, "meets_constraints", lambda *_args: False)
    failed_filter = client.post(
        "/api/rois/shackleton-rim-b/brush/execute", json=passing_body
    ).json()["results"][0]
    assert failed_filter["verdict"] == "FAIL" and failed_filter["persisted"] is False
    assert failed_filter["evaluation"]["status"] == "COMPUTED_UNVERIFIED"
    assert candidate_store.get(passing_preview["samples"][0]["candidate_id"]) is None
    assert len(candidate_store.roots("shackleton-rim-b")) == 2
    monkeypatch.setattr(brush, "meets_constraints", lambda *_args: True)
    kept = client.post("/api/rois/shackleton-rim-b/brush/execute", json=passing_body).json()[
        "results"
    ][0]
    assert kept["verdict"] == "PASS" and kept["persisted"] is True
    assert len(candidate_store.roots("shackleton-rim-b")) == 3

    # A per-location failure does not prevent other samples from being evaluated.
    monkeypatch.setattr(brush, "meets_constraints", original_rules)
    multiple = {
        **definition,
        "observer_height_m": 6,
        "polygon": [
            {"east_m": -50, "north_m": -50},
            {"east_m": 150, "north_m": -50},
            {"east_m": 150, "north_m": 150},
            {"east_m": -50, "north_m": 150},
        ],
    }
    multiple_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=multiple).json()
    assert multiple_preview["ready_count"] == 4
    multiple_body = {
        "definition": multiple,
        "preview_token": multiple_preview["preview_token"],
        "confirmed": True,
    }
    count_calls = 0

    def second_fails(c: CandidateOut, req: EvaluationRequest) -> EvaluationOut:
        nonlocal count_calls
        count_calls += 1
        if count_calls == 2:
            raise RuntimeError("location failure")
        return original_compute(c, req)

    monkeypatch.setattr(evaluation, "compute", second_fails)
    partial = client.post("/api/rois/shackleton-rim-b/brush/execute", json=multiple_body).json()[
        "results"
    ]
    assert [r["verdict"] for r in partial].count("ERROR") == 1
    assert [r["verdict"] for r in partial].count("PASS") == 3
    assert all(r["persisted"] for r in partial)
    monkeypatch.setattr(evaluation, "compute", original_compute)
    completed = client.post("/api/rois/shackleton-rim-b/brush/execute", json=multiple_body).json()[
        "results"
    ]
    assert all(r["verdict"] == "PASS" for r in completed)
    assert len(candidate_store.roots("shackleton-rim-b")) == 7
    assert all(len(evaluation.list_for(r["candidate"]["candidate_id"])) == 1 for r in completed)


def test_constraint_verdict_uses_inclusive_thresholds():
    from clps_api.brush import meets_constraints
    from clps_api.schemas import BrushConstraints, BrushMetrics

    metrics = BrushMetrics(
        sample_count=10,
        duration_hours=10,
        sun_fraction=0.2,
        earth_fraction=0.5,
        simultaneous_fraction=0.1,
        longest_darkness_hours=4,
        longest_earth_gap_hours=6,
    )
    assert meets_constraints(
        metrics,
        BrushConstraints(
            min_sun_fraction=0.2,
            min_earth_fraction=0.5,
            min_simultaneous_fraction=0.1,
            max_darkness_hours=4,
            max_earth_gap_hours=6,
        ),
    )
    assert not meets_constraints(metrics, BrushConstraints(min_sun_fraction=0.21))
    assert not meets_constraints(metrics, BrushConstraints(max_earth_gap_hours=5.9))


def test_preview_retains_geographic_coordinates_for_unavailable_dem(
    monkeypatch: pytest.MonkeyPatch,
):
    from clps_api import brush
    from clps_api.schemas import BrushDefinition, BrushPoint

    def missing(*_args: object, **_kwargs: object) -> CandidateOut:
        raise ValueError("missing DEM")

    monkeypatch.setattr(brush, "_candidate", missing)
    definition = BrushDefinition(
        polygon=[
            BrushPoint(east_m=-50, north_m=-50),
            BrushPoint(east_m=50, north_m=-50),
            BrushPoint(east_m=50, north_m=50),
            BrushPoint(east_m=-50, north_m=50),
        ],
        start_utc=datetime(2026, 11, 7, tzinfo=UTC),
    )
    point = brush.preview(definition).samples[0]
    assert point.status == "UNAVAILABLE" and point.error == "missing DEM"
    assert point.latitude_deg == pytest.approx(-89.5244)
    assert point.longitude_deg == pytest.approx(56.30993)
