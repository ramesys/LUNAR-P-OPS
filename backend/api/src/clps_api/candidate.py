"""Create a scientific candidate from the original DEM, never from display heights."""

import hashlib
import json
import math
from datetime import UTC

import numpy as np
from lunar_core.sites import Site
from lunar_core.terrain import (
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
    terrain_files,
)

from clps_api import terrain_store
from clps_api.schemas import CandidateOut, CandidateRequest


def create_candidate(site: Site, request: CandidateRequest) -> CandidateOut:
    if site.id != "sample-a":
        raise ValueError("candidate selection is available only for sample-a")
    near, _ = terrain_files(terrain_store.terrain_dir(), site.id)
    if not near.is_file():
        raise FileNotFoundError("LOLA near-field terrain is unavailable")
    grid = TerrainGrid.load(near)
    checksum = hashlib.sha256(near.read_bytes()).hexdigest()
    x0, y0 = polar_stereographic_south(site.latitude_deg, site.longitude_deg)
    lon = math.radians(site.longitude_deg)
    x = float(x0) + request.east_m * math.cos(lon) + request.north_m * math.sin(lon)
    y = float(y0) - request.east_m * math.sin(lon) + request.north_m * math.cos(lon)
    elevation = float(grid.sample(np.array([x]), np.array([y]))[0])
    if not math.isfinite(elevation):
        raise ValueError("point lies outside valid DEM coverage")
    latitude, longitude = polar_stereographic_south_inverse(x, y)
    lat, lng = float(latitude), float(longitude)
    instant = request.selected_time_utc.astimezone(UTC)
    site_key = f"{lat:.12f},{lng:.12f}"
    site_id = "site-" + hashlib.sha256(site_key.encode()).hexdigest()[:20]
    reference = "MOON_ME; planetocentric latitude; east longitude [0, 360)"
    inputs = {
        "site_id": site_id,
        "latitude_deg": lat,
        "longitude_deg": lng,
        "observer_height_m": request.observer_height_m,
        "selected_time_utc": instant.isoformat(),
        "terrain_source_url": grid.source,
        "terrain_dataset_sha256": checksum,
        "dem_resolution_m": grid.pixel_size_m,
        "coordinate_reference": reference,
        "terrain_elevation_m": elevation,
    }
    identifier = hashlib.sha256(
        json.dumps(inputs, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return CandidateOut(
        candidate_id=f"candidate-{identifier}",
        terrain_dataset_sha256=checksum,
        terrain_nodata="NaN" if grid.source.endswith("/LDEM_80S_20MPP_ADJ.TIF") else "unknown",
        coverage_bounds_m=[
            grid.x_left + grid.pixel_size_m / 2,
            grid.y_top - (grid.heights.shape[0] - 0.5) * grid.pixel_size_m,
            grid.x_left + (grid.heights.shape[1] - 0.5) * grid.pixel_size_m,
            grid.y_top - grid.pixel_size_m / 2,
        ],
        site_id=site_id,
        latitude_deg=lat,
        longitude_deg=lng,
        terrain_elevation_m=elevation,
        observer_height_m=request.observer_height_m,
        selected_time_utc=instant,
        terrain_dataset_id="LDEM_80S_20MPP_ADJ",
        terrain_source_url=grid.source,
        dem_resolution_m=grid.pixel_size_m,
        coordinate_reference=reference,
        validation_status="not_independently_validated",
        data_availability="available",
    )
