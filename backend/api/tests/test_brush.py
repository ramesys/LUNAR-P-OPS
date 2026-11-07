from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from clps_api.brush import sample_polygon, summarize
from clps_api.schemas import EvaluationOut, EvaluationRequest, EvaluationSample


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
