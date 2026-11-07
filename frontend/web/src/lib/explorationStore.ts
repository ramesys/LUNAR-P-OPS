import type { BrushExecution, BrushPreview, ScientificEvaluation } from "@clps/api-client";
import type { BrushMode } from "./brushTypes.ts";
import type { LocalPoint } from "./roiFrame.ts";
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
 *  - regions   : drawing, selecting, editing and deleting Constraint Brush regions are draft
 *                state. Only a confirmed region execution writes (C0s and evaluations), and
 *                deleting a region never deletes those records. A preview or execution result is
 *                applied only to the unchanged region revision it was requested for.
 */
export interface Draft { observer_height_m: number; selected_time_utc: string }
export interface ExperimentSettings { duration_hours: number; step_minutes: number }
export type EvaluationActivity =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "running"; candidateId: string }
  | { kind: "error"; message: string };

/** Which scientific result the shared controls and labels currently refer to. */
export type ScientificContext = "candidate" | "catalog";

/**
 * The catalog comparison (original CLPS analysis). It is recomputed from the URL scenario on load
 * and on "Compare sites" (upstream behaviour, not persisted), so it is identified by a key derived
 * from its exact request, never mixed with candidate evaluations.
 */
export interface CatalogState {
  analysisKey: string | null;
  label: string;
  times: readonly string[];
  stepMinutes: number;
  cursorUtc: string | null;
  playing: boolean;
  focus: { siteId: string; name: string; latitude_deg: number; longitude_deg: number } | null;
}

/** Editable Constraint Brush parameters of one region (form values; percentages, optional limits as text). */
export interface BrushParams {
  spacing_m: number; max_points: number; observer_height_m: number; start_utc: string;
  duration_hours: number; step_minutes: number; min_sun_pct: number; min_earth_pct: number; min_both_pct: number;
  max_darkness_hours: string; max_earth_gap_hours: string; retention: "all" | "passing";
}

export interface BrushRegion {
  id: string;
  /** Sequence number shown as "Region n" / "Rn"; never reused while the region exists. */
  number: number;
  vertices: LocalPoint[];
  closed: boolean;
  params: BrushParams;
  /** Increments on every edit; stale preview/execution responses carry an older revision. */
  revision: number;
  preview: BrushPreview | null;
  execution: BrushExecution | null;
}

export interface InspectedSample { regionId: string; index: number }

export interface ExplorationState {
  context: ScientificContext;
  catalog: CatalogState;
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
  regions: BrushRegion[];
  activeRegionId: string | null;
  brushMode: BrushMode;
  /** Brush result the user is inspecting; follows the selected candidate when it is a region result. */
  inspectedSample: InspectedSample | null;
}

export type RegionPatch = Partial<Pick<BrushRegion, "vertices" | "closed" | "params">>;

export type ExplorationAction =
  | { type: "select-root"; rootId: string }
  | { type: "select-revision"; revisionId: string; rootId: string }
  | { type: "evaluation"; evaluation: ScientificEvaluation | null }
  | { type: "activity"; activity: EvaluationActivity }
  | { type: "draft"; draft: Draft | null }
  | { type: "settings"; settings: ExperimentSettings }
  | { type: "cursor"; utc: string | null }
  | { type: "playing"; playing: boolean }
  | { type: "context"; context: ScientificContext }
  | { type: "catalog-analysis"; analysisKey: string; label: string; times: readonly string[]; stepMinutes: number }
  | { type: "catalog-cursor"; utc: string | null }
  | { type: "catalog-playing"; playing: boolean }
  | { type: "catalog-focus"; focus: CatalogState["focus"] }
  | { type: "region-create"; id: string; params: BrushParams }
  | { type: "region-select"; regionId: string }
  | { type: "region-edit"; regionId: string; patch: RegionPatch }
  | { type: "region-delete"; regionId: string }
  | { type: "brush-mode"; mode: BrushMode }
  | { type: "region-preview"; regionId: string; revision: number; preview: BrushPreview | null }
  | { type: "region-execution"; regionId: string; revision: number; execution: BrushExecution }
  | { type: "region-inspect"; sample: InspectedSample | null };

export const INITIAL_CATALOG: CatalogState = { analysisKey: null, label: "", times: [], stepMinutes: 0, cursorUtc: null, playing: false, focus: null };

export const INITIAL: ExplorationState = {
  context: "candidate", catalog: INITIAL_CATALOG,
  rootId: null, revisionId: null, evaluation: null, activity: { kind: "idle" }, draft: null,
  settings: { duration_hours: 24, step_minutes: 60 }, cursorUtc: null, playing: false,
  regions: [], activeRegionId: null, brushMode: "off", inspectedSample: null,
};

/** Candidate behind an inspected brush result, if that result was persisted. */
export function inspectedCandidateId(state: Pick<ExplorationState, "regions" | "inspectedSample">, sample: InspectedSample | null = state.inspectedSample): string | null {
  if (sample === null) return null;
  const result: BrushExecution["results"][number] | undefined = state.regions.find((r: BrushRegion): boolean => r.id === sample.regionId)?.execution?.results[sample.index];
  return result?.persisted === true ? result.candidate?.candidate_id ?? null : null;
}

/** First brush result (any region) whose persisted candidate is `candidateId`. */
export function findSample(regions: readonly BrushRegion[], candidateId: string): InspectedSample | null {
  for (const region of regions) {
    const index: number = region.execution?.results.findIndex((r): boolean => r.persisted && r.candidate?.candidate_id === candidateId) ?? -1;
    if (index >= 0) return { regionId: region.id, index };
  }
  return null;
}

function updateRegion(state: ExplorationState, regionId: string, update: (region: BrushRegion) => BrushRegion): ExplorationState {
  const current: BrushRegion | undefined = state.regions.find((r: BrushRegion): boolean => r.id === regionId);
  if (current === undefined) return state;
  const next: BrushRegion = update(current);
  if (next === current) return state;
  return { ...state, regions: state.regions.map((r: BrushRegion): BrushRegion => r.id === regionId ? next : r) };
}

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

/** Index of the catalog time nearest to `utc` (the analysis' own sample grid); -1 without times. */
export function nearestTime(times: readonly string[], utc: string | null): number {
  if (times.length === 0) return -1;
  if (utc === null) return 0;
  const target: number = Date.parse(utc);
  let best: number = 0;
  let distance: number = Infinity;
  times.forEach((time: string, index: number): void => {
    const d: number = Math.abs(Date.parse(time) - target);
    if (d < distance) { best = index; distance = d; }
  });
  return best;
}

export function reduce(state: ExplorationState, action: ExplorationAction): ExplorationState {
  switch (action.type) {
    case "context":
      if (state.context === action.context) return state;
      // Switching context pauses both timelines; neither cursor is changed.
      return { ...state, context: action.context, playing: false, catalog: { ...state.catalog, playing: false } };
    case "catalog-analysis": {
      const same: boolean = state.catalog.analysisKey === action.analysisKey;
      const index: number = nearestTime(action.times, same ? state.catalog.cursorUtc : null);
      // Same request (e.g. after reload): keep the snapped cursor; a new request starts at its first sample.
      const cursor: string | null = index < 0 ? null : action.times[index] ?? null;
      return { ...state, catalog: { ...state.catalog, analysisKey: action.analysisKey, label: action.label, times: action.times,
        stepMinutes: action.stepMinutes, playing: false, cursorUtc: cursor } };
    }
    case "catalog-cursor": {
      const index: number = nearestTime(state.catalog.times, action.utc);
      const utc: string | null = index < 0 ? null : state.catalog.times[index] ?? null;
      if (utc === state.catalog.cursorUtc && state.context === "catalog") return state;
      return { ...state, context: "catalog", playing: false, catalog: { ...state.catalog, cursorUtc: utc } };
    }
    case "catalog-playing":
      if (state.catalog.playing === action.playing && (!action.playing || state.context === "catalog")) return state;
      return { ...state, context: action.playing ? "catalog" : state.context, playing: action.playing ? false : state.playing,
        catalog: { ...state.catalog, playing: action.playing } };
    case "catalog-focus":
      if (state.catalog.focus?.siteId === action.focus?.siteId) return state;
      return { ...state, catalog: { ...state.catalog, focus: action.focus } };
    case "select-root": {
      // A brush result stays inspected only while it is the selected candidate; otherwise follow the
      // selection to a matching result in any region, or clear it (no stale highlight).
      const inspected: InspectedSample | null = inspectedCandidateId(state) === action.rootId ? state.inspectedSample : findSample(state.regions, action.rootId);
      if (state.rootId === action.rootId && state.revisionId === action.rootId) {
        return inspected === state.inspectedSample ? state : { ...state, inspectedSample: inspected };
      }
      return { ...state, rootId: action.rootId, revisionId: action.rootId, evaluation: null, draft: null, cursorUtc: null, playing: false,
        inspectedSample: inspected, activeRegionId: inspected?.regionId ?? state.activeRegionId };
    }
    case "region-create": {
      if (state.regions.some((r: BrushRegion): boolean => r.id === action.id)) return state;
      const number: number = Math.max(0, ...state.regions.map((r: BrushRegion): number => r.number)) + 1;
      const region: BrushRegion = { id: action.id, number, vertices: [], closed: false, params: action.params, revision: 0, preview: null, execution: null };
      return { ...state, regions: [...state.regions, region], activeRegionId: action.id, brushMode: "draw" };
    }
    case "region-select":
      if (!state.regions.some((r: BrushRegion): boolean => r.id === action.regionId)) return state;
      if (state.activeRegionId === action.regionId) return state;
      return { ...state, activeRegionId: action.regionId, brushMode: "off" };
    case "region-edit": {
      const next: ExplorationState = updateRegion(state, action.regionId, (r: BrushRegion): BrushRegion =>
        ({ ...r, ...action.patch, revision: r.revision + 1, preview: null, execution: null }));
      if (next === state) return state;
      // Results of the edited region no longer describe it.
      return { ...next, inspectedSample: state.inspectedSample?.regionId === action.regionId ? null : state.inspectedSample };
    }
    case "region-delete": {
      if (!state.regions.some((r: BrushRegion): boolean => r.id === action.regionId)) return state;
      const regions: BrushRegion[] = state.regions.filter((r: BrushRegion): boolean => r.id !== action.regionId);
      const active: string | null = state.activeRegionId === action.regionId ? regions.at(-1)?.id ?? null : state.activeRegionId;
      // Only the drawn region is removed: persisted candidates, evaluations and the selection stay.
      return { ...state, regions, activeRegionId: active, brushMode: state.activeRegionId === action.regionId ? "off" : state.brushMode,
        inspectedSample: state.inspectedSample?.regionId === action.regionId ? null : state.inspectedSample };
    }
    case "brush-mode":
      if (state.brushMode === action.mode) return state;
      if (action.mode !== "off" && state.activeRegionId === null) return state;
      return { ...state, brushMode: action.mode };
    case "region-preview":
      return updateRegion(state, action.regionId, (r: BrushRegion): BrushRegion =>
        r.revision !== action.revision ? r : { ...r, preview: action.preview, execution: action.preview === null ? r.execution : null });
    case "region-execution":
      return updateRegion(state, action.regionId, (r: BrushRegion): BrushRegion =>
        r.revision !== action.revision ? r : { ...r, execution: action.execution });
    case "region-inspect":
      if (action.sample !== null && !state.regions.some((r: BrushRegion): boolean => r.id === action.sample?.regionId)) return state;
      if (action.sample?.regionId === state.inspectedSample?.regionId && action.sample?.index === state.inspectedSample?.index) return state;
      return { ...state, inspectedSample: action.sample, activeRegionId: action.sample?.regionId ?? state.activeRegionId };
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
      if (utc === state.cursorUtc && state.context === "candidate") return state;
      return { ...state, cursorUtc: utc, context: "candidate", catalog: { ...state.catalog, playing: false } };
    }
    case "playing":
      if (state.playing === action.playing && (!action.playing || state.context === "candidate")) return state;
      return { ...state, playing: action.playing, context: action.playing ? "candidate" : state.context,
        catalog: action.playing ? { ...state.catalog, playing: false } : state.catalog };
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
