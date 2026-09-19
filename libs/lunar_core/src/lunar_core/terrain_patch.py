"""Local terrain around a site on an east/north grid, for the 3D view (RF-19)."""

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_core.terrain import MOON_RADIUS_M, FloatArray, TerrainGrid, polar_stereographic_south

DEFAULT_HALF_WIDTH_M: float = 6_000.0
"""Fits inside the ±8.5 km near-field window for any grid rotation (8.5 km / √2)."""
DEFAULT_SIZE: int = 129


@dataclass(frozen=True)
class LocalTerrainPatch:
    """Heights (m) relative to the site's ground, including the drop of the lunar curvature.

    Row 0 is the north edge (+half_width), column 0 the west edge (-half_width); spacing is
    `2 * half_width_m / (size - 1)`. East/north are the local directions at the site.
    """

    half_width_m: float
    size: int
    heights_m: NDArray[np.float32]
    site_ground_m: float


def local_terrain_patch(
    latitude_deg: float,
    longitude_deg: float,
    near: TerrainGrid,
    *,
    half_width_m: float = DEFAULT_HALF_WIDTH_M,
    size: int = DEFAULT_SIZE,
) -> LocalTerrainPatch:
    x0, y0 = (float(v) for v in polar_stereographic_south(latitude_deg, longitude_deg))
    lon: float = math.radians(longitude_deg)
    # In the south polar projection, local north points away from the pole and east is 90°
    # clockwise from it (same convention as polar_stereographic_south: +y toward 0°E).
    north: tuple[float, float] = (math.sin(lon), math.cos(lon))
    east: tuple[float, float] = (math.cos(lon), -math.sin(lon))

    offsets: FloatArray = np.linspace(-half_width_m, half_width_m, size)
    e, n = np.meshgrid(offsets, offsets[::-1])
    x: FloatArray = x0 + e * east[0] + n * north[0]
    y: FloatArray = y0 + e * east[1] + n * north[1]
    heights: FloatArray = near.sample(x, y)
    ground: float = float(near.sample(np.atleast_1d(x0), np.atleast_1d(y0))[0])
    if np.isnan(heights).any() or math.isnan(ground):
        raise ValueError("the local patch extends beyond the near-field terrain grid")

    curvature_drop: FloatArray = (e**2 + n**2) / (2.0 * MOON_RADIUS_M)
    relative: FloatArray = heights - ground - curvature_drop
    return LocalTerrainPatch(
        half_width_m=half_width_m,
        size=size,
        heights_m=relative.astype(np.float32),
        site_ground_m=ground,
    )
