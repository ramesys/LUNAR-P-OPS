import hashlib
import sqlite3
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from clps_api import evaluation, roi_terrain, terrain_store
from clps_api.main import app
from clps_api.schemas import CandidateOut
from fastapi.testclient import TestClient
from lunar_core.horizon import _destination
from lunar_core.roi import SHACKLETON_RIM_B, local_frame
from lunar_core.terrain import (
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
    terrain_files,
)

ROI = SHACKLETON_RIM_B
CENTER_X, CENTER_Y = (float(v) for v in polar_stereographic_south(-89.5244, 56.30993))


def plane(x: float, y: float) -> float:
    """Synthetic DEM: bilinear interpolation of a plane is exact, so positions can be checked."""
    return 0.01 * (x - CENTER_X) - 0.02 * (y - CENTER_Y) - 30.0


def write_windows(terrain: Path) -> None:
    near, far = terrain_files(terrain, ROI.id)
    x_left, y_top = round(CENTER_X) - 12000, round(CENTER_Y) + 12000
    xs = x_left + 10 + 20 * np.arange(1200)
    ys = y_top - 10 - 20 * np.arange(1200)
    gx, gy = np.meshgrid(xs, ys)
    heights = (0.01 * (gx - CENTER_X) - 0.02 * (gy - CENTER_Y) - 30.0).astype(np.float32)
    TerrainGrid(heights, x_left, y_top, 20, "https://test.invalid/LDEM_80S_20MPP_ADJ.TIF").save(
        near
    )
    TerrainGrid(
        np.zeros((1710, 1710), dtype=np.float32),
        round(CENTER_X) - 205200,
        round(CENTER_Y) + 205200,
        240,
        "https://test.invalid/LDEM_60S_240MPP_ADJ.TIF",
    ).save(far)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    terrain = tmp_path / "terrain"
    write_windows(terrain)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: terrain)
    roi_terrain._cache.clear()
    return TestClient(app)


def body(east_m: float, north_m: float) -> dict[str, object]:
    return {
        "east_m": east_m,
        "north_m": north_m,
        "observer_height_m": 2,
        "selected_time_utc": "2026-11-07T00:00:00Z",
    }


def test_roi_terrain_is_one_georeferenced_dem_grid(client: TestClient, tmp_path: Path):
    listed = client.get("/api/rois").json()
    assert [r["roi_id"] for r in listed] == ["shackleton-rim-b"]
    assert listed[0]["terrain_available"] is True
    response = client.get("/api/rois/shackleton-rim-b/terrain")
    assert response.status_code == 200
    t = response.json()
    assert t["size"] == 201 and t["spacing_m"] == 20 and len(t["elevations_m"]) == 201 * 201
    assert t["roi"]["half_width_m"] == 2000
    frame = local_frame(ROI.center_latitude_deg, ROI.center_longitude_deg)
    assert t["center_projected_m"] == pytest.approx([frame.center_x_m, frame.center_y_m])
    assert t["center_elevation_m"] == pytest.approx(plane(CENTER_X, CENTER_Y), abs=1e-3)
    # Row 0 is the north edge, column 0 the west edge.
    edges = {0: (-2000, 2000), 200: (2000, 2000), 201 * 201 - 1: (2000, -2000)}
    for index, (e, n) in edges.items():
        x, y = frame.to_projected(e, n)
        assert t["elevations_m"][index] == pytest.approx(plane(float(x), float(y)), abs=0.01)
    for corner in t["corners"]:
        x, y = frame.to_projected(corner["east_m"], corner["north_m"])
        lat, lon = polar_stereographic_south_inverse(x, y)
        assert (corner["latitude_deg"], corner["longitude_deg"]) == pytest.approx(
            (float(lat), float(lon))
        )
    assert t["latitude_range_deg"][0] < min(c["latitude_deg"] for c in t["corners"])
    assert t["coverage"]["grid_status"] == "complete"
    assert [c["status"] for c in t["coverage"]["horizon_checks"]] == ["covered"] * 5
    near, far = terrain_files(tmp_path / "terrain", ROI.id)
    assert [d["local_window_sha256"] for d in t["datasets"]] == [
        hashlib.sha256(near.read_bytes()).hexdigest(),
        hashlib.sha256(far.read_bytes()).hexdigest(),
    ]
    assert client.get("/api/rois/unknown/terrain").status_code == 404


def test_missing_roi_windows_are_reported(client: TestClient, tmp_path: Path):
    near, _ = terrain_files(tmp_path / "terrain", ROI.id)
    near.unlink()
    response = client.get("/api/rois/shackleton-rim-b/terrain")
    assert response.status_code == 404
    assert "not downloaded" in response.json()["detail"]
    assert client.get("/api/rois").json()[0]["terrain_available"] is False


def test_two_roi_candidates_are_located_from_the_raster(client: TestClient):
    frame = local_frame(ROI.center_latitude_deg, ROI.center_longitude_deg)
    created = []
    for e, n in ((-1500.0, 800.0), (1200.0, -1700.0)):
        response = client.post("/api/rois/shackleton-rim-b/candidates", json=body(e, n))
        assert response.status_code == 200
        c = response.json()
        x, y = frame.to_projected(e, n)
        lat, lon = polar_stereographic_south_inverse(x, y)
        assert c["latitude_deg"] == pytest.approx(float(lat), abs=1e-12)
        assert c["longitude_deg"] == pytest.approx(float(lon), abs=1e-12)
        assert c["terrain_elevation_m"] == pytest.approx(plane(float(x), float(y)), abs=1e-3)
        assert c["terrain_window_id"] == "shackleton-rim-b"
        assert c["terrain_dataset_id"] == "LDEM_80S_20MPP_ADJ"
        created.append(c)
    assert created[0]["candidate_id"] != created[1]["candidate_id"]
    listed = client.get("/api/rois/shackleton-rim-b/candidates").json()
    assert [c["candidate_id"] for c in listed] == [c["candidate_id"] for c in created]
    outside = client.post("/api/rois/shackleton-rim-b/candidates", json=body(2500, 0))
    assert outside.status_code == 422
    assert client.post("/api/rois/unknown/candidates", json=body(0, 0)).status_code == 404


def test_candidate_ref_identifies_the_stored_snapshot(client: TestClient, tmp_path: Path):
    c0 = client.post("/api/rois/shackleton-rim-b/candidates", json=body(100, 100)).json()
    c1 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evolve",
        json={"observer_height_m": 7, "selected_time_utc": "2026-11-08T00:00:00Z"},
    ).json()
    with sqlite3.connect(tmp_path / "candidates.sqlite3") as db:
        stored = db.execute("SELECT payload FROM candidates WHERE id = ?", (c1["candidate_id"],))
        payload = stored.fetchone()[0]
    ref = client.get(f"/api/candidates/{c1['candidate_id']}/ref").json()
    assert ref == {
        "schema_version": "candidate-ref/1",
        "candidate_id": c1["candidate_id"],
        "site_id": c0["site_id"],
        "parent_candidate_id": c0["candidate_id"],
        "terrain_window_id": "shackleton-rim-b",
        "snapshot_sha256": hashlib.sha256(payload.encode()).hexdigest(),
    }
    assert client.get("/api/candidates/missing/ref").status_code == 404
    # Roots only: C1 is not listed as a separate ROI candidate.
    listed = client.get("/api/rois/shackleton-rim-b/candidates").json()
    assert [c["candidate_id"] for c in listed] == [c0["candidate_id"]]


def test_pre_sprint_04_candidates_default_to_sample_a():
    legacy = CandidateOut(
        candidate_id="c",
        site_id="s",
        latitude_deg=-89.5,
        longitude_deg=0,
        terrain_elevation_m=1,
        observer_height_m=2,
        selected_time_utc=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
        terrain_dataset_id="LDEM_80S_20MPP_ADJ",
        terrain_source_url="u",
        dem_resolution_m=20,
        coordinate_reference="MOON_ME",
        validation_status="not_independently_validated",
        data_availability="available",
    ).model_dump_json(exclude={"terrain_window_id"})
    assert CandidateOut.model_validate_json(legacy).terrain_window_id == "sample-a"


def test_roi_evaluation_uses_the_roi_windows(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from lunar_core.geometry import Body, HorizontalPosition, SurfacePoint
    from lunar_core.horizon import HorizonMask

    calls: list[tuple[float, float, float]] = []
    monkeypatch.setattr(evaluation, "kernel_hashes", lambda: {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "moon_radii_m", lambda: (1737400.0, 1737400.0, 1737400.0))

    def mask(
        lat: float, lon: float, near: TerrainGrid, far: TerrainGrid, *, observer_height_m: float
    ) -> HorizonMask:
        calls.append((lat, lon, float(near.heights[600, 600])))
        return HorizonMask(np.array([0.0, 180.0]), np.array([0.0, 0.0]))

    def positions(
        body_: Body, point: SurfacePoint, times: list[datetime]
    ) -> list[HorizontalPosition]:
        distance = 150000000 if body_ == Body.SUN else 380000
        return [HorizontalPosition(0, 1, distance) for _ in times]

    monkeypatch.setattr(evaluation, "horizon_mask", mask)
    monkeypatch.setattr(evaluation, "horizontal_positions", positions)
    c0 = client.post("/api/rois/shackleton-rim-b/candidates", json=body(-800, 600)).json()
    result = client.post(
        f"/api/candidates/{c0['candidate_id']}/evaluations",
        json={"duration_hours": 2, "step_minutes": 60},
    ).json()
    assert result["status"] == "COMPUTED_UNVERIFIED", result["errors"]
    assert result["provenance"]["terrain_window_id"] == "shackleton-rim-b"
    assert result["provenance"]["near_sha256"] == c0["terrain_dataset_sha256"]
    assert calls == [(c0["latitude_deg"], c0["longitude_deg"], pytest.approx(-30.0, abs=0.5))]


def test_roi_candidate_with_missing_far_coverage_is_unavailable(client: TestClient, tmp_path: Path):
    c0 = client.post("/api/rois/shackleton-rim-b/candidates", json=body(0, 0)).json()
    _, far = terrain_files(tmp_path / "terrain", ROI.id)
    grid = TerrainGrid.load(far)
    lat, lon = _destination(
        c0["latitude_deg"], c0["longitude_deg"], np.array([0.0]), np.array([10000 / 1737400.0])
    )
    x, y = polar_stereographic_south(lat, lon)
    grid.heights[int((grid.y_top - float(y[0])) / 240), int((float(x[0]) - grid.x_left) / 240)] = (
        np.nan
    )
    grid.save(far)
    result = client.post(f"/api/candidates/{c0['candidate_id']}/evaluations", json={}).json()
    assert result["status"] == "UNAVAILABLE"
    assert "far DEM coverage/nodata" in " ".join(result["errors"])
    assert result["samples"] == [] and result["horizon_elevation_deg"] == []
    checks = client.get("/api/rois/shackleton-rim-b/terrain").json()["coverage"]["horizon_checks"]
    assert checks[0]["status"] == "missing"


def test_real_shackleton_roi_and_candidate_evaluation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from lunar_core.kernels import KERNELS, load_kernels

    real = Path("/data")
    near_path, far_path = terrain_files(real / "terrain", ROI.id)
    if (
        not near_path.is_file()
        or not far_path.is_file()
        or not all((real / "kernels" / k.filename).is_file() for k in KERNELS)
    ):
        pytest.skip("Real Shackleton LOLA windows or SPICE kernels not available")
    (tmp_path / "kernels").symlink_to(real / "kernels", target_is_directory=True)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: real / "terrain")
    roi_terrain._cache.clear()
    load_kernels(real / "kernels")
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", evaluation.kernel_hashes())
    client = TestClient(app)
    t = client.get("/api/rois/shackleton-rim-b/terrain").json()
    near = TerrainGrid.load(near_path)
    regional = client.get("/api/rois/shackleton-rim-b/regional-terrain").json()
    far = TerrainGrid.load(far_path)
    frame = local_frame(ROI.center_latitude_deg, ROI.center_longitude_deg)
    for index, east, north in [
        (0, -10000, 10000),
        (81 * 40 + 40, 0, 0),
        (81 * 81 - 1, 10000, -10000),
    ]:
        x, y = frame.to_projected(east, north)
        expected = float(far.sample(np.atleast_1d(x), np.atleast_1d(y))[0])
        assert regional["elevations_m"][index] == pytest.approx(expected, abs=0.0051)
    assert (
        regional["dataset"]["local_window_sha256"]
        == hashlib.sha256(far_path.read_bytes()).hexdigest()
    )
    assert t["center_elevation_m"] == float(
        near.sample(np.array([CENTER_X]), np.array([CENTER_Y]))[0]
    )
    assert t["coverage"]["grid_status"] == "complete"
    assert [c["status"] for c in t["coverage"]["horizon_checks"]] == ["covered"] * 5
    frame = local_frame(ROI.center_latitude_deg, ROI.center_longitude_deg)
    for e, n in ((-1200.0, 900.0), (1500.0, -1300.0)):
        c = client.post("/api/rois/shackleton-rim-b/candidates", json=body(e, n)).json()
        x, y = frame.to_projected(e, n)
        assert c["terrain_elevation_m"] == float(near.sample(np.atleast_1d(x), np.atleast_1d(y))[0])
        r = client.post(
            f"/api/candidates/{c['candidate_id']}/evaluations",
            json={"duration_hours": 3, "step_minutes": 60},
        ).json()
        assert r["status"] == "COMPUTED_UNVERIFIED", r["errors"]
        assert r["provenance"]["near_sha256"] == t["datasets"][0]["local_window_sha256"]
        assert r["provenance"]["far_sha256"] == t["datasets"][1]["local_window_sha256"]
        assert len(r["horizon_elevation_deg"]) == 720 and len(r["samples"]) == 3


def test_regional_terrain_samples_far_dem_in_roi_frame(client: TestClient, tmp_path: Path):
    response = client.get("/api/rois/shackleton-rim-b/regional-terrain")
    assert response.status_code == 200
    region = response.json()
    assert (region["half_width_m"], region["spacing_m"], region["size"]) == (10000, 250, 81)
    assert len(region["elevations_m"]) == 81 * 81
    assert region["dataset"]["dataset_id"] == "LDEM_60S_240MPP_ADJ"
    assert region["dataset"]["resolution_m"] == 240
    assert all(value == 0 for value in region["elevations_m"])
    far = TerrainGrid.load(terrain_files(tmp_path / "terrain", ROI.id)[1])
    frame = local_frame(ROI.center_latitude_deg, ROI.center_longitude_deg)
    for index, e, n in [(0, -10000, 10000), (81 * 40 + 40, 0, 0), (81 * 81 - 1, 10000, -10000)]:
        x, y = frame.to_projected(e, n)
        sampled = far.sample(np.atleast_1d(x), np.atleast_1d(y))
        assert region["elevations_m"][index] == pytest.approx(float(sampled[0]))
    assert client.get("/api/rois/unknown/regional-terrain").status_code == 404


def test_regional_missing_samples_are_reported(client: TestClient, tmp_path: Path):
    _, path = terrain_files(tmp_path / "terrain", ROI.id)
    grid = TerrainGrid.load(path)
    grid.heights[:] = np.nan
    grid.save(path)
    response = client.get("/api/rois/shackleton-rim-b/regional-terrain")
    assert response.status_code == 422
    assert "missing or out-of-coverage" in response.json()["detail"]
