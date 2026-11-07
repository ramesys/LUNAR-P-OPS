import type { ScientificEvaluation } from "@clps/api-client";
import type { JSX } from "react";
import { formatUtc } from "../lib/format.ts";
import {
  nearestSample,
  nearestTime,
  useExploration,
  useExplorationStore,
  type CatalogState,
  type Draft,
  type ExplorationStore,
  type ScientificContext,
} from "../lib/explorationStore.ts";

function scrollTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The explicit active scientific context: which result the time controls, labels and spatial views
 * refer to. Each context keeps its own identifier, interval and cursor; they are never mixed.
 */
export function ContextBar(): JSX.Element {
  const store: ExplorationStore = useExplorationStore();
  const context: ScientificContext = useExploration((state): ScientificContext => state.context);
  const evaluation: ScientificEvaluation | null = useExploration((state): ScientificEvaluation | null => state.evaluation);
  const cursorUtc: string | null = useExploration((state): string | null => state.cursorUtc);
  const rootId: string | null = useExploration((state): string | null => state.rootId);
  const revisionId: string | null = useExploration((state): string | null => state.revisionId);
  const draft: Draft | null = useExploration((state): Draft | null => state.draft);
  const catalog: CatalogState = useExploration((state): CatalogState => state.catalog);

  const revision: string = revisionId === null ? "none" : revisionId === rootId ? "C0" : "C1";
  const index: number = nearestSample(evaluation, cursorUtc);
  const sample: string | undefined = index < 0 ? undefined : evaluation?.samples[index]?.time_utc;
  const inputs: ScientificEvaluation["candidate"] | undefined = evaluation?.candidate;
  const drafted: boolean = draft !== null && inputs !== undefined &&
    (draft.observer_height_m !== inputs.observer_height_m || draft.selected_time_utc !== inputs.selected_time_utc);
  const catalogIndex: number = nearestTime(catalog.times, catalog.cursorUtc);

  function choose(next: ScientificContext): void {
    store.dispatch({ type: "context", context: next });
    scrollTo(next === "candidate" ? "candidate-context" : "catalog-context");
  }

  return <nav className="context-bar" aria-label="Active scientific context">
    <span className="context-title">Active context</span>
    <button type="button" className="context-card" aria-pressed={context === "candidate"} onClick={(): void => { choose("candidate"); }}>
      <span className="context-kind">Candidate evaluation</span>
      {revisionId === null ? <span>No candidate selected</span> : <>
        <span><strong>{revision}</strong> {inputs === undefined ? "" : `· ${Math.abs(inputs.latitude_deg).toFixed(5)}°S ${inputs.longitude_deg.toFixed(5)}°E · ${inputs.observer_height_m.toString()} m`}</span>
        <span className="mono-wrap">{evaluation === null ? "not evaluated" : `${evaluation.evaluation_id.slice(0, 22)}… · ${evaluation.status}`}</span>
        <span>{sample === undefined || evaluation === null ? "no stored samples" :
          `sample ${(index + 1).toString()}/${evaluation.samples.length.toString()} · ${formatUtc(sample)} · step ${evaluation.request.step_minutes.toString()} min`}</span>
        {drafted && <span className="draft-text">Unsaved draft differs from the evaluated inputs</span>}
      </>}
    </button>
    <button type="button" className="context-card" aria-pressed={context === "catalog"} onClick={(): void => { choose("catalog"); }}>
      <span className="context-kind">Catalog comparison</span>
      {catalog.analysisKey === null || catalog.times.length === 0 ? <span>No comparison loaded</span> : <>
        <span><strong>{catalog.focus?.name ?? "—"}</strong> {catalog.focus === null ? "" : `· ${Math.abs(catalog.focus.latitude_deg).toFixed(2)}°S ${catalog.focus.longitude_deg.toFixed(2)}°E`}</span>
        <span className="mono-wrap">{catalog.analysisKey} · {catalog.label}</span>
        <span>{catalogIndex < 0 ? "no samples" :
          `sample ${(catalogIndex + 1).toString()}/${catalog.times.length.toString()} · ${formatUtc(catalog.times[catalogIndex] ?? "")} · step ${catalog.stepMinutes.toString()} min`}</span>
      </>}
    </button>
  </nav>;
}

/** Small badge naming the context a panel belongs to and whether it is the active one. */
export function ContextBadge({ of }: { of: ScientificContext }): JSX.Element {
  const context: ScientificContext = useExploration((state): ScientificContext => state.context);
  const active: boolean = context === of;
  return <span className={`context-badge ${active ? "active" : ""}`}>
    {of === "candidate" ? "Candidate evaluation" : "Catalog comparison"} · {active ? "active context" : "inactive"}
  </span>;
}
