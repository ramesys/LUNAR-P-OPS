import { render, screen } from "@testing-library/react";
import type { Candidate, ScientificEvaluation } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import { ScientificResults } from "./ScientificResults.tsx";

const candidate: Candidate = { candidate_id: "c0", site_id: "site", latitude_deg: -89.5,
  longitude_deg: 0, terrain_elevation_m: -700, observer_height_m: 2,
  selected_time_utc: "2026-02-01T00:00:00Z", terrain_dataset_id: "LOLA",
  terrain_source_url: "https://example.org", terrain_dataset_sha256: "hash", terrain_nodata: "NaN",
  coverage_bounds_m: [0, 0, 1, 1], dem_resolution_m: 20, coordinate_reference: "MOON_ME",
  validation_status: "not_independently_validated", data_availability: "available", terrain_window_id: "sample-a" };
const computed: ScientificEvaluation = { evaluation_id: "e0", candidate_id: "c0", candidate,
  status: "COMPUTED_UNVERIFIED", request: { duration_hours: 24, step_minutes: 60 },
  provenance: { near_sha256: "hash" }, errors: [], warnings: ["Not validated"],
  horizon_azimuth_deg: [], horizon_elevation_deg: [], samples: [],
  intervals: { sun: [{ start_utc: "2026-02-01T00:00:00Z", end_utc: "2026-02-01T02:00:00Z", duration_seconds: 7200, truncated: true }], earth: [], simultaneous: [] } };

describe("Scientific results", () => {
  it("compares computed durations and keeps unavailable data distinct", () => {
    const missing: ScientificEvaluation = { ...computed, evaluation_id: "e1", status: "UNAVAILABLE", errors: ["near DEM coverage missing"], intervals: {} };
    const view: ReturnType<typeof render> = render(<ScientificResults c0={computed} c1={missing} />);
    expect(screen.getByText(/Sun 2.00 h/)).toBeDefined();
    expect(screen.getByText(/near DEM coverage missing/)).toBeDefined();
    expect(screen.queryByText(/visibility comparison/i)).toBeNull();
    view.rerender(<ScientificResults c0={computed} c1={{ ...computed, evaluation_id: "e2" }} />);
    expect(screen.getByText(/visibility comparison/i)).toBeDefined();
    expect(screen.getByText(/cannot be attributed to height alone/i)).toBeDefined();
  });
});
