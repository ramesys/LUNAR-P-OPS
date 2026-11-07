from pathlib import Path

import numpy as np
import pytest
from clps_api import terrain_store
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    x, y = polar_stereographic_south(-89.5, 0)
    near, _ = terrain_files(tmp_path / "terrain", "sample-a")
    TerrainGrid(
        np.full((900, 900), 123, dtype=np.float32),
        float(x) - 9000,
        float(y) + 9000,
        20,
        "synthetic",
    ).save(near)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: tmp_path / "terrain")
    return TestClient(app)


def test_candidate_lineage_persists_immutable_snapshots(client: TestClient):
    req = {
        "east_m": 0,
        "north_m": 0,
        "observer_height_m": 2,
        "selected_time_utc": "2026-02-01T00:00:00Z",
    }
    c0 = client.post("/api/sites/sample-a/candidate", json=req).json()
    assert c0["parent_candidate_id"] is None
    assert len(c0["terrain_dataset_sha256"]) == 64
    response = client.post(
        f"/api/candidates/{c0['candidate_id']}/evolve",
        json={"observer_height_m": 4, "selected_time_utc": "2026-02-02T00:00:00Z"},
    )
    assert response.status_code == 200
    c1 = response.json()
    assert c1["candidate_id"] != c0["candidate_id"]
    assert c1["parent_candidate_id"] == c0["candidate_id"]
    assert c1["observer_height_m"] == 4
    assert c1["terrain_elevation_m"] == c0["terrain_elevation_m"]
    assert client.get(f"/api/candidates/{c0['candidate_id']}").json() == c0
    assert client.get(f"/api/candidates/{c1['candidate_id']}").json() == c1
    assert client.get(f"/api/candidates/{c0['candidate_id']}/children").json() == [c1]


def test_bad_evolution_rejected(client: TestClient):
    assert (
        client.post(
            "/api/candidates/nope/evolve",
            json={"observer_height_m": 2, "selected_time_utc": "2026-02-01T00:00:00Z"},
        ).status_code
        == 404
    )
