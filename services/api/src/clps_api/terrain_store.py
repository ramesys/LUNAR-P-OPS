"""Terrain horizon masks for catalog sites, computed on demand from the cached LOLA windows."""

import os
import threading
from pathlib import Path

from lunar_core.horizon import HorizonMask, horizon_mask
from lunar_core.sites import Site
from lunar_core.terrain import TerrainGrid, terrain_files

_cache: dict[tuple[str, float], HorizonMask] = {}
_lock: threading.Lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def terrain_dir() -> Path:
    return Path(os.environ.get("CLPS_DATA_DIR", "data")) / "terrain"


def terrain_available(site_id: str) -> bool:
    return all(path.is_file() for path in terrain_files(terrain_dir(), site_id))


def mask_for(site: Site, observer_height_m: float) -> HorizonMask | None:
    """None when the site's terrain has not been downloaded (the caller falls back to flat)."""
    if not terrain_available(site.id):
        return None
    key: tuple[str, float] = (site.id, observer_height_m)
    with _lock:
        cached: HorizonMask | None = _cache.get(key)
        if cached is None:
            near_path, far_path = terrain_files(terrain_dir(), site.id)
            cached = horizon_mask(
                site.latitude_deg,
                site.longitude_deg,
                TerrainGrid.load(near_path),
                TerrainGrid.load(far_path),
                observer_height_m=observer_height_m,
            )
            _cache[key] = cached
        return cached
