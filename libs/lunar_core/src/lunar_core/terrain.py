"""Terrain height grids in the LOLA south polar stereographic projection (sphere R = 1737.4 km)."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

MOON_RADIUS_M: float = 1_737_400.0

FloatArray = NDArray[np.float64]


def polar_stereographic_south(
    latitude_deg: FloatArray | float, longitude_deg: FloatArray | float
) -> tuple[FloatArray, FloatArray]:
    """Map coordinates (m) of the LOLA polar DEMs: origin at the pole, +y toward 0°E."""
    lat: FloatArray = np.radians(np.asarray(latitude_deg, dtype=np.float64))
    lon: FloatArray = np.radians(np.asarray(longitude_deg, dtype=np.float64))
    rho: FloatArray = 2.0 * MOON_RADIUS_M * np.tan(np.pi / 4.0 + lat / 2.0)
    return rho * np.sin(lon), rho * np.cos(lon)


def polar_stereographic_south_inverse(
    x: FloatArray | float, y: FloatArray | float
) -> tuple[FloatArray, FloatArray]:
    """Inverse of `polar_stereographic_south`: (latitude, east longitude in [0, 360)) in deg."""
    xs: FloatArray = np.asarray(x, dtype=np.float64)
    ys: FloatArray = np.asarray(y, dtype=np.float64)
    rho: FloatArray = np.hypot(xs, ys)
    lat: FloatArray = 2.0 * np.arctan(rho / (2.0 * MOON_RADIUS_M)) - np.pi / 2.0
    lon: FloatArray = np.mod(np.degrees(np.arctan2(xs, ys)), 360.0)
    return np.degrees(lat), lon


@dataclass(frozen=True)
class TerrainGrid:
    """Heights (m above the 1737.4 km sphere) on a regular grid; row 0 is the top (max y)."""

    heights: NDArray[np.float32]
    x_left: float
    y_top: float
    pixel_size_m: float
    source: str

    def sample(self, x: FloatArray, y: FloatArray) -> FloatArray:
        """Bilinear interpolation at pixel centers; NaN outside the grid."""
        col: FloatArray = (x - self.x_left) / self.pixel_size_m - 0.5
        row: FloatArray = (self.y_top - y) / self.pixel_size_m - 0.5
        rows, cols = self.heights.shape
        inside: NDArray[np.bool_] = (col >= 0) & (row >= 0) & (col <= cols - 1) & (row <= rows - 1)
        c0: NDArray[np.intp] = np.clip(np.floor(col), 0, cols - 2).astype(np.intp)
        r0: NDArray[np.intp] = np.clip(np.floor(row), 0, rows - 2).astype(np.intp)
        fc: FloatArray = np.clip(col - c0, 0.0, 1.0)
        fr: FloatArray = np.clip(row - r0, 0.0, 1.0)
        h: NDArray[np.float32] = self.heights
        top: FloatArray = h[r0, c0] * (1.0 - fc) + h[r0, c0 + 1] * fc
        bottom: FloatArray = h[r0 + 1, c0] * (1.0 - fc) + h[r0 + 1, c0 + 1] * fc
        values: FloatArray = top * (1.0 - fr) + bottom * fr
        return np.where(inside, values, np.nan)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            heights=self.heights,
            x_left=self.x_left,
            y_top=self.y_top,
            pixel_size_m=self.pixel_size_m,
            source=self.source,
        )

    @staticmethod
    def load(path: Path) -> "TerrainGrid":
        with np.load(path) as data:
            return TerrainGrid(
                heights=data["heights"].astype(np.float32),
                x_left=float(data["x_left"]),
                y_top=float(data["y_top"]),
                pixel_size_m=float(data["pixel_size_m"]),
                source=str(data["source"]),
            )
