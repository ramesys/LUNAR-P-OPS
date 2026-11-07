from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from clps_api import terrain_store
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    terrain = tmp_path / "terrain"
    near, far = terrain_files(terrain, "sample-a")
    x, y = polar_stereographic_south(-89.5, 0)
    TerrainGrid(
        np.zeros((850, 850), dtype=np.float32),
        float(x) - 8500,
        float(y) + 8500,
        20,
        "https://test.invalid/LDEM_80S_20MPP_ADJ.TIF",
    ).save(near)
    TerrainGrid(
        np.zeros((1750, 1750), dtype=np.float32),
        float(x) - 210000,
        float(y) + 210000,
        240,
        "https://test.invalid/LDEM_60S_240MPP_ADJ.TIF",
    ).save(far)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: terrain)
    return TestClient(app)


def test_evaluation_refuses_incomplete_ray_coverage(client: TestClient):
    candidate = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 3000,
            "north_m": 0,
            "observer_height_m": 2,
            "selected_time_utc": "2026-02-01T00:00:00Z",
        },
    ).json()
    response = client.post(f"/api/candidates/{candidate['candidate_id']}/evaluations", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "UNAVAILABLE"
    assert "coverage" in " ".join(body["errors"]).lower()
    assert body["samples"] == []
    assert client.get(f"/api/evaluations/{body['evaluation_id']}").json() == body


def test_evaluation_requires_known_candidate_and_limits_window(client: TestClient):
    assert client.post("/api/candidates/missing/evaluations", json={}).status_code == 404
    assert (
        client.post("/api/candidates/missing/evaluations", json={"duration_hours": 169}).status_code
        == 422
    )


def test_location_height_time_and_intervals_use_candidate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    from clps_api import evaluation
    from lunar_core.geometry import Body, HorizontalPosition, SurfacePoint
    from lunar_core.horizon import HorizonMask

    calls = []
    monkeypatch.setattr(evaluation, "verify_coverage", lambda *_args: None)
    monkeypatch.setattr(evaluation, "kernel_hashes", lambda: {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "moon_radii_m", lambda: (1737400.0, 1737400.0, 1737400.0))

    def mask(
        lat: float, lon: float, near: TerrainGrid, far: TerrainGrid, *, observer_height_m: float
    ) -> HorizonMask:
        calls.append(("horizon", lat, lon, observer_height_m))
        return HorizonMask(np.array([0.0, 180.0]), np.array([0.0, 0.0]))

    def positions(
        body: Body, point: SurfacePoint, times: list[datetime]
    ) -> list[HorizontalPosition]:
        calls.append((body, point, times[0]))
        return [
            HorizontalPosition(
                0,
                (1 if (i < 2 or body == Body.EARTH) else -1),
                150000000 if body == Body.SUN else 380000,
            )
            for i in range(len(times))
        ]

    monkeypatch.setattr(evaluation, "horizon_mask", mask)
    monkeypatch.setattr(evaluation, "horizontal_positions", positions)
    c0 = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 200,
            "north_m": 100,
            "observer_height_m": 2,
            "selected_time_utc": "2026-02-01T00:00:00Z",
        },
    ).json()
    c1 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evolve",
        json={"observer_height_m": 5, "selected_time_utc": "2026-02-02T00:00:00Z"},
    ).json()
    r0 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evaluations",
        json={"duration_hours": 3, "step_minutes": 60},
    ).json()
    r1 = client.post(
        f"/api/candidates/{c1['candidate_id']}/evaluations",
        json={"duration_hours": 3, "step_minutes": 60},
    ).json()
    assert r0["status"] == r1["status"] == "COMPUTED_UNVERIFIED"
    assert calls[0] == ("horizon", c0["latitude_deg"], c0["longitude_deg"], 2)
    assert calls[1][1].latitude_deg == c0["latitude_deg"]
    assert calls[1][1].longitude_deg == c0["longitude_deg"]
    assert calls[1][1].height_m == c0["terrain_elevation_m"] + 2
    assert calls[3] == ("horizon", c1["latitude_deg"], c1["longitude_deg"], 5)
    assert calls[4][1].height_m == c1["terrain_elevation_m"] + 5
    assert calls[4][2].isoformat().startswith("2026-02-02")
    assert [s["sun_visible"] for s in r0["samples"]] == [True, True, False]
    assert [s["simultaneous_visible"] for s in r0["samples"]] == [True, True, False]
    assert r0["intervals"]["sun"][0]["duration_seconds"] == 7200
    assert r0["intervals"]["earth"][0]["duration_seconds"] == 10800
    assert r0["intervals"]["simultaneous"][0]["duration_seconds"] == 7200
    assert client.get(f"/api/evaluations/{r0['evaluation_id']}").json() == r0
    assert client.get(f"/api/candidates/{c1['candidate_id']}/evaluations").json() == [r1]
    another = client.post(
        f"/api/candidates/{c0['candidate_id']}/evaluations",
        json={"duration_hours": 2, "step_minutes": 60},
    ).json()
    assert another["evaluation_id"] != r0["evaluation_id"]
    assert client.get(f"/api/candidates/{c0['candidate_id']}/evaluations").json() == [r0, another]


def test_nodata_on_ray_is_unavailable(client: TestClient, tmp_path: Path):
    near, _ = terrain_files(tmp_path / "terrain", "sample-a")
    grid = TerrainGrid.load(near)
    grid.heights[425, 500] = np.nan
    grid.save(near)
    c0 = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 0,
            "north_m": 0,
            "observer_height_m": 2,
            "selected_time_utc": "2026-02-01T00:00:00Z",
        },
    ).json()
    r = client.post(f"/api/candidates/{c0['candidate_id']}/evaluations", json={}).json()
    assert r["status"] == "UNAVAILABLE"
    assert "nodata" in " ".join(r["errors"]).lower()


def test_real_lola_spice_evaluations_and_height_dependency(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from clps_api import evaluation
    from lunar_core.kernels import KERNELS, load_kernels

    real_data = Path("/data")
    if (
        not (real_data / "terrain" / "sample-a_near.npz").is_file()
        or not all((real_data / "kernels" / k.filename).is_file() for k in KERNELS)
        or not (real_data / "terrain" / "sample-a_far.npz").is_file()
    ):
        pytest.skip("Real LOLA windows or SPICE kernels not available")
    (tmp_path / "kernels").symlink_to(real_data / "kernels", target_is_directory=True)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: real_data / "terrain")
    load_kernels(real_data / "kernels")
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", evaluation.kernel_hashes())
    client = TestClient(app)
    c0 = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 0,
            "north_m": 0,
            "observer_height_m": 2,
            "selected_time_utc": "2026-11-23T00:00:00Z",
        },
    ).json()
    c1 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evolve",
        json={"observer_height_m": 6, "selected_time_utc": "2026-11-23T00:00:00Z"},
    ).json()
    r0 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evaluations",
        json={"duration_hours": 4, "step_minutes": 60},
    ).json()
    r1 = client.post(
        f"/api/candidates/{c1['candidate_id']}/evaluations",
        json={"duration_hours": 4, "step_minutes": 60},
    ).json()
    assert r0["status"] == r1["status"] == "COMPUTED_UNVERIFIED"
    assert len(r0["samples"]) == len(r1["samples"]) == 4
    assert len(r0["horizon_azimuth_deg"]) == 720
    assert r0["provenance"]["near_sha256"] == c0["terrain_dataset_sha256"]
    assert len(r0["provenance"]["kernel_sha256"]) == 5
    assert r0["horizon_elevation_deg"] != r1["horizon_elevation_deg"]
    assert client.get(f"/api/evaluations/{r0['evaluation_id']}").json() == r0


def test_far_field_nodata_and_missing_window_are_unavailable(client: TestClient, tmp_path: Path):
    from lunar_core.horizon import _destination

    _, far = terrain_files(tmp_path / "terrain", "sample-a")
    grid = TerrainGrid.load(far)
    lat, lon = _destination(-89.5, 0, np.array([0.0]), np.array([10000.0 / 1737400.0]))
    x, y = polar_stereographic_south(lat, lon)
    row = int((grid.y_top - float(y[0])) / grid.pixel_size_m)
    col = int((float(x[0]) - grid.x_left) / grid.pixel_size_m)
    grid.heights[row, col] = np.nan
    grid.save(far)
    c0 = client.post(
        "/api/sites/sample-a/candidate",
        json={
            "east_m": 0,
            "north_m": 0,
            "observer_height_m": 2,
            "selected_time_utc": "2026-02-01T00:00:00Z",
        },
    ).json()
    path = f"/api/candidates/{c0['candidate_id']}/evaluations"
    result = client.post(path, json={}).json()
    assert result["status"] == "UNAVAILABLE"
    assert "far DEM coverage/nodata" in " ".join(result["errors"])
    far.unlink()
    missing = client.post(path, json={}).json()
    assert missing["status"] == "UNAVAILABLE"
    assert "unavailable" in " ".join(missing["errors"])
