"""Compare the cached LOLA window with independent pyproj / Rasterio source sampling."""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from lunar_core.terrain import (
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
)
from pyproj import CRS, Transformer
from rasterio.windows import Window

URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
near = Path("/data/terrain/sample-a_near.npz")
grid = TerrainGrid.load(near)
crs = CRS.from_proj4("+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs")
geo = CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")
forward = Transformer.from_crs(geo, crs, always_xy=True)
inverse = Transformer.from_crs(crs, geo, always_xy=True)
x0, y0 = forward.transform(0, -89.5)
app_x0, app_y0 = polar_stereographic_south(-89.5, 0)
# Captured from the browser-created C0 (full API precision), not a fabricated location.
selected_lat = -89.48166138121806
selected_lon = 3.171005503338025
selected_elevation = -618.7817844514108
selected_x, selected_y = forward.transform(selected_lon, selected_lat)
points = [(0, 0), (1200, -900), (-2300, 1800), (4000, 3000), (selected_x - x0, selected_y - y0)]
results = []
with (
    rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF",
        GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    ),
    rasterio.open("/vsicurl/" + URL) as ds,
):
    for east, north in points:
        x, y = x0 + east, y0 + north
        lon, lat = inverse.transform(x, y)
        app_x, app_y = float(app_x0) + east, float(app_y0) + north
        app_lat, app_lon = polar_stereographic_south_inverse(app_x, app_y)
        col, row = (~ds.transform) * (x, y)
        col -= 0.5
        row -= 0.5
        c, r = math.floor(col), math.floor(row)
        h = ds.read(1, window=Window(c, r, 2, 2), masked=True)
        if np.ma.getmaskarray(h).any():
            raise ValueError("Source raster contains nodata at comparison sample")
        fx, fy = col - c, row - r
        independent = float(
            (1 - fy) * ((1 - fx) * h[0, 0] + fx * h[0, 1])
            + fy * ((1 - fx) * h[1, 0] + fx * h[1, 1])
        )
        sampled = float(grid.sample(np.array([app_x]), np.array([app_y]))[0])
        longitude_error = abs((float(app_lon) - lon + 180) % 360 - 180)
        results.append(
            {
                "east_m": east,
                "north_m": north,
                "lat_deg": lat,
                "lon_east_deg": lon % 360,
                "coordinate_max_error_deg": max(abs(float(app_lat) - lat), longitude_error),
                "source_elevation_m": independent,
                "cached_elevation_m": sampled,
                "elevation_difference_m": sampled - independent,
            }
        )
    results[-1]["browser_candidate_id"] = (
        "candidate-d8dff67ea896840707b28a58aeeecc87e02bbea713603f80ecfff8076f3e59f1"
    )
    results[-1]["candidate_elevation_m"] = selected_elevation
    results[-1]["candidate_minus_source_m"] = selected_elevation - results[-1]["source_elevation_m"]
    print(
        json.dumps(
            {
                "source": URL,
                "cached_window_sha256": hashlib.sha256(near.read_bytes()).hexdigest(),
                "source_checksum": "unavailable: only remote ranges read",
                "nodata": "NaN" if ds.nodata is not None and math.isnan(ds.nodata) else ds.nodata,
                "source_bounds_m": list(ds.bounds),
                "source_resolution_m": list(ds.res),
                "coordinate_tolerance_deg": 1e-9,
                "elevation_tolerance_m": 0.001,
                "samples": results,
                "passed": abs(results[-1]["candidate_minus_source_m"]) < 0.001
                and all(
                    s["coordinate_max_error_deg"] < 1e-9
                    and abs(s["elevation_difference_m"]) < 0.001
                    for s in results
                ),
            },
            indent=2,
        )
    )
