from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from clps_api import service, terrain_store
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files

SITE_WITH_TERRAIN = "sample-a"
SITE_WITHOUT_TERRAIN = "sample-f"


def flat_grid(center: tuple[float, float], pixel_m: float, half_width_m: float) -> TerrainGrid:
    n = int(2 * half_width_m / pixel_m)
    return TerrainGrid(
        heights=np.zeros((n, n), dtype=np.float32),
        x_left=center[0] - half_width_m,
        y_top=center[1] + half_width_m,
        pixel_size_m=pixel_m,
        source="synthetic",
    )


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    x, y = polar_stereographic_south(-89.5, 0.0)
    near_path, far_path = terrain_files(tmp_path, SITE_WITH_TERRAIN)
    flat_grid((float(x), float(y)), 20.0, 9_000.0).save(near_path)
    flat_grid((float(x), float(y)), 240.0, 210_000.0).save(far_path)
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: tmp_path)
    terrain_store.clear_cache()
    service.clear_cache()
    with TestClient(app) as test_client:
        yield test_client
    terrain_store.clear_cache()
    service.clear_cache()


def request_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "site_ids": [SITE_WITH_TERRAIN, SITE_WITHOUT_TERRAIN],
        "start": "2026-02-01T00:00:00Z",
        "end": "2026-02-04T00:00:00Z",
    }
    return {**body, **overrides}


def sites_by_id(body: dict[str, object]) -> dict[str, dict[str, object]]:
    sites = body["sites"]
    assert isinstance(sites, list)
    return {s["site"]["id"]: s for s in sites}


def test_catalog_reports_terrain_availability(client: TestClient):
    sites = {s["id"]: s for s in client.get("/api/sites").json()}

    assert sites[SITE_WITH_TERRAIN]["terrain_available"] is True
    assert sites[SITE_WITHOUT_TERRAIN]["terrain_available"] is False


def test_terrain_is_used_where_available_and_flat_elsewhere(client: TestClient):
    body = client.post("/api/analysis", json=request_body()).json()
    sites = sites_by_id(body)

    with_terrain = sites[SITE_WITH_TERRAIN]
    assert with_terrain["horizon_model"] == "terrain"
    assert len(with_terrain["horizon_mask"]["azimuth_deg"]) == 720
    # Flat synthetic terrain seen from 2 m: the horizon dips slightly below 0°.
    assert max(with_terrain["horizon_mask"]["elevation_deg"]) < 0.0
    assert max(with_terrain["sun"]["horizon_deg"]) < 0.0

    without = sites[SITE_WITHOUT_TERRAIN]
    assert without["horizon_model"] == "flat"
    assert without["horizon_mask"] is None
    assert set(without["earth"]["horizon_deg"]) == {0.0}

    horizon = next(a for a in body["assumptions"] if a["key"] == "horizon")
    assert "for 1 of 2 sites" in horizon["value"]
    assert any("LOLA" in s["name"] for s in body["data_sources"])


def test_flat_request_ignores_available_terrain(client: TestClient):
    body = client.post("/api/analysis", json=request_body(horizon="flat")).json()

    assert {s["horizon_model"] for s in body["sites"]} == {"flat"}
    assert not any("LOLA" in s["name"] for s in body["data_sources"])


def test_earth_clearance_is_reported_and_bounded(client: TestClient):
    body = client.post("/api/analysis", json=request_body(earth_min_clearance_deg=2.5)).json()
    earth_rule = next(a for a in body["assumptions"] if a["key"] == "earth_rule")
    assert "at least 2.5°" in earth_rule["value"]

    response = client.post("/api/analysis", json=request_body(earth_min_clearance_deg=12))
    assert response.status_code == 422


def test_site_terrain_patch_is_served_for_sites_with_terrain(client: TestClient):
    body = client.get(f"/api/sites/{SITE_WITH_TERRAIN}/terrain").json()

    assert body["site_id"] == SITE_WITH_TERRAIN
    assert body["size"] == 129
    assert len(body["heights_m"]) == 129 * 129
    center = body["heights_m"][64 * 129 + 64]
    assert center == 0.0
    assert min(body["heights_m"]) < -20  # flat synthetic terrain: only the curvature drop
    assert client.get(f"/api/sites/{SITE_WITHOUT_TERRAIN}/terrain").status_code == 404
    assert client.get("/api/sites/custom:-87.5:10/terrain").status_code == 404
    assert client.get("/api/sites/nope/terrain").status_code == 404
