import type { Candidate, CandidateRef, ScientificEvaluation } from "@clps/api-client";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { computationState, evaluationChart, visibleHours, type ComputationState, type EvaluationChart } from "../lib/evaluationCharts.ts";
import { clampIndex, DEFAULT_SPEED, samplesPerTick, TICK_MS, trailSamples } from "../lib/playback.ts";
import type { Mode } from "../lib/mode.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";
import { CandidateInspector } from "./CandidateInspector.tsx";
import { HoverReadout } from "./HoverReadout.tsx";
import { ResultComparison, ResultDetails } from "./ScientificResults.tsx";
import { SkyChart } from "./SkyChart.tsx";
import { TimeControl } from "./TimeControl.tsx";
import { Timeline } from "./Timeline.tsx";

export interface Draft { observer_height_m: number; selected_time_utc: string }

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
export function WorkspaceInspector({ root, child, selected, selectedRef, evaluation, c0Result, c1Result, draft, mode, busy, focus = null,
  onSelectRevision, onDraftChange }: Props): JSX.Element {
  const label: string = revisionLabel(root, selected);
  const state: ComputationState = computationState(evaluation);
  const edited: boolean = draft !== null && (draft.observer_height_m !== selected.observer_height_m || draft.selected_time_utc !== selected.selected_time_utc);
  const validated: boolean = evaluation?.status === "VALIDATED";
  return <aside className="ws-inspector card" aria-label="Inspector">
    <div className="inspector-head">
      <h2>Inspector</h2>
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
      <h3>Result for {label}</h3>
      {evaluation === null ? <p className="muted">No stored evaluation for {label}.</p> : <EvaluationSummary evaluation={evaluation} label={label} />}
      {c0Result !== null && c1Result !== null && <ResultComparison c0={c0Result} c1={c1Result} />}
    </section>

    <details open={mode === "expert"}>
      <summary>Data source, CandidateRef and provenance</summary>
      {selectedRef !== null && <p className="mono-wrap">CandidateRef {selectedRef.schema_version}: {selectedRef.candidate_id} · site {selectedRef.site_id} · window {selectedRef.terrain_window_id} · snapshot SHA-256 {selectedRef.snapshot_sha256}</p>}
      <CandidateInspector candidate={selected} />
    </details>
  </aside>;
}

function EvaluationSummary({ evaluation, label }: { evaluation: ScientificEvaluation; label: string }): JSX.Element {
  const chart: EvaluationChart | null = evaluationChart(evaluation, `${label} candidate`);
  return <div>
    <p><strong>{evaluation.status}</strong> · {evaluation.request.duration_hours} h from {evaluation.candidate.selected_time_utc}, {evaluation.request.step_minutes} min step
      {" "}<span className="muted mono-wrap">{evaluation.evaluation_id.slice(0, 27)}…</span></p>
    {evaluation.errors.map((message: string): JSX.Element => <p role="alert" key={message}>{message}</p>)}
    {chart !== null && <>
      <p>Sampled visibility: <strong>Sun {visibleHours(evaluation, "sun").toFixed(1)} h</strong> · <strong>Earth {visibleHours(evaluation, "earth").toFixed(1)} h</strong> · both {visibleHours(evaluation, "simultaneous").toFixed(1)} h of {evaluation.request.duration_hours} h</p>
      <EvaluationCharts key={evaluation.evaluation_id} chart={chart} stepMinutes={evaluation.request.step_minutes} />
    </>}
    <ul className="muted small-list">{evaluation.warnings.map((message: string): JSX.Element => <li key={message}>{message}</li>)}</ul>
    <details><summary>Intervals, time series, horizon and provenance</summary><ResultDetails result={evaluation} label={label} /></details>
  </div>;
}

/** The original CLPS sky diagram, timeline and time control, fed by the persisted evaluation. */
function EvaluationCharts({ chart, stepMinutes }: { chart: EvaluationChart; stepMinutes: number }): JSX.Element {
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const width: number = Math.max(300, useElementWidth(host, 420));
  const [index, setIndex] = useState<number>(0);
  const [hover, setHover] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_SPEED);
  const [playing, setPlaying] = useState<boolean>(false);
  const position: RefObject<number> = useRef<number>(0);
  const count: number = chart.times.length;
  useEffect((): (() => void) | undefined => {
    if (!playing) return undefined;
    position.current = index;
    const perTick: number = samplesPerTick(speed, stepMinutes);
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      position.current = Math.min(count - 1, position.current + perTick);
      setIndex(Math.floor(position.current + 1e-9));
      if (position.current >= count - 1) setPlaying(false);
    }, TICK_MS);
    return (): void => { clearInterval(timer); };
    // Restart only when playback settings change, not on every index update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, stepMinutes, count]);
  const shown: number = hover ?? Math.min(index, count - 1);
  const select: (i: number) => void = (i: number): void => { setPlaying(false); setIndex(clampIndex(i, count)); };
  return <div ref={host} className="inspector-charts">
    <TimeControl times={chart.times} index={shown} playing={playing} hoursPerSecond={speed} onIndex={(i: number): void => { setIndex(clampIndex(i, count)); }}
      onPlayingChange={setPlaying} onSpeed={setSpeed} />
    <HoverReadout times={chart.times} focused={chart.site} index={shown} previewing={hover !== null} />
    <SkyChart result={chart.site} width={width} index={shown} trailSamples={trailSamples(stepMinutes)} onHover={setHover} onSelect={select} />
    <Timeline times={chart.times} width={width} sites={[chart.site]} focused={chart.site} rangeEnd={chart.rangeEnd}
      index={shown} onHover={setHover} onSelect={select} />
  </div>;
}
