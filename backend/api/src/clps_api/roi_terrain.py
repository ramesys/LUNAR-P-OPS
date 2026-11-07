"""Serve a bounded ROI terrain grid built from the locally downloaded LOLA windows."""

import math
import threading

import numpy as np
from lunar_core.roi import ROIS, Roi, local_frame, roi_corners, roi_grid, stereographic_scale_factor
from lunar_core.terrain import (
    MOON_RADIUS_M,
    TerrainGrid,
    polar_stereographic_south_inverse,
    terrain_files,
)

from clps_api import terrain_store
from clps_api.evaluation import file_hash, verify_point_coverage
from clps_api.schemas import (
    RegionalTerrainOut,
    RoiCornerOut,
    RoiCoverageCheckOut,
    RoiCoverageOut,
    RoiDatasetOut,
    RoiOut,
    RoiTerrainOut,
)

COORDINATE_REFERENCE: str = "MOON_ME; planetocentric latitude; east longitude [0, 360)"
PROJECTION: str = (
    "LOLA south polar stereographic on the 1737400 m sphere; origin at the pole, "
    "+y toward 0°E, +x toward 90°E (spherical formula, lunar_core.polar_stereographic_south)"
)
DATASET_IDS: dict[str, tuple[str, float]] = {
    "near": ("LDEM_80S_20MPP_ADJ", 20.0),
    "far": ("LDEM_60S_240MPP_ADJ", 240.0),
}
LIMITATIONS: list[str] = [
    "The ROI is a proposed study area around a published point, not an official landing site.",
    "Display-grid elevations are bilinear samples of the 20 m DEM; they are not the raw pixel "
    "lattice. Candidate elevations are re-sampled from the raster at the exact position.",
    "Mesh height exaggeration and curvature are visual only and never used in calculations.",
    "Horizon coverage was checked at the centre and four corners only; every candidate is "
    "checked again before evaluation.",
    "No check here validates illumination, terrain accuracy between samples, or landing safety.",
]

_cache: dict[tuple[str, str, str], RoiTerrainOut] = {}
_lock: threading.Lock = threading.Lock()


def roi_out(roi: Roi) -> RoiOut:
    near, far = terrain_files(terrain_store.terrain_dir(), roi.id)
    return RoiOut(
        roi_id=roi.id,
        name=roi.name,
        center_latitude_deg=roi.center_latitude_deg,
        center_longitude_deg=roi.center_longitude_deg,
        half_width_m=roi.half_width_m,
        center_source_name=roi.center_source_name,
        center_source_url=roi.center_source_url,
        note=roi.note,
        terrain_available=near.is_file() and far.is_file(),
    )


def _dataset(role: str, grid: TerrainGrid, sha256: str) -> RoiDatasetOut:
    dataset_id, resolution = DATASET_IDS[role]
    if not grid.source.endswith(f"/{dataset_id}.TIF") or grid.pixel_size_m != resolution:
        raise ValueError(f"unexpected {role}-field terrain dataset identity or resolution")
    rows, cols = grid.heights.shape
    return RoiDatasetOut(
        role="near" if role == "near" else "far",
        dataset_id=dataset_id,
        source_url=grid.source,
        resolution_m=grid.pixel_size_m,
        local_window_sha256=sha256,
        nodata="NaN in source GeoTIFF; cached NPZ has no separate mask",
        window_bounds_m=[
            grid.x_left,
            grid.y_top - rows * grid.pixel_size_m,
            grid.x_left + cols * grid.pixel_size_m,
            grid.y_top,
        ],
    )


def roi_terrain(roi_id: str) -> RoiTerrainOut | None:
    """None for an unknown ROI; FileNotFoundError when its windows were not downloaded."""
    roi: Roi | None = ROIS.get(roi_id)
    if roi is None:
        return None
    near_path, far_path = terrain_files(terrain_store.terrain_dir(), roi.id)
    if not near_path.is_file() or not far_path.is_file():
        raise FileNotFoundError(
            f"LOLA windows for {roi.id} are not downloaded (run python -m clps_pipelines.fetch_roi)"
        )
    near_hash, far_hash = file_hash(near_path), file_hash(far_path)
    key: tuple[str, str, str] = (roi.id, near_hash, far_hash)
    with _lock:
        cached: RoiTerrainOut | None = _cache.get(key)
        if cached is None:
            cached = _build(
                roi, TerrainGrid.load(near_path), TerrainGrid.load(far_path), near_hash, far_hash
            )
            _cache[key] = cached
    return cached


def _build(
    roi: Roi, near: TerrainGrid, far: TerrainGrid, near_hash: str, far_hash: str
) -> RoiTerrainOut:
    datasets = [_dataset("near", near, near_hash), _dataset("far", far, far_hash)]
    frame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
    grid = roi_grid(roi, near)
    if not math.isfinite(grid.center_elevation_m):
        raise ValueError("ROI centre has no DEM value")
    finite = np.isfinite(grid.elevations_m)
    missing = int(np.count_nonzero(~finite))
    corners = roi_corners(roi)
    checks: list[RoiCoverageCheckOut] = []
    points = [("centre", roi.center_latitude_deg, roi.center_longitude_deg)]
    points += [(label, lat, lon) for label, _, _, lat, lon in corners]
    for label, lat, lon in points:
        try:
            verify_point_coverage(lat, lon, near, far)
            checks.append(
                RoiCoverageCheckOut(
                    label=label,
                    latitude_deg=lat,
                    longitude_deg=lon,
                    status="covered",
                    detail="all near and far ray samples finite",
                )
            )
        except ValueError as error:
            checks.append(
                RoiCoverageCheckOut(
                    label=label,
                    latitude_deg=lat,
                    longitude_deg=lon,
                    status="missing",
                    detail=str(error),
                )
            )
    offsets = np.linspace(-roi.half_width_m, roi.half_width_m, grid.size)
    node_lat, node_lon = polar_stereographic_south_inverse(
        *frame.to_projected(*np.meshgrid(offsets, offsets))
    )
    if np.ptp(node_lon) > 180:
        raise ValueError("ROI longitudes wrap around 0°E; extent reporting is not supported")
    values = grid.elevations_m[finite]
    return RoiTerrainOut(
        roi=roi_out(roi),
        coordinate_reference=COORDINATE_REFERENCE,
        projection=PROJECTION,
        reference_radius_m=MOON_RADIUS_M,
        center_projected_m=[frame.center_x_m, frame.center_y_m],
        east_axis_projected=list(frame.east),
        north_axis_projected=list(frame.north),
        stereographic_scale_factor=stereographic_scale_factor(roi.center_latitude_deg),
        corners=[
            RoiCornerOut(
                label=c[0], east_m=c[1], north_m=c[2], latitude_deg=c[3], longitude_deg=c[4]
            )
            for c in corners
        ],
        latitude_range_deg=[float(node_lat.min()), float(node_lat.max())],
        longitude_range_deg=[float(node_lon.min()), float(node_lon.max())],
        size=grid.size,
        spacing_m=grid.spacing_m,
        elevations_m=[
            round(float(v), 2) if math.isfinite(v) else None for v in grid.elevations_m.ravel()
        ],
        center_elevation_m=grid.center_elevation_m,
        elevation_range_m=[float(values.min()), float(values.max())] if values.size else [],
        datasets=datasets,
        coverage=RoiCoverageOut(
            grid_status="complete" if missing == 0 else "incomplete",
            grid_missing_samples=missing,
            grid_total_samples=int(grid.elevations_m.size),
            horizon_checks=checks,
            note=(
                "Discrete checks of the 0.5° horizon ray samples at five points; "
                "not a proof of coverage for every ROI position."
            ),
        ),
        limitations=LIMITATIONS,
    )


REGIONAL_HALF_WIDTH_M: float = 20_000.0
"""Half-width of the regional display grid: a 40 km x 40 km square centred on the ROI."""
REGIONAL_SPACING_M: float = 250.0


def regional_terrain(roi_id: str) -> RegionalTerrainOut | None:
    """Return a bounded 40 km far-field display grid; never modify the science ROI."""
    roi = ROIS.get(roi_id)
    if roi is None:
        return None
    _, path = terrain_files(terrain_store.terrain_dir(), roi.id)
    if not path.is_file():
        raise FileNotFoundError(f"Far-field LOLA window for {roi.id} is not downloaded")
    far = TerrainGrid.load(path)
    dataset = _dataset("far", far, file_hash(path))
    frame = local_frame(roi.center_latitude_deg, roi.center_longitude_deg)
    half = REGIONAL_HALF_WIDTH_M
    size = round(2 * half / REGIONAL_SPACING_M) + 1
    offsets = np.linspace(-half, half, size)
    east, north = np.meshgrid(offsets, offsets[::-1])
    values = far.sample(*frame.to_projected(east, north))
    if not np.all(np.isfinite(values)):
        raise ValueError("Regional terrain contains missing or out-of-coverage DEM samples")
    corners: list[RoiCornerOut] = []
    for label, e, n in (
        ("north-west", -half, half),
        ("north-east", half, half),
        ("south-east", half, -half),
        ("south-west", -half, -half),
    ):
        lat, lon = polar_stereographic_south_inverse(*frame.to_projected(e, n))
        corners.append(
            RoiCornerOut(
                label=label, east_m=e, north_m=n, latitude_deg=float(lat), longitude_deg=float(lon)
            )
        )
    return RegionalTerrainOut(
        half_width_m=half,
        spacing_m=REGIONAL_SPACING_M,
        size=size,
        elevations_m=[round(float(value), 2) for value in values.ravel()],
        elevation_range_m=[float(values.min()), float(values.max())],
        corners=corners,
        dataset=dataset,
    )
