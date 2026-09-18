from datetime import datetime, timedelta
from functools import lru_cache

from lunar_core.analysis import Scenario, ScenarioResult, SiteAnalysis, analyze
from lunar_core.assumptions import assumptions_for, data_sources
from lunar_core.geometry import HorizontalPosition
from lunar_core.sites import Site, load_catalog
from lunar_core.windows import VisibilityWindow

from clps_api.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    AssumptionOut,
    BodySeries,
    DataSourceOut,
    MetricsOut,
    SiteOut,
    SiteResult,
    WindowOut,
)

DECIMALS: int = 4
CATALOG: tuple[Site, ...] = load_catalog()
_SITES_BY_ID: dict[str, Site] = {site.id: site for site in CATALOG}


def site_out(site: Site) -> SiteOut:
    return SiteOut(
        id=site.id,
        name=site.name,
        latitude_deg=site.latitude_deg,
        longitude_deg=site.longitude_deg,
        origin=site.origin,
        note=site.note,
    )


def _window_out(window: VisibilityWindow) -> WindowOut:
    return WindowOut(
        start=window.start,
        end=window.end,
        duration_hours=round(window.duration.total_seconds() / 3600.0, DECIMALS),
        visible=window.visible,
        truncated=window.truncated,
    )


def _series(positions: list[HorizontalPosition]) -> BodySeries:
    return BodySeries(
        azimuth_deg=[round(p.azimuth_deg, DECIMALS) for p in positions],
        elevation_deg=[round(p.elevation_deg, DECIMALS) for p in positions],
    )


def _site_result(rank: int, analysis: SiteAnalysis) -> SiteResult:
    metrics = analysis.metrics
    return SiteResult(
        rank=rank,
        site=site_out(analysis.site),
        metrics=MetricsOut(
            sun_fraction=round(metrics.sun_fraction, DECIMALS),
            earth_fraction=round(metrics.earth_fraction, DECIMALS),
            longest_darkness=None
            if metrics.longest_darkness is None
            else _window_out(metrics.longest_darkness),
            longest_earth_outage=None
            if metrics.longest_earth_outage is None
            else _window_out(metrics.longest_earth_outage),
        ),
        sun=_series(analysis.sun),
        earth=_series(analysis.earth),
        sun_windows=[_window_out(w) for w in analysis.sun_windows],
        earth_windows=[_window_out(w) for w in analysis.earth_windows],
    )


def build_scenario(request: AnalysisRequest) -> Scenario:
    unknown: list[str] = [i for i in request.site_ids if i not in _SITES_BY_ID]
    if unknown:
        raise ValueError(f"unknown site ids: {', '.join(unknown)}")
    return Scenario(
        sites=tuple(_SITES_BY_ID[i] for i in request.site_ids),
        start=request.start,
        end=request.end,
        step=timedelta(minutes=request.step_minutes),
        observer_height_m=request.observer_height_m,
    )


@lru_cache(maxsize=16)
def _cached_analysis(
    site_ids: tuple[str, ...], start: datetime, end: datetime, step_minutes: int, height_m: float
) -> AnalysisResponse:
    request: AnalysisRequest = AnalysisRequest(
        site_ids=list(site_ids),
        start=start,
        end=end,
        step_minutes=step_minutes,
        observer_height_m=height_m,
    )
    scenario: Scenario = build_scenario(request)
    result: ScenarioResult = analyze(scenario)
    return AnalysisResponse(
        request=request,
        times=result.times,
        sites=[_site_result(i + 1, a) for i, a in enumerate(result.ranked)],
        assumptions=[
            AssumptionOut(key=a.key, label=a.label, value=a.value)
            for a in assumptions_for(scenario)
        ],
        data_sources=[
            DataSourceOut(name=s.name, description=s.description, url=s.url) for s in data_sources()
        ],
    )


def run_analysis(request: AnalysisRequest) -> AnalysisResponse:
    return _cached_analysis(
        tuple(request.site_ids),
        request.start,
        request.end,
        request.step_minutes,
        request.observer_height_m,
    )
