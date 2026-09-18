from datetime import timedelta
from functools import lru_cache

from lunar_core.analysis import Scenario, ScenarioResult, SiteAnalysis, analyze
from lunar_core.assumptions import assumptions_for, data_sources
from lunar_core.geometry import HorizontalPosition
from lunar_core.horizon import HorizonMask
from lunar_core.pole_map import site_map_xy
from lunar_core.sites import Site, load_catalog
from lunar_core.windows import VisibilityWindow

from clps_api import terrain_store
from clps_api.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    AssumptionOut,
    BodySeries,
    DataSourceOut,
    HorizonMaskOut,
    MetricsOut,
    SiteOut,
    SiteResult,
    WindowOut,
)

DECIMALS: int = 4
CATALOG: tuple[Site, ...] = load_catalog()
_SITES_BY_ID: dict[str, Site] = {site.id: site for site in CATALOG}


def site_out(site: Site) -> SiteOut:
    map_x, map_y = site_map_xy(site)
    return SiteOut(
        map_x_m=round(map_x, 1),
        map_y_m=round(map_y, 1),
        id=site.id,
        name=site.name,
        latitude_deg=site.latitude_deg,
        longitude_deg=site.longitude_deg,
        origin=site.origin,
        note=site.note,
        terrain_available=terrain_store.terrain_available(site.id),
    )


def _window_out(window: VisibilityWindow) -> WindowOut:
    return WindowOut(
        start=window.start,
        end=window.end,
        duration_hours=round(window.duration.total_seconds() / 3600.0, DECIMALS),
        visible=window.visible,
        truncated=window.truncated,
    )


def _round(values: list[float]) -> list[float]:
    return [round(v, DECIMALS) for v in values]


def _series(positions: list[HorizontalPosition], horizon_deg: list[float]) -> BodySeries:
    return BodySeries(
        azimuth_deg=_round([p.azimuth_deg for p in positions]),
        elevation_deg=_round([p.elevation_deg for p in positions]),
        horizon_deg=_round(horizon_deg),
    )


def _mask_out(mask: HorizonMask | None) -> HorizonMaskOut | None:
    if mask is None:
        return None
    return HorizonMaskOut(
        azimuth_deg=_round([float(v) for v in mask.azimuths_deg]),
        elevation_deg=_round([float(v) for v in mask.elevations_deg]),
    )


def _site_result(rank: int, analysis: SiteAnalysis) -> SiteResult:
    metrics = analysis.metrics
    return SiteResult(
        rank=rank,
        site=site_out(analysis.site),
        horizon_model="flat" if analysis.horizon_mask is None else "terrain",
        horizon_mask=_mask_out(analysis.horizon_mask),
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
        sun=_series(analysis.sun, analysis.sun_horizon_deg),
        earth=_series(analysis.earth, analysis.earth_horizon_deg),
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
        horizon_model=request.horizon,
        earth_min_clearance_deg=request.earth_min_clearance_deg,
    )


@lru_cache(maxsize=16)
def _cached_analysis(
    request_json: str,
    terrain_key: tuple[bool, ...],  # part of the key: new terrain downloads invalidate results
) -> AnalysisResponse:
    request: AnalysisRequest = AnalysisRequest.model_validate_json(request_json)
    scenario: Scenario = build_scenario(request)
    masks: dict[str, HorizonMask] = {}
    if scenario.horizon_model == "terrain":
        for site in scenario.sites:
            mask: HorizonMask | None = terrain_store.mask_for(site, scenario.observer_height_m)
            if mask is not None:
                masks[site.id] = mask
    result: ScenarioResult = analyze(scenario, masks)
    return AnalysisResponse(
        request=request,
        times=result.times,
        sites=[_site_result(i + 1, a) for i, a in enumerate(result.ranked)],
        assumptions=[
            AssumptionOut(key=a.key, label=a.label, value=a.value) for a in assumptions_for(result)
        ],
        data_sources=[
            DataSourceOut(name=s.name, description=s.description, url=s.url)
            for s in data_sources(result)
        ],
    )


def clear_cache() -> None:
    _cached_analysis.cache_clear()


def run_analysis(request: AnalysisRequest) -> AnalysisResponse:
    terrain_key: tuple[bool, ...] = tuple(
        terrain_store.terrain_available(site_id) for site_id in request.site_ids
    )
    return _cached_analysis(request.model_dump_json(), terrain_key)
