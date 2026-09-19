import math

import numpy as np
import pytest
from lunar_core.horizon import _destination
from lunar_core.terrain import MOON_RADIUS_M, TerrainGrid, polar_stereographic_south
from lunar_core.terrain_patch import local_terrain_patch

SITE_LAT, SITE_LON = -89.0, 120.0


def near_grid(bumps: tuple[tuple[float, float], ...] = ()) -> TerrainGrid:
    """Flat 20 m grid (±9 km around the site), plus 500 m bumps at (azimuth°, distance m).

    Bumps are placed along great circles with the horizon module's `_destination`, the same
    geometry validated against NASA's PSR map, so the patch orientation is checked
    independently of its own east/north vectors.
    """
    x0, y0 = (float(v) for v in polar_stereographic_south(SITE_LAT, SITE_LON))
    n = 900
    heights = np.zeros((n, n), dtype=np.float32)
    for azimuth_deg, distance_m in bumps:
        lat, lon = _destination(
            SITE_LAT,
            SITE_LON,
            np.array([math.radians(azimuth_deg)]),
            np.array([distance_m / MOON_RADIUS_M]),
        )
        bx, by = polar_stereographic_south(lat, lon)
        x, y = float(bx[0]), float(by[0])
        col = int((x - (x0 - 9_000)) / 20)
        row = int(((y0 + 9_000) - y) / 20)
        heights[row - 15 : row + 15, col - 15 : col + 15] = 500.0
    return TerrainGrid(heights, x0 - 9_000, y0 + 9_000, 20.0, "synthetic")


def test_flat_terrain_only_shows_the_curvature_drop():
    patch = local_terrain_patch(SITE_LAT, SITE_LON, near_grid(), half_width_m=6_000, size=65)

    assert patch.heights_m.shape == (65, 65)
    assert float(patch.heights_m[32, 32]) == pytest.approx(0.0, abs=1e-3)
    corner_drop = (2 * 6_000**2) / (2 * MOON_RADIUS_M)
    assert float(patch.heights_m[0, 0]) == pytest.approx(-corner_drop, abs=0.05)


@pytest.mark.parametrize(
    ("azimuth_deg", "row", "col"),
    [(0.0, 16, 32), (90.0, 32, 48), (180.0, 48, 32), (270.0, 32, 16)],
)
def test_features_land_in_the_right_local_direction(azimuth_deg: float, row: int, col: int):
    patch = local_terrain_patch(
        SITE_LAT, SITE_LON, near_grid(((azimuth_deg, 3_000.0),)), half_width_m=6_000, size=65
    )

    peak_row, peak_col = np.unravel_index(int(np.argmax(patch.heights_m)), patch.heights_m.shape)
    assert abs(int(peak_row) - row) <= 1
    assert abs(int(peak_col) - col) <= 1
    assert float(patch.heights_m.max()) == pytest.approx(500.0, abs=5)


def test_patch_beyond_the_terrain_grid_is_rejected():
    with pytest.raises(ValueError, match="beyond the near-field"):
        local_terrain_patch(SITE_LAT, SITE_LON, near_grid(), half_width_m=12_000)
