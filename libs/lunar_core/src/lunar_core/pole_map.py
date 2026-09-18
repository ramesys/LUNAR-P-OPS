"""2D map of the south polar region (RF-15) in the LOLA polar stereographic projection."""

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from lunar_core.sites import Site
from lunar_core.terrain import polar_stereographic_south

MAP_MARGIN_M: float = 30_000.0
MAP_ROUNDING_M: float = 50_000.0
MIN_HALF_WIDTH_M: float = 100_000.0
MAX_HALF_WIDTH_M: float = 300_000.0  # the 80°S LOLA products end at ±304 km
MERIDIAN_STEP_DEG: int = 30


@dataclass(frozen=True)
class Parallel:
    latitude_deg: float
    radius_m: float


@dataclass(frozen=True)
class Meridian:
    longitude_deg: float
    x_m: float
    y_m: float
    """End point of the meridian line (it starts at the pole)."""


@dataclass(frozen=True)
class BasemapInfo:
    half_width_m: float
    source_url: str


def site_map_xy(site: Site) -> tuple[float, float]:
    x, y = polar_stereographic_south(site.latitude_deg, site.longitude_deg)
    return float(x), float(y)


def map_half_width_m(sites: Sequence[Site]) -> float:
    """Square map extent (±half width around the pole) that fits every site with a margin."""
    farthest: float = max((math.hypot(*site_map_xy(s)) for s in sites), default=0.0)
    rounded: float = math.ceil((farthest + MAP_MARGIN_M) / MAP_ROUNDING_M) * MAP_ROUNDING_M
    return min(MAX_HALF_WIDTH_M, max(MIN_HALF_WIDTH_M, rounded))


def graticule(half_width_m: float) -> tuple[list[Parallel], list[Meridian]]:
    parallels: list[Parallel] = []
    latitude: float = -89.0
    while True:
        _, radius = polar_stereographic_south(latitude, 0.0)
        if float(radius) > half_width_m:
            break
        parallels.append(Parallel(latitude_deg=latitude, radius_m=float(radius)))
        latitude += 1.0
    meridians: list[Meridian] = []
    for longitude in range(0, 360, MERIDIAN_STEP_DEG):
        angle: float = math.radians(longitude)
        # Matches polar_stereographic_south: +y toward 0°E, +x toward 90°E.
        meridians.append(
            Meridian(
                longitude_deg=float(longitude),
                x_m=half_width_m * math.sin(angle),
                y_m=half_width_m * math.cos(angle),
            )
        )
    return parallels, meridians


def basemap_files(basemap_dir: Path) -> tuple[Path, Path]:
    return basemap_dir / "south_pole_hillshade.png", basemap_dir / "south_pole_hillshade.json"


def write_basemap_info(path: Path, info: BasemapInfo) -> None:
    payload: dict[str, object] = {"half_width_m": info.half_width_m, "source_url": info.source_url}
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8", newline="\n")


def read_basemap_info(path: Path) -> BasemapInfo | None:
    if not path.is_file():
        return None
    raw: dict[str, object] = json.loads(path.read_text(encoding="utf-8"))
    return BasemapInfo(
        half_width_m=float(str(raw["half_width_m"])), source_url=str(raw["source_url"])
    )
