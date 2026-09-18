"""Visibility rules (ADR 0006, ADR 0010). `horizon_deg` is 0 for a flat horizon, or the terrain
horizon mask evaluated at the body's azimuth."""

import math

from lunar_core.geometry import HorizontalPosition

SUN_RADIUS_KM: float = 695_700.0


def apparent_semidiameter_deg(radius_km: float, distance_km: float) -> float:
    return math.degrees(math.asin(radius_km / distance_km))


def sun_upper_limb_visible(position: HorizontalPosition, horizon_deg: float = 0.0) -> bool:
    semidiameter: float = apparent_semidiameter_deg(SUN_RADIUS_KM, position.distance_km)
    return position.elevation_deg + semidiameter > horizon_deg


def earth_center_visible(
    position: HorizontalPosition, horizon_deg: float = 0.0, min_clearance_deg: float = 0.0
) -> bool:
    return position.elevation_deg > horizon_deg + min_clearance_deg
