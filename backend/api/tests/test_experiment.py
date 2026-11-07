from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from clps_api import evaluation, roi_terrain, terrain_store
from clps_api.main import app
from fastapi.testclient import TestClient
from lunar_core.geometry import Body, HorizontalPosition, SurfacePoint
from lunar_core.horizon import HorizonMask, _destination
from lunar_core.roi import SHACKLETON_RIM_B
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files

# Same synthetic Shackleton windows as test_roi.py (test modules are not importable).
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


def body(east_m: float, north_m: float) -> dict[str, object]:
    return {
        "east_m": east_m,
        "north_m": north_m,
        "observer_height_m": 2,
        "selected_time_utc": "2026-11-07T00:00:00Z",
    }


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    terrain = tmp_path / "terrain"
    write_windows(terrain)
    monkeypatch.setenv("CLPS_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("CLPS_GIT_COMMIT", raising=False)
    monkeypatch.delenv("CLPS_BUILD_COMMIT", raising=False)
    monkeypatch.setattr(terrain_store, "terrain_dir", lambda: terrain)
    monkeypatch.setattr(evaluation, "kernel_hashes", lambda: {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "_loaded_kernel_hashes", {"test-kernel": "abc"})
    monkeypatch.setattr(evaluation, "moon_radii_m", lambda: (1737400.0, 1737400.0, 1737400.0))

    def mask(
        lat: float, lon: float, near: TerrainGrid, far: TerrainGrid, *, observer_height_m: float
    ) -> HorizonMask:
        return HorizonMask(np.array([0.0, 180.0]), np.array([observer_height_m / 10, 0.0]))

    def positions(b: Body, point: SurfacePoint, times: list[datetime]) -> list[HorizontalPosition]:
        distance = 150000000 if b == Body.SUN else 380000
        return [HorizontalPosition(10.0 * i, 0.5 * i - 0.2, distance) for i in range(len(times))]

    monkeypatch.setattr(evaluation, "horizon_mask", mask)
    monkeypatch.setattr(evaluation, "horizontal_positions", positions)
    roi_terrain._cache.clear()
    return TestClient(app)


def evaluated(client: TestClient) -> tuple[dict[str, object], dict[str, object]]:
    c0 = client.post("/api/rois/shackleton-rim-b/candidates", json=body(-300, 400)).json()
    c1 = client.post(
        f"/api/candidates/{c0['candidate_id']}/evolve",
        json={"observer_height_m": 7, "selected_time_utc": "2026-11-07T00:00:00Z"},
    ).json()
    result = client.post(
        f"/api/candidates/{c1['candidate_id']}/evaluations",
        json={"duration_hours": 4, "step_minutes": 60},
    ).json()
    assert result["status"] == "COMPUTED_UNVERIFIED", result["errors"]
    return c1, result


def test_manifest_contains_the_stored_inputs_and_outputs(client: TestClient, tmp_path: Path):
    c1, result = evaluated(client)
    m = client.get(f"/api/evaluations/{result['evaluation_id']}/manifest").json()
    assert m["schema_version"] == "lunar-ops-experiment/1"
    assert m["candidate"] == result["candidate"] == c1
    assert m["parent_candidate_id"] == c1["parent_candidate_id"]
    assert m["parent_candidate"]["candidate_id"] == c1["parent_candidate_id"]
    assert m["candidate_ref"]["candidate_id"] == c1["candidate_id"]
    assert m["request"] == {"duration_hours": 4, "step_minutes": 60}
    assert m["interval"]["start_utc"] == "2026-11-07T00:00:00+00:00"
    assert m["interval"]["end_utc"] == "2026-11-07T04:00:00+00:00"
    assert m["interval"]["sample_count"] == 4
    near, far = terrain_files(tmp_path / "terrain", ROI.id)
    near_hash = evaluation.file_hash(near)
    assert m["terrain"]["near"]["sha256"] == near_hash == c1["terrain_dataset_sha256"]
    assert m["terrain"]["far"]["sha256"] == evaluation.file_hash(far)
    assert m["terrain"]["terrain_window_id"] == "shackleton-rim-b"
    assert m["spice"]["kernel_sha256"] == {"test-kernel": "abc"}
    assert m["method"]["algorithm"] == "candidate-horizon-spice-v1"
    assert m["status"] == {
        "execution_status": "COMPUTED_UNVERIFIED",
        "validation_status": "not_independently_validated",
        "errors": [],
        "warnings": result["warnings"],
    }
    assert m["outputs"]["samples"] == result["samples"]
    assert m["outputs"]["horizon_elevation_deg"] == result["horizon_elevation_deg"]
    assert len(m["outputs"]["output_sha256"]) == 64
    # No commit was provided to this deployment: reported, not invented.
    assert m["software"]["software_commit"] == "not_recorded"
    assert m["software"]["software_commit_state"] == "not_recorded"
    assert m["not_recorded"] == ["software_commit"]
    assert m["consistency"]["candidate_snapshot_matches_record"] is True
    assert m["consistency"]["evaluation_candidate_id_matches"] is True
    assert len(m["consistency"]["inputs_sha256"]) == 64
    assert client.get("/api/evaluations/missing/manifest").status_code == 404


def test_commit_is_recorded_when_provided(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CLPS_GIT_COMMIT", "abc1234")
    _, result = evaluated(client)
    m = client.get(f"/api/evaluations/{result['evaluation_id']}/manifest").json()
    assert m["software"]["software_commit"] == "abc1234"
    assert m["software"]["software_commit_state"] == "clean"
    assert m["software"]["software_commit_source"] == "runtime environment"
    assert m["not_recorded"] == []


def test_build_commit_wins_and_dirty_state_is_kept(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    sha = "b1de8d725a3929ae9b4fa0a050ec0e5198ea5ff5"
    monkeypatch.setenv("CLPS_BUILD_COMMIT", f"{sha}-dirty")
    monkeypatch.setenv("CLPS_GIT_COMMIT", "abc1234")
    _, result = evaluated(client)
    m = client.get(f"/api/evaluations/{result['evaluation_id']}/manifest").json()
    assert m["software"]["software_commit"] == f"{sha}-dirty"
    assert m["software"]["software_commit_state"] == "dirty"
    assert m["software"]["software_commit_source"] == "image build"


@pytest.mark.parametrize("value", ["", "not-a-commit", "ABCDEF1", "abc1234-modified"])
def test_malformed_commits_are_not_recorded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, value: str
):
    monkeypatch.setenv("CLPS_BUILD_COMMIT", value)
    monkeypatch.setenv("CLPS_GIT_COMMIT", value)
    _, result = evaluated(client)
    assert "software_commit" not in result["provenance"]


def test_manifest_reports_a_changed_candidate_record(client: TestClient, tmp_path: Path):
    import sqlite3

    c1, result = evaluated(client)
    with sqlite3.connect(tmp_path / "candidates.sqlite3") as db:
        payload = db.execute(
            "SELECT payload FROM candidates WHERE id = ?", (c1["candidate_id"],)
        ).fetchone()[0]
        db.execute(
            "UPDATE candidates SET payload = ? WHERE id = ?",
            (
                payload.replace('"observer_height_m":7.0', '"observer_height_m":8.0'),
                c1["candidate_id"],
            ),
        )
    m = client.get(f"/api/evaluations/{result['evaluation_id']}/manifest").json()
    # The manifest keeps the evaluated inputs and flags that the record no longer matches.
    assert m["candidate"]["observer_height_m"] == 7
    assert m["consistency"]["candidate_snapshot_matches_record"] is False


def test_legacy_records_mark_missing_provenance(client: TestClient):
    _, result = evaluated(client)
    stored = evaluation.get(str(result["evaluation_id"]))
    assert stored is not None
    legacy = stored.model_copy(
        update={
            "evaluation_id": "evaluation-legacy",
            "provenance": {
                k: v
                for k, v in stored.provenance.items()
                if k not in {"clps_api_version", "terrain_window_id"}
            },
        }
    )
    evaluation.save(legacy)
    m = client.get("/api/evaluations/evaluation-legacy/manifest").json()
    assert m["software"]["clps_api_version"] == "not_recorded"
    assert set(m["not_recorded"]) == {"terrain_window_id", "clps_api_version", "software_commit"}


def test_recompute_reproduces_without_storing(client: TestClient):
    c1, result = evaluated(client)
    listed = client.get(f"/api/candidates/{c1['candidate_id']}/evaluations").json()
    report = client.post(f"/api/evaluations/{result['evaluation_id']}/recompute").json()
    assert report["outcome"] == "reproduced"
    assert report["persisted"] is False
    assert report["stored_output_sha256"] == report["recomputed_output_sha256"]
    assert all(check["match"] for check in report["input_checks"])
    assert report["differences"]["sun_elevation_deg_max_abs"] == 0
    assert report["differences"]["visibility_flag_mismatches"] == 0
    assert report["tolerances"]["angles_deg"] == 1e-9
    assert report["validation_status"] == "not_independently_validated"
    assert client.get(f"/api/candidates/{c1['candidate_id']}/evaluations").json() == listed
    assert client.get(f"/api/evaluations/{result['evaluation_id']}").json() == result


def test_recompute_reports_changed_data(client: TestClient, tmp_path: Path):
    c1, result = evaluated(client)
    _, far = terrain_files(tmp_path / "terrain", ROI.id)
    grid = TerrainGrid.load(far)
    ray = np.array([10000 / 1737400.0])
    lat, lon = _destination(c1["latitude_deg"], c1["longitude_deg"], np.array([0.0]), ray)
    x, y = polar_stereographic_south(lat, lon)
    row, col = int((grid.y_top - float(y[0])) / 240), int((float(x[0]) - grid.x_left) / 240)
    grid.heights[row, col] = np.nan
    grid.save(far)
    report = client.post(f"/api/evaluations/{result['evaluation_id']}/recompute").json()
    assert report["outcome"] == "inputs_changed"
    assert report["recomputed_status"] == "UNAVAILABLE"
    assert [c["name"] for c in report["input_checks"] if not c["match"]] == ["far_sha256"]
    assert client.get(f"/api/evaluations/{result['evaluation_id']}").json() == result
