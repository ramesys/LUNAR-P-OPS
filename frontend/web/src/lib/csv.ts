import type { AnalysisRequest, AnalysisResponse, SiteResult, VisibilityWindow } from "@clps/api-client";

import { inclusiveDateRange } from "./download.ts";

/** RF-18: CSV exports built from the analysis on screen (RFC 4180, UTF-8 with BOM for Excel). */

export type CsvValue = string | number | boolean | null;

const BOM: string = String.fromCharCode(0xfeff);
const NEWLINE: string = "\r\n";

function cell(value: CsvValue): string {
  if (value === null) {
    return "";
  }
  const text: string = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines: string[] = [header, ...rows].map((row: readonly CsvValue[]): string =>
    row.map(cell).join(","),
  );
  return BOM + lines.join(NEWLINE) + NEWLINE;
}

function round(value: number, decimals: number): number {
  const factor: number = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function windowHours(window: VisibilityWindow | null): [number | null, boolean | null] {
  return window === null ? [null, null] : [window.duration_hours, window.truncated];
}

export function summaryCsv(result: AnalysisResponse): string {
  const r: AnalysisRequest = result.request;
  const header: string[] = [
    "rank",
    "site_id",
    "site_name",
    "origin",
    "latitude_deg",
    "longitude_deg",
    "horizon_used",
    "sunlit_percent",
    "earth_in_view_percent",
    "longest_darkness_hours",
    "longest_darkness_truncated",
    "longest_dte_gap_hours",
    "longest_dte_gap_truncated",
    "start_utc",
    "end_utc",
    "step_minutes",
    "observer_height_m",
    "horizon_requested",
    "earth_min_elevation_deg",
  ];
  const rows: CsvValue[][] = result.sites.map((s: SiteResult): CsvValue[] => [
    s.rank,
    s.site.id,
    s.site.name,
    s.site.origin,
    s.site.latitude_deg,
    s.site.longitude_deg,
    s.horizon_model,
    round(s.metrics.sun_fraction * 100, 2),
    round(s.metrics.earth_fraction * 100, 2),
    ...windowHours(s.metrics.longest_darkness),
    ...windowHours(s.metrics.longest_earth_outage),
    r.start,
    r.end,
    r.step_minutes,
    r.observer_height_m,
    r.horizon,
    r.earth_min_clearance_deg,
  ]);
  return toCsv(header, rows);
}

/** Visibility flag per sample, from the API's windows (half-open, sorted, contiguous). */
export function flagsFromWindows(times: readonly string[], windows: readonly VisibilityWindow[]): boolean[] {
  const flags: boolean[] = [];
  let w: number = 0;
  for (const time of times) {
    const t: number = Date.parse(time);
    while (w < windows.length - 1 && Date.parse(windows[w]?.end ?? time) <= t) {
      w += 1;
    }
    const current: VisibilityWindow | undefined = windows[w];
    flags.push(
      current !== undefined &&
        current.visible &&
        Date.parse(current.start) <= t &&
        t < Date.parse(current.end),
    );
  }
  return flags;
}

export function timeSeriesCsv(result: AnalysisResponse): string {
  const header: string[] = [
    "time_utc",
    "site_id",
    "sun_azimuth_deg",
    "sun_elevation_deg",
    "sun_horizon_deg",
    "sun_visible",
    "earth_azimuth_deg",
    "earth_elevation_deg",
    "earth_horizon_deg",
    "dte_available",
  ];
  const rows: CsvValue[][] = [];
  for (const s of result.sites) {
    const sunFlags: boolean[] = flagsFromWindows(result.times, s.sun_windows);
    const earthFlags: boolean[] = flagsFromWindows(result.times, s.earth_windows);
    result.times.forEach((time: string, i: number): void => {
      rows.push([
        time,
        s.site.id,
        s.sun.azimuth_deg[i] ?? null,
        s.sun.elevation_deg[i] ?? null,
        s.sun.horizon_deg[i] ?? null,
        sunFlags[i] ?? null,
        s.earth.azimuth_deg[i] ?? null,
        s.earth.elevation_deg[i] ?? null,
        s.earth.horizon_deg[i] ?? null,
        earthFlags[i] ?? null,
      ]);
    });
  }
  return toCsv(header, rows);
}

export function windowsCsv(result: AnalysisResponse): string {
  const header: string[] = [
    "site_id",
    "period",
    "start_utc",
    "end_utc",
    "duration_hours",
    "truncated",
  ];
  const rows: CsvValue[][] = [];
  for (const s of result.sites) {
    for (const w of s.sun_windows) {
      rows.push([s.site.id, w.visible ? "sunlight" : "darkness", w.start, w.end, w.duration_hours, w.truncated]);
    }
    for (const w of s.earth_windows) {
      rows.push([s.site.id, w.visible ? "dte" : "no_dte", w.start, w.end, w.duration_hours, w.truncated]);
    }
  }
  return toCsv(header, rows);
}

/** File name with the inclusive UTC date range, e.g. clps-summary_2026-01-01_2026-12-31.csv. */
export function exportFileName(result: AnalysisResponse, kind: string): string {
  const [start, lastIncluded] = inclusiveDateRange(result.request);
  return `clps-${kind}_${start}_${lastIncluded}.csv`;
}
