"""Terrain screening against analytic surfaces with known slope and roughness."""

import math

import numpy as np
import pytest
from lunar_core.landing_terrain import (
    LandingZoneConstraints,
    landing_zone_screen,
    terrain_metrics,
)
from lunar_core.terrain import TerrainGrid

SPACING = 20.0
SIZE = 201  # 4 km square centred on the projected origin


def _grid(height: "np.ndarray") -> TerrainGrid:
    return TerrainGrid(
        heights=height.astype(np.float32),
        x_left=-SIZE * SPACING / 2,
        y_top=SIZE * SPACING / 2,
        pixel_size_m=SPACING,
        source="synthetic",
    )


def _centres() -> tuple["np.ndarray", "np.ndarray"]:
    c = (np.arange(SIZE) + 0.5) * SPACING - SIZE * SPACING / 2
    x, y = np.meshgrid(c, -c)  # row 0 is the top (max y)
    return x, y


def test_tilted_plane_has_exact_slope_and_no_roughness() -> None:
    x, y = _centres()
    gx, gy = math.tan(math.radians(7.0)) * 0.6, math.tan(math.radians(7.0)) * 0.8
    grid = _grid(100 + gx * x + gy * y)
    # Any longitude: the plane's slope is independent of the local axes.
    for lon in (0.0, 37.0, 210.0):
        (m,) = terrain_metrics(grid, [5.0], [-3.0], [lon], [1.0], neighborhood_radius_m=100)
        assert m.slope.local_slope_deg == pytest.approx(7.0, abs=1e-3)
        assert m.slope.neighborhood_slope_deg == pytest.approx(7.0, abs=1e-3)
        assert m.slope.max_local_slope_deg == pytest.approx(7.0, abs=1e-3)
        assert m.roughness.rms_residual_m == pytest.approx(0.0, abs=1e-3)
        assert m.roughness.residual_relief_m == pytest.approx(0.0, abs=1e-2)
        assert m.quality.coverage_fraction == 1.0
        assert m.quality.vertical_uncertainty == "NOT_ASSESSED"


def test_detrending_separates_roughness_from_regional_tilt() -> None:
    x, _ = _centres()
    bumps = 2.0 * np.sin(2 * np.pi * x / 80.0)  # 80 m wavelength, 2 m amplitude
    tilted = _grid(0.2 * x + bumps)
    flat = _grid(bumps)
    (a,) = terrain_metrics(tilted, [0.0], [0.0], [0.0], [1.0], neighborhood_radius_m=200)
    (b,) = terrain_metrics(flat, [0.0], [0.0], [0.0], [1.0], neighborhood_radius_m=200)
    assert a.roughness.rms_residual_m == pytest.approx(b.roughness.rms_residual_m, rel=1e-3)
    assert a.roughness.rms_residual_m == pytest.approx(2 / math.sqrt(2), rel=0.1)
    assert a.roughness.raw_relief_m is not None and b.roughness.raw_relief_m is not None
    assert a.roughness.raw_relief_m > b.roughness.raw_relief_m + 50
    assert a.slope.neighborhood_slope_deg == pytest.approx(math.degrees(math.atan(0.2)), abs=0.3)


def test_missing_dem_nodes_are_reported_and_never_pass() -> None:
    x, y = _centres()
    height = 0.01 * x
    height[(x > 30) & (np.abs(y) < 60)] = np.nan
    grid = _grid(height)
    (m,) = terrain_metrics(grid, [0.0], [0.0], [0.0], [1.0], neighborhood_radius_m=100)
    assert 0 < m.quality.coverage_fraction < 1
    rules = LandingZoneConstraints(max_local_slope_deg=10, max_roughness_rms_m=5)
    screen = landing_zone_screen(m, rules)
    assert screen.verdict == "FAIL"  # the required coverage (100 %) is not met
    assert {c.name: c.status for c in screen.checks}["roughness_rms_m"] == "NOT_ASSESSED"
    relaxed = landing_zone_screen(
        m, LandingZoneConstraints(max_roughness_rms_m=5, min_coverage_fraction=0)
    )
    assert relaxed.verdict == "PASS"
    # Far outside the grid: nothing to assess.
    (outside,) = terrain_metrics(grid, [1e6], [1e6], [0.0], [1.0])
    assert outside.slope.local_slope_deg is None
    assert (
        landing_zone_screen(
            outside, LandingZoneConstraints(max_local_slope_deg=10, min_coverage_fraction=0)
        ).verdict
        == "NOT_ASSESSED"
    )


def test_screen_verdicts_margins_and_unconfigured_limits() -> None:
    x, _ = _centres()
    (m,) = terrain_metrics(_grid(math.tan(math.radians(8)) * x), [0.0], [0.0], [0.0], [1.0])
    assert landing_zone_screen(m, LandingZoneConstraints()).verdict == "NOT_ASSESSED"
    passing = landing_zone_screen(m, LandingZoneConstraints(max_local_slope_deg=10))
    assert passing.verdict == "PASS"
    assert passing.margin() == pytest.approx(0.2, abs=1e-3)
    failing = landing_zone_screen(m, LandingZoneConstraints(max_neighborhood_slope_deg=5))
    assert failing.verdict == "FAIL" and failing.margin() is not None and failing.margin() < 0
    assert any("uncertainty" in item for item in failing.not_assessed)


def test_vectorized_results_match_single_point_calls_and_validate_inputs() -> None:
    x, y = _centres()
    grid = _grid(3 * np.cos(x / 150) * np.sin(y / 90) + 0.05 * y)
    xs, ys = [0.0, 120.0, -340.0], [10.0, -200.0, 400.0]
    many = terrain_metrics(grid, xs, ys, [10.0, 20.0, 30.0], [1.0, 1.0, 1.0])
    for i in range(3):
        (one,) = terrain_metrics(grid, [xs[i]], [ys[i]], [10.0 * (i + 1)], [1.0])
        assert one == many[i]
    with pytest.raises(ValueError):
        terrain_metrics(grid, [0.0], [0.0], [0.0], [1.0], neighborhood_radius_m=30)
    with pytest.raises(ValueError):
        terrain_metrics(grid, [0.0], [0.0], [0.0], [1.0], neighborhood_radius_m=600)
