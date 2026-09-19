"""Terrain horizon masks for catalog sites, computed on demand from the cached LOLA windows."""

import os
import threading
from pathlib import Path

from lunar_core.horizon import HorizonMask, horizon_mask
from lunar_core.sites import Site
from lunar_core.terrain import TerrainGrid, terrain_files
from lunar_core.terrain_patch import LocalTerrainPatch, local_terrain_patch

_cache: dict[tuple[str, float], HorizonMask] = {}
_patches: dict[str, LocalTerrainPatch] = {}
_lock: threading.Lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _patches.clear()


def terrain_dir() -> Path:
    return Path(os.environ.get("CLPS_DATA_DIR", "data")) / "terrain"


def terrain_available(site: Site) -> bool:
    """Custom sites never have terrain: it is only downloaded for catalog sites (ADR 0014)."""
    if site.origin == "custom":
        return False
    return all(path.is_file() for path in terrain_files(terrain_dir(), site.id))


def mask_for(site: Site, observer_height_m: float) -> HorizonMask | None:
    """None when the site has no downloaded terrain (the caller falls back to flat)."""
    if not terrain_available(site):
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


def patch_for(site: Site) -> LocalTerrainPatch | None:
    """Local ±6 km terrain around the site for the 3D view (RF-19); None without terrain."""
    if not terrain_available(site):
        return None
    with _lock:
        cached: LocalTerrainPatch | None = _patches.get(site.id)
        if cached is None:
            near_path, _ = terrain_files(terrain_dir(), site.id)
            cached = local_terrain_patch(
                site.latitude_deg, site.longitude_deg, TerrainGrid.load(near_path)
            )
            _patches[site.id] = cached
        return cached
