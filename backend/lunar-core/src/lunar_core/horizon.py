"""Terrain horizon masks: for each azimuth, the highest elevation angle of the terrain.

Two nested grids, as in the LOLA horizon method (Barker et al. 2023): a fine grid near the
observer and a coarse one far away. Rays follow great circles on the 1737.4 km sphere.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_core.terrain import MOON_RADIUS_M, FloatArray, TerrainGrid, polar_stereographic_south


@dataclass(frozen=True)
class HorizonMask:
    """Terrain elevation angle (deg) at evenly spaced azimuths from 0 (clockwise from north)."""

    azimuths_deg: FloatArray
    elevations_deg: FloatArray

    def at(self, azimuth_deg: FloatArray | float) -> FloatArray:
        az: FloatArray = np.mod(np.asarray(azimuth_deg, dtype=np.float64), 360.0)
        closed_az: FloatArray = np.append(self.azimuths_deg, 360.0)
        closed_el: FloatArray = np.append(self.elevations_deg, self.elevations_deg[0])
        return np.interp(az, closed_az, closed_el)


def _destination(
    latitude_deg: float, longitude_deg: float, azimuth_rad: FloatArray, angle_rad: FloatArray
) -> tuple[FloatArray, FloatArray]:
    """Point at central angle `angle_rad` along the great circle leaving at `azimuth_rad`."""
    lat0: float = np.radians(latitude_deg)
    lon0: float = np.radians(longitude_deg)
    sin_lat: FloatArray = np.sin(lat0) * np.cos(angle_rad) + np.cos(lat0) * np.sin(
        angle_rad
    ) * np.cos(azimuth_rad)
    lat: FloatArray = np.arcsin(np.clip(sin_lat, -1.0, 1.0))
    lon: FloatArray = lon0 + np.arctan2(
        np.sin(azimuth_rad) * np.sin(angle_rad) * np.cos(lat0),
        np.cos(angle_rad) - np.sin(lat0) * sin_lat,
    )
    return np.degrees(lat), np.degrees(lon)


def horizon_mask(
    latitude_deg: float,
    longitude_deg: float,
    near: TerrainGrid,
    far: TerrainGrid,
    *,
    observer_height_m: float = 2.0,
    azimuth_step_deg: float = 0.5,
    near_limit_m: float = 8_000.0,
    max_distance_m: float = 200_000.0,
) -> HorizonMask:
    azimuths_deg: FloatArray = np.arange(0.0, 360.0, azimuth_step_deg)
    near_d: FloatArray = np.arange(near.pixel_size_m, near_limit_m, near.pixel_size_m)
    far_d: FloatArray = np.arange(near_limit_m, max_distance_m, far.pixel_size_m)

    x0, y0 = polar_stereographic_south(latitude_deg, longitude_deg)
    ground_m: float = float(near.sample(np.atleast_1d(x0), np.atleast_1d(y0))[0])
    if np.isnan(ground_m):
        raise ValueError("observer is outside the near-field terrain grid")
    observer_radius: float = MOON_RADIUS_M + ground_m + observer_height_m

    best: FloatArray = np.full(azimuths_deg.shape, -90.0)
    for distances, grid in ((near_d, near), (far_d, far)):
        angle: FloatArray = distances[np.newaxis, :] / MOON_RADIUS_M
        az_rad: FloatArray = np.radians(azimuths_deg)[:, np.newaxis]
        lat, lon = _destination(latitude_deg, longitude_deg, az_rad, angle)
        x, y = polar_stereographic_south(lat, lon)
        heights: FloatArray = grid.sample(x, y)
        target_radius: FloatArray = MOON_RADIUS_M + heights
        elevation: FloatArray = np.degrees(
            np.arctan2(
                target_radius * np.cos(angle) - observer_radius, target_radius * np.sin(angle)
            )
        )
        with np.errstate(invalid="ignore"):
            best = np.fmax(best, np.nanmax(elevation, axis=1, initial=-90.0))
    return HorizonMask(azimuths_deg=azimuths_deg, elevations_deg=best)


def above_mask(
    mask: HorizonMask, azimuth_deg: FloatArray, elevation_deg: FloatArray, margin_deg: FloatArray
) -> NDArray[np.bool_]:
    """True where `elevation + margin` clears the terrain (margin = semidiameter for the Sun)."""
    return (elevation_deg + margin_deg) > mask.at(azimuth_deg)
