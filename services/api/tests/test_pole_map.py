from collections.abc import Iterator
from pathlib import Path

import pytest
from clps_api import pole_map
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.pole_map import BasemapInfo, basemap_files, write_basemap_info

PNG_BYTES = b"\x89PNG\r\n\x1a\nfake"


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(pole_map, "basemap_dir", lambda: tmp_path)
    with TestClient(app) as test_client:
        yield test_client


def write_basemap(directory: Path, half_width_m: float) -> None:
    image, info = basemap_files(directory)
    image.write_bytes(PNG_BYTES)
    write_basemap_info(info, BasemapInfo(half_width_m, "https://example.test/hill.tif"))


def test_map_without_basemap_still_has_graticule(client: TestClient):
    body = client.get("/api/map").json()

    assert body["image_url"] is None
    assert body["half_width_m"] == 200_000
    assert [p["latitude_deg"] for p in body["parallels"]][:2] == [-89.0, -88.0]
    assert len(body["meridians"]) == 12
    assert client.get("/api/map/hillshade.png").status_code == 404


def test_map_serves_matching_basemap(client: TestClient, tmp_path: Path):
    write_basemap(tmp_path, 200_000)

    body = client.get("/api/map").json()
    image = client.get(body["image_url"])

    assert body["image_url"] == "/api/map/hillshade.png"
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content == PNG_BYTES


def test_basemap_for_another_extent_is_ignored(client: TestClient, tmp_path: Path):
    write_basemap(tmp_path, 150_000)

    assert client.get("/api/map").json()["image_url"] is None


def test_sites_carry_map_positions(client: TestClient):
    sites = {s["id"]: s for s in client.get("/api/sites").json()}

    assert sites["sample-a"]["map_x_m"] == pytest.approx(0.0, abs=0.1)
    assert sites["sample-a"]["map_y_m"] > 0
    assert sites["sample-b"]["map_x_m"] > 0  # 120°E lies right of the 0°E meridian
