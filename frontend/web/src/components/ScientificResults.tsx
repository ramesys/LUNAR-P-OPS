import type { ScientificEvaluation } from "@clps/api-client";
import type { JSX } from "react";

type Key = "sun" | "earth" | "simultaneous";
const KEYS: Key[] = ["sun", "earth", "simultaneous"];
function hours(result: ScientificEvaluation, key: Key): number {
  return (result.intervals[key] ?? []).reduce((total: number, interval): number => total + interval.duration_seconds, 0) / 3600;
}

export function ResultDetails({ result, label }: { result: ScientificEvaluation; label: string }): JSX.Element {
  return <section aria-label={`${label} scientific result`}>
    <h4>{label}: {result.status}</h4>
    <p>Evaluation: {result.evaluation_id}</p>
    {result.errors.map((message: string): JSX.Element => <p role="alert" key={message}>{message}</p>)}
    {result.warnings.map((message: string): JSX.Element => <p key={message}>{message}</p>)}
    {(result.status === "COMPUTED_UNVERIFIED" || result.status === "VALIDATED") && <>
      <p>Window: {result.candidate.selected_time_utc}, {result.request.duration_hours} hours, {result.request.step_minutes} minute step.</p>
      <p>Visible duration: Sun {hours(result, "sun").toFixed(2)} h · Earth {hours(result, "earth").toFixed(2)} h · simultaneous {hours(result, "simultaneous").toFixed(2)} h</p>
      {KEYS.map((key: Key): JSX.Element => <div key={key}><strong>{key} intervals (UTC):</strong>
        {(result.intervals[key] ?? []).length === 0 ? " none" : (result.intervals[key] ?? []).map((interval): JSX.Element =>
          <p key={interval.start_utc}>{interval.start_utc} → {interval.end_utc}, {(interval.duration_seconds / 3600).toFixed(2)} h {interval.truncated ? "(range edge)" : ""}</p>)}</div>)}
      <details><summary>Time series: Sun, Earth and horizon</summary><table><thead><tr><th>UTC</th><th>Sun az/el/horizon °</th><th>Sun visible</th><th>Earth az/el/horizon °</th><th>Earth visible</th><th>Both</th></tr></thead><tbody>
        {result.samples.map((sample): JSX.Element => <tr key={sample.time_utc}><td>{sample.time_utc}</td>
          <td>{sample.sun_azimuth_deg.toFixed(2)} / {sample.sun_elevation_deg.toFixed(2)} / {sample.sun_horizon_deg.toFixed(2)}</td><td>{String(sample.sun_visible)}</td>
          <td>{sample.earth_azimuth_deg.toFixed(2)} / {sample.earth_elevation_deg.toFixed(2)} / {sample.earth_horizon_deg.toFixed(2)}</td><td>{String(sample.earth_visible)}</td><td>{String(sample.simultaneous_visible)}</td></tr>)}
      </tbody></table></details>
      <details><summary>Terrain horizon samples</summary><p>Azimuth ° : elevation °</p><p>{result.horizon_azimuth_deg.map((az: number, index: number): string => `${az.toFixed(1)}: ${result.horizon_elevation_deg[index]?.toFixed(3) ?? "unavailable"}`).join(" · ")}</p></details>
    </>}
    <details><summary>Validation inspector: sources and methods</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result.provenance, null, 2)}</pre></details>
  </section>;
}

export function ScientificResults({ c0, c1 }: { c0: ScientificEvaluation | null; c1: ScientificEvaluation | null }): JSX.Element {
  return <section aria-label="Scientific evaluation results">
    {c0 !== null && <ResultDetails label="C0" result={c0} />}
    {c1 !== null && <ResultDetails label="C1" result={c1} />}
    {c0 !== null && c1 !== null && <ResultComparison c0={c0} c1={c1} />}
  </section>;
}

export interface InputDifference { input: string; c0: string; c1: string }

/** Every scientific input that differs between two persisted evaluations. */
export function inputDifferences(c0: ScientificEvaluation, c1: ScientificEvaluation): InputDifference[] {
  const p0: Record<string, unknown> = c0.provenance;
  const p1: Record<string, unknown> = c1.provenance;
  const rows: [string, unknown, unknown][] = [
    ["location (lat, lon)", `${c0.candidate.latitude_deg.toFixed(7)}, ${c0.candidate.longitude_deg.toFixed(7)}`, `${c1.candidate.latitude_deg.toFixed(7)}, ${c1.candidate.longitude_deg.toFixed(7)}`],
    ["observer height (m)", c0.candidate.observer_height_m, c1.candidate.observer_height_m],
    ["start time (UTC)", c0.candidate.selected_time_utc, c1.candidate.selected_time_utc],
    ["duration (h)", c0.request.duration_hours, c1.request.duration_hours],
    ["sampling step (min)", c0.request.step_minutes, c1.request.step_minutes],
    ["near DEM window SHA-256", p0["near_sha256"] ?? "not recorded", p1["near_sha256"] ?? "not recorded"],
    ["far DEM window SHA-256", p0["far_sha256"] ?? "not recorded", p1["far_sha256"] ?? "not recorded"],
    ["SPICE kernels", JSON.stringify(p0["kernel_sha256"] ?? "not recorded"), JSON.stringify(p1["kernel_sha256"] ?? "not recorded")],
    ["algorithm", p0["algorithm"] ?? "not recorded", p1["algorithm"] ?? "not recorded"],
  ];
  return rows.filter(([, a, b]): boolean => String(a) !== String(b)).map(([input, a, b]): InputDifference => ({ input, c0: String(a), c1: String(b) }));
}

/** C0 / C1 sampled visibility comparison; shown only when both evaluations computed. */
export function ResultComparison({ c0, c1 }: { c0: ScientificEvaluation; c1: ScientificEvaluation }): JSX.Element | null {
  const computed: (r: ScientificEvaluation) => boolean = (r: ScientificEvaluation): boolean => r.status === "COMPUTED_UNVERIFIED" || r.status === "VALIDATED";
  if (!computed(c0) || !computed(c1)) return null;
  const changed: InputDifference[] = inputDifferences(c0, c1);
  return <section aria-label="Scientific comparison">
    <h4>C0 / C1 visibility comparison</h4>
    <div className="controlled" role="note">
      {changed.length === 0 && <p>Identical scientific inputs: any difference would indicate a reproducibility problem.</p>}
      {changed.length === 1 && <p><strong>Controlled comparison:</strong> only the {changed[0]?.input} differs ({changed[0]?.c0} → {changed[0]?.c1}); every other recorded input is identical, so the difference below reflects that input under this model (geometric, not independently validated).</p>}
      {changed.length > 1 && <p><strong>Not a single-variable comparison:</strong> {changed.length} inputs differ ({changed.map((d: InputDifference): string => d.input).join(", ")}). Differences cannot be attributed to any one of them.</p>}
      {changed.length > 0 && <ul className="small-list">{changed.map((d: InputDifference): JSX.Element => <li key={d.input}>{d.input}: <span className="mono-wrap">{d.c0}</span> → <span className="mono-wrap">{d.c1}</span></li>)}</ul>}
    </div>
    {KEYS.map((key: Key): JSX.Element => <p key={key}>{key}: {hours(c0, key).toFixed(2)} h → {hours(c1, key).toFixed(2)} h (difference {(hours(c1, key) - hours(c0, key)).toFixed(2)} h)</p>)}
  </section>;
}
