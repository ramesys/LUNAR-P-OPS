"""Spike B: validate terrain horizon masks against the LOLA PSR map and measure their cost.

1. PSR check: pixels NASA marks as permanently shadowed must never see the Sun's upper limb over
   a full 18.6-year lunar precession cycle; lit pixels should see it at some point.
2. Sample sites: sunlit / Earth-in-view fractions over 2026 with a flat vs. a terrain horizon.
"""

import time
from datetime import UTC, datetime, timedelta

import numpy as np
from lunar_core.geometry import Body, HorizontalPosition, SurfacePoint, horizontal_positions
from lunar_core.horizon import HorizonMask, above_mask, horizon_mask
from lunar_core.kernels import load_kernels
from lunar_core.sites import load_catalog
from lunar_core.terrain import (
    FloatArray,
    TerrainGrid,
    polar_stereographic_south,
    polar_stereographic_south_inverse,
)
from lunar_core.visibility import SUN_RADIUS_KM

from clps_pipelines import data_dir
from clps_pipelines.fetch_terrain import (
    FAR_DEM,
    NEAR_DEM,
    PSR_MAP,
    fetch_site,
    read_window,
    terrain_paths,
)

PSR_CENTER: tuple[float, float] = (-89.5, 0.0)
PSR_TEST_HALF_WIDTH_M: float = 5_000.0
PIXELS_PER_CLASS: int = 25
CYCLE_START: datetime = datetime(2026, 1, 1, tzinfo=UTC)
CYCLE_END: datetime = datetime(2044, 9, 1, tzinfo=UTC)
CYCLE_STEP: timedelta = timedelta(hours=12)
YEAR_START: datetime = datetime(2026, 1, 1, tzinfo=UTC)


def _arrays(
    positions: list[HorizontalPosition], radius_km: float
) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Azimuth, elevation and visibility margin; radius 0 means the body's center is used."""
    az: FloatArray = np.array([p.azimuth_deg for p in positions])
    el: FloatArray = np.array([p.elevation_deg for p in positions])
    margin: FloatArray = np.degrees(
        np.arcsin(radius_km / np.array([p.distance_km for p in positions]))
    )
    return az, el, margin


def _interior(mask: np.ndarray) -> np.ndarray:
    """Pixels whose 3x3 neighborhood shares the same class (avoids boundary ambiguity)."""
    inner: np.ndarray = np.zeros_like(mask, dtype=bool)
    core: np.ndarray = np.ones_like(mask[1:-1, 1:-1], dtype=bool)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            core &= mask[1 + dr : mask.shape[0] - 1 + dr, 1 + dc : mask.shape[1] - 1 + dc]
    inner[1:-1, 1:-1] = core
    return inner


def psr_check() -> None:
    cx, cy = (float(v) for v in polar_stereographic_south(*PSR_CENTER))
    started: float = time.perf_counter()
    psr: TerrainGrid = read_window(PSR_MAP, cx, cy, PSR_TEST_HALF_WIDTH_M)
    near: TerrainGrid = read_window(NEAR_DEM, cx, cy, PSR_TEST_HALF_WIDTH_M + 8_500.0)
    far: TerrainGrid = read_window(FAR_DEM, cx, cy, 215_000.0)
    print(f"downloaded PSR test area in {time.perf_counter() - started:.1f}s")

    shadowed: np.ndarray = psr.heights == 1.0
    rng: np.random.Generator = np.random.default_rng(42)
    times: list[datetime] = []
    t: datetime = CYCLE_START
    while t < CYCLE_END:
        times.append(t)
        t += CYCLE_STEP

    rows_out: list[tuple[str, int, int]] = []
    mask_seconds: list[float] = []
    for label, candidates in (("PSR", _interior(shadowed)), ("lit", _interior(~shadowed))):
        rows, cols = np.nonzero(candidates)
        picks: np.ndarray = rng.choice(
            len(rows), size=min(PIXELS_PER_CLASS, len(rows)), replace=False
        )
        never_lit: int = 0
        for i in picks:
            x: float = psr.x_left + (cols[i] + 0.5) * psr.pixel_size_m
            y: float = psr.y_top - (rows[i] + 0.5) * psr.pixel_size_m
            lat, lon = (float(v) for v in polar_stereographic_south_inverse(x, y))
            t0: float = time.perf_counter()
            mask: HorizonMask = horizon_mask(lat, lon, near, far, observer_height_m=0.0)
            mask_seconds.append(time.perf_counter() - t0)
            sun: list[HorizontalPosition] = horizontal_positions(
                Body.SUN, SurfacePoint(lat, lon), times
            )
            az, el, semidiameter = _arrays(sun, SUN_RADIUS_KM)
            if not above_mask(mask, az, el, semidiameter).any():
                never_lit += 1
        rows_out.append((label, len(picks), never_lit))

    print(f"\nPSR check over {CYCLE_START.date()}..{CYCLE_END.date()} ({len(times)} samples)")
    for label, total, never_lit in rows_out:
        print(f"  NASA {label:>3}: {total} pixels -> never lit by our model: {never_lit}")
    print(f"  horizon mask: {np.mean(mask_seconds):.2f}s mean per pixel (720 azimuths)")


def sample_sites() -> None:
    print("\nSample sites, 2026 hourly, observer 2 m (flat vs terrain horizon)")
    for site in load_catalog():
        started: float = time.perf_counter()
        fetch_site(site)
        fetch_s: float = time.perf_counter() - started
        near_path, far_path = terrain_paths(site.id)
        near: TerrainGrid = TerrainGrid.load(near_path)
        far: TerrainGrid = TerrainGrid.load(far_path)
        started = time.perf_counter()
        mask: HorizonMask = horizon_mask(site.latitude_deg, site.longitude_deg, near, far)
        mask_s: float = time.perf_counter() - started
        point: SurfacePoint = SurfacePoint(site.latitude_deg, site.longitude_deg, 2.0)
        times: list[datetime] = [YEAR_START + timedelta(hours=h) for h in range(365 * 24)]
        sun_az, sun_el, sd = _arrays(horizontal_positions(Body.SUN, point, times), SUN_RADIUS_KM)
        earth_az, earth_el, earth_margin = _arrays(
            horizontal_positions(Body.EARTH, point, times), 0.0
        )
        flat_sun: float = float(np.mean(sun_el + sd > 0.0))
        flat_earth: float = float(np.mean(earth_el > 0.0))
        terrain_sun: float = float(np.mean(above_mask(mask, sun_az, sun_el, sd)))
        terrain_earth: float = float(np.mean(above_mask(mask, earth_az, earth_el, earth_margin)))
        print(
            f"  {site.name}: sun {flat_sun:6.1%} -> {terrain_sun:6.1%} | "
            f"earth {flat_earth:6.1%} -> {terrain_earth:6.1%} | "
            f"max mask {np.max(mask.elevations_deg):5.2f} deg | "
            f"fetch {fetch_s:5.1f}s, mask {mask_s:4.2f}s"
        )


def main() -> None:
    load_kernels(data_dir() / "kernels")
    psr_check()
    sample_sites()


if __name__ == "__main__":
    main()
