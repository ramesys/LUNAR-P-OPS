"""Pole map metadata and the cached LOLA hillshade background (RF-15)."""

import os
from pathlib import Path

from lunar_core.pole_map import (
    BasemapInfo,
    basemap_files,
    graticule,
    map_half_width_m,
    read_basemap_info,
)

from clps_api.schemas import MeridianOut, ParallelOut, PoleMapOut
from clps_api.service import CATALOG

IMAGE_URL: str = "/api/map/hillshade.png"
SOURCE_NAME: str = "NASA GSFC PGDA — LOLA hillshade LDEM_80S_80MPP_ADJ_HILL"
SOURCE_PAGE: str = "https://pgda.gsfc.nasa.gov/products/90"


def basemap_dir() -> Path:
    return Path(os.environ.get("CLPS_DATA_DIR", "data")) / "basemap"


def image_path() -> Path | None:
    """The background image, or None if missing or made for a different extent."""
    image, info_path = basemap_files(basemap_dir())
    info: BasemapInfo | None = read_basemap_info(info_path)
    if not image.is_file() or info is None or info.half_width_m != map_half_width_m(CATALOG):
        return None
    return image


def pole_map() -> PoleMapOut:
    half_width: float = map_half_width_m(CATALOG)
    parallels, meridians = graticule(half_width)
    return PoleMapOut(
        half_width_m=half_width,
        image_url=IMAGE_URL if image_path() is not None else None,
        parallels=[
            ParallelOut(latitude_deg=p.latitude_deg, radius_m=round(p.radius_m, 1))
            for p in parallels
        ],
        meridians=[
            MeridianOut(longitude_deg=m.longitude_deg, x_m=round(m.x_m, 1), y_m=round(m.y_m, 1))
            for m in meridians
        ],
        source_name=SOURCE_NAME,
        source_url=SOURCE_PAGE,
    )
