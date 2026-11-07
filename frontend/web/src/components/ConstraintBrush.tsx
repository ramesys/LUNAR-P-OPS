import type { ApiClient, BrushDefinition, BrushExecution, BrushPreview, BrushResult, Candidate } from "@clps/api-client";
import { useEffect, useRef, useState, type ChangeEvent, type JSX, type RefObject } from "react";
import { describeApiError } from "../lib/apiError.ts";
import type { BrushOverlay, BrushVerdict, RegionOverlay } from "../lib/brushTypes.ts";
import { downloadBlob } from "../lib/download.ts";
import { useExploration, useExplorationStore, type BrushParams, type BrushRegion, type ExplorationStore, type InspectedSample, type RegionPatch } from "../lib/explorationStore.ts";
import type { LocalPoint } from "../lib/roiFrame.ts";

interface Props {
  apiClient: ApiClient;
  defaultTimeUtc: string;
  onCandidatesCreated: (candidates: Candidate[]) => void;
  onInspect: (candidate: Candidate, evaluationId?: string) => void;
  renderTerrain: (brush: BrushOverlay) => JSX.Element;
}

type Panel = "none" | "params" | "run" | "results";
type Busy = { kind: "preview" | "execute"; regionId: string } | null;
type Pending = { kind: "delete" | "clear"; regionId: string } | null;

export function defaultParams(startUtc: string): BrushParams {
  return { spacing_m: 100, max_points: 16, observer_height_m: 3, start_utc: startUtc, duration_hours: 168, step_minutes: 60,
    min_sun_pct: 0, min_earth_pct: 0, min_both_pct: 0, max_darkness_hours: "", max_earth_gap_hours: "", retention: "all" };
}

export function definitionOf(region: BrushRegion): BrushDefinition {
  const p: BrushParams = region.params;
  return { polygon: region.vertices, spacing_m: p.spacing_m, max_points: p.max_points, observer_height_m: p.observer_height_m,
    start_utc: p.start_utc, duration_hours: p.duration_hours, step_minutes: p.step_minutes, retention: p.retention,
    constraints: { min_sun_fraction: p.min_sun_pct / 100, min_earth_fraction: p.min_earth_pct / 100, min_simultaneous_fraction: p.min_both_pct / 100,
      max_darkness_hours: p.max_darkness_hours === "" ? null : Number(p.max_darkness_hours),
      max_earth_gap_hours: p.max_earth_gap_hours === "" ? null : Number(p.max_earth_gap_hours) } };
}

function verdicts(region: BrushRegion): BrushVerdict[] {
  const preview: BrushPreview | null = region.preview ?? region.execution?.preview ?? null;
  return preview?.samples.map((point, index): BrushVerdict => region.execution?.results[index]?.verdict ??
    (point.status === "READY" ? "NOT_EVALUATED" : "UNAVAILABLE")) ?? [];
}

function regionName(region: BrushRegion): string { return `Region ${region.number.toString()}`; }

function newRegionId(): string { return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

/**
 * Constraint Brush dock: several drawn regions, each with its own parameters, read-only preview
 * and confirmed execution. Region state lives in the shared exploration store; only a confirmed
 * execution writes candidates and evaluations, and deleting a region never deletes them.
 */
export function ConstraintBrush({ apiClient, defaultTimeUtc, onCandidatesCreated, onInspect, renderTerrain }: Props): JSX.Element {
  const store: ExplorationStore = useExplorationStore();
  const regions: BrushRegion[] = useExploration((state): BrushRegion[] => state.regions);
  const activeId: string | null = useExploration((state): string | null => state.activeRegionId);
  const mode: BrushOverlay["mode"] = useExploration((state): BrushOverlay["mode"] => state.brushMode);
  const inspected: InspectedSample | null = useExploration((state): InspectedSample | null => state.inspectedSample);
  const docked: boolean = useExploration((state): boolean => state.context === "candidate");
  const active: BrushRegion | null = regions.find((r: BrushRegion): boolean => r.id === activeId) ?? null;
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [pending, setPending] = useState<Pending>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const dock: RefObject<HTMLElement | null> = useRef<HTMLElement | null>(null);
  const locked: boolean = busy !== null;

  // The Timeline dock sits directly above this dock: publish this dock's height for its offset.
  useEffect((): (() => void) => {
    const element: HTMLElement | null = dock.current;
    const root: HTMLElement = document.documentElement;
    const publish: () => void = (): void => {
      root.style.setProperty("--brush-dock-h", docked && element !== null ? `${Math.ceil(element.getBoundingClientRect().height).toString()}px` : "0px");
    };
    publish();
    const observer: ResizeObserver | null = typeof ResizeObserver === "undefined" || element === null ? null : new ResizeObserver(publish);
    if (element !== null) observer?.observe(element);
    return (): void => { observer?.disconnect(); root.style.setProperty("--brush-dock-h", "0px"); };
  }, [docked]);

  function edit(regionId: string, patch: RegionPatch): void {
    setConfirmed(false); setError(null); setNotice(null);
    store.dispatch({ type: "region-edit", regionId, patch });
  }
  function createRegion(): void {
    setError(null); setNotice(null); setConfirmed(false); setPending(null); setPanel("none");
    store.dispatch({ type: "region-create", id: newRegionId(), params: active?.params ?? defaultParams(defaultTimeUtc) });
  }
  function selectRegion(regionId: string): void {
    setConfirmed(false); setPending(null); setError(null); setNotice(null);
    store.dispatch({ type: "region-select", regionId });
  }
  function confirmPending(): void {
    if (pending === null) return;
    if (pending.kind === "delete") store.dispatch({ type: "region-delete", regionId: pending.regionId });
    else { edit(pending.regionId, { vertices: [], closed: false }); store.dispatch({ type: "brush-mode", mode: "draw" }); }
    setPending(null); setPanel("none");
  }
  async function previewRegion(region: BrushRegion): Promise<void> {
    const { id, revision } = region;
    setBusy({ kind: "preview", regionId: id }); setError(null); setNotice(null); setConfirmed(false);
    try {
      const { data, error: failure, response } = await apiClient.POST("/api/rois/{roi_id}/brush/preview", {
        params: { path: { roi_id: "shackleton-rim-b" } }, body: definitionOf(region),
      });
      if (data === undefined) { store.dispatch({ type: "region-preview", regionId: id, revision, preview: null }); setError(describeApiError(failure, response.status)); return; }
      store.dispatch({ type: "region-preview", regionId: id, revision, preview: data });
      store.dispatch({ type: "brush-mode", mode: "off" });
      if (store.getState().regions.find((r: BrushRegion): boolean => r.id === id)?.preview !== data) setNotice("The region changed while previewing; preview it again.");
      else setPanel("run");
    } catch { setError("Unable to preview the region. Check the connection and parameters."); }
    finally { setBusy(null); }
  }
  async function executeRegion(region: BrushRegion): Promise<void> {
    const preview: BrushPreview | null = region.preview;
    if (preview === null || !confirmed || locked) return;
    const { id, revision } = region;
    setBusy({ kind: "execute", regionId: id }); setError(null); setNotice(null);
    try {
      const { data, error: failure, response } = await apiClient.POST("/api/rois/{roi_id}/brush/execute", {
        params: { path: { roi_id: "shackleton-rim-b" } },
        body: { definition: preview.definition, preview_token: preview.preview_token, confirmed: true },
      });
      setConfirmed(false);
      if (data === undefined) {
        store.dispatch({ type: "region-preview", regionId: id, revision, preview: null });
        setError(`${describeApiError(failure, response.status)} Preview again before retrying.`); return;
      }
      store.dispatch({ type: "region-execution", regionId: id, revision, execution: data });
      onCandidatesCreated(data.results.flatMap((item: BrushResult): Candidate[] => item.candidate === null || item.candidate === undefined ? [] : [item.candidate]));
      if (store.getState().regions.find((r: BrushRegion): boolean => r.id === id)?.execution !== data) {
        setNotice("The region was changed or deleted during evaluation. Its persisted candidates remain in the ROI list.");
      } else setPanel("results");
    } catch {
      store.dispatch({ type: "region-preview", regionId: id, revision, preview: null });
      setConfirmed(false);
      setError("Execution interrupted. Completed records remain saved; preview again to update counts before retrying.");
    } finally { setBusy(null); }
  }
  function inspect(regionId: string, index: number): void {
    store.dispatch({ type: "region-inspect", sample: { regionId, index } });
    setPanel("results");
    const item: BrushResult | undefined = store.getState().regions.find((r: BrushRegion): boolean => r.id === regionId)?.execution?.results[index];
    if (item?.candidate !== null && item?.candidate !== undefined && item.persisted) onInspect(item.candidate, item.evaluation?.evaluation_id);
  }

  const overlays: RegionOverlay[] = regions.map((region: BrushRegion): RegionOverlay => {
    const preview: BrushPreview | null = region.preview ?? region.execution?.preview ?? null;
    const flags: BrushVerdict[] = verdicts(region);
    return { id: region.id, label: `R${region.number.toString()}`, vertices: region.vertices, closed: region.closed, active: region.id === activeId,
      samples: preview?.samples.map((point, index): RegionOverlay["samples"][number] => ({ east_m: point.east_m, north_m: point.north_m, index,
        verdict: flags[index] ?? "NOT_EVALUATED", selected: inspected?.regionId === region.id && inspected.index === index })) ?? [] };
  });
  const overlay: BrushOverlay = { mode: active === null ? "off" : mode, regions: overlays, busy: busy?.kind === "execute",
    onAdd: (point: LocalPoint): void => { if (!locked && mode === "draw" && active !== null && !active.closed) edit(active.id, { vertices: [...active.vertices, point] }); },
    onMove: (index: number, point: LocalPoint): void => { if (!locked && mode === "edit" && active !== null) edit(active.id, { vertices: active.vertices.map((v, i): LocalPoint => i === index ? point : v) }); },
    onSelectSample: inspect,
  };
  const preview: BrushPreview | null = active?.preview ?? null;
  const execution: BrushExecution | null = active?.execution ?? null;
  const outcome: BrushResult | undefined = inspected?.regionId === activeId ? execution?.results[inspected.index] : undefined;
  const count: (v: BrushVerdict) => number = (v: BrushVerdict): number => execution?.results.filter((r): boolean => r.verdict === v).length ?? 0;
  const vertexCount: number = active?.vertices.length ?? 0;
  const status: string = busy?.kind === "execute" ? "Executing" : busy?.kind === "preview" ? "Previewing" : active === null ? "No region"
    : mode === "draw" ? "Drawing" : mode === "edit" ? "Editing" : execution !== null ? "Evaluated" : preview !== null ? "Previewed" : active.closed ? "Region defined" : "Open region";
  const hint: string = active === null ? "Create a region, then click the terrain to add vertices." : mode === "draw" ? "Click terrain to add vertices, then finish."
    : mode === "edit" ? "Drag a vertex on the terrain; remove one in Parameters if needed." : "Coordinates use ROI local east/north projected metres.";
  const p: BrushParams | null = active?.params ?? null;
  const pendingRegion: BrushRegion | undefined = pending === null ? undefined : regions.find((r: BrushRegion): boolean => r.id === pending.regionId);
  const pendingName: string = pendingRegion === undefined ? "this region" : regionName(pendingRegion);
  function field(key: keyof BrushParams, value: BrushParams[keyof BrushParams]): void {
    if (active !== null) edit(active.id, { params: { ...active.params, [key]: value } });
  }
  function numberInput(labelText: string, key: "spacing_m" | "max_points" | "observer_height_m" | "duration_hours" | "step_minutes" | "min_sun_pct" | "min_earth_pct" | "min_both_pct", min: string, max: string): JSX.Element {
    return <label>{labelText}<input type="number" min={min} max={max} value={p?.[key] ?? 0} disabled={locked || active === null}
      onChange={(e: ChangeEvent<HTMLInputElement>): void => { field(key, Number(e.target.value)); }} /></label>;
  }

  return <>
    {renderTerrain(overlay)}
    <section id="constraint-brush" ref={dock} className="brush-dock" data-active={docked} aria-label="Constraint Brush">
      <div className="brush-dock-bar">
        <span className="dock-title"><strong>◩ REGION BRUSH</strong><a href="#candidate-context" className="dock-link">Shackleton Rim B terrain ↑</a></span>
        <div className="region-chips" role="group" aria-label="Regions">
          {regions.map((region: BrushRegion): JSX.Element => <button type="button" key={region.id} aria-pressed={region.id === activeId} disabled={locked}
            onClick={(): void => { selectRegion(region.id); }}>{regionName(region)}<span className="chip-meta"> · {region.vertices.length.toString()} vtx{region.execution !== null ? ` · ${region.execution.results.filter((r): boolean => r.verdict === "PASS").length.toString()}/${region.execution.results.length.toString()} pass` : region.preview !== null ? ` · ${region.preview.samples.length.toString()} pts` : ""}</span></button>)}
          <button type="button" className="new-region" disabled={locked} onClick={createRegion}>＋ New region</button>
        </div>
        <div className="brush-actions" role="toolbar" aria-label="Brush drawing controls">
          <button type="button" disabled={locked || active === null || vertexCount < 3 || active.closed} onClick={(): void => { if (active !== null) { edit(active.id, { closed: true }); store.dispatch({ type: "brush-mode", mode: "off" }); setPanel("params"); } }}>Finish region</button>
          <button type="button" disabled={locked || active?.closed !== true} aria-pressed={mode === "edit"} onClick={(): void => { store.dispatch({ type: "brush-mode", mode: mode === "edit" ? "off" : "edit" }); }}>Edit vertices</button>
          <button type="button" disabled={locked || vertexCount === 0} onClick={(): void => { if (active !== null) { edit(active.id, { vertices: active.vertices.slice(0, -1), closed: false }); store.dispatch({ type: "brush-mode", mode: "draw" }); } }}>Undo vertex</button>
          <button type="button" disabled={locked || vertexCount === 0} onClick={(): void => { if (active !== null) setPending({ kind: "clear", regionId: active.id }); }}>Clear vertices</button>
          <button type="button" disabled={locked || active === null} onClick={(): void => { if (active !== null) setPending({ kind: "delete", regionId: active.id }); }}>Delete region</button>
        </div>
        <div className="brush-actions" role="toolbar" aria-label="Region experiment">
          <button type="button" aria-pressed={panel === "params"} disabled={active === null} onClick={(): void => { setPanel(panel === "params" ? "none" : "params"); }}>Parameters</button>
          <button type="button" disabled={locked || active?.closed !== true} onClick={(): void => { if (active !== null) void previewRegion(active); }}>Preview locations</button>
          <button type="button" aria-pressed={panel === "run"} disabled={preview === null && execution === null} onClick={(): void => { setPanel(panel === "run" ? "none" : "run"); }}>Run</button>
          <button type="button" aria-pressed={panel === "results"} disabled={execution === null} onClick={(): void => { setPanel(panel === "results" ? "none" : "results"); }}>Results</button>
        </div>
        <span className="chip brush-state">{status}</span>
        <span className="small vertex-count">{vertexCount.toString()} vertices · {hint}</span>
      </div>
      {pending !== null && <div className="brush-confirm" role="alertdialog" aria-label={pending.kind === "delete" ? "Confirm region deletion" : "Confirm clearing vertices"}>
        <p>{pending.kind === "delete"
          ? `Delete ${pendingName} and its preview and results view? Persisted candidates and evaluations are kept in the database.`
          : "Clear all vertices of this region? Its preview and results view are discarded; persisted candidates and evaluations are kept."}</p>
        <button type="button" className="danger" onClick={confirmPending}>{pending.kind === "delete" ? "Delete region" : "Clear vertices"}</button>{" "}
        <button type="button" onClick={(): void => { setPending(null); }}>Cancel</button>
      </div>}
      {busy !== null && <p role="status" className="small">{busy.kind === "execute" ? "Processing… terrain horizons and SPICE may take time. Keep this page open; terrain clicks do not create candidates meanwhile." : "Previewing locations (read-only)…"}</p>}
      {error !== null && <p role="alert">{error}</p>}
      {notice !== null && <p role="status" className="small">{notice}</p>}
      {panel !== "none" && active !== null && <div className="brush-dock-panel">
        {panel === "params" && p !== null && <div>
          <div className="brush-fields">
            {numberInput("Grid spacing (m)", "spacing_m", "20", "4000")}
            {numberInput("Maximum locations", "max_points", "1", "64")}
            {numberInput("Observer height (m)", "observer_height_m", "0", "100")}
            <label>UTC start<input type="text" value={p.start_utc} disabled={locked} onChange={(e: ChangeEvent<HTMLInputElement>): void => { field("start_utc", e.target.value); }} /></label>
            {numberInput("Duration (h)", "duration_hours", "0.01", "168")}
            {numberInput("Step (min)", "step_minutes", "1", "360")}
            {numberInput("Minimum Sun (%)", "min_sun_pct", "0", "100")}
            {numberInput("Minimum Earth (%)", "min_earth_pct", "0", "100")}
            {numberInput("Minimum simultaneous (%)", "min_both_pct", "0", "100")}
            <label>Max darkness (h, optional)<input type="number" min="0" max="168" value={p.max_darkness_hours} disabled={locked} onChange={(e: ChangeEvent<HTMLInputElement>): void => { field("max_darkness_hours", e.target.value); }} /></label>
            <label>Max Earth gap (h, optional)<input type="number" min="0" max="168" value={p.max_earth_gap_hours} disabled={locked} onChange={(e: ChangeEvent<HTMLInputElement>): void => { field("max_earth_gap_hours", e.target.value); }} /></label>
            <label>Persist results<select value={p.retention} disabled={locked} onChange={(e: ChangeEvent<HTMLSelectElement>): void => { field("retention", e.target.value === "passing" ? "passing" : "all"); }}><option value="all">All valid locations (default)</option><option value="passing">Passing locations only</option></select></label>
          </div>
          <p className="muted small">Grid aligned to ROI origin; boundary tolerance 0.0000001 m. Maximum 64 locations and 8,192 location-time samples. Fractions count stored samples; gaps are sampled estimates. Editing a region discards its preview and results view, never persisted records.</p>
          {mode === "edit" && <div className="brush-vertices">{active.vertices.map((point, index): JSX.Element => <button type="button" key={index} disabled={locked}
            onClick={(): void => { edit(active.id, { vertices: active.vertices.filter((_, i): boolean => i !== index), closed: active.vertices.length > 3 }); if (active.vertices.length <= 3) store.dispatch({ type: "brush-mode", mode: "draw" }); }}>
            Remove vertex {index + 1} ({point.east_m.toFixed(0)}, {point.north_m.toFixed(0)})</button>)}</div>}
        </div>}
        {panel === "run" && <RunPanel preview={preview ?? execution?.preview ?? null} retention={p?.retention ?? "all"}
          confirmed={confirmed} locked={locked} evaluated={execution !== null} onConfirm={setConfirmed} onExecute={(): void => { void executeRegion(active); }} />}
        {panel === "results" && execution !== null && <div className="brush-results">
          <div className="brush-results-head"><h4>Experiment results · {regionName(active)}</h4>
          <span>{execution.results.length} requested · {execution.results.filter((r): boolean => r.persisted).length} persisted candidates · {count("PASS") + count("FAIL")} scientifically evaluated · {count("PASS")} pass · {count("FAIL")} fail · {count("UNAVAILABLE")} unavailable · {count("ERROR")} error</span>
          <button type="button" onClick={(): void => { downloadBlob(`lunar-ops-brush-${regionName(active).toLowerCase().replace(" ", "-")}.json`, new Blob([JSON.stringify({ region: { id: active.id, name: regionName(active) }, ...execution }, null, 2)], { type: "application/json" })); }}>Export experiment JSON</button></div>
          <p className="muted small">Geometric visibility, not power or communications performance; not independently validated. To retry, preview again. This results view lasts for the browser session; export it to keep it.</p>
          <ol aria-label="Brush results">{execution.results.map((item, index): JSX.Element => <li key={`${item.sample.east_m.toString()}:${item.sample.north_m.toString()}`}><button type="button" onClick={(): void => { inspect(active.id, index); }} aria-pressed={inspected?.regionId === active.id && inspected.index === index}>
            {item.verdict} · {item.sample.east_m.toFixed(0)} m E, {item.sample.north_m.toFixed(0)} m N {item.persisted ? "· saved" : "· not saved"}</button></li>)}</ol>
          {outcome !== undefined && <ResultDetail outcome={outcome} />}
        </div>}
      </div>}
    </section>
  </>;
}

function RunPanel({ preview, retention, confirmed, locked, evaluated, onConfirm, onExecute }: { preview: BrushPreview | null; retention: "all" | "passing";
  confirmed: boolean; locked: boolean; evaluated: boolean; onConfirm: (value: boolean) => void; onExecute: () => void }): JSX.Element | null {
  if (preview === null) return null;
  return <div className="brush-preview" role="status"><strong>{preview.samples.length} locations · {preview.ready_count} DEM-ready</strong> · {preview.temporal_samples_per_point} times per location · {preview.estimated_total_samples} location-time samples
    <p>{retention === "all" ? `At preview: ${preview.new_count.toString()} new C0 records and ${preview.existing_count.toString()} existing C0 records to reuse.` : `At preview: at most ${preview.new_count.toString()} new C0 records; up to ${preview.existing_count.toString()} existing C0 records may be reused if they pass.`} Counts may change if another session creates a matching candidate. An invalid DEM point is reported and skipped.</p>
    <details><summary>Inspect all preview locations</summary><ol>{preview.samples.map((point): JSX.Element =>
      <li key={`${point.east_m.toString()}:${point.north_m.toString()}`}>{point.status} · {point.east_m.toFixed(0)} m E, {point.north_m.toFixed(0)} m N · {point.latitude_deg?.toFixed(6) ?? "—"}°, {point.longitude_deg?.toFixed(6) ?? "—"}°E · DEM {point.elevation_m?.toFixed(1) ?? "unavailable"} m · {point.already_persisted ? "existing C0" : "not saved"} {point.error ?? ""}</li>)}</ol></details>
    <label><input type="checkbox" checked={confirmed} disabled={locked || evaluated} onChange={(e: ChangeEvent<HTMLInputElement>): void => { onConfirm(e.target.checked); }} /> I approve evaluating and persisting this preview.</label>{" "}
    <button type="button" className="primary" disabled={locked || !confirmed || preview.ready_count === 0 || evaluated} onClick={onExecute}>Evaluate region &amp; create candidates</button>
    <p className="brush-legend small">● <span className="brush-proposed">Proposed</span> · <span className="brush-pass">● Pass</span> · <span className="brush-fail">● Fail</span> · <span className="brush-unavailable">● Unavailable</span> · <span className="brush-error">● Error</span></p>
  </div>;
}

function ResultDetail({ outcome }: { outcome: BrushResult }): JSX.Element {
  return <div className="brush-result-detail"><strong>{outcome.verdict}</strong> · {outcome.evaluation?.status ?? outcome.sample.status}
    <p>Position {outcome.sample.latitude_deg?.toFixed(6) ?? "—"}°, {outcome.sample.longitude_deg?.toFixed(6) ?? "—"}°E · elevation {outcome.sample.elevation_m?.toFixed(1) ?? "—"} m · observer {outcome.candidate?.observer_height_m ?? outcome.evaluation?.candidate.observer_height_m ?? "—"} m</p>
    {outcome.metrics !== null && outcome.metrics !== undefined && <p>Sun {(outcome.metrics.sun_fraction * 100).toFixed(1)}% · Earth {(outcome.metrics.earth_fraction * 100).toFixed(1)}% · both {(outcome.metrics.simultaneous_fraction * 100).toFixed(1)}% · longest darkness {outcome.metrics.longest_darkness_hours.toFixed(1)} h · Earth gap {outcome.metrics.longest_earth_gap_hours.toFixed(1)} h</p>}
    <p className="mono-wrap">Candidate {outcome.candidate?.candidate_id ?? "not persisted"}<br />Evaluation {outcome.evaluation?.evaluation_id ?? "not available"}</p>
    {outcome.evaluation !== null && outcome.evaluation !== undefined && <details><summary>Intervals and provenance</summary>
      <p className="muted small">Intervals are discrete sampled estimates. Missing results are never replaced by a flat horizon.</p>
      <pre className="mono-wrap">{JSON.stringify({ intervals: outcome.evaluation.intervals, provenance: outcome.evaluation.provenance,
        warnings: outcome.evaluation.warnings }, null, 2)}</pre></details>}
    {outcome.errors.map((message: string): JSX.Element => <p key={message} role="alert">{message}</p>)}
    {outcome.persisted && (outcome.evaluation === null || outcome.evaluation === undefined) && <p className="muted small">No evaluation was saved for this run. The graph may show another saved evaluation for this C0.</p>}
    {(outcome.candidate === null || outcome.candidate === undefined) && <p className="muted small">{outcome.sample.already_persisted ? "An existing C0 is retained, but this evaluation was not saved under the selected policy." : "This point was not persisted under the selected policy and cannot be opened in the Candidate graph."}</p>}
  </div>;
}
