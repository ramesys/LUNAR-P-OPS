import type { ScientificEvaluation } from "@clps/api-client";
import { createContext, useContext, useSyncExternalStore, type Context } from "react";

/**
 * One authoritative space–time exploration state for the terrain, graph, timeline and inspector
 * (Sprint 06). Plain React `useSyncExternalStore`: subscribers re-render only for the slice they
 * select, so timeline playback does not re-render the whole application.
 *
 * Interaction contract — which actions may change which kind of state:
 *  - display   : cursor (scrub/play), playing, camera (local to the 3D view), panel focus.
 *  - draft     : draft height/time (graph nodes or Inspector), experiment duration/step.
 *  - persisted : terrain click → new C0; "Create Candidate C1" → new revision. Nothing else.
 *  - evaluation: "Evaluate" (POST) and "Recompute & compare" (not stored). Selecting candidates,
 *                evaluations or time only reads stored results.
 */
export interface Draft { observer_height_m: number; selected_time_utc: string }
export interface ExperimentSettings { duration_hours: number; step_minutes: number }
export type EvaluationActivity =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "running"; candidateId: string }
  | { kind: "error"; message: string };

export interface ExplorationState {
  /** Root candidate (C0) whose graph is open; also the highlighted terrain marker. */
  rootId: string | null;
  /** Active committed candidate (C0 or C1) on the graph's candidate_ref. */
  revisionId: string | null;
  /** Active persisted evaluation of the active candidate (never a draft). */
  evaluation: ScientificEvaluation | null;
  activity: EvaluationActivity;
  /** Unsaved parameters in the graph nodes for the next revision. */
  draft: Draft | null;
  /** Unsaved settings for the next Evaluate. */
  settings: ExperimentSettings;
  /** UTC of the inspected stored sample; never part of the scientific inputs. */
  cursorUtc: string | null;
  playing: boolean;
}

export type ExplorationAction =
  | { type: "select-root"; rootId: string }
  | { type: "select-revision"; revisionId: string; rootId: string }
  | { type: "evaluation"; evaluation: ScientificEvaluation | null }
  | { type: "activity"; activity: EvaluationActivity }
  | { type: "draft"; draft: Draft | null }
  | { type: "settings"; settings: ExperimentSettings }
  | { type: "cursor"; utc: string | null }
  | { type: "playing"; playing: boolean };

export const INITIAL: ExplorationState = {
  rootId: null, revisionId: null, evaluation: null, activity: { kind: "idle" }, draft: null,
  settings: { duration_hours: 24, step_minutes: 60 }, cursorUtc: null, playing: false,
};

/** Index of the stored sample nearest to `utc` (ties go to the earlier sample); -1 without samples. */
export function nearestSample(evaluation: ScientificEvaluation | null, utc: string | null): number {
  const samples: ScientificEvaluation["samples"] = evaluation?.samples ?? [];
  if (samples.length === 0) return -1;
  if (utc === null) return 0;
  const target: number = Date.parse(utc);
  let best: number = 0;
  let distance: number = Infinity;
  samples.forEach((sample: ScientificEvaluation["samples"][number], index: number): void => {
    const d: number = Math.abs(Date.parse(sample.time_utc) - target);
    if (d < distance) { best = index; distance = d; }
  });
  return best;
}

export function reduce(state: ExplorationState, action: ExplorationAction): ExplorationState {
  switch (action.type) {
    case "select-root":
      if (state.rootId === action.rootId && state.revisionId === action.rootId) return state;
      return { ...state, rootId: action.rootId, revisionId: action.rootId, evaluation: null, draft: null, cursorUtc: null, playing: false };
    case "select-revision":
      if (state.revisionId === action.revisionId && state.rootId === action.rootId) return state;
      // Same location: keep the inspected time so C0 and C1 can be compared at one instant.
      return { ...state, rootId: action.rootId, revisionId: action.revisionId, evaluation: null, playing: false,
        cursorUtc: state.rootId === action.rootId ? state.cursorUtc : null };
    case "evaluation": {
      const evaluation: ScientificEvaluation | null = action.evaluation;
      // A result for another candidate is stale and never replaces the active one.
      if (evaluation !== null && evaluation.candidate_id !== state.revisionId) return state;
      if (evaluation?.evaluation_id === state.evaluation?.evaluation_id) return state;
      // Keep the cursor's time when the new result covers it; snap to an actual stored sample.
      const index: number = nearestSample(evaluation, state.cursorUtc);
      const sample: string | null = index < 0 ? null : evaluation?.samples[index]?.time_utc ?? null;
      const inside: boolean = state.cursorUtc !== null && sample !== null && evaluation !== null &&
        Date.parse(state.cursorUtc) >= Date.parse(evaluation.samples[0]?.time_utc ?? "") &&
        Date.parse(state.cursorUtc) <= Date.parse(evaluation.samples.at(-1)?.time_utc ?? "");
      const first: string | null = evaluation?.samples[0]?.time_utc ?? null;
      return { ...state, evaluation, cursorUtc: inside ? sample : first, playing: false };
    }
    case "activity":
      return { ...state, activity: action.activity };
    case "draft":
      if (state.draft?.observer_height_m === action.draft?.observer_height_m && state.draft?.selected_time_utc === action.draft?.selected_time_utc) return state;
      return { ...state, draft: action.draft };
    case "settings":
      return { ...state, settings: action.settings };
    case "cursor": {
      if (state.evaluation === null) return state.cursorUtc === null ? state : { ...state, cursorUtc: null };
      const index: number = nearestSample(state.evaluation, action.utc);
      const utc: string | null = index < 0 ? null : state.evaluation.samples[index]?.time_utc ?? null;
      return utc === state.cursorUtc ? state : { ...state, cursorUtc: utc };
    }
    case "playing":
      return state.playing === action.playing ? state : { ...state, playing: action.playing };
  }
}

export interface ExplorationStore {
  getState: () => ExplorationState;
  dispatch: (action: ExplorationAction) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createExplorationStore(initial: ExplorationState = INITIAL): ExplorationStore {
  let state: ExplorationState = initial;
  const listeners: Set<() => void> = new Set<() => void>();
  return {
    getState: (): ExplorationState => state,
    dispatch: (action: ExplorationAction): void => {
      const next: ExplorationState = reduce(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((listener: () => void): void => { listener(); });
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
  };
}

export const ExplorationContext: Context<ExplorationStore> = createContext<ExplorationStore>(createExplorationStore());

export function useExplorationStore(): ExplorationStore {
  return useContext(ExplorationContext);
}

export function useExploration<T>(select: (state: ExplorationState) => T): T {
  const store: ExplorationStore = useExplorationStore();
  return useSyncExternalStore(store.subscribe, (): T => select(store.getState()));
}
