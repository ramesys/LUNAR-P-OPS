import type { ApiClient, Candidate, RegionalTerrain, RoiTerrain, ScientificEvaluation } from "@clps/api-client";

type Dataset = RoiTerrain["datasets"][number];
type Coverage = RoiTerrain["coverage"];
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type LazyExoticComponent,
  type RefObject,
} from "react";
import { ConstraintBrush } from "./ConstraintBrush.tsx";
import { describeApiError } from "../lib/apiError.ts";
import type { LocalPoint } from "../lib/roiFrame.ts";
import { SelectionGuard } from "../lib/selectionGuard.ts";
import { nearestSample, useExploration, type Draft } from "../lib/explorationStore.ts";
import type { RoiTerrain3DProps } from "./RoiTerrain3D.tsx";

const RoiTerrain3D: LazyExoticComponent<ComponentType<RoiTerrain3DProps>> = lazy(
  async (): Promise<{ default: ComponentType<RoiTerrain3DProps> }> => ({
    default: (await import("./RoiTerrain3D.tsx")).RoiTerrain3D,
  }),
);

export const ROI_ID: string = "shackleton-rim-b";

type TerrainState = { kind: "loading" } | { kind: "ready"; terrain: RoiTerrain } | { kind: "error"; message: string };

interface Props {
  apiClient: ApiClient;
  selectedCandidateId: string | null;
  onCandidateSelected: (candidate: Candidate, evaluationId?: string) => void;
  defaultTimeUtc: string;
  defaultObserverHeightM: number;
}

function deg(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(5)}°${value < 0 ? negative : positive}`;
}

export function candidateLabel(candidate: Candidate): string {
  return `${deg(candidate.latitude_deg, "N", "S")} ${candidate.longitude_deg.toFixed(5)}°E · ${candidate.terrain_elevation_m.toFixed(1)} m`;
}

/** The Shackleton Rim B ROI: one terrain scene holding every persisted candidate of the ROI. */
export function ShackletonWorkspace({ apiClient, selectedCandidateId, onCandidateSelected, defaultTimeUtc,
  defaultObserverHeightM }: Props): JSX.Element {
  const [terrain, setTerrain] = useState<TerrainState>({ kind: "loading" });
  const [regional, setRegional] = useState<RegionalTerrain | null>(null);
  const [regionalError, setRegionalError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [height, setHeight] = useState<number>(defaultObserverHeightM);
  const [time, setTime] = useState<string>(defaultTimeUtc);
  const [lastPick, setLastPick] = useState<LocalPoint | null>(null);
  const guard: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  // Shared space–time state: the active stored evaluation and the inspected sample.
  const evaluation: ScientificEvaluation | null = useExploration((state): ScientificEvaluation | null => state.evaluation);
  const cursorUtc: string | null = useExploration((state): string | null => state.cursorUtc);
  const draft: Draft | null = useExploration((state): Draft | null => state.draft);
  const inRoi: ScientificEvaluation | null = evaluation?.candidate.terrain_window_id === ROI_ID ? evaluation : null;
  const temporal: RoiTerrain3DProps["temporal"] = inRoi === null ? null : { evaluation: inRoi, index: Math.max(0, nearestSample(inRoi, cursorUtc)) };
  const settings: RefObject<{ height: number; time: string }> = useRef({ height, time });
  useEffect((): void => { settings.current = { height, time }; }, [height, time]);

  useEffect((): (() => void) => {
    let active: boolean = true;
    const picks: SelectionGuard = guard.current;
    void apiClient.GET("/api/rois/{roi_id}/terrain", { params: { path: { roi_id: ROI_ID } } })
      .then(({ data, error: failure, response }): void => {
        if (!active) return;
        setTerrain(data === undefined ? { kind: "error", message: describeApiError(failure, response.status) } : { kind: "ready", terrain: data });
      })
      .catch((caught: unknown): void => {
        if (active) setTerrain({ kind: "error", message: caught instanceof Error ? caught.message : String(caught) });
      });
    void apiClient.GET("/api/rois/{roi_id}/regional-terrain", { params: { path: { roi_id: ROI_ID } } })
      .then(({ data }): void => {
        if (!active) return;
        if (data !== undefined && data.size > 1 && data.elevations_m.length === data.size * data.size) setRegional(data);
        else setRegionalError("Regional terrain unavailable; showing the 4 km study area.");
      }).catch((): void => { if (active) setRegionalError("Regional terrain unavailable; showing the 4 km study area."); });
    void apiClient.GET("/api/rois/{roi_id}/candidates", { params: { path: { roi_id: ROI_ID } } })
      .then(({ data }): void => {
        if (!active || data === undefined) return;
        // Merge: candidates created while the list was loading must stay.
        setCandidates((current: Candidate[]): Candidate[] => [...data, ...current.filter((c: Candidate): boolean =>
          !data.some((d: Candidate): boolean => d.candidate_id === c.candidate_id))]);
      })
      .catch((): void => { if (active) setError("Could not restore the saved ROI candidates."); });
    return (): void => { active = false; picks.invalidate(); };
  }, [apiClient]);

  const onPick: (point: LocalPoint) => void = useCallback((point: LocalPoint): void => {
    const sequence: number = guard.current.next();
    const { height: observer, time: selected } = settings.current;
    setLastPick(point);
    setError(null);
    if (!Number.isFinite(observer) || observer < 0 || observer > 100 || !Number.isFinite(Date.parse(selected))) {
      setError("Enter an observer height of 0–100 m and a valid UTC time before selecting terrain.");
      return;
    }
    setBusy(true);
    void apiClient.POST("/api/rois/{roi_id}/candidates", {
      params: { path: { roi_id: ROI_ID } },
      body: { east_m: point.east_m, north_m: point.north_m, observer_height_m: observer, selected_time_utc: selected },
    }).then(({ data, error: failure, response }): void => {
      if (!guard.current.isCurrent(sequence)) return;
      setBusy(false);
      if (data === undefined) { setError(describeApiError(failure, response.status)); return; }
      setCandidates((current: Candidate[]): Candidate[] =>
        current.some((c: Candidate): boolean => c.candidate_id === data.candidate_id) ? current : [...current, data]);
      onCandidateSelected(data);
    }).catch((): void => {
      if (guard.current.isCurrent(sequence)) { setBusy(false); setError("Could not create a candidate at this point."); }
    });
  }, [apiClient, onCandidateSelected]);

  const onSelectMarker: (id: string) => void = useCallback((id: string): void => {
    const found: Candidate | undefined = candidates.find((c: Candidate): boolean => c.candidate_id === id);
    if (found !== undefined) onCandidateSelected(found);
  }, [candidates, onCandidateSelected]);

  return <section className="ws-terrain card" aria-label="Shackleton Rim B workspace">
    <div className="panel-heading"><div><span className="panel-eyebrow">01 / SPATIAL EXPLORER</span><h2>Terrain explorer · Shackleton Rim B</h2></div><span className="status-pill">● &nbsp;LOLA TERRAIN</span></div>
    {terrain.kind === "loading" && <p className="muted">Loading ROI terrain…</p>}
    {terrain.kind === "error" && <p role="alert">ROI terrain unavailable: {terrain.message}</p>}

    {terrain.kind === "ready" &&
      <ConstraintBrush apiClient={apiClient} defaultTimeUtc={defaultTimeUtc} onInspect={onCandidateSelected}
        onCandidatesCreated={(created: Candidate[]): void => { setCandidates((current: Candidate[]): Candidate[] =>
          [...current, ...created.filter((item: Candidate): boolean => !current.some((existing: Candidate): boolean => existing.candidate_id === item.candidate_id))]); }}
        renderTerrain={(brush): JSX.Element => <Suspense fallback={<p className="muted">Loading 3D view…</p>}>
          <RoiTerrain3D terrain={terrain.terrain} regional={regional} candidates={candidates} selectedId={selectedCandidateId}
            onPick={onPick} onSelectMarker={onSelectMarker} temporal={temporal} brush={brush} draftHeightM={inRoi === null ? null : draft?.observer_height_m ?? null} />
        </Suspense>} />}
    {regionalError !== null && <p role="status">{regionalError}</p>}
    <fieldset className="new-candidate">
      <legend>Settings for the next terrain click</legend>
      <label>Observer height (m) <input type="number" min="0" max="100" step="0.1" value={height}
        onChange={(event): void => { setHeight(Number(event.target.value)); }} /></label>{" "}
      <label>UTC time <input type="text" value={time} onChange={(event): void => { setTime(event.target.value); }} /></label>
    </fieldset>
    {terrain.kind === "ready" && <details className="terrain-metadata"><summary>Terrain data and coverage</summary><RoiSummary terrain={terrain.terrain} /></details>}
    {busy && <p>Sampling the LOLA raster at the selected point…</p>}
    {lastPick !== null && <p className="muted">Last terrain pick: {lastPick.east_m.toFixed(1)} m east, {lastPick.north_m.toFixed(1)} m north of the ROI centre (local projected metres).</p>}
    {error !== null && <p role="alert">{error}</p>}
    <h3>Saved candidates in this ROI ({candidates.length})</h3>
    {candidates.length === 0 ? <p>No candidates yet. Click the terrain to create one.</p> :
      <ol aria-label="ROI candidates" className="candidate-list">{candidates.map((c: Candidate): JSX.Element =>
        <li key={c.candidate_id}><button type="button" aria-pressed={c.candidate_id === selectedCandidateId}
          onClick={(): void => { onCandidateSelected(c); }}>{candidateLabel(c)}</button>{" "}
          <span className="muted">{c.candidate_id.slice(0, 18)}…</span></li>)}</ol>}
  </section>;
}

function RoiSummary({ terrain }: { terrain: RoiTerrain }): JSX.Element {
  const near: Dataset | undefined = terrain.datasets.find((d: Dataset): boolean => d.role === "near");
  const [latMin = 0, latMax = 0] = terrain.latitude_range_deg;
  const [lonMin = 0, lonMax = 0] = terrain.longitude_range_deg;
  const [low = 0, high = 0] = terrain.elevation_range_m;
  const coverage: Coverage = terrain.coverage;
  const covered: number = coverage.horizon_checks.filter((c): boolean => c.status === "covered").length;
  return <div className="roi-summary">
    <ul className="chips" aria-label="Terrain data summary">
      <li>{(terrain.roi.half_width_m * 2 / 1000).toFixed(0)} × {(terrain.roi.half_width_m * 2 / 1000).toFixed(0)} km around {deg(terrain.roi.center_latitude_deg, "N", "S")}, {terrain.roi.center_longitude_deg.toFixed(5)}°E</li>
      <li>{near?.dataset_id ?? "unknown DEM"} · {near?.resolution_m ?? "?"} m/pixel · {terrain.size}×{terrain.size} grid at {terrain.spacing_m} m</li>
      <li className={coverage.grid_status === "complete" ? "ok" : "warn"}>DEM coverage {coverage.grid_status} ({coverage.grid_missing_samples} missing)</li>
      <li className={covered === coverage.horizon_checks.length ? "ok" : "warn"}>Horizon rays covered at {covered}/{coverage.horizon_checks.length} check points</li>
      <li>Elevation {low.toFixed(0)} to {high.toFixed(0)} m</li>
    </ul>
    <p className="muted small">{terrain.roi.note} Centre from the <a href={terrain.roi.center_source_url}>{terrain.roi.center_source_name}</a>.</p>
    <details><summary>ROI georeference, datasets and limitations</summary>
      <p>Coordinates: {terrain.coordinate_reference}. Projection: {terrain.projection}.</p>
      <p>Extent: latitude {latMin.toFixed(5)}° to {latMax.toFixed(5)}°, east longitude {lonMin.toFixed(5)}° to {lonMax.toFixed(5)}°.
        Centre at ({terrain.center_projected_m.map((v: number): string => v.toFixed(2)).join(", ")}) m projected; scale factor {terrain.stereographic_scale_factor.toFixed(7)}.</p>
      <ul>{terrain.corners.map((c): JSX.Element => <li key={c.label}>{c.label}: {c.latitude_deg.toFixed(6)}°, {c.longitude_deg.toFixed(6)}°E</li>)}</ul>
      <ul>{terrain.datasets.map((d): JSX.Element => <li key={d.role}>{d.role}: <a href={d.source_url}>{d.dataset_id}</a>, {d.resolution_m} m,
        local window SHA-256 {d.local_window_sha256}; bounds {d.window_bounds_m.join(", ")} m; nodata: {d.nodata}</li>)}</ul>
      <ul>{coverage.horizon_checks.map((c): JSX.Element => <li key={c.label}>{c.label}: {c.status} — {c.detail}</li>)}</ul>
      <p>{coverage.note}</p>
      <ul>{terrain.limitations.map((text: string): JSX.Element => <li key={text}>{text}</li>)}</ul>
    </details>
  </div>;
}
