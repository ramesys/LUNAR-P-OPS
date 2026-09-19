"""Download the LOLA terrain windows needed to compute horizon masks for the site catalog."""

import time
from pathlib import Path

import numpy as np
import rasterio
from lunar_core.sites import Site, load_catalog
from lunar_core.terrain import TerrainGrid, polar_stereographic_south, terrain_files
from rasterio.windows import Window, from_bounds

from clps_pipelines import data_dir

LOLA_BASE: str = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp"
NEAR_DEM: str = f"{LOLA_BASE}/LDEM_80S_20MPP_ADJ.TIF"
FAR_DEM: str = f"{LOLA_BASE}/LDEM_60S_240MPP_ADJ.TIF"
PSR_MAP: str = f"{LOLA_BASE}/LPSR_80S_20MPP_ADJ.TIF"
NEAR_HALF_WIDTH_M: float = 8_500.0
FAR_HALF_WIDTH_M: float = 210_000.0

# Avoid listing the remote directory on open; this server does not support multi-range requests.
GDAL_ENV: dict[str, str] = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".TIF",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
}


def read_window(url: str, center_x: float, center_y: float, half_width_m: float) -> TerrainGrid:
    with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{url}") as dataset:
        window: Window = (
            from_bounds(
                center_x - half_width_m,
                center_y - half_width_m,
                center_x + half_width_m,
                center_y + half_width_m,
                dataset.transform,
            )
            .round_offsets()
            .round_lengths()
        )
        heights: np.ndarray = dataset.read(1, window=window).astype(np.float32)
        left, top = dataset.window_transform(window) * (0, 0)
        return TerrainGrid(
            heights=heights,
            x_left=float(left),
            y_top=float(top),
            pixel_size_m=float(dataset.res[0]),
            source=url,
        )


def terrain_paths(site_id: str) -> tuple[Path, Path]:
    return terrain_files(data_dir() / "terrain", site_id)


def fetch_site(site: Site) -> None:
    near_path, far_path = terrain_paths(site.id)
    x, y = polar_stereographic_south(site.latitude_deg, site.longitude_deg)
    for path, url, half_width in (
        (near_path, NEAR_DEM, NEAR_HALF_WIDTH_M),
        (far_path, FAR_DEM, FAR_HALF_WIDTH_M),
    ):
        if path.is_file():
            print(f"ok          {path.name}")
            continue
        started: float = time.perf_counter()
        read_window(url, float(x), float(y), half_width).save(path)
        print(f"downloaded  {path.name} in {time.perf_counter() - started:.1f}s")


def main() -> None:
    for site in load_catalog():
        fetch_site(site)


if __name__ == "__main__":
    main()
