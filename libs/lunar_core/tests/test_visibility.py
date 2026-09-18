import pytest
from lunar_core.geometry import HorizontalPosition
from lunar_core.visibility import (
    SUN_RADIUS_KM,
    apparent_semidiameter_deg,
    earth_center_visible,
    sun_upper_limb_visible,
)

AU_KM = 149_597_870.7


def sun_at(elevation_deg: float) -> HorizontalPosition:
    return HorizontalPosition(azimuth_deg=0.0, elevation_deg=elevation_deg, distance_km=AU_KM)


def test_sun_semidiameter_at_one_au_is_about_16_arcmin():
    assert apparent_semidiameter_deg(SUN_RADIUS_KM, AU_KM) == pytest.approx(0.2665, abs=1e-3)


@pytest.mark.parametrize(
    ("elevation_deg", "visible"),
    [(1.0, True), (0.0, True), (-0.2, True), (-0.3, False), (-5.0, False)],
)
def test_sun_counts_as_visible_while_upper_limb_is_up(elevation_deg: float, visible: bool):
    assert sun_upper_limb_visible(sun_at(elevation_deg)) is visible


@pytest.mark.parametrize(("elevation_deg", "visible"), [(0.1, True), (0.0, False), (-0.1, False)])
def test_earth_uses_center_above_zero(elevation_deg: float, visible: bool):
    position = HorizontalPosition(azimuth_deg=0.0, elevation_deg=elevation_deg, distance_km=4e5)
    assert earth_center_visible(position) is visible
