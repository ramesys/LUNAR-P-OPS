import type { ApiClient, ExperimentManifest, RecomputeReport, ScientificEvaluation } from "@clps/api-client";
import { useRef, useState, type JSX, type RefObject } from "react";
import { describeApiError } from "../lib/apiError.ts";
import { downloadBlob } from "../lib/download.ts";
import { SelectionGuard } from "../lib/selectionGuard.ts";

type Busy = "export" | "recompute" | null;

/**
 * Export the stored experiment manifest, or re-run its stored inputs and compare. Both act on the
 * active persisted evaluation only; the recomputation is never stored and never validates.
 */
export function ExperimentPanel({ apiClient, evaluation }: { apiClient: ApiClient; evaluation: ScientificEvaluation }): JSX.Element {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RecomputeReport | null>(null);
  const [exported, setExported] = useState<{ missing: string[]; commit: string } | null>(null);
  const guard: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const id: string = evaluation.evaluation_id;
  const path: { params: { path: { evaluation_id: string } } } = { params: { path: { evaluation_id: id } } };

  async function exportManifest(): Promise<void> {
    const token: number = guard.current.next();
    setBusy("export"); setError(null);
    try {
      const { data, error: failure, response } = await apiClient.GET("/api/evaluations/{evaluation_id}/manifest", path);
      if (!guard.current.isCurrent(token)) return;
      if (data === undefined) { setError(describeApiError(failure, response.status)); return; }
      const manifest: ExperimentManifest = data;
      downloadBlob(`lunar-ops-experiment_${id.slice(11, 23)}.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
      const software: Record<string, unknown> = manifest.software;
      const recorded: unknown = software["software_commit"];
      const commit: string = typeof recorded === "string" ? recorded : "not_recorded";
      setExported({ missing: manifest.not_recorded,
        commit: commit === "not_recorded" ? "software commit not recorded for this evaluation" :
          `software commit ${commit.slice(0, 12)} (${String(software["software_commit_state"])}, from ${String(software["software_commit_source"])})` });
    } catch { if (guard.current.isCurrent(token)) setError("Could not export the experiment manifest."); }
    finally { if (guard.current.isCurrent(token)) setBusy(null); }
  }

  async function recompute(): Promise<void> {
    const token: number = guard.current.next();
    setBusy("recompute"); setError(null); setReport(null);
    try {
      const { data, error: failure, response } = await apiClient.POST("/api/evaluations/{evaluation_id}/recompute", path);
      if (!guard.current.isCurrent(token)) return;
      if (data === undefined) { setError(describeApiError(failure, response.status)); return; }
      // Ignore a report that belongs to a previously inspected evaluation.
      if (data.evaluation_id === id) setReport(data);
    } catch { if (guard.current.isCurrent(token)) setError("Recompute request failed."); }
    finally { if (guard.current.isCurrent(token)) setBusy(null); }
  }

  return <section aria-label="Experiment reproducibility">
    <h3>Reproducibility</h3>
    <div className="param-row">
      <button type="button" disabled={busy !== null} onClick={(): void => { void exportManifest(); }}>Export experiment (JSON)</button>
      <button type="button" disabled={busy !== null} onClick={(): void => { void recompute(); }}>Recompute &amp; compare</button>
    </div>
    <p className="muted small">The export contains the stored candidate, parent, interval, DEM and SPICE kernel hashes, method, software versions, status and outputs. Recompute re-runs the same stored inputs with the current data and code, compares numerically, and stores nothing.</p>
    {busy === "recompute" && <p role="status">Recomputing the stored inputs…</p>}
    {error !== null && <p role="alert">{error}</p>}
    {exported !== null && <p role="status">Exported; {exported.commit}. {exported.missing.length === 0 ? "All provenance fields were recorded." : `Not recorded for this evaluation: ${exported.missing.join(", ")}.`}</p>}
    {report !== null && <div className={`controlled recompute-${report.outcome}`} aria-label="Recompute report">
      <p><strong>{report.outcome === "reproduced" ? "Reproduced" : report.outcome === "differs" ? "Outputs differ" : "Inputs changed"}</strong>
        {" "}· stored {report.stored_status} → recomputed {report.recomputed_status} · not stored · {report.validation_status.replaceAll("_", " ")}</p>
      <ul className="small-list">
        {report.input_checks.map((check): JSX.Element => <li key={check.name}>{check.match ? "✓" : "✗"} {check.name}{check.match ? "" : `: stored ${check.stored} · now ${check.current}`}</li>)}
        {Object.entries(report.differences).map(([key, value]): JSX.Element => <li key={key}>{key}: {value === null ? "not comparable" : String(value)}</li>)}
        <li>Tolerances: {Object.entries(report.tolerances).map(([key, value]): string => `${key} ${String(value)}`).join(" · ")}</li>
      </ul>
      {report.recomputed_errors.map((message: string): JSX.Element => <p key={message} role="alert">{message}</p>)}
      <p className="muted small">{report.notes.join(" ")}</p>
    </div>}
  </section>;
}
