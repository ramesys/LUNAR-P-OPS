import math
from pathlib import Path

import pytest
from lunar_core.pole_map import (
    BasemapInfo,
    graticule,
    map_half_width_m,
    read_basemap_info,
    site_map_xy,
    write_basemap_info,
)
from lunar_core.sites import Site, load_catalog


def site(latitude: float, longitude: float) -> Site:
    return Site("x", "X", latitude, longitude, "sample", "")


def test_extent_fits_every_catalog_site_with_margin():
    catalog = load_catalog()
    half = map_half_width_m(catalog)
    farthest = max(math.hypot(*site_map_xy(s)) for s in catalog)

    assert half >= farthest + 30_000
    assert half % 50_000 == 0


def test_extent_is_clamped():
    assert map_half_width_m([site(-89.9, 0.0)]) == 100_000
    assert map_half_width_m([site(-70.0, 0.0)]) == 300_000


def test_sites_project_with_zero_meridian_up_and_90e_right():
    x, y = site_map_xy(site(-89.0, 0.0))
    assert x == pytest.approx(0.0, abs=1e-6)
    assert y > 0
    x, y = site_map_xy(site(-89.0, 90.0))
    assert x > 0
    assert y == pytest.approx(0.0, abs=1e-6)


def test_graticule_parallels_fit_the_map_and_meridians_reach_its_edge():
    parallels, meridians = graticule(200_000)

    assert [p.latitude_deg for p in parallels] == [-89.0, -88.0, -87.0, -86.0, -85.0, -84.0]
    assert all(p.radius_m <= 200_000 for p in parallels)
    assert len(meridians) == 12
    assert all(math.hypot(m.x_m, m.y_m) == pytest.approx(200_000) for m in meridians)
    east = next(m for m in meridians if m.longitude_deg == 90.0)
    assert (east.x_m, east.y_m) == pytest.approx((200_000, 0.0), abs=1e-6)


def test_basemap_info_round_trip(tmp_path: Path):
    path = tmp_path / "info.json"
    assert read_basemap_info(path) is None
    write_basemap_info(path, BasemapInfo(200_000.0, "https://example.test/hill.tif"))
    assert read_basemap_info(path) == BasemapInfo(200_000.0, "https://example.test/hill.tif")
