from datetime import datetime

import pytest
from lunar_core.geometry import (
    Body,
    HorizontalPosition,
    SurfacePoint,
    angular_separation_deg,
    horizontal_positions,
)


@pytest.mark.parametrize(("latitude", "longitude"), [(-90.5, 0.0), (0.0, 360.5), (0.0, -181.0)])
def test_surface_point_rejects_out_of_range(latitude: float, longitude: float):
    with pytest.raises(ValueError, match="out of range"):
        SurfacePoint(latitude_deg=latitude, longitude_deg=longitude)


@pytest.mark.usefixtures("kernels_loaded")
def test_naive_datetime_is_rejected():
    with pytest.raises(ValueError, match="timezone-aware"):
        horizontal_positions(Body.SUN, SurfacePoint(-89.5, 0.0), [datetime(2026, 1, 1)])


def test_angular_separation_is_zero_for_same_direction():
    a = HorizontalPosition(azimuth_deg=10.0, elevation_deg=5.0)
    assert angular_separation_deg(a, a) == pytest.approx(0.0, abs=1e-9)


def test_angular_separation_ignores_azimuth_at_zenith():
    a = HorizontalPosition(azimuth_deg=0.0, elevation_deg=90.0)
    b = HorizontalPosition(azimuth_deg=180.0, elevation_deg=90.0)
    assert angular_separation_deg(a, b) == pytest.approx(0.0, abs=1e-6)


def test_angular_separation_across_north():
    a = HorizontalPosition(azimuth_deg=359.0, elevation_deg=0.0)
    b = HorizontalPosition(azimuth_deg=1.0, elevation_deg=0.0)
    assert angular_separation_deg(a, b) == pytest.approx(2.0)
