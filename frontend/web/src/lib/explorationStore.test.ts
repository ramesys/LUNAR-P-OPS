import type { ScientificEvaluation } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import { createExplorationStore, INITIAL, nearestSample, reduce, type ExplorationState, type ExplorationStore } from "./explorationStore.ts";
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
