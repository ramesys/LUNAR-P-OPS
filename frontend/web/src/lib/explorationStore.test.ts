import type { BrushExecution, ScientificEvaluation } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import { createExplorationStore, INITIAL, TERRAIN_PARAM_DEFAULTS, inspectedCandidateId, nearestSample, reduce, type BrushParams, type ExplorationState, type ExplorationStore } from "./explorationStore.ts";
import { evaluation } from "./testFixtures.ts";

const e0: ScientificEvaluation = evaluation();
const selected: ExplorationState = { ...INITIAL, rootId: "c0", revisionId: "c0" };

describe("exploration store", (): void => {
  it("snaps the cursor to an actual stored sample and never invents times", (): void => {
    expect(nearestSample(e0, "2026-11-07T00:40:00Z")).toBe(1);
    expect(nearestSample(e0, "2026-11-07T00:30:00Z")).toBe(0);
    expect(nearestSample(null, "2026-11-07T00:40:00Z")).toBe(-1);
    let state: ExplorationState = reduce(selected, { type: "evaluation", evaluation: e0 });
    expect(state.cursorUtc).toBe("2026-11-07T00:00:00Z");
    state = reduce(state, { type: "cursor", utc: "2026-11-07T00:50:00Z" });
    expect(state.cursorUtc).toBe("2026-11-07T01:00:00Z");
    // Cursor moves never touch the candidate, the evaluation, the draft or the experiment settings.
    expect(state.revisionId).toBe("c0");
    expect(state.evaluation).toBe(e0);
    expect(state.draft).toBeNull();
    expect(state.settings).toEqual(INITIAL.settings);
  });

  it("rejects stale evaluations and resets the cursor only for another location", (): void => {
    let state: ExplorationState = reduce(selected, { type: "evaluation", evaluation: e0 });
    state = reduce(state, { type: "cursor", utc: "2026-11-07T01:00:00Z" });
    const stale: ScientificEvaluation = { ...e0, evaluation_id: "old", candidate_id: "other" };
    expect(reduce(state, { type: "evaluation", evaluation: stale })).toBe(state);
    const revision: ExplorationState = reduce(state, { type: "select-revision", rootId: "c0", revisionId: "c1" });
    expect(revision.evaluation).toBeNull();
    expect(revision.cursorUtc).toBe("2026-11-07T01:00:00Z");
    const c1: ScientificEvaluation = { ...e0, evaluation_id: "e-c1", candidate_id: "c1" };
    expect(reduce(revision, { type: "evaluation", evaluation: c1 }).cursorUtc).toBe("2026-11-07T01:00:00Z");
    const elsewhere: ExplorationState = reduce(state, { type: "select-root", rootId: "c9" });
    expect(elsewhere).toMatchObject({ rootId: "c9", revisionId: "c9", evaluation: null, cursorUtc: null, draft: null });
  });

  it("notifies subscribers only for real changes", (): void => {
    const store: ExplorationStore = createExplorationStore(selected);
    let calls: number = 0;
    const stop: () => void = store.subscribe((): void => { calls++; });
    store.dispatch({ type: "evaluation", evaluation: e0 });
    store.dispatch({ type: "evaluation", evaluation: e0 });
    store.dispatch({ type: "cursor", utc: "2026-11-07T00:00:00Z" });
    store.dispatch({ type: "draft", draft: { observer_height_m: 2, selected_time_utc: "2026-11-07T00:00:00Z" } });
    store.dispatch({ type: "draft", draft: { observer_height_m: 2, selected_time_utc: "2026-11-07T00:00:00Z" } });
    expect(calls).toBe(2);
    stop();
  });
});

describe("scientific context", (): void => {
  const times: string[] = ["2026-11-07T00:00:00Z", "2026-11-07T02:00:00Z", "2026-11-07T04:00:00Z"];
  const withBoth: () => ExplorationState = (): ExplorationState => {
    let state: ExplorationState = reduce(selected, { type: "evaluation", evaluation: e0 });
    state = reduce(state, { type: "catalog-analysis", analysisKey: "analysis-1", label: "3 sites", times, stepMinutes: 120 });
    return state;
  };

  it("keeps candidate and catalog cursors on their own sample grids", (): void => {
    let state: ExplorationState = withBoth();
    expect(state.catalog.cursorUtc).toBe(times[0]);
    state = reduce(state, { type: "catalog-cursor", utc: "2026-11-07T02:59:00Z" });
    expect(state.context).toBe("catalog");
    expect(state.catalog.cursorUtc).toBe("2026-11-07T02:00:00Z");
    // The candidate cursor is untouched by the catalog timeline, and vice versa.
    expect(state.cursorUtc).toBe("2026-11-07T00:00:00Z");
    state = reduce(state, { type: "cursor", utc: "2026-11-07T01:00:00Z" });
    expect(state.context).toBe("candidate");
    expect(state.catalog.cursorUtc).toBe("2026-11-07T02:00:00Z");
  });

  it("plays one context at a time and pauses both when switching", (): void => {
    let state: ExplorationState = reduce(withBoth(), { type: "catalog-playing", playing: true });
    expect(state).toMatchObject({ context: "catalog", playing: false, catalog: { playing: true } });
    state = reduce(state, { type: "playing", playing: true });
    expect(state).toMatchObject({ context: "candidate", playing: true, catalog: { playing: false } });
    state = reduce(state, { type: "context", context: "catalog" });
    expect(state).toMatchObject({ context: "catalog", playing: false, catalog: { playing: false } });
  });

  it("keeps the catalog cursor only for the same analysis request", (): void => {
    let state: ExplorationState = reduce(withBoth(), { type: "catalog-cursor", utc: times[2] ?? null });
    state = reduce(state, { type: "catalog-analysis", analysisKey: "analysis-1", label: "3 sites", times, stepMinutes: 120 });
    expect(state.catalog.cursorUtc).toBe(times[2]);
    state = reduce(state, { type: "catalog-analysis", analysisKey: "analysis-2", label: "other", times: ["2026-12-01T00:00:00Z"], stepMinutes: 60 });
    expect(state.catalog).toMatchObject({ analysisKey: "analysis-2", cursorUtc: "2026-12-01T00:00:00Z", stepMinutes: 60 });
    expect(state.evaluation).toBe(e0);
  });
});

describe("brush regions in the shared store", (): void => {
  const params: BrushParams = { spacing_m: 100, max_points: 16, observer_height_m: 3, start_utc: "2026-11-07T00:00:00Z", duration_hours: 2,
    step_minutes: 60, min_sun_pct: 0, min_earth_pct: 0, min_both_pct: 0, max_darkness_hours: "", max_earth_gap_hours: "", retention: "all", sampling: "adaptive",
    ...TERRAIN_PARAM_DEFAULTS };
  const triangle: { east_m: number; north_m: number }[] = [
    { east_m: 0, north_m: 0 }, { east_m: 100, north_m: 0 }, { east_m: 0, north_m: 100 }];
  function execution(candidateId: string): BrushExecution {
    const result: ScientificEvaluation = { ...e0, candidate: { ...e0.candidate, candidate_id: candidateId }, candidate_id: candidateId };
    const preview: BrushExecution["preview"] = { definition: { polygon: triangle, spacing_m: 100, max_points: 16, observer_height_m: 3, start_utc: params.start_utc,
      duration_hours: 2, step_minutes: 60, retention: "all", sampling: "grid", evidence: "visibility", constraints: { min_sun_fraction: 0, min_earth_fraction: 0, min_simultaneous_fraction: 0, max_darkness_hours: null, max_earth_gap_hours: null } }, coordinate_reference: "", alignment: "", tolerance_m: 0,
      samples: [{ east_m: 0, north_m: 0, status: "READY", candidate_id: candidateId, already_persisted: false, iteration: 0, parent_candidate_ids: [], parent_evaluation_ids: [], parent_terrain_screen_ids: [] }], ready_count: 1, new_count: 1, existing_count: 0,
      temporal_samples_per_point: 2, estimated_total_samples: 2, preview_token: "t" };
    return { schema_version: "lunar-ops-brush/1", preview, notes: [],
      results: [{ sample: { east_m: 0, north_m: 0, status: "READY", candidate_id: candidateId, already_persisted: false, iteration: 0, parent_candidate_ids: [], parent_evaluation_ids: [], parent_terrain_screen_ids: [] }, verdict: "PASS", candidate: result.candidate, evaluation: result, persisted: true, errors: [] }] };
  }
  function withTwoRegions(): ExplorationState {
    let state: ExplorationState = reduce(selected, { type: "region-create", id: "a", params });
    state = reduce(state, { type: "region-edit", regionId: "a", patch: { vertices: triangle, closed: true } });
    state = reduce(state, { type: "region-create", id: "b", params });
    state = reduce(state, { type: "region-edit", regionId: "b", patch: { vertices: triangle, closed: true } });
    const a: number = state.regions[0]?.revision ?? -1;
    const b: number = state.regions[1]?.revision ?? -1;
    state = reduce(state, { type: "region-execution", regionId: "a", revision: a, execution: execution("ca") });
    return reduce(state, { type: "region-execution", regionId: "b", revision: b, execution: execution("cb") });
  }

  it("creates, selects and deletes regions without touching the candidate selection", (): void => {
    let state: ExplorationState = withTwoRegions();
    expect(state.regions.map((r): number => r.number)).toEqual([1, 2]);
    expect(state.activeRegionId).toBe("b");
    state = reduce(state, { type: "region-select", regionId: "a" });
    expect([state.activeRegionId, state.brushMode]).toEqual(["a", "off"]);
    state = reduce(state, { type: "region-inspect", sample: { regionId: "a", index: 0 } });
    state = reduce(state, { type: "select-root", rootId: "ca" });
    state = reduce(state, { type: "region-delete", regionId: "a" });
    expect(state.regions.map((r): string => r.id)).toEqual(["b"]);
    expect(state.inspectedSample).toBeNull();
    // The persisted candidate stays selected: deleting a region removes only the drawing.
    expect([state.rootId, state.revisionId]).toEqual(["ca", "ca"]);
    expect(state.activeRegionId).toBe("b");
  });

  it("follows candidate selection to the matching region result and clears stale highlights", (): void => {
    let state: ExplorationState = withTwoRegions();
    state = reduce(state, { type: "select-root", rootId: "cb" });
    expect(state.inspectedSample).toEqual({ regionId: "b", index: 0 });
    state = reduce(state, { type: "select-root", rootId: "ca" });
    expect([state.inspectedSample, state.activeRegionId]).toEqual([{ regionId: "a", index: 0 }, "a"]);
    state = reduce(state, { type: "select-root", rootId: "elsewhere" });
    expect(state.inspectedSample).toBeNull();
    expect(inspectedCandidateId(state, { regionId: "b", index: 0 })).toBe("cb");
  });

  it("ignores preview and execution responses for an edited or deleted region", (): void => {
    let state: ExplorationState = withTwoRegions();
    const old: number = state.regions[0]?.revision ?? -1;
    state = reduce(state, { type: "region-edit", regionId: "a", patch: { params: { ...params, spacing_m: 200 } } });
    expect(state.regions[0]?.execution).toBeNull();
    const stale: ExplorationState = reduce(state, { type: "region-execution", regionId: "a", revision: old, execution: execution("ca") });
    expect(stale).toBe(state);
    expect(reduce(state, { type: "region-preview", regionId: "gone", revision: 0, preview: null })).toBe(state);
    expect(reduce(state, { type: "brush-mode", mode: "edit" }).brushMode).toBe("edit");
    // Drawing needs an active region: no region, no drawing mode.
    expect(reduce({ ...state, activeRegionId: null, brushMode: "off" }, { type: "brush-mode", mode: "draw" }).brushMode).toBe("off");
  });
});
