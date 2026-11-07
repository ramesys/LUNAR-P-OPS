"""Bounded regions of interest (ROI) backed by locally downloaded LOLA windows.

An ROI is a square in local east/north offsets (projected metres) around a centre point, in the
same south polar stereographic plane and east/north convention as `terrain_patch`. It is a
proposed study area, not an official landing site or a surveyed boundary.
"""

import math
from dataclasses import dataclass

import numpy as np

from lunar_core.terrain import (
    FloatArray,
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
)


@dataclass(frozen=True)
class Roi:
    id: str
    name: str
    center_latitude_deg: float
    center_longitude_deg: float
    half_width_m: float
    near_half_width_m: float
    """Half-width of the near-field LOLA window downloaded around the centre."""
    far_half_width_m: float
    center_source_name: str
    center_source_url: str
    note: str


SHACKLETON_RIM_B: Roi = Roi(
    id="shackleton-rim-b",
    name="Shackleton Rim B",
    center_latitude_deg=-89.5244,
    center_longitude_deg=56.30993,
    half_width_m=2_000.0,
    # 12 km: an 8 km near-field horizon from any ROI corner (2.83 km out) stays in the window.
    near_half_width_m=12_000.0,
    far_half_width_m=205_000.0,
    center_source_name="NASA Lunar Surface Data Book, table A2.1-1 (Shackleton Rim B)",
    center_source_url=(
        "https://ntrs.nasa.gov/api/citations/20250002845/downloads/"
        "M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf"
    ),
    note=(
        "Proposed 4 km x 4 km study area around the Shackleton Rim B point; "
        "not an official landing site and not a surveyed rim boundary."
    ),
)

ROIS: dict[str, Roi] = {SHACKLETON_RIM_B.id: SHACKLETON_RIM_B}


@dataclass(frozen=True)
class LocalFrame:
    """Local east/north axes at a centre point, expressed in projected (x, y) metres."""

    center_x_m: float
    center_y_m: float
    east: tuple[float, float]
    north: tuple[float, float]

    def to_projected(
        self, east_m: FloatArray | float, north_m: FloatArray | float
    ) -> tuple[FloatArray, FloatArray]:
        e: FloatArray = np.asarray(east_m, dtype=np.float64)
        n: FloatArray = np.asarray(north_m, dtype=np.float64)
        x: FloatArray = self.center_x_m + e * self.east[0] + n * self.north[0]
        y: FloatArray = self.center_y_m + e * self.east[1] + n * self.north[1]
        return x, y

    def from_projected(
        self, x_m: FloatArray | float, y_m: FloatArray | float
    ) -> tuple[FloatArray, FloatArray]:
        dx: FloatArray = np.asarray(x_m, dtype=np.float64) - self.center_x_m
        dy: FloatArray = np.asarray(y_m, dtype=np.float64) - self.center_y_m
        return dx * self.east[0] + dy * self.east[1], dx * self.north[0] + dy * self.north[1]


def local_frame(latitude_deg: float, longitude_deg: float) -> LocalFrame:
    """Same axes as `local_terrain_patch`: north points away from the pole, east 90° clockwise."""
    x0, y0 = (float(v) for v in polar_stereographic_south(latitude_deg, longitude_deg))
    lon: float = math.radians(longitude_deg)
    return LocalFrame(
        center_x_m=x0,
        center_y_m=y0,
        east=(math.cos(lon), -math.sin(lon)),
        north=(math.sin(lon), math.cos(lon)),
    )


def stereographic_scale_factor(latitude_deg: float) -> float:
    """Point scale of the polar stereographic projection (true scale at the pole)."""
    return 2.0 / (1.0 + math.sin(abs(math.radians(latitude_deg))))


@dataclass(frozen=True)
class RoiGrid:
    """DEM elevations (m above the 1737.4 km sphere) on the ROI's east/north display grid.

    Row 0 is the north edge, column 0 the west edge; NaN where the DEM has no value.
    """

    size: int
    spacing_m: float
    elevations_m: FloatArray
    center_elevation_m: float


def roi_grid(roi: Roi, near: TerrainGrid, *, spacing_m: float = 20.0) -> RoiGrid:
    intervals: int = round(2 * roi.half_width_m / spacing_m)
    if not math.isclose(intervals * spacing_m, 2 * roi.half_width_m):
        raise ValueError("ROI width must be a whole number of grid spacings")
    size: int = intervals + 1
    frame: LocalFrame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
    offsets: FloatArray = np.linspace(-roi.half_width_m, roi.half_width_m, size)
    e, n = np.meshgrid(offsets, offsets[::-1])
    x, y = frame.to_projected(e, n)
    center: float = float(
        near.sample(np.atleast_1d(frame.center_x_m), np.atleast_1d(frame.center_y_m))[0]
    )
    return RoiGrid(
        size=size,
        spacing_m=spacing_m,
        elevations_m=near.sample(x, y),
        center_elevation_m=center,
    )


def roi_corners(roi: Roi) -> list[tuple[str, float, float, float, float]]:
    """(label, east_m, north_m, latitude_deg, east longitude_deg) for the four corners."""
    frame: LocalFrame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
    h: float = roi.half_width_m
    corners: list[tuple[str, float, float, float, float]] = []
    for label, e, n in (
        ("north-west", -h, h),
        ("north-east", h, h),
        ("south-east", h, -h),
        ("south-west", -h, -h),
    ):
        x, y = frame.to_projected(e, n)
        lat, lon = polar_stereographic_south_inverse(x, y)
        corners.append((label, e, n, float(lat), float(lon)))
    return corners
