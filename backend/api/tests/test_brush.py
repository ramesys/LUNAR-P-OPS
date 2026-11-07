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

    # Duration and step belong to the evaluation; location, time, height and DEM identify the C0.
    temporal = {**definition, "duration_hours": 3}
    temporal_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=temporal).json()
    assert temporal_preview["existing_count"] == 1
    assert temporal_preview["samples"][0]["candidate_id"] == item["candidate"]["candidate_id"]
    temporal_body = {
        "definition": temporal,
        "preview_token": temporal_preview["preview_token"],
        "confirmed": True,
    }
    temporal_result = client.post(
        "/api/rois/shackleton-rim-b/brush/execute", json=temporal_body
    ).json()["results"][0]
    assert temporal_result["candidate"]["candidate_id"] == item["candidate"]["candidate_id"]
    assert temporal_result["evaluation"]["evaluation_id"] != item["evaluation"]["evaluation_id"]
    assert len(evaluation.list_for(item["candidate"]["candidate_id"])) == 2
    finer = {**definition, "step_minutes": 30}
    finer_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=finer).json()
    assert finer_preview["existing_count"] == 1
    finer_body = {
        "definition": finer,
        "preview_token": finer_preview["preview_token"],
        "confirmed": True,
    }
    finer_result = client.post("/api/rois/shackleton-rim-b/brush/execute", json=finer_body).json()[
        "results"
    ][0]
    assert finer_result["candidate"]["candidate_id"] == item["candidate"]["candidate_id"]
    assert finer_result["evaluation"]["evaluation_id"] not in {
        item["evaluation"]["evaluation_id"],
        temporal_result["evaluation"]["evaluation_id"],
    }
    assert len(evaluation.list_for(item["candidate"]["candidate_id"])) == 3
    # A filter is a judgment on the same stored science, not a new evaluation input.
    filtered = {**definition, "constraints": {"min_sun_fraction": 1}}
    filtered_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=filtered).json()
    filtered_body = {
        "definition": filtered,
        "preview_token": filtered_preview["preview_token"],
        "confirmed": True,
    }
    filtered_result = client.post(
        "/api/rois/shackleton-rim-b/brush/execute", json=filtered_body
    ).json()["results"][0]
    assert filtered_result["evaluation"]["evaluation_id"] == item["evaluation"]["evaluation_id"]
    assert len(evaluation.list_for(item["candidate"]["candidate_id"])) == 3
    equivalent = {**definition, "start_utc": "2026-11-07T02:00:00+02:00"}
    equivalent_preview = client.post(
        "/api/rois/shackleton-rim-b/brush/preview", json=equivalent
    ).json()
    assert equivalent_preview["existing_count"] == 1
    assert equivalent_preview["samples"][0]["candidate_id"] == item["candidate"]["candidate_id"]
    later = {**definition, "start_utc": "2026-11-08T00:00:00Z"}
    later_preview = client.post("/api/rois/shackleton-rim-b/brush/preview", json=later).json()
    assert later_preview["new_count"] == 1
    assert later_preview["samples"][0]["candidate_id"] != item["candidate"]["candidate_id"]

    # A forced same-ID, different-payload collision cannot change either persisted snapshot.
    original_candidate = candidate_store.get(item["candidate"]["candidate_id"])
    original_evaluation = evaluation.get(item["evaluation"]["evaluation_id"])
    assert original_candidate is not None and original_evaluation is not None
    assert original_evaluation.candidate == original_candidate
    assert (
        original_evaluation.provenance["near_sha256"] == original_candidate.terrain_dataset_sha256
    )
    with pytest.raises(ValueError, match="candidate identity collision"):
        candidate_store.save(original_candidate.model_copy(update={"observer_height_m": 99}))
    with pytest.raises(ValueError, match="evaluation identity collision"):
        evaluation.save(original_evaluation.model_copy(update={"candidate_id": "different"}))
    assert candidate_store.get(original_candidate.candidate_id) == original_candidate
    assert evaluation.get(original_evaluation.evaluation_id) == original_evaluation

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

    # Simulate an abrupt process interruption after the first committed evaluation and
    # the second committed candidate. Retrying the same preview must complete safely.
    from clps_api.schemas import BrushDefinition

    interrupted_definition = {**multiple, "observer_height_m": 7}
    interrupted_preview = client.post(
        "/api/rois/shackleton-rim-b/brush/preview", json=interrupted_definition
    ).json()
    parsed = BrushDefinition.model_validate(interrupted_definition)
    calls = 0

    class AbruptInterruption(BaseException):
        pass

    def interrupted(c: CandidateOut, req: EvaluationRequest) -> EvaluationOut:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise AbruptInterruption()
        return original_compute(c, req)

    monkeypatch.setattr(evaluation, "compute", interrupted)
    with pytest.raises(AbruptInterruption):
        brush.execute(parsed, interrupted_preview["preview_token"])
    first_id = interrupted_preview["samples"][0]["candidate_id"]
    second_id = interrupted_preview["samples"][1]["candidate_id"]
    assert candidate_store.get(first_id) is not None and candidate_store.get(second_id) is not None
    assert len(evaluation.list_for(first_id)) == 1 and evaluation.list_for(second_id) == []
    assert len(candidate_store.roots("shackleton-rim-b")) == 9
    monkeypatch.setattr(evaluation, "compute", original_compute)
    resumed = brush.execute(parsed, interrupted_preview["preview_token"])
    assert all(r.verdict == "PASS" and r.persisted for r in resumed.results)
    assert len(candidate_store.roots("shackleton-rim-b")) == 11
    assert all(len(evaluation.list_for(s.candidate_id or "")) == 1 for s in resumed.preview.samples)

    # Two simultaneous retries of the same approved definition must converge on one
    # candidate and one evaluation, even when both start before either has saved.
    from concurrent.futures import ThreadPoolExecutor

    concurrent_definition = {**definition, "observer_height_m": 8}
    concurrent_preview = client.post(
        "/api/rois/shackleton-rim-b/brush/preview", json=concurrent_definition
    ).json()
    concurrent_parsed = BrushDefinition.model_validate(concurrent_definition)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(brush.execute, concurrent_parsed, concurrent_preview["preview_token"])
            for _ in range(2)
        ]
        concurrent_results = [future.result().results[0] for future in futures]
    assert all(r.verdict == "PASS" and r.persisted for r in concurrent_results)
    assert (
        concurrent_results[0].candidate is not None and concurrent_results[1].candidate is not None
    )
    assert (
        concurrent_results[0].evaluation is not None
        and concurrent_results[1].evaluation is not None
    )
    assert (
        concurrent_results[0].candidate.candidate_id == concurrent_results[1].candidate.candidate_id
    )
    assert (
        concurrent_results[0].evaluation.evaluation_id
        == concurrent_results[1].evaluation.evaluation_id
    )
    assert len(candidate_store.roots("shackleton-rim-b")) == 12
    assert len(evaluation.list_for(concurrent_results[0].candidate.candidate_id)) == 1

    # Changing only the DEM window identity must not reuse the old C0.
    import shutil

    from lunar_core.terrain import TerrainGrid

    alternate_dir = tmp_path / "alternate-terrain"
    alternate_dir.mkdir()
    copied_near, copied_far = terrain_files(alternate_dir, "shackleton-rim-b")
    shutil.copy2(near, copied_near)
    shutil.copy2(far, copied_far)
    changed_grid = TerrainGrid.load(copied_near)
    changed_grid.heights[0, 0] += 1
    changed_grid.save(copied_near)
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: alternate_dir)
    changed_dem = client.post("/api/rois/shackleton-rim-b/brush/preview", json=definition).json()
    assert changed_dem["new_count"] == 1
    assert changed_dem["samples"][0]["elevation_m"] == preview["samples"][0]["elevation_m"]
    assert changed_dem["samples"][0]["candidate_id"] != item["candidate"]["candidate_id"]


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
