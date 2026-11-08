import type { TerrainCheck, TerrainScreen } from "@clps/api-client";
import type { JSX } from "react";

const LABELS: Record<string, string> = {
  coverage_fraction: "DEM coverage",
  local_slope_deg: "Local slope",
  neighborhood_slope_deg: "Neighbourhood slope",
  roughness_rms_m: "Roughness (RMS)",
  residual_relief_m: "Relief (detrended)",
};

function value(v: number | null | undefined, digits: number, unit: string): string {
  return v === null || v === undefined ? "not assessed" : `${v.toFixed(digits)} ${unit}`;
}

function checkText(check: TerrainCheck): string {
  const scale: number = check.unit === "fraction" ? 100 : 1;
  const unit: string = check.unit === "fraction" ? "%" : check.unit === "deg" ? "°" : ` ${check.unit}`;
  const shown: string = check.value === null ? "—" : `${(check.value * scale).toFixed(check.unit === "fraction" ? 0 : 2)}${unit}`;
  return `${shown} ${check.comparison === "<=" ? "≤" : "≥"} ${(check.limit * scale).toString()}${unit}`;
}

/**
 * Compact display of one DEM terrain screen (SurfaceSlope, TerrainRoughness, TerrainQuality and
 * LandingZoneScreen). Values come from the Python backend unchanged; missing data and unavailable
 * hazard/uncertainty information are shown as NOT ASSESSED, never as passing.
 */
export function TerrainScreenCard({ screen, title = "Terrain screen" }: { screen: TerrainScreen; title?: string }): JSX.Element {
  const radius: number = screen.constraints.neighborhood_radius_m;
  return <section className="terrain-card" aria-label={title} data-verdict={screen.verdict}>
    <header><strong>{title}</strong> <span className={`terrain-verdict verdict-${screen.verdict.toLowerCase()}`}>{screen.verdict.replace("_", " ")}</span>
      <span className="muted small"> · {screen.status} · LandingZoneScreen</span></header>
    {screen.status === "UNAVAILABLE"
      ? <p role="status" className="small">Terrain metrics unavailable: {screen.errors.join("; ") || "DEM not available"}. Nothing is assessed.</p>
      : <>
        <dl className="terrain-metrics">
          <div><dt>Local slope</dt><dd>{value(screen.slope?.local_slope_deg, 1, "°")}</dd></div>
          <div><dt>Max local slope</dt><dd>{value(screen.slope?.max_local_slope_deg, 1, "°")}</dd></div>
          <div><dt>Plane slope (r {radius.toString()} m)</dt><dd>{value(screen.slope?.neighborhood_slope_deg, 1, "°")}</dd></div>
          <div><dt>RMS roughness</dt><dd>{value(screen.roughness?.rms_residual_m, 2, "m")}</dd></div>
          <div><dt>Relief (detrended)</dt><dd>{value(screen.roughness?.residual_relief_m, 2, "m")}</dd></div>
          <div><dt>DEM coverage</dt><dd>{screen.quality === null || screen.quality === undefined ? "not assessed"
            : `${screen.quality.valid_node_count.toString()}/${screen.quality.neighborhood_node_count.toString()} nodes`}</dd></div>
        </dl>
        <ul className="terrain-checks" aria-label="Terrain constraints">
          {screen.checks.map((check: TerrainCheck): JSX.Element => <li key={check.name} data-status={check.status}>
            <span className={`terrain-verdict verdict-${check.status.toLowerCase()}`}>{check.status.replace("_", " ")}</span> {LABELS[check.name] ?? check.name}: {checkText(check)}
          </li>)}
          {screen.checks.length <= 1 && <li data-status="NOT_ASSESSED">No slope or roughness limit configured: terrain is not assessed.</li>}
        </ul>
      </>}
    <details className="small"><summary>Not assessed ({screen.not_assessed.length.toString()}) and provenance</summary>
      <ul>{screen.not_assessed.map((item: string): JSX.Element => <li key={item}>NOT ASSESSED · {item}</li>)}</ul>
      {screen.provenance !== null && screen.provenance !== undefined && <p className="mono-wrap">
        {screen.provenance.algorithm} · {screen.provenance.terrain_dataset_id} ({screen.provenance.dem_resolution_m.toString()} m/px) ·
        SHA-256 {screen.provenance.terrain_dataset_sha256.slice(0, 16)}… · lunar-core {screen.provenance.lunar_core_version}<br />
        {screen.provenance.coordinate_reference}<br />Screen {screen.screen_id}</p>}
    </details>
    <p className="muted small">{screen.scope_note}</p>
  </section>;
}
