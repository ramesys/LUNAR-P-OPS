import math

import numpy as np
import pytest
from lunar_core.horizon import HorizonMask, above_mask, horizon_mask
from lunar_core.terrain import (
    MOON_RADIUS_M,
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
)

SITE_LAT, SITE_LON = -89.5, 0.0


def flat_grid(pixel_m: float, half_width_m: float, center: tuple[float, float]) -> TerrainGrid:
    n = int(2 * half_width_m / pixel_m)
    return TerrainGrid(
        heights=np.zeros((n, n), dtype=np.float32),
        x_left=center[0] - half_width_m,
        y_top=center[1] + half_width_m,
        pixel_size_m=pixel_m,
        source="synthetic",
    )


def site_xy() -> tuple[float, float]:
    x, y = polar_stereographic_south(SITE_LAT, SITE_LON)
    return float(x), float(y)


def test_projection_puts_pole_at_origin_and_zero_meridian_on_positive_y():
    x, y = polar_stereographic_south(-90.0, 0.0)
    assert (float(x), float(y)) == pytest.approx((0.0, 0.0), abs=1e-6)
    x, y = polar_stereographic_south(-89.0, 0.0)
    assert float(x) == pytest.approx(0.0, abs=1e-6)
    assert float(y) == pytest.approx(30_323.0, abs=5.0)
    x, y = polar_stereographic_south(-89.0, 90.0)
    assert float(x) == pytest.approx(30_323.0, abs=5.0)


def test_projection_round_trip():
    lats = np.array([-89.9, -88.0, -85.0])
    lons = np.array([10.0, 200.0, 359.5])
    back_lat, back_lon = polar_stereographic_south_inverse(*polar_stereographic_south(lats, lons))
    assert back_lat == pytest.approx(lats, abs=1e-9)
    assert back_lon == pytest.approx(lons, abs=1e-9)


def test_bilinear_sampling_and_nan_outside():
    grid = TerrainGrid(
        heights=np.array([[0.0, 10.0], [20.0, 30.0]], dtype=np.float32),
        x_left=0.0,
        y_top=2.0,
        pixel_size_m=1.0,
        source="synthetic",
    )
    values = grid.sample(np.array([0.5, 1.0, 1.5, 5.0]), np.array([1.5, 1.0, 0.5, 5.0]))
    assert values[:3].tolist() == pytest.approx([0.0, 15.0, 30.0])
    assert math.isnan(values[3])


def test_flat_moon_horizon_is_the_geometric_dip():
    center = site_xy()
    near = flat_grid(20.0, 10_000.0, center)
    far = flat_grid(240.0, 210_000.0, center)

    mask = horizon_mask(SITE_LAT, SITE_LON, near, far, observer_height_m=2.0)

    dip_deg = -math.degrees(math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 2.0)))
    assert mask.elevations_deg == pytest.approx(np.full(720, dip_deg), abs=0.01)


def test_isolated_mountain_blocks_its_azimuth_only():
    center = site_xy()
    near = flat_grid(20.0, 10_000.0, center)
    far = flat_grid(240.0, 210_000.0, center)
    # 3 km high block 50 km away toward azimuth 0 (local north = away from the pole).
    distance_m, height_m = 50_000.0, 3_000.0
    lat_peak = SITE_LAT + math.degrees(distance_m / MOON_RADIUS_M)
    px, py = polar_stereographic_south(lat_peak, SITE_LON)
    rows = slice(int((far.y_top - float(py)) / 240.0) - 3, int((far.y_top - float(py)) / 240.0) + 4)
    cols = slice(
        int((float(px) - far.x_left) / 240.0) - 3, int((float(px) - far.x_left) / 240.0) + 4
    )
    far.heights[rows, cols] = height_m

    mask = horizon_mask(SITE_LAT, SITE_LON, near, far, observer_height_m=0.0)

    angle = distance_m / MOON_RADIUS_M
    r = MOON_RADIUS_M + height_m
    expected = math.degrees(math.atan2(r * math.cos(angle) - MOON_RADIUS_M, r * math.sin(angle)))
    assert float(mask.at(0.0)) == pytest.approx(expected, abs=0.05)
    assert float(mask.at(180.0)) < 0.0


def test_mask_interpolates_across_north_and_tests_visibility():
    mask = HorizonMask(
        azimuths_deg=np.array([0.0, 90.0, 180.0, 270.0]),
        elevations_deg=np.array([2.0, 0.0, 4.0, 0.0]),
    )
    assert float(mask.at(315.0)) == pytest.approx(1.0)
    assert float(mask.at(-45.0)) == pytest.approx(1.0)
    visible = above_mask(mask, np.array([0.0, 180.0]), np.array([1.9, 4.5]), np.array([0.2, 0.0]))
    assert visible.tolist() == [True, True]
    assert above_mask(mask, np.array([0.0]), np.array([1.5]), np.array([0.2])).tolist() == [False]
