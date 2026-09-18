"""Visibility rules over a flat local horizon (ADR 0006)."""

import math

from lunar_core.geometry import HorizontalPosition

SUN_RADIUS_KM: float = 695_700.0
EARTH_MIN_ELEVATION_DEG: float = 0.0


def apparent_semidiameter_deg(radius_km: float, distance_km: float) -> float:
    return math.degrees(math.asin(radius_km / distance_km))


def sun_upper_limb_visible(position: HorizontalPosition) -> bool:
    semidiameter: float = apparent_semidiameter_deg(SUN_RADIUS_KM, position.distance_km)
    return position.elevation_deg + semidiameter > 0.0


def earth_center_visible(position: HorizontalPosition) -> bool:
    return position.elevation_deg > EARTH_MIN_ELEVATION_DEG
