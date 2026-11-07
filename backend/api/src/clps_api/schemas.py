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
    origin: Literal["sample", "official", "custom"]
    note: str
    terrain_available: bool
    map_x_m: float
    map_y_m: float
    """Polar stereographic position (m) on the pole map: +y toward 0°E, +x toward 90°E."""


class TerrainPatchOut(BaseModel):
    """Local terrain for the 3D view: heights (m) relative to the site's ground, with curvature.

    Row-major `size` by `size` values: row 0 is the north edge, column 0 the west edge, spanning
    ±half_width_m east/north of the site.
    """

    site_id: str
    half_width_m: float
    size: int
    heights_m: list[float]
    site_ground_m: float
    source: str


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


class CandidateRequest(BaseModel):
    """Local mesh coordinates, metres in the existing patch east/north plane."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    east_m: float = Field(ge=-6000, le=6000)
    north_m: float = Field(ge=-6000, le=6000)
    observer_height_m: float = Field(ge=0, le=100)
    selected_time_utc: AwareDatetime


class CandidateOut(BaseModel):
    candidate_id: str
    parent_candidate_id: str | None = None
    terrain_dataset_sha256: str = ""
    terrain_nodata: str = "unknown"
    coverage_bounds_m: list[float] = []
    site_id: str
    latitude_deg: float
    longitude_deg: float
    terrain_elevation_m: float
    observer_height_m: float
    selected_time_utc: AwareDatetime
    terrain_dataset_id: str
    terrain_source_url: str
    dem_resolution_m: float
    coordinate_reference: str
    validation_status: Literal["not_independently_validated"]
    data_availability: Literal["available"]


class CandidateEvolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    observer_height_m: float = Field(ge=0, le=100)
    selected_time_utc: AwareDatetime
