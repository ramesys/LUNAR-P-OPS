from collections.abc import Iterator
from typing import Any

import pytest
from clps_api.main import app
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def valid_request(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "site_ids": ["sample-a", "sample-f"],
        "start": "2026-01-01T00:00:00Z",
        "end": "2026-01-08T00:00:00Z",
    }
    return {**body, **overrides}


def test_lists_sample_sites(client: TestClient):
    response = client.get("/api/sites")

    assert response.status_code == 200
    sites = response.json()
    assert len(sites) >= 4
    assert {s["origin"] for s in sites} == {"sample"}


def test_analysis_returns_ranked_sites_with_aligned_series(client: TestClient):
    response = client.post("/api/analysis", json=valid_request())

    assert response.status_code == 200
    body = response.json()
    assert len(body["times"]) == 7 * 24
    assert body["request"]["step_minutes"] == 60
    assert body["request"]["observer_height_m"] == 2.0
    assert [s["rank"] for s in body["sites"]] == [1, 2]
    fractions = [s["metrics"]["sun_fraction"] for s in body["sites"]]
    assert fractions == sorted(fractions, reverse=True)
    for site in body["sites"]:
        assert len(site["sun"]["elevation_deg"]) == len(body["times"])
        assert len(site["earth"]["azimuth_deg"]) == len(body["times"])
        assert site["sun_windows"][0]["truncated"] is True
    assert {a["key"] for a in body["assumptions"]} >= {"horizon", "sun_rule", "earth_rule"}
    assert any("de440s.bsp" in s["name"] for s in body["data_sources"])


def test_repeated_request_is_served_from_cache(client: TestClient):
    first = client.post("/api/analysis", json=valid_request(step_minutes=120)).json()
    second = client.post("/api/analysis", json=valid_request(step_minutes=120)).json()

    assert first == second


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"site_ids": ["sample-a"]}, "at least 2"),
        ({"site_ids": ["sample-a", "sample-b", "sample-c", "sample-d", "sample-e"]}, "at most 4"),
        ({"site_ids": ["sample-a", "nope"]}, "unknown site ids: nope"),
        ({"site_ids": ["sample-a", "sample-a"]}, "must not repeat"),
        ({"end": "2027-06-01T00:00:00Z"}, "at most one year"),
        ({"start": "2026-01-01T00:00:00"}, "timezone"),
        ({"observer_height_m": -1}, "greater than or equal to 0"),
        ({"unexpected": 1}, "Extra inputs are not permitted"),
    ],
)
def test_invalid_scenarios_are_rejected(
    client: TestClient, overrides: dict[str, Any], fragment: str
):
    response = client.post("/api/analysis", json=valid_request(**overrides))

    assert response.status_code == 422
    assert fragment in response.text
