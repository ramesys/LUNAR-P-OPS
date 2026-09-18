from typing import Literal

from lunar_core.analysis import (
    DEFAULT_OBSERVER_HEIGHT_M,
    MAX_EARTH_CLEARANCE_DEG,
    MAX_SITES,
    MIN_SITES,
)
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]
    api_version: str
    lunar_core_version: str


class SiteOut(BaseModel):
    id: str
    name: str
    latitude_deg: float
    longitude_deg: float
    origin: Literal["sample", "official"]
    note: str
    terrain_available: bool
    map_x_m: float
    map_y_m: float
    """Polar stereographic position (m) on the pole map: +y toward 0°E, +x toward 90°E."""


class ParallelOut(BaseModel):
    latitude_deg: float
    radius_m: float


class MeridianOut(BaseModel):
    longitude_deg: float
    x_m: float
    y_m: float


class PoleMapOut(BaseModel):
    """Square map centered on the pole, spanning ±half_width_m on both axes."""

    half_width_m: float
    image_url: str | None
    parallels: list[ParallelOut]
    meridians: list[MeridianOut]
    source_name: str
    source_url: str


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    site_ids: list[str] = Field(min_length=MIN_SITES, max_length=MAX_SITES)
    start: AwareDatetime
    end: AwareDatetime
    step_minutes: int = Field(default=60, ge=1)
    observer_height_m: float = Field(default=DEFAULT_OBSERVER_HEIGHT_M, ge=0.0)
    horizon: Literal["terrain", "flat"] = "terrain"
    earth_min_clearance_deg: float = Field(default=0.0, ge=0.0, le=MAX_EARTH_CLEARANCE_DEG)


class WindowOut(BaseModel):
    start: AwareDatetime
    end: AwareDatetime
    duration_hours: float
    visible: bool
    truncated: bool


class BodySeries(BaseModel):
    """Columnar series aligned with `AnalysisResponse.times`."""

    azimuth_deg: list[float]
    elevation_deg: list[float]
    horizon_deg: list[float]
    """Horizon elevation in the body's direction: 0 when flat, else the terrain mask."""


class HorizonMaskOut(BaseModel):
    azimuth_deg: list[float]
    elevation_deg: list[float]


class MetricsOut(BaseModel):
    sun_fraction: float
    earth_fraction: float
    longest_darkness: WindowOut | None
    longest_earth_outage: WindowOut | None


class SiteResult(BaseModel):
    rank: int
    site: SiteOut
    horizon_model: Literal["terrain", "flat"]
    horizon_mask: HorizonMaskOut | None
    metrics: MetricsOut
    sun: BodySeries
    earth: BodySeries
    sun_windows: list[WindowOut]
    earth_windows: list[WindowOut]


class AssumptionOut(BaseModel):
    key: str
    label: str
    value: str


class DataSourceOut(BaseModel):
    name: str
    description: str
    url: str


class AnalysisResponse(BaseModel):
    request: AnalysisRequest
    times: list[AwareDatetime]
    sites: list[SiteResult]
    assumptions: list[AssumptionOut]
    data_sources: list[DataSourceOut]
