from typing import Literal

from lunar_core.analysis import (
    DEFAULT_OBSERVER_HEIGHT_M,
    MAX_EARTH_CLEARANCE_DEG,
    MAX_SITES,
    MIN_SITES,
)
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


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
    terrain_window_id: str = "sample-a"
    """Local LOLA near/far window pair used for elevation and horizon (Sample A if absent)."""
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


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    duration_hours: float = Field(default=24, gt=0, le=168)
    step_minutes: int = Field(default=60, ge=1, le=360)


class EvaluationSample(BaseModel):
    time_utc: AwareDatetime
    sun_azimuth_deg: float
    sun_elevation_deg: float
    sun_horizon_deg: float
    sun_visible: bool
    earth_azimuth_deg: float
    earth_elevation_deg: float
    earth_horizon_deg: float
    earth_visible: bool
    simultaneous_visible: bool


class EvaluationInterval(BaseModel):
    start_utc: AwareDatetime
    end_utc: AwareDatetime
    duration_seconds: float
    truncated: bool


class EvaluationOut(BaseModel):
    evaluation_id: str
    candidate_id: str
    status: Literal["COMPUTED_UNVERIFIED", "VALIDATED", "UNAVAILABLE", "ERROR"]
    request: EvaluationRequest
    candidate: CandidateOut
    provenance: dict[str, object]
    warnings: list[str]
    errors: list[str]
    horizon_azimuth_deg: list[float] = []
    horizon_elevation_deg: list[float] = []
    samples: list[EvaluationSample] = []
    intervals: dict[str, list[EvaluationInterval]] = {}


class CandidateRefOut(BaseModel):
    """Typed reference to one persisted, immutable candidate snapshot (Rete `CandidateRef`)."""

    schema_version: Literal["candidate-ref/1"] = "candidate-ref/1"
    candidate_id: str
    site_id: str
    parent_candidate_id: str | None
    terrain_window_id: str
    snapshot_sha256: str
    """SHA-256 of the stored candidate JSON payload; changes only if the stored record changes."""


class RoiCornerOut(BaseModel):
    label: str
    east_m: float
    north_m: float
    latitude_deg: float
    longitude_deg: float


class RoiDatasetOut(BaseModel):
    role: Literal["near", "far"]
    dataset_id: str
    source_url: str
    resolution_m: float
    local_window_sha256: str
    nodata: str
    window_bounds_m: list[float]
    """Pixel-edge bounds [x_min, y_min, x_max, y_max] in south polar stereographic metres."""


class RoiCoverageCheckOut(BaseModel):
    label: str
    latitude_deg: float
    longitude_deg: float
    status: Literal["covered", "missing"]
    detail: str


class RoiCoverageOut(BaseModel):
    grid_status: Literal["complete", "incomplete"]
    grid_missing_samples: int
    grid_total_samples: int
    horizon_checks: list[RoiCoverageCheckOut]
    note: str


class RoiOut(BaseModel):
    roi_id: str
    name: str
    center_latitude_deg: float
    center_longitude_deg: float
    half_width_m: float
    center_source_name: str
    center_source_url: str
    note: str
    terrain_available: bool


class RoiTerrainOut(BaseModel):
    """One continuous terrain grid for the ROI, with actual LOLA elevations.

    `elevations_m` is row-major `size` x `size`: row 0 is the north edge (+half_width_m), column 0
    the west edge. Offsets are local east/north metres in the south polar stereographic plane:
    x = center_x + east * east_axis[0] + north * north_axis[0] (likewise y). Values are bilinear
    samples of the 20 m DEM at the grid nodes (null where the DEM has no value); candidates are
    sampled again from the raster at their exact position.
    """

    roi: RoiOut
    coordinate_reference: str
    projection: str
    reference_radius_m: float
    center_projected_m: list[float]
    east_axis_projected: list[float]
    north_axis_projected: list[float]
    stereographic_scale_factor: float
    corners: list[RoiCornerOut]
    latitude_range_deg: list[float]
    longitude_range_deg: list[float]
    size: int
    spacing_m: float
    elevations_m: list[float | None]
    center_elevation_m: float
    elevation_range_m: list[float]
    datasets: list[RoiDatasetOut]
    coverage: RoiCoverageOut
    limitations: list[str]


class RegionalTerrainOut(BaseModel):
    """Display-only far-field samples (40 km x 40 km) in the same projected ROI frame.

    `elevations_m` is row-major `size` x `size` like `RoiTerrainOut`: row 0 is the north edge,
    column 0 the west edge, nodes every `spacing_m` in local east/north projected metres. Values
    are bilinear samples of the 240 m DEM; they are never used for candidates or evaluations.
    """

    half_width_m: float
    spacing_m: float
    size: int
    elevations_m: list[float]
    elevation_range_m: list[float]
    corners: list[RoiCornerOut]
    dataset: RoiDatasetOut


class ExperimentManifestOut(BaseModel):
    """Reproducibility manifest of one persisted evaluation, built only from stored records.

    Fields an older record did not store hold "not_recorded" and are listed in `not_recorded`.
    """

    schema_version: Literal["lunar-ops-experiment/1"] = "lunar-ops-experiment/1"
    exported_at_utc: AwareDatetime
    evaluation_id: str
    candidate_id: str
    parent_candidate_id: str | None
    candidate: CandidateOut
    candidate_ref: CandidateRefOut | None
    parent_candidate: CandidateOut | None
    request: EvaluationRequest
    interval: dict[str, object]
    terrain: dict[str, object]
    spice: dict[str, object]
    method: dict[str, object]
    software: dict[str, object]
    status: dict[str, object]
    outputs: dict[str, object]
    consistency: dict[str, object]
    not_recorded: list[str]


class InputCheckOut(BaseModel):
    name: str
    stored: str
    current: str
    match: bool


class RecomputeReportOut(BaseModel):
    """Recompute-and-compare result; the recomputed evaluation is never stored."""

    evaluation_id: str
    recomputed_at_utc: AwareDatetime
    persisted: Literal[False]
    outcome: Literal["reproduced", "differs", "inputs_changed"]
    stored_status: Literal["COMPUTED_UNVERIFIED", "VALIDATED", "UNAVAILABLE", "ERROR"]
    recomputed_status: Literal["COMPUTED_UNVERIFIED", "VALIDATED", "UNAVAILABLE", "ERROR"]
    stored_output_sha256: str
    recomputed_output_sha256: str
    recomputed_errors: list[str]
    input_checks: list[InputCheckOut]
    tolerances: dict[str, float | str]
    differences: dict[str, float | int | None]
    validation_status: Literal["not_independently_validated", "independently_validated"]
    notes: list[str]


class BrushPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    east_m: float = Field(ge=-2000, le=2000)
    north_m: float = Field(ge=-2000, le=2000)


class BrushConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    min_sun_fraction: float = Field(default=0, ge=0, le=1)
    min_earth_fraction: float = Field(default=0, ge=0, le=1)
    min_simultaneous_fraction: float = Field(default=0, ge=0, le=1)
    max_darkness_hours: float | None = Field(default=None, ge=0, le=168)
    max_earth_gap_hours: float | None = Field(default=None, ge=0, le=168)


class TerrainScreenConstraints(BaseModel):
    """LandingZoneScreen limits; a limit left empty is not checked (and never passes)."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    neighborhood_radius_m: float = Field(default=100, ge=40, le=500)
    max_local_slope_deg: float | None = Field(default=None, ge=0, le=90)
    max_neighborhood_slope_deg: float | None = Field(default=None, ge=0, le=90)
    max_roughness_rms_m: float | None = Field(default=None, ge=0, le=1000)
    max_relief_m: float | None = Field(default=None, ge=0, le=5000)
    min_coverage_fraction: float = Field(default=1, ge=0, le=1)


class SurfaceSlopeOut(BaseModel):
    local_slope_deg: float | None
    max_local_slope_deg: float | None
    neighborhood_slope_deg: float | None
    local_baseline_m: float
    neighborhood_radius_m: float


class TerrainRoughnessOut(BaseModel):
    rms_residual_m: float | None
    residual_relief_m: float | None
    raw_relief_m: float | None
    neighborhood_radius_m: float
    detrending: str


class TerrainQualityOut(BaseModel):
    dem_resolution_m: float
    sample_spacing_m: float
    interpolation: str
    neighborhood_node_count: int
    valid_node_count: int
    coverage_fraction: float
    local_stencil_complete: bool
    vertical_uncertainty: Literal["NOT_ASSESSED"]
    sub_resolution_hazards: Literal["NOT_ASSESSED"]


class TerrainCheckOut(BaseModel):
    name: str
    value: float | None
    limit: float
    comparison: Literal["<=", ">="]
    unit: str
    status: Literal["PASS", "FAIL", "NOT_ASSESSED"]
    margin: float | None
    reason: str


class TerrainProvenanceOut(BaseModel):
    algorithm: str
    terrain_dataset_id: str
    terrain_source_url: str
    terrain_dataset_sha256: str
    dem_resolution_m: float
    coordinate_reference: str
    lunar_core_version: str


class TerrainScreenOut(BaseModel):
    """Coarse DEM screening of one location; PASS is not certified landing safety."""

    schema_version: Literal["lunar-ops-terrain-screen/1"] = "lunar-ops-terrain-screen/1"
    screen_id: str
    """Content hash of the inputs, constraints and computed metrics."""
    status: Literal["COMPUTED_UNVERIFIED", "UNAVAILABLE"]
    verdict: Literal["PASS", "FAIL", "NOT_ASSESSED"]
    east_m: float | None = None
    north_m: float | None = None
    latitude_deg: float | None = None
    longitude_deg: float | None = None
    constraints: TerrainScreenConstraints
    slope: SurfaceSlopeOut | None = None
    roughness: TerrainRoughnessOut | None = None
    quality: TerrainQualityOut | None = None
    checks: list[TerrainCheckOut] = []
    margin: float | None = None
    not_assessed: list[str] = []
    provenance: TerrainProvenanceOut | None = None
    scope_note: str = (
        "Coarse screening on a 20 m interpolated LOLA DEM; not certified landing safety."
    )
    errors: list[str] = []


class BrushDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    polygon: list[BrushPoint] = Field(min_length=3, max_length=64)
    spacing_m: float = Field(default=100, ge=20, le=4000)
    max_points: int = Field(default=16, ge=1, le=64)
    observer_height_m: float = Field(default=3, ge=0, le=100)
    start_utc: AwareDatetime
    duration_hours: float = Field(default=168, gt=0, le=168)
    step_minutes: int = Field(default=60, ge=1, le=360)
    constraints: BrushConstraints = BrushConstraints()
    retention: Literal["all", "passing"] = "all"
    sampling: Literal["grid", "adaptive"] = "grid"
    terrain: TerrainScreenConstraints | None = None
    """LandingZoneScreen limits; when set, a PASS also requires the terrain screen to pass."""
    evidence: Literal["visibility", "visibility_terrain"] = "visibility"
    """Evidence driving adaptive refinement: A = visibility only, B = visibility + terrain."""

    @model_validator(mode="after")
    def _terrain_evidence_needs_constraints(self) -> "BrushDefinition":
        if self.evidence == "visibility_terrain" and (
            self.sampling != "adaptive" or self.terrain is None
        ):
            raise ValueError(
                "visibility + terrain evidence requires adaptive sampling and terrain constraints"
            )
        return self


class BrushSampleOut(BaseModel):
    east_m: float
    north_m: float
    latitude_deg: float | None = None
    longitude_deg: float | None = None
    elevation_m: float | None = None
    candidate_id: str | None = None
    status: Literal["READY", "UNAVAILABLE"]
    already_persisted: bool = False
    error: str | None = None
    iteration: int = 0
    reason: str | None = None
    priority: str | None = None
    parent_candidate_ids: list[str] = []
    parent_evaluation_ids: list[str] = []
    terrain: TerrainScreenOut | None = None
    """Terrain screen of this location, computed from the DEM before any evaluation."""
    parent_terrain_screen_ids: list[str] = []
    """Terrain screens of the parents that the refinement policy used as evidence."""


class BrushPreviewOut(BaseModel):
    definition: BrushDefinition
    coordinate_reference: str
    alignment: str
    tolerance_m: float
    samples: list[BrushSampleOut]
    ready_count: int
    new_count: int
    existing_count: int
    temporal_samples_per_point: int
    estimated_total_samples: int
    preview_token: str
    terrain_pool_size: int | None = None
    terrain_excluded_count: int | None = None
    """Lattice points failing the terrain screen; excluded from selection under evidence B."""


class BrushMetrics(BaseModel):
    sample_count: int
    duration_hours: float
    sun_fraction: float
    earth_fraction: float
    simultaneous_fraction: float
    longest_darkness_hours: float
    longest_earth_gap_hours: float


class BrushResultOut(BaseModel):
    sample: BrushSampleOut
    verdict: Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED", "NOT_ASSESSED"]
    """Combined verdict: visibility constraints and, when configured, the terrain screen."""
    visibility_verdict: Literal["PASS", "FAIL", "UNAVAILABLE", "ERROR", "NOT_EVALUATED"] | None = (
        None
    )
    metrics: BrushMetrics | None = None
    pareto: bool | None = None
    candidate: CandidateOut | None = None
    evaluation: EvaluationOut | None = None
    persisted: bool = False
    errors: list[str] = []


class BrushExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    definition: BrushDefinition
    preview_token: str
    confirmed: Literal[True]


class BrushExecutionOut(BaseModel):
    schema_version: Literal["lunar-ops-brush/1"] = "lunar-ops-brush/1"
    preview: BrushPreviewOut
    results: list[BrushResultOut]
    notes: list[str]
    experiment_id: str | None = None
    candidate_set_id: str | None = None
    refinement_policy: str | None = None
