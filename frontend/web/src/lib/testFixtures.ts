import type { Candidate, ScientificEvaluation, TerrainScreen } from "@clps/api-client";

/** Persisted-evaluation fixtures shared by tests. */
const candidate: Candidate = { candidate_id: "c0", site_id: "s", latitude_deg: -89.5, longitude_deg: 56, terrain_elevation_m: -28, observer_height_m: 2,
  selected_time_utc: "2026-11-07T00:00:00Z", terrain_dataset_id: "LDEM_80S_20MPP_ADJ", terrain_source_url: "u", terrain_dataset_sha256: "h",
  terrain_nodata: "NaN", coverage_bounds_m: [], dem_resolution_m: 20, coordinate_reference: "MOON_ME", validation_status: "not_independently_validated",
  data_availability: "available", terrain_window_id: "shackleton-rim-b" };

export function evaluation(status: ScientificEvaluation["status"] = "COMPUTED_UNVERIFIED"): ScientificEvaluation {
  const computed: boolean = status === "COMPUTED_UNVERIFIED";
  return { evaluation_id: "e1", candidate_id: "c0", status, request: { duration_hours: 2, step_minutes: 60 }, candidate, provenance: {},
    warnings: ["Not validated."], errors: computed ? [] : ["near DEM coverage/nodata: 3 of 9 ray samples unavailable"],
    horizon_azimuth_deg: computed ? [0, 180] : [], horizon_elevation_deg: computed ? [1.5, 2.5] : [],
    samples: computed ? [
      { time_utc: "2026-11-07T00:00:00Z", sun_azimuth_deg: 10, sun_elevation_deg: 3, sun_horizon_deg: 1.5, sun_visible: true,
        earth_azimuth_deg: 300, earth_elevation_deg: -5, earth_horizon_deg: 2, earth_visible: false, simultaneous_visible: false },
      { time_utc: "2026-11-07T01:00:00Z", sun_azimuth_deg: 25, sun_elevation_deg: 1, sun_horizon_deg: 1.6, sun_visible: false,
        earth_azimuth_deg: 301, earth_elevation_deg: -4, earth_horizon_deg: 2, earth_visible: false, simultaneous_visible: false },
    ] : [],
    intervals: computed ? { sun: [{ start_utc: "2026-11-07T00:00:00Z", end_utc: "2026-11-07T01:00:00Z", duration_seconds: 3600, truncated: true }], earth: [], simultaneous: [] } : {} };
}


const terrainConstraints: TerrainScreen["constraints"] = { neighborhood_radius_m: 100, max_local_slope_deg: 12, max_neighborhood_slope_deg: null,
  max_roughness_rms_m: 1.5, max_relief_m: null, min_coverage_fraction: 1 };

/** A realistic terrain screen response (values as returned by the Python backend). */
export function terrainScreen(overrides: Partial<TerrainScreen> = {}): TerrainScreen {
  return {
    schema_version: "lunar-ops-terrain-screen/1", screen_id: "terrain-screen-abc", status: "COMPUTED_UNVERIFIED", verdict: "FAIL",
    east_m: -600, north_m: 900, latitude_deg: -89.5, longitude_deg: 56, constraints: terrainConstraints,
    slope: { local_slope_deg: 14.2, max_local_slope_deg: 18.1, neighborhood_slope_deg: 13.4, local_baseline_m: 40, neighborhood_radius_m: 100 },
    roughness: { rms_residual_m: 0.91, residual_relief_m: 4.4, raw_relief_m: 47, neighborhood_radius_m: 100, detrending: "least-squares plane" },
    quality: { dem_resolution_m: 20, sample_spacing_m: 20, interpolation: "bilinear", neighborhood_node_count: 81, valid_node_count: 81,
      coverage_fraction: 1, local_stencil_complete: true, vertical_uncertainty: "NOT_ASSESSED", sub_resolution_hazards: "NOT_ASSESSED" },
    checks: [
      { name: "coverage_fraction", value: 1, limit: 1, comparison: ">=", unit: "fraction", status: "PASS", margin: 0, reason: "81/81" },
      { name: "local_slope_deg", value: 14.2, limit: 12, comparison: "<=", unit: "deg", status: "FAIL", margin: -0.18, reason: "14.2 > 12" },
      { name: "roughness_rms_m", value: 0.91, limit: 1.5, comparison: "<=", unit: "m", status: "PASS", margin: 0.39, reason: "0.91 ≤ 1.5" },
    ],
    margin: -0.18,
    not_assessed: ["DEM vertical uncertainty: no uncertainty layer", "Hazards below DEM resolution"],
    provenance: { algorithm: "landing-terrain-screen-v1", terrain_dataset_id: "LDEM_80S_20MPP_ADJ", terrain_source_url: "https://pgda.gsfc.nasa.gov/x.TIF",
      terrain_dataset_sha256: "0123456789abcdef0123", dem_resolution_m: 20, coordinate_reference: "MOON_ME", lunar_core_version: "0.1.0" },
    scope_note: "Coarse screening on a 20 m interpolated LOLA DEM; not certified landing safety.",
    errors: [],
    ...overrides,
  };
}

