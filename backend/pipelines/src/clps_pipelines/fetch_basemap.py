"""Download a reduced LOLA hillshade of the south pole as the 2D map background (RF-15)."""

import time
import warnings
from pathlib import Path

import numpy as np
import rasterio
from lunar_core.pole_map import (
    BasemapInfo,
    basemap_files,
    map_half_width_m,
    read_basemap_info,
    write_basemap_info,
)
from lunar_core.sites import load_catalog
from rasterio.enums import Resampling
from rasterio.errors import NotGeoreferencedWarning
from rasterio.windows import Window, from_bounds

from clps_pipelines import data_dir
from clps_pipelines.fetch_terrain import GDAL_ENV, LOLA_BASE

HILLSHADE: str = f"{LOLA_BASE}/LDEM_80S_80MPP_ADJ_HILL.TIF"
PIXELS: int = 1024


def main() -> None:
    half_width: float = map_half_width_m(load_catalog())
    image_path, info_path = basemap_files(data_dir() / "basemap")
    existing: BasemapInfo | None = read_basemap_info(info_path)
    if image_path.is_file() and existing is not None and existing.half_width_m == half_width:
        print(f"ok          {image_path.name} (±{half_width / 1000:.0f} km)")
        return

    started: float = time.perf_counter()
    with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{HILLSHADE}") as dataset:
        window: Window = from_bounds(
            -half_width, -half_width, half_width, half_width, dataset.transform
        )
        shade: np.ndarray = dataset.read(
            1, window=window, out_shape=(PIXELS, PIXELS), resampling=Resampling.average
        )
    image: np.ndarray = np.clip(np.nan_to_num(shade, nan=0.0), 0, 255).astype(np.uint8)
    image_path.parent.mkdir(parents=True, exist_ok=True)
    # A plain PNG: its extent lives in the JSON sidecar, not in a geotransform.
    with (
        warnings.catch_warnings(action="ignore", category=NotGeoreferencedWarning),
        rasterio.open(
            image_path, "w", driver="PNG", width=PIXELS, height=PIXELS, count=1, dtype="uint8"
        ) as png,
    ):
        png.write(image, 1)
    Path(f"{image_path}.aux.xml").unlink(missing_ok=True)
    write_basemap_info(info_path, BasemapInfo(half_width_m=half_width, source_url=HILLSHADE))
    print(
        f"downloaded  {image_path.name} (±{half_width / 1000:.0f} km) "
        f"in {time.perf_counter() - started:.1f}s"
    )


if __name__ == "__main__":
    main()
