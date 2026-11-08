import { afterEach, describe, expect, it } from "vitest";
import { TERRAIN_PARAM_DEFAULTS } from "./explorationStore.ts";
import { loadRegions, loadSelection, saveSelection } from "./workspaceSelection.ts";

afterEach((): void => { localStorage.clear(); });

describe("workspace selection", (): void => {
  it("restores the root and the committed revision", (): void => {
    saveSelection({ rootId: "c0", revisionId: "c1", evaluationId: "e1", cursorUtc: "2026-11-07T05:00:00Z" });
    expect(loadSelection()).toEqual({ rootId: "c0", revisionId: "c1", evaluationId: "e1", cursorUtc: "2026-11-07T05:00:00Z" });
    // The Sprint 02–04 pointer stays in sync for older builds.
    expect(localStorage.getItem("lunar-ops-c0")).toBe("c0");
  });

  it("migrates the legacy C0 pointer and ignores malformed data", (): void => {
    expect(loadSelection()).toBeNull();
    localStorage.setItem("lunar-ops-c0", "legacy");
    expect(loadSelection()).toEqual({ rootId: "legacy", revisionId: "legacy", evaluationId: null, cursorUtc: null });
    localStorage.setItem("lunar-ops-selection", "{not json");
    expect(loadSelection()).toEqual({ rootId: "legacy", revisionId: "legacy", evaluationId: null, cursorUtc: null });
    localStorage.setItem("lunar-ops-selection", JSON.stringify({ rootId: "c0" }));
    expect(loadSelection()).toEqual({ rootId: "c0", revisionId: "c0", evaluationId: null, cursorUtc: null });
  });
});

describe("stored regions", (): void => {
  it("fills terrain-screen defaults for regions saved before terrain screening", (): void => {
    const legacy: Record<string, unknown> = { spacing_m: 100, max_points: 16, observer_height_m: 3, start_utc: "2026-11-07T00:00:00Z", duration_hours: 2,
      step_minutes: 60, min_sun_pct: 0, min_earth_pct: 0, min_both_pct: 0, max_darkness_hours: "", max_earth_gap_hours: "", retention: "all", sampling: "adaptive" };
    localStorage.setItem("lunar-ops-regions", JSON.stringify({ activeRegionId: "r1", regions: [{ id: "r1", number: 1, closed: true,
      vertices: [{ east_m: 0, north_m: 0 }, { east_m: 100, north_m: 0 }, { east_m: 0, north_m: 100 }], params: legacy }] }));
    const loaded: ReturnType<typeof loadRegions> = loadRegions();
    expect(loaded.regions[0]?.params).toEqual({ ...legacy, ...TERRAIN_PARAM_DEFAULTS });
    // Terrain screening stays off and Experiment A stays the default for restored regions.
    expect(loaded.regions[0]?.params.terrain_enabled).toBe(false);
    expect(loaded.regions[0]?.params.evidence).toBe("visibility");
  });
});
