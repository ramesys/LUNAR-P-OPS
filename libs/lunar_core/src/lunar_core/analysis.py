"""Scenario analysis: samples, visibility windows, metrics and ranking (ADR 0003, 0006, 0010)."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import numpy as np

from lunar_core.geometry import Body, HorizontalPosition, SurfacePoint, horizontal_positions
from lunar_core.horizon import HorizonMask
from lunar_core.sites import Site
from lunar_core.terrain import FloatArray
from lunar_core.visibility import earth_center_visible, sun_upper_limb_visible
from lunar_core.windows import VisibilityWindow, build_windows, longest

HorizonModel = Literal["terrain", "flat"]

MIN_SITES: int = 2
MAX_SITES: int = 4
MAX_RANGE: timedelta = timedelta(days=366)
MIN_STEP: timedelta = timedelta(minutes=1)
MAX_SAMPLES: int = 10_000
DEFAULT_STEP: timedelta = timedelta(hours=1)
DEFAULT_OBSERVER_HEIGHT_M: float = 2.0
MAX_EARTH_CLEARANCE_DEG: float = 10.0


@dataclass(frozen=True)
class Scenario:
    sites: tuple[Site, ...]
    start: datetime
    end: datetime
    step: timedelta = DEFAULT_STEP
    observer_height_m: float = DEFAULT_OBSERVER_HEIGHT_M
    horizon_model: HorizonModel = "terrain"
    earth_min_clearance_deg: float = 0.0

    def __post_init__(self) -> None:
        if not MIN_SITES <= len(self.sites) <= MAX_SITES:
            raise ValueError(f"select between {MIN_SITES} and {MAX_SITES} sites")
        if len({s.id for s in self.sites}) != len(self.sites):
            raise ValueError("sites must not repeat")
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("start and end must be timezone-aware (UTC)")
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > MAX_RANGE:
            raise ValueError("date range must be at most one year")
        if self.step < MIN_STEP:
            raise ValueError("step must be at least 1 minute")
        if self.sample_count > MAX_SAMPLES:
            raise ValueError(
                f"too many samples ({self.sample_count} > {MAX_SAMPLES}); use a larger step"
            )
        if self.observer_height_m < 0.0:
            raise ValueError("observer height must be >= 0 m")
        if not 0.0 <= self.earth_min_clearance_deg <= MAX_EARTH_CLEARANCE_DEG:
            raise ValueError(f"Earth clearance must be between 0 and {MAX_EARTH_CLEARANCE_DEG}°")

    @property
    def sample_count(self) -> int:
        return -(-(self.end - self.start) // self.step)

    def sample_times(self) -> list[datetime]:
        return [self.start + i * self.step for i in range(self.sample_count)]


@dataclass(frozen=True)
class SiteMetrics:
    sun_fraction: float
    earth_fraction: float
    longest_darkness: VisibilityWindow | None
    longest_earth_outage: VisibilityWindow | None


@dataclass(frozen=True)
class SiteAnalysis:
    site: Site
    horizon_mask: HorizonMask | None
    """None means a flat horizon was used (requested, or terrain unavailable for this site)."""
    sun: list[HorizontalPosition]
    earth: list[HorizontalPosition]
    sun_horizon_deg: list[float]
    earth_horizon_deg: list[float]
    sun_windows: list[VisibilityWindow]
    earth_windows: list[VisibilityWindow]
    metrics: SiteMetrics


@dataclass(frozen=True)
class ScenarioResult:
    scenario: Scenario
    times: list[datetime]
    ranked: list[SiteAnalysis]


def _horizon_along(mask: HorizonMask | None, positions: list[HorizontalPosition]) -> list[float]:
    if mask is None:
        return [0.0] * len(positions)
    azimuths: FloatArray = np.array([p.azimuth_deg for p in positions])
    return [float(v) for v in mask.at(azimuths)]


def _analyze_site(
    scenario: Scenario, site: Site, times: list[datetime], mask: HorizonMask | None
) -> SiteAnalysis:
    point: SurfacePoint = SurfacePoint(
        latitude_deg=site.latitude_deg,
        longitude_deg=site.longitude_deg,
        height_m=scenario.observer_height_m,
    )
    sun: list[HorizontalPosition] = horizontal_positions(Body.SUN, point, times)
    earth: list[HorizontalPosition] = horizontal_positions(Body.EARTH, point, times)
    sun_horizon: list[float] = _horizon_along(mask, sun)
    earth_horizon: list[float] = _horizon_along(mask, earth)
    sun_flags: list[bool] = [
        sun_upper_limb_visible(p, h) for p, h in zip(sun, sun_horizon, strict=True)
    ]
    earth_flags: list[bool] = [
        earth_center_visible(p, h, scenario.earth_min_clearance_deg)
        for p, h in zip(earth, earth_horizon, strict=True)
    ]
    sun_windows: list[VisibilityWindow] = build_windows(times, sun_flags, scenario.end)
    earth_windows: list[VisibilityWindow] = build_windows(times, earth_flags, scenario.end)
    return SiteAnalysis(
        site=site,
        horizon_mask=mask,
        sun=sun,
        earth=earth,
        sun_horizon_deg=sun_horizon,
        earth_horizon_deg=earth_horizon,
        sun_windows=sun_windows,
        earth_windows=earth_windows,
        metrics=SiteMetrics(
            sun_fraction=sum(sun_flags) / len(sun_flags),
            earth_fraction=sum(earth_flags) / len(earth_flags),
            longest_darkness=longest(sun_windows, visible=False),
            longest_earth_outage=longest(earth_windows, visible=False),
        ),
    )


def rank(analyses: list[SiteAnalysis]) -> list[SiteAnalysis]:
    """Highest sunlit fraction first; `sorted` is stable, so ties keep the input order."""
    return sorted(analyses, key=lambda a: a.metrics.sun_fraction, reverse=True)


def analyze(
    scenario: Scenario, horizon_masks: Mapping[str, HorizonMask] | None = None
) -> ScenarioResult:
    """Requires kernels loaded with `lunar_core.kernels.load_kernels`.

    With the terrain model, sites missing from `horizon_masks` fall back to a flat horizon;
    each `SiteAnalysis.horizon_mask` records which model was actually used.
    """
    masks: Mapping[str, HorizonMask] = (
        horizon_masks if horizon_masks is not None and scenario.horizon_model == "terrain" else {}
    )
    times: list[datetime] = scenario.sample_times()
    analyses: list[SiteAnalysis] = [
        _analyze_site(scenario, s, times, masks.get(s.id)) for s in scenario.sites
    ]
    return ScenarioResult(scenario=scenario, times=times, ranked=rank(analyses))
