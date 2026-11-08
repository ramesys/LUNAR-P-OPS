import type { ApiClient, Candidate, CandidateRef, ScientificEvaluation } from "@clps/api-client";
import { ExperimentPanel } from "./ExperimentPanel.tsx";
import { ContextBadge } from "./ContextBar.tsx";
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { computationState, evaluationChart, exactStoredSample, horizonGap, visibleHours, type ComputationState, type EvaluationChart, type HorizonGap } from "../lib/evaluationCharts.ts";
import { nearestSample, useExploration, useExplorationStore, type BrushRegion, type Draft, type ExplorationStore } from "../lib/explorationStore.ts";
import { formatUtc } from "../lib/format.ts";
import { clampIndex, DEFAULT_SPEED, samplesPerTick, TICK_MS, trailSamples } from "../lib/playback.ts";
import type { Mode } from "../lib/mode.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";
import { CandidateInspector } from "./CandidateInspector.tsx";
import { HoverReadout } from "./HoverReadout.tsx";
import { ResultComparison, ResultDetails } from "./ScientificResults.tsx";
import { SkyChart } from "./SkyChart.tsx";
import { TimeControl } from "./TimeControl.tsx";
import { Timeline } from "./Timeline.tsx";

export type { Draft } from "../lib/explorationStore.ts";

interface Props {
  root: Candidate;
  child: Candidate | null;
  selected: Candidate;
  selectedRef: CandidateRef | null;
  evaluation: ScientificEvaluation | null;
  c0Result: ScientificEvaluation | null;
  c1Result: ScientificEvaluation | null;
  draft: Draft | null;
  mode: Mode;
  busy: boolean;
  /** Needed for experiment export and recompute; omitted in isolated tests. */
  apiClient?: ApiClient;
  /** Set when a graph node was picked: highlights the matching Inspector section. */
  focus?: { part: "candidate" | "result"; at: number } | null;
  onSelectRevision: (candidate: Candidate) => void;
  onDraftChange: (draft: Draft) => void;
}

const COMPUTATION_TEXT: Record<ComputationState, string> = {
  "not-run": "Not evaluated yet — press Evaluate in the graph toolbar.",
  succeeded: "Computed (COMPUTED_UNVERIFIED): the terrain horizon and SPICE geometry ran with complete inputs.",
  unavailable: "Unavailable: required terrain coverage or inputs were missing, so nothing was computed.",
  failed: "Failed: the computation raised an error.",
};

export function revisionLabel(root: Candidate, candidate: Candidate): string {
  return candidate.candidate_id === root.candidate_id ? "C0" : "C1";
}

function latLon(c: Candidate): string {
  return `${Math.abs(c.latitude_deg).toFixed(6)}°${c.latitude_deg < 0 ? "S" : "N"}, ${c.longitude_deg.toFixed(6)}°E`;
}

/** Selected candidate, its parameters, status and persisted result, in order of importance. */
export function WorkspaceInspector({ root, child, selected, selectedRef, evaluation, c0Result, c1Result, draft, mode, busy, focus = null, apiClient,
  onSelectRevision, onDraftChange }: Props): JSX.Element {
  const label: string = revisionLabel(root, selected);
  const state: ComputationState = computationState(evaluation);
  const edited: boolean = draft !== null && (draft.observer_height_m !== selected.observer_height_m || draft.selected_time_utc !== selected.selected_time_utc);
  const validated: boolean = evaluation?.status === "VALIDATED";
  return <aside className="ws-inspector card" aria-label="Inspector">
    <div className="inspector-head">
      <div><span className="panel-eyebrow">03 / CANDIDATE CONTEXT</span><h2>Inspector</h2></div>
      <div className="site-tabs" role="group" aria-label="Committed revision on candidate_ref">
        <button type="button" aria-pressed={selected.candidate_id === root.candidate_id} disabled={busy}
          onClick={(): void => { onSelectRevision(root); }}>C0</button>
        <button type="button" aria-pressed={child !== null && selected.candidate_id === child.candidate_id} disabled={busy || child === null}
          title={child === null ? "Create C1 from edited parameters first" : undefined}
          onClick={(): void => { if (child !== null) onSelectRevision(child); }}>C1</button>
      </div>
    </div>
    <div key={focus?.part === "candidate" ? focus.at : "candidate"} className={focus?.part === "candidate" ? "focus-flash" : undefined}>
    <p className="selected-line"><span className="sel-dot" aria-hidden="true" /> <strong>Selected: {label}</strong>
      {label === "C1" ? " (committed revision of C0)" : " (created from the terrain)"} · {selected.terrain_window_id === "sample-a" ? "Sample A" : "Shackleton Rim B"}</p>

    <dl className="facts">
      <dt>Position</dt><dd>{latLon(selected)} <span className="muted">MOON_ME, planetocentric</span></dd>
      <dt>Terrain elevation</dt><dd>{selected.terrain_elevation_m.toFixed(2)} m <span className="muted">above the 1737.4 km sphere · LOLA {selected.dem_resolution_m} m raster sample</span></dd>
      <dt>Observer height</dt><dd>{selected.observer_height_m} m above the ground</dd>
      <dt>Start time</dt><dd>{selected.selected_time_utc} UTC</dd>
    </dl>
    </div>

    <section aria-label="Status" className="status-grid">
      <h3>Status</h3>
      <p><span className="chip ok">Data available</span> DEM sample found at this point{selected.terrain_nodata === "NaN" ? " (source nodata is NaN)" : ""}.</p>
      <p><span className={`chip ${state === "succeeded" ? "ok" : state === "not-run" ? "idle" : "warn"}`}>
        {state === "succeeded" ? "Computed" : state === "not-run" ? "Not evaluated" : state === "unavailable" ? "Unavailable" : "Failed"}</span> {COMPUTATION_TEXT[state]}</p>
      <p><span className={`chip ${validated ? "ok" : "idle"}`}>{validated ? "Independently validated" : "Not independently validated"}</span>
        {validated ? " Independent evidence supports this result." : " A computed result is not a validated one; no independent check exists for this candidate."}</p>
    </section>

    <section aria-label="Parameters for the next revision">
      <h3>Parameters</h3>
      <p className="muted">These edit the graph's Observer Height and Time nodes. Nothing is saved until you press <strong>Create Candidate C1</strong> in the graph toolbar.</p>
      {draft === null ? <p className="muted">Graph loading…</p> : <div className="param-row">
        <label>Observer height (m) <input type="number" min="0" max="100" step="0.1" value={draft.observer_height_m} disabled={busy}
          onChange={(event): void => { onDraftChange({ ...draft, observer_height_m: Number(event.target.value) }); }} /></label>
        <label>UTC time <input type="text" value={draft.selected_time_utc} disabled={busy}
          onChange={(event): void => { onDraftChange({ ...draft, selected_time_utc: event.target.value }); }} /></label>
      </div>}
      {edited && <p className="chip warn" role="status">Unsaved edit — differs from {label}; not on candidate_ref</p>}
    </section>

    <section aria-label="Selected result" key={focus?.part === "result" ? focus.at : "result"} className={focus?.part === "result" ? "focus-flash" : undefined}>
      <h3>Result for {label} <ContextBadge of="candidate" /></h3>
      {evaluation === null ? <p className="muted">No stored evaluation for {label}.</p> : <EvaluationSummary evaluation={evaluation} label={label} />}
      {c0Result !== null && c1Result !== null && <ResultComparison c0={c0Result} c1={c1Result} />}
    </section>
    {evaluation !== null && apiClient !== undefined && <ExperimentPanel key={evaluation.evaluation_id} apiClient={apiClient} evaluation={evaluation} />}

    <details open={mode === "expert"}>
      <summary>Data source, CandidateRef and provenance</summary>
      {selectedRef !== null && <p className="mono-wrap">CandidateRef {selectedRef.schema_version}: {selectedRef.candidate_id} · site {selectedRef.site_id} · window {selectedRef.terrain_window_id} · snapshot SHA-256 {selectedRef.snapshot_sha256}</p>}
      <CandidateInspector candidate={selected} />
    </details>
  </aside>;
}

function EvaluationSummary({ evaluation, label }: { evaluation: ScientificEvaluation; label: string }): JSX.Element {
  const chart: EvaluationChart | null = evaluationChart(evaluation, `${label} candidate`);
  const gap: HorizonGap | null = horizonGap(evaluation);
  const start: string = evaluation.samples[0]?.time_utc ?? evaluation.candidate.selected_time_utc;
  const end: string = new Date(Date.parse(evaluation.candidate.selected_time_utc) + evaluation.request.duration_hours * 3600_000).toISOString();
  return <div>
    <p><strong>{evaluation.status}</strong> <span className="muted mono-wrap">{evaluation.evaluation_id.slice(0, 27)}…</span></p>
    <p className="interval-line">Evaluated interval <strong>{formatUtc(start)} → {formatUtc(end)}</strong> ({evaluation.request.duration_hours} h),
      {" "}{evaluation.samples.length} samples every {evaluation.request.step_minutes} min — each state is known only at its sample time; transitions are uncertain by up to one step.</p>
    {evaluation.errors.map((message: string): JSX.Element => <p role="alert" key={message}>{message}</p>)}
    {chart !== null && <>
      <p>Sampled visibility: <strong>Sun {visibleHours(evaluation, "sun").toFixed(1)} h</strong> · <strong>Earth {visibleHours(evaluation, "earth").toFixed(1)} h</strong> · both {visibleHours(evaluation, "simultaneous").toFixed(1)} h of {evaluation.request.duration_hours} h</p>
      {gap !== null && <ZeroVisibility gap={gap} />}
      <EvaluationCharts chart={chart} evaluation={evaluation} />
    </>}
    <ul className="muted small-list">{evaluation.warnings.map((message: string): JSX.Element => <li key={message}>{message}</li>)}</ul>
    <details><summary>Intervals, time series, horizon and provenance</summary><ResultDetails result={evaluation} label={label} /></details>
  </div>;
}

/** Explains a zero-visibility result from the stored samples instead of leaving an empty chart. */
function ZeroVisibility({ gap }: { gap: HorizonGap }): JSX.Element | null {
  const lines: string[] = [];
  if (gap.sunHours === 0) lines.push(`Sun never cleared the terrain horizon in this interval: closest approach ${gap.sunClosest.toFixed(2)}° (Sun elevation minus horizon at the Sun's azimuth, upper limb counted).`);
  if (gap.earthHours === 0) lines.push(`Earth never cleared the terrain horizon: closest approach ${gap.earthClosest.toFixed(2)}° (Earth centre minus horizon).`);
  if (lines.length === 0) return null;
  return <div className="zero-state" role="note">
    {lines.map((line: string): JSX.Element => <p key={line}>{line}</p>)}
    <p className="muted small">This is the stored geometric result for this date range. To explore another period, edit the start time in the Time node or here, create C1, and evaluate (up to 168 h per run).</p>
  </div>;
}

/** The original CLPS sky diagram, timeline and time control, driving the shared cursor. */
function EvaluationCharts({ chart, evaluation }: { chart: EvaluationChart; evaluation: ScientificEvaluation }): JSX.Element {
  const store: ExplorationStore = useExplorationStore();
  const cursorUtc: string | null = useExploration((state): string | null => state.cursorUtc);
  const regions: BrushRegion[] = useExploration((state): BrushRegion[] => state.regions);
  const playing: boolean = useExploration((state): boolean => state.playing);
  const activeContext: string = useExploration((state): string => state.context);
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const width: number = Math.max(300, useElementWidth(host, 420));
  const [hover, setHover] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const position: RefObject<number> = useRef<number>(0);
  const count: number = chart.times.length;
  const index: number = Math.max(0, nearestSample(evaluation, cursorUtc));
  const indexRef: RefObject<number> = useRef<number>(index);
  useEffect((): void => { indexRef.current = index; }, [index]);
  const moveTo: (i: number) => void = useCallback((i: number): void => {
    store.dispatch({ type: "cursor", utc: chart.times[clampIndex(i, count)] ?? null });
  }, [store, chart, count]);
  // Playback walks the stored samples only; it never requests a computation.
  useEffect((): (() => void) | undefined => {
    if (!playing) return undefined;
    position.current = indexRef.current >= count - 1 ? 0 : indexRef.current;
    const perTick: number = samplesPerTick(speed, evaluation.request.step_minutes);
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      position.current = Math.min(count - 1, position.current + perTick);
      moveTo(Math.floor(position.current + 1e-9));
      if (position.current >= count - 1) store.dispatch({ type: "playing", playing: false });
    }, TICK_MS);
    return (): void => { clearInterval(timer); };
  }, [playing, speed, evaluation.request.step_minutes, count, moveTo, store]);
  const shown: number = hover ?? Math.min(index, count - 1);
  const select: (i: number) => void = (i: number): void => { store.dispatch({ type: "playing", playing: false }); moveTo(i); };
  return <div ref={host} className="inspector-charts">
    <p className="muted small">Inspecting stored sample <strong>{(index + 1).toString()} of {count.toString()}</strong> at {formatUtc(chart.times[index] ?? "")}
      {index === 0 ? " (start of interval)" : index === count - 1 ? " (end of interval)" : ""}. The terrain view and graph follow this cursor; it never changes the candidate or runs a calculation.</p>
    <section className="candidate-time-dock" aria-label="Candidate timeline dock" data-active={activeContext === "candidate"}>
      <div className="dock-heading"><strong>◷ &nbsp; TIMELINE</strong><span>Candidate evaluation · {evaluation.request.duration_hours} h / {evaluation.request.step_minutes} min</span><span>Sample {index + 1} / {count}</span></div>
      <TimeControl times={chart.times} index={shown} playing={playing} hoursPerSecond={speed} onIndex={moveTo}
        onPlayingChange={(next: boolean): void => { store.dispatch({ type: "playing", playing: next }); }} onSpeed={setSpeed} />
    </section>
    <HoverReadout times={chart.times} focused={chart.site} index={shown} previewing={hover !== null} />
    <SkyChart result={chart.site} width={width} index={shown} trailSamples={trailSamples(evaluation.request.step_minutes)} onHover={setHover} onSelect={select} />
    <Timeline times={chart.times} width={width} sites={[chart.site]} focused={chart.site} rangeEnd={chart.rangeEnd}
      index={shown} onHover={setHover} onSelect={select} />
    {regions.some((region): boolean => region.execution !== null) && <details><summary>Compare region results at the cursor UTC</summary>
      <p className="small muted">Exact stored samples only; a missing timestamp is unsampled, not interpolated.</p>
      <table><thead><tr><th>Candidate</th><th>Sun</th><th>Earth</th><th>Both</th></tr></thead><tbody>
      {regions.flatMap((region) => (region.execution?.results ?? []).map((result, i): JSX.Element => {
        const recorded: boolean = result.persisted || region.execution?.experiment_id != null;
        const computed: boolean = result.evaluation?.status === "COMPUTED_UNVERIFIED" || result.evaluation?.status === "VALIDATED";
        const sample: ScientificEvaluation["samples"][number] | null = recorded && computed ? exactStoredSample(result.evaluation, cursorUtc) : null;
        const state: string = !recorded ? "not stored" : result.evaluation === null || result.evaluation === undefined || result.evaluation.status === "UNAVAILABLE" || result.evaluation.status === "ERROR" ? "unavailable" : "unsampled";
        const display: (value: boolean | undefined) => string = (value: boolean | undefined): string => value === undefined ? state : value ? "visible" : "not visible";
        return <tr key={`${region.id}:${i.toString()}`}><td>R{region.number} · {result.sample.candidate_id ?? `point ${(i + 1).toString()}`}</td>
          <td>{display(sample?.sun_visible)}</td><td>{display(sample?.earth_visible)}</td><td>{display(sample?.simultaneous_visible)}</td></tr>;
      }))}</tbody></table>
    </details>}
  </div>;
}
