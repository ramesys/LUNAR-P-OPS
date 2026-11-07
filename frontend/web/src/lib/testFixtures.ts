import type { Candidate, ScientificEvaluation } from "@clps/api-client";

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

