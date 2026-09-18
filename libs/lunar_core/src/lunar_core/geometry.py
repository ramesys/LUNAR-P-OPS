import math
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

import spiceypy as spice

MOON_FIXED_FRAME: str = "MOON_ME"
ABERRATION_CORRECTION: str = "LT+S"

# CSPICE keeps global state and is not thread-safe (FastAPI runs sync endpoints in a threadpool).
SPICE_LOCK: threading.Lock = threading.Lock()


class Body(StrEnum):
    SUN = "SUN"
    EARTH = "EARTH"


@dataclass(frozen=True)
class SurfacePoint:
    """Point on the lunar surface in MOON_ME, planetocentric latitude and east longitude."""

    latitude_deg: float
    longitude_deg: float
    height_m: float = 0.0

    def __post_init__(self) -> None:
        if not -90.0 <= self.latitude_deg <= 90.0:
            raise ValueError(f"latitude_deg out of range [-90, 90]: {self.latitude_deg}")
        if not -180.0 <= self.longitude_deg <= 360.0:
            raise ValueError(f"longitude_deg out of range [-180, 360]: {self.longitude_deg}")


@dataclass(frozen=True)
class HorizontalPosition:
    """Azimuth clockwise from local north (0-360); elevation above the local horizontal plane."""

    azimuth_deg: float
    elevation_deg: float
    distance_km: float


def _to_et(time: datetime) -> float:
    if time.tzinfo is None:
        raise ValueError("time must be timezone-aware (UTC)")
    utc: datetime = time.astimezone(UTC)
    et: float = spice.str2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f"))
    return et


def _observer_position_km(point: SurfacePoint) -> list[float]:
    radii: Sequence[float] = spice.bodvrd("MOON", "RADII", 3)[1]
    equatorial_km: float = float(radii[0])
    flattening: float = (equatorial_km - float(radii[2])) / equatorial_km
    position: Sequence[float] = spice.georec(
        math.radians(point.longitude_deg),
        math.radians(point.latitude_deg),
        point.height_m / 1000.0,
        equatorial_km,
        flattening,
    )
    return [float(c) for c in position]


def horizontal_positions(
    body: Body, point: SurfacePoint, times: Sequence[datetime]
) -> list[HorizontalPosition]:
    """Apparent (light-time + stellar aberration) azimuth/elevation of a body's center.

    Requires kernels loaded with `lunar_core.kernels.load_kernels`. No refraction (airless).
    """
    results: list[HorizontalPosition] = []
    with SPICE_LOCK:
        observer: list[float] = _observer_position_km(point)
        for time in times:
            state, _light_time = spice.azlcpo(
                "ELLIPSOID",
                body.value,
                _to_et(time),
                ABERRATION_CORRECTION,
                False,
                True,
                observer,
                "MOON",
                MOON_FIXED_FRAME,
            )
            results.append(
                HorizontalPosition(
                    azimuth_deg=math.degrees(float(state[1])) % 360.0,
                    elevation_deg=math.degrees(float(state[2])),
                    distance_km=float(state[0]),
                )
            )
    return results


def angular_separation_deg(a: HorizontalPosition, b: HorizontalPosition) -> float:
    """Great-circle angle between two sky directions; well-behaved near the zenith."""
    az_a: float = math.radians(a.azimuth_deg)
    az_b: float = math.radians(b.azimuth_deg)
    el_a: float = math.radians(a.elevation_deg)
    el_b: float = math.radians(b.elevation_deg)
    cos_sep: float = math.sin(el_a) * math.sin(el_b) + math.cos(el_a) * math.cos(el_b) * math.cos(
        az_a - az_b
    )
    return math.degrees(math.acos(max(-1.0, min(1.0, cos_sep))))
