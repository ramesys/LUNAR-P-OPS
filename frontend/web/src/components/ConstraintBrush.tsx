import type { ApiClient, BrushDefinition, BrushExecution, BrushPreview, BrushResult, Candidate } from "@clps/api-client";
import { useState, type ChangeEvent, type JSX } from "react";
import { describeApiError } from "../lib/apiError.ts";
import type { BrushMode, BrushOverlay, BrushVerdict } from "../lib/brushTypes.ts";
import { downloadBlob } from "../lib/download.ts";
import type { LocalPoint } from "../lib/roiFrame.ts";

interface Props {
  apiClient: ApiClient;
  defaultTimeUtc: string;
  onCandidatesCreated: (candidates: Candidate[]) => void;
  onInspect: (candidate: Candidate, evaluationId?: string) => void;
  renderTerrain: (brush: BrushOverlay) => JSX.Element;
}

/** Transient experiment state remains mounted while the selected candidate and time change. */
export function ConstraintBrush({ apiClient, defaultTimeUtc, onCandidatesCreated, onInspect, renderTerrain }: Props): JSX.Element {
  const [mode, setMode] = useState<BrushMode>("off");
  const [vertices, setVertices] = useState<LocalPoint[]>([]);
  const [closed, setClosed] = useState<boolean>(false);
  const [spacing, setSpacing] = useState<number>(100);
  const [maxPoints, setMaxPoints] = useState<number>(16);
  const [height, setHeight] = useState<number>(3);
  const [start, setStart] = useState<string>(defaultTimeUtc);
  const [duration, setDuration] = useState<number>(168);
  const [step, setStep] = useState<number>(60);
  const [minSun, setMinSun] = useState<number>(0);
  const [minEarth, setMinEarth] = useState<number>(0);
  const [minBoth, setMinBoth] = useState<number>(0);
  const [maxDark, setMaxDark] = useState<string>("");
  const [maxEarth, setMaxEarth] = useState<string>("");
  const [retention, setRetention] = useState<"all" | "passing">("all");
  const [preview, setPreview] = useState<BrushPreview | null>(null);
  const [execution, setExecution] = useState<BrushExecution | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function invalidate(): void { setPreview(null); setExecution(null); setInspected(null); setConfirmed(false); setError(null); }
  function definition(): BrushDefinition {
    return { polygon: vertices, spacing_m: spacing, max_points: maxPoints, observer_height_m: height, start_utc: start,
      duration_hours: duration, step_minutes: step, retention,
      constraints: { min_sun_fraction: minSun / 100, min_earth_fraction: minEarth / 100,
        min_simultaneous_fraction: minBoth / 100, max_darkness_hours: maxDark === "" ? null : Number(maxDark),
        max_earth_gap_hours: maxEarth === "" ? null : Number(maxEarth) } };
  }
  async function previewRegion(): Promise<void> {
    setBusy(true); setError(null); setConfirmed(false);
    try {
      const { data, error: failure, response } = await apiClient.POST("/api/rois/{roi_id}/brush/preview", {
        params: { path: { roi_id: "shackleton-rim-b" } }, body: definition(),
      });
      if (data === undefined) { setPreview(null); setError(describeApiError(failure, response.status)); }
      else { setPreview(data); setExecution(null); setInspected(null); setMode("off"); }
    } catch { setError("Unable to preview the region. Check the connection and parameters."); }
    finally { setBusy(false); }
  }
  async function executeRegion(): Promise<void> {
    if (preview === null || !confirmed || busy) return;
    setBusy(true); setError(null);
    try {
      const { data, error: failure, response } = await apiClient.POST("/api/rois/{roi_id}/brush/execute", {
        params: { path: { roi_id: "shackleton-rim-b" } },
        body: { definition: preview.definition, preview_token: preview.preview_token, confirmed: true },
      });
      if (data === undefined) { setPreview(null); setConfirmed(false); setError(`${describeApiError(failure, response.status)} Preview again before retrying.`); return; }
      setExecution(data); setMode("off"); setConfirmed(false);
      onCandidatesCreated(data.results.flatMap((item: BrushResult): Candidate[] => item.candidate === null || item.candidate === undefined ? [] : [item.candidate]));
    } catch { setPreview(null); setConfirmed(false); setError("Execution interrupted. Completed records remain saved; preview again to update counts before retrying."); }
    finally { setBusy(false); }
  }
  function inspect(index: number): void {
    setInspected(index);
    const item: BrushResult | undefined = execution?.results[index];
    if (item?.candidate !== null && item?.candidate !== undefined && item.persisted) {
      onInspect(item.candidate, item.evaluation?.evaluation_id);
    }
  }
  const displayedPreview: BrushPreview | null = preview ?? execution?.preview ?? null;
  const samples: BrushOverlay["samples"] = displayedPreview?.samples.map((point, index): BrushOverlay["samples"][number] => ({
    east_m: point.east_m, north_m: point.north_m, index,
    verdict: execution?.results[index]?.verdict ?? (point.status === "READY" ? "NOT_EVALUATED" : "UNAVAILABLE"),
  })) ?? [];
  const overlay: BrushOverlay = { mode, vertices, closed, samples,
    onAdd: (point: LocalPoint): void => { if (!busy && mode === "draw") { invalidate(); setVertices((current): LocalPoint[] => [...current, point]); } },
    onMove: (index: number, point: LocalPoint): void => { if (!busy && mode === "edit") { invalidate(); setVertices((current): LocalPoint[] => current.map((v, i): LocalPoint => i === index ? point : v)); } },
    onSelect: inspect,
  };
  const outcome: BrushResult | undefined = inspected === null ? undefined : execution?.results[inspected];
  const count: (v: BrushVerdict) => number = (v: BrushVerdict): number => execution?.results.filter((r): boolean => r.verdict === v).length ?? 0;
  const ready: number = preview?.ready_count ?? 0;
  return <>
    {renderTerrain(overlay)}
    <section id="constraint-brush" className="brush-panel" aria-label="Constraint Brush">
      <div className="brush-heading"><div><span className="panel-eyebrow">REGION / SPATIAL EXPERIMENT</span><h3>Constraint Brush</h3></div><span className="chip">{busy ? "Executing" : mode === "draw" ? "Drawing" : mode === "edit" ? "Editing" : closed ? "Region defined" : "No region"}</span></div>
      <p className="muted small">Draw inside the outlined 4 × 4 km study area. Preview is read-only; only the confirmed execution creates records.</p>
      <div className="brush-actions" role="toolbar" aria-label="Brush drawing controls">
        <button type="button" disabled={busy} aria-pressed={mode === "draw"} onClick={(): void => { invalidate(); setVertices([]); setClosed(false); setMode("draw"); }}>Draw region</button>
        <button type="button" disabled={busy || vertices.length < 3 || closed} onClick={(): void => { setClosed(true); setMode("off"); }}>Finish region</button>
        <button type="button" disabled={busy || !closed} aria-pressed={mode === "edit"} onClick={(): void => { setMode(mode === "edit" ? "off" : "edit"); }}>Edit vertices</button>
        <button type="button" disabled={busy || vertices.length === 0} onClick={(): void => { invalidate(); setVertices((v): LocalPoint[] => v.slice(0, -1)); setClosed(false); setMode("draw"); }}>Undo vertex</button>
        <button type="button" disabled={busy || vertices.length === 0} onClick={(): void => { invalidate(); setVertices([]); setClosed(false); setMode("off"); }}>Clear region</button>
      </div>
      <p className="small">{vertices.length} vertices · {mode === "draw" ? "Click terrain to add vertices, then finish." : mode === "edit" ? "Drag a vertex on the terrain; remove one below if needed." : "Coordinates use ROI local east/north projected metres."}</p>
      {mode === "edit" && <div className="brush-vertices">{vertices.map((point, index): JSX.Element => <button type="button" key={index} disabled={busy}
        onClick={(): void => { invalidate(); setVertices((v): LocalPoint[] => v.filter((_, i): boolean => i !== index)); if (vertices.length <= 3) { setClosed(false); setMode("draw"); } }}>
        Remove vertex {index + 1} ({point.east_m.toFixed(0)}, {point.north_m.toFixed(0)})</button>)}</div>}
      <details open={vertices.length > 0}><summary>Sampling, time &amp; constraints</summary>
        <div className="brush-fields">
          <label>Grid spacing (m)<input type="number" min="20" max="4000" value={spacing} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setSpacing(Number(e.target.value)); }} /></label>
          <label>Maximum locations<input type="number" min="1" max="64" value={maxPoints} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMaxPoints(Number(e.target.value)); }} /></label>
          <label>Observer height (m)<input type="number" min="0" max="100" value={height} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setHeight(Number(e.target.value)); }} /></label>
          <label>UTC start<input type="text" value={start} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setStart(e.target.value); }} /></label>
          <label>Duration (h)<input type="number" min="0.01" max="168" value={duration} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setDuration(Number(e.target.value)); }} /></label>
          <label>Step (min)<input type="number" min="1" max="360" value={step} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setStep(Number(e.target.value)); }} /></label>
          <label>Minimum Sun (%)<input type="number" min="0" max="100" value={minSun} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMinSun(Number(e.target.value)); }} /></label>
          <label>Minimum Earth (%)<input type="number" min="0" max="100" value={minEarth} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMinEarth(Number(e.target.value)); }} /></label>
          <label>Minimum simultaneous (%)<input type="number" min="0" max="100" value={minBoth} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMinBoth(Number(e.target.value)); }} /></label>
          <label>Max darkness (h, optional)<input type="number" min="0" max="168" value={maxDark} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMaxDark(e.target.value); }} /></label>
          <label>Max Earth gap (h, optional)<input type="number" min="0" max="168" value={maxEarth} disabled={busy} onChange={(e: ChangeEvent<HTMLInputElement>): void => { invalidate(); setMaxEarth(e.target.value); }} /></label>
          <label>Persist results<select value={retention} disabled={busy} onChange={(e: ChangeEvent<HTMLSelectElement>): void => { invalidate(); setRetention(e.target.value === "passing" ? "passing" : "all"); }}><option value="all">All valid locations (default)</option><option value="passing">Passing locations only</option></select></label>
        </div>
        <p className="muted small">Grid aligned to ROI origin; boundary tolerance 0.0000001 m. Maximum 64 locations and 8,192 location-time samples. Fractions count stored samples; gaps are sampled estimates.</p>
      </details>
      <div className="brush-actions"><button type="button" disabled={busy || !closed} onClick={(): void => { void previewRegion(); }}>Preview locations</button></div>
      {preview !== null && <div className="brush-preview" role="status"><strong>{preview.samples.length} locations · {ready} DEM-ready</strong> · {preview.temporal_samples_per_point} times per location · {preview.estimated_total_samples} location-time samples
        <p>{retention === "all" ? `At preview: ${preview.new_count.toString()} new C0 records and ${preview.existing_count.toString()} existing C0 records to reuse.` : `At preview: at most ${preview.new_count.toString()} new C0 records; up to ${preview.existing_count.toString()} existing C0 records may be reused if they pass.`} Counts may change if another session creates a matching candidate. An invalid DEM point is reported and skipped.</p>
        <details><summary>Inspect all preview locations</summary><ol>{preview.samples.map((point): JSX.Element =>
          <li key={`${point.east_m.toString()}:${point.north_m.toString()}`}>{point.status} · {point.east_m.toFixed(0)} m E, {point.north_m.toFixed(0)} m N · {point.latitude_deg?.toFixed(6) ?? "—"}°, {point.longitude_deg?.toFixed(6) ?? "—"}°E · DEM {point.elevation_m?.toFixed(1) ?? "unavailable"} m · {point.already_persisted ? "existing C0" : "not saved"} {point.error ?? ""}</li>)}</ol></details>
        <label><input type="checkbox" checked={confirmed} disabled={busy || execution !== null} onChange={(e: ChangeEvent<HTMLInputElement>): void => { setConfirmed(e.target.checked); }} /> I approve evaluating and persisting this preview.</label>{" "}
        <button type="button" className="primary" disabled={busy || !confirmed || ready === 0 || execution !== null} onClick={(): void => { void executeRegion(); }}>Evaluate region &amp; create candidates</button>
      </div>}
      {busy && <p role="status">Processing… terrain horizons and SPICE may take time. Keep this page open.</p>}
      {error !== null && <p role="alert">{error}</p>}
      {preview !== null && <p className="brush-legend small">● <span className="brush-proposed">Proposed</span> · <span className="brush-pass">● Pass</span> · <span className="brush-fail">● Fail</span> · <span className="brush-unavailable">● Unavailable</span> · <span className="brush-error">● Error</span></p>}
      {execution !== null && <div className="brush-results">
        <h4>Experiment results</h4>
        <p className="muted small">To retry, preview again to update new and existing candidate counts.</p>
        <p>{execution.results.length} requested · {execution.results.filter((r): boolean => r.persisted).length} persisted candidates · {count("PASS") + count("FAIL")} scientifically evaluated · {count("PASS")} pass · {count("FAIL")} fail · {count("UNAVAILABLE")} unavailable · {count("ERROR")} error</p>
        <p className="muted small">Visibility is geometric, not electrical power or communications performance. Results are not independently validated.</p>
        <button type="button" onClick={(): void => { downloadBlob("lunar-ops-brush-experiment.json", new Blob([JSON.stringify(execution, null, 2)], { type: "application/json" })); }}>Export experiment JSON</button>
        <ol aria-label="Brush results">{execution.results.map((item, index): JSX.Element => <li key={`${item.sample.east_m.toString()}:${item.sample.north_m.toString()}`}><button type="button" onClick={(): void => { inspect(index); }} aria-pressed={inspected === index}>
          {item.verdict} · {item.sample.east_m.toFixed(0)} m E, {item.sample.north_m.toFixed(0)} m N {item.persisted ? "· saved" : "· not saved"}</button></li>)}</ol>
        {outcome !== undefined && <div className="brush-result-detail"><strong>{outcome.verdict}</strong> · {outcome.evaluation?.status ?? outcome.sample.status}
          <p>Position {outcome.sample.latitude_deg?.toFixed(6) ?? "—"}°, {outcome.sample.longitude_deg?.toFixed(6) ?? "—"}°E · elevation {outcome.sample.elevation_m?.toFixed(1) ?? "—"} m · observer {height} m</p>
          {outcome.metrics !== null && outcome.metrics !== undefined && <p>Sun {(outcome.metrics.sun_fraction * 100).toFixed(1)}% · Earth {(outcome.metrics.earth_fraction * 100).toFixed(1)}% · both {(outcome.metrics.simultaneous_fraction * 100).toFixed(1)}% · longest darkness {outcome.metrics.longest_darkness_hours.toFixed(1)} h · Earth gap {outcome.metrics.longest_earth_gap_hours.toFixed(1)} h</p>}
          <p className="mono-wrap">Candidate {outcome.candidate?.candidate_id ?? "not persisted"}<br />Evaluation {outcome.evaluation?.evaluation_id ?? "not available"}</p>
          {outcome.evaluation !== null && outcome.evaluation !== undefined && <details><summary>Intervals and provenance</summary>
            <p className="muted small">Intervals are discrete sampled estimates. Missing results are never replaced by a flat horizon.</p>
            <pre className="mono-wrap">{JSON.stringify({ intervals: outcome.evaluation.intervals, provenance: outcome.evaluation.provenance,
              warnings: outcome.evaluation.warnings }, null, 2)}</pre></details>}
          {outcome.errors.map((message: string): JSX.Element => <p key={message} role="alert">{message}</p>)}
          {outcome.persisted && (outcome.evaluation === null || outcome.evaluation === undefined) && <p className="muted small">No evaluation was saved for this run. The graph may show another saved evaluation for this C0.</p>}
          {(outcome.candidate === null || outcome.candidate === undefined) && <p className="muted small">{outcome.sample.already_persisted ? "An existing C0 is retained, but this evaluation was not saved under the selected policy." : "This point was not persisted under the selected policy and cannot be opened in the Candidate graph."}</p>}
        </div>}
      </div>}
    </section>
  </>;
}
