from collections.abc import Iterator

import pytest
from clps_api.main import app
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_custom_site_is_canonical_flat_only_and_placed_on_the_map(client: TestClient):
    response = client.get("/api/sites/custom", params={"latitude": -88.123456, "longitude": -45})

    assert response.status_code == 200
    site = response.json()
    assert site["id"] == "custom:-88.1235:315"
    assert site["origin"] == "custom"
    assert site["terrain_available"] is False
    assert site["map_x_m"] < 0  # 315°E is left of the 0° meridian
    assert site["map_y_m"] > 0


def test_custom_site_outside_the_polar_region_is_rejected(client: TestClient):
    response = client.get("/api/sites/custom", params={"latitude": -45, "longitude": 10})

    assert response.status_code == 422
    assert "south polar region" in response.text


def test_site_lookup_resolves_catalog_and_custom_ids(client: TestClient):
    assert client.get("/api/sites/sample-a").json()["origin"] == "sample"
    assert client.get("/api/sites/custom:-87.5:100").json()["name"] == "Custom 87.50°S 100.00°E"
    assert client.get("/api/sites/nope").status_code == 404
    assert client.get("/api/sites/custom:-10:0").status_code == 404
    assert all(s["origin"] != "custom" for s in client.get("/api/sites").json())


def test_analysis_with_a_custom_site_uses_a_flat_horizon_and_says_so(client: TestClient):
    body = client.post(
        "/api/analysis",
        json={
            "site_ids": ["sample-a", "custom:-87.5:100"],
            "start": "2026-01-01T00:00:00Z",
            "end": "2026-01-03T00:00:00Z",
        },
    ).json()

    custom = next(s for s in body["sites"] if s["site"]["id"] == "custom:-87.5:100")
    assert custom["horizon_model"] == "flat"
    assert custom["horizon_mask"] is None
    assert any(a["key"] == "custom_sites" for a in body["assumptions"])


def test_equivalent_custom_ids_count_as_the_same_site(client: TestClient):
    response = client.post(
        "/api/analysis",
        json={
            "site_ids": ["custom:-87.5:100", "custom:-87.50001:100"],
            "start": "2026-01-01T00:00:00Z",
            "end": "2026-01-02T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "must not repeat" in response.text
