"""Download the bounded LOLA windows for the regions of interest (never the whole south pole).

Run with `python -m clps_pipelines.fetch_roi`. Existing files are kept; recheck their SHA-256
and nodata after any download, because the remote NASA products may change.
"""

from lunar_core.roi import ROIS, Roi
from lunar_core.terrain import polar_stereographic_south

from clps_pipelines.fetch_terrain import FAR_DEM, NEAR_DEM, read_window, terrain_paths


def fetch_roi(roi: Roi) -> None:
    near_path, far_path = terrain_paths(roi.id)
    x, y = polar_stereographic_south(roi.center_latitude_deg, roi.center_longitude_deg)
    for path, url, half_width in (
        (near_path, NEAR_DEM, roi.near_half_width_m),
        (far_path, FAR_DEM, roi.far_half_width_m),
    ):
        if path.is_file():
            print(f"ok          {path.name}")
            continue
        read_window(url, float(x), float(y), half_width).save(path)
        print(f"downloaded  {path.name}")


def main() -> None:
    for roi in ROIS.values():
        fetch_roi(roi)


if __name__ == "__main__":
    main()
