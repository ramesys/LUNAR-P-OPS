from pathlib import Path

import numpy as np
import pytest
from clps_api import terrain_store
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    x, y = polar_stereographic_south(-89.5, 0.0)
    path, _ = terrain_files(tmp_path, "sample-a")
    TerrainGrid(
        np.full((900, 900), 123.0, dtype=np.float32),
        float(x) - 9000,
        float(y) + 9000,
        20.0,
        "test-dem",
    ).save(path)
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: tmp_path)
    yield TestClient(app, raise_server_exceptions=True)


def test_candidate_uses_dem_and_deterministic_identity(client: TestClient):
    request = {
        "east_m": 0,
        "north_m": 0,
        "observer_height_m": 2,
        "selected_time_utc": "2026-02-01T00:00:00Z",
    }
    response = client.post("/api/sites/sample-a/candidate", json=request)
    assert response.status_code == 200
    c = response.json()
    assert c["terrain_elevation_m"] == 123.0
    assert c["latitude_deg"] == pytest.approx(-89.5)
    assert c["longitude_deg"] == pytest.approx(0.0)
    assert c["validation_status"] == "not_independently_validated"
    assert (
        c["candidate_id"]
        == client.post("/api/sites/sample-a/candidate", json=request).json()["candidate_id"]
    )
    assert c["site_id"] != c["candidate_id"]


def test_candidate_rejects_outside_patch(client: TestClient):
    response = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 6001,
            "north_m": 0,
            "observer_height_m": 2,
            "selected_time_utc": "2026-02-01T00:00:00Z",
        },
    )
    assert response.status_code == 422


def test_candidate_coordinate_round_trip_and_invalid_samples(client: TestClient, tmp_path: Path):
    from lunar_core.terrain import polar_stereographic_south

    body = {
        "east_m": 1200,
        "north_m": -900,
        "observer_height_m": 2,
        "selected_time_utc": "2026-02-01T00:00:00Z",
    }
    response = client.post("/api/sites/sample-a/candidate", json=body)
    assert response.status_code == 200
    result = response.json()
    x, y = polar_stereographic_south(result["latitude_deg"], result["longitude_deg"])
    x0, y0 = polar_stereographic_south(-89.5, 0.0)
    assert float(x - x0) == pytest.approx(1200, abs=1e-7)
    assert float(y - y0) == pytest.approx(-900, abs=1e-7)
    path, _ = terrain_files(tmp_path, "sample-a")
    grid = TerrainGrid.load(path)
    grid.heights[:] = np.nan
    grid.save(path)
    assert client.post("/api/sites/sample-a/candidate", json=body).status_code == 422
    path.unlink()
    assert client.post("/api/sites/sample-a/candidate", json=body).status_code == 404


def test_real_lola_grid_candidate():
    from clps_api.candidate import create_candidate
    from clps_api.schemas import CandidateRequest
    from clps_api.service import resolve_site

    path, _ = terrain_files(terrain_store.terrain_dir(), "sample-a")
    if not path.is_file():
        pytest.skip("Real LOLA window not downloaded")
    grid = TerrainGrid.load(path)
    assert grid.source.endswith("/LDEM_80S_20MPP_ADJ.TIF")
    site = resolve_site("sample-a")
    assert site is not None
    c = create_candidate(
        site,
        CandidateRequest(
            east_m=0, north_m=0, observer_height_m=2, selected_time_utc="2026-02-01T00:00:00Z"
        ),
    )
    x, y = polar_stereographic_south(site.latitude_deg, site.longitude_deg)
    assert c.terrain_elevation_m == pytest.approx(
        float(grid.sample(np.array([x]), np.array([y]))[0])
    )
    assert c.dem_resolution_m == 20
