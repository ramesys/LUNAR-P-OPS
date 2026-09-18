import type { AnalysisRequest, HorizonModel } from "@clps/api-client";

export const MIN_SITES: number = 2;
export const MAX_SITES: number = 4;
export const MAX_RANGE_DAYS: number = 366;
export const MAX_EARTH_CLEARANCE_DEG: number = 10;

export const STEP_OPTIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
];

export interface ScenarioForm {
  siteIds: string[];
  /** Inclusive UTC calendar dates, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  stepMinutes: number;
  observerHeightM: number;
  horizon: HorizonModel;
  earthMinClearanceDeg: number;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;
const DATE_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}$/;

function utcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function toRequest(form: ScenarioForm): AnalysisRequest {
  const endExclusive: string = new Date(utcMidnight(form.endDate) + DAY_MS).toISOString();
  return {
    site_ids: form.siteIds,
    start: `${form.startDate}T00:00:00Z`,
    end: endExclusive,
    step_minutes: form.stepMinutes,
    observer_height_m: form.observerHeightM,
    horizon: form.horizon,
    earth_min_clearance_deg: form.earthMinClearanceDeg,
  };
}

/** Client-side checks for instant feedback; the API remains the source of truth. */
export function validateForm(form: ScenarioForm): string[] {
  const errors: string[] = [];
  if (form.siteIds.length < MIN_SITES || form.siteIds.length > MAX_SITES) {
    errors.push(`Select between ${MIN_SITES.toString()} and ${MAX_SITES.toString()} sites.`);
  }
  const start: number = utcMidnight(form.startDate);
  const end: number = utcMidnight(form.endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    errors.push("Enter both dates.");
  } else if (end < start) {
    errors.push("The end date must not be before the start date.");
  } else if ((end - start) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    errors.push("The date range can be at most one year.");
  }
  if (!Number.isFinite(form.observerHeightM) || form.observerHeightM < 0) {
    errors.push("Observer height must be 0 m or more.");
  }
  if (
    !Number.isFinite(form.earthMinClearanceDeg) ||
    form.earthMinClearanceDeg < 0 ||
    form.earthMinClearanceDeg > MAX_EARTH_CLEARANCE_DEG
  ) {
    errors.push(`Minimum Earth elevation must be between 0° and ${MAX_EARTH_CLEARANCE_DEG.toString()}°.`);
  }
  return errors;
}

export function toggleSite(siteIds: readonly string[], siteId: string): string[] {
  return siteIds.includes(siteId)
    ? siteIds.filter((id: string): boolean => id !== siteId)
    : [...siteIds, siteId];
}

/** Shareable URL query (RF-14). */
export function formToSearch(form: ScenarioForm): string {
  const params: URLSearchParams = new URLSearchParams({
    sites: form.siteIds.join(","),
    from: form.startDate,
    to: form.endDate,
    step: form.stepMinutes.toString(),
    height: form.observerHeightM.toString(),
    horizon: form.horizon,
    dte: form.earthMinClearanceDeg.toString(),
  });
  return `?${params.toString()}`;
}

function numberParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw: string | null = params.get(key);
  const value: number = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function dateParam(params: URLSearchParams, key: string, fallback: string): string {
  const raw: string | null = params.get(key);
  return raw !== null && DATE_PATTERN.test(raw) ? raw : fallback;
}

/**
 * Read a scenario from a URL query, keeping `fallback` values for anything missing or malformed.
 * Unknown site ids are dropped so a stale link still opens.
 */
export function formFromSearch(search: string, fallback: ScenarioForm, knownSiteIds: readonly string[]): ScenarioForm {
  const params: URLSearchParams = new URLSearchParams(search);
  const sitesParam: string | null = params.get("sites");
  const siteIds: string[] =
    sitesParam === null
      ? fallback.siteIds
      : sitesParam.split(",").filter((id: string): boolean => knownSiteIds.includes(id));
  const horizonParam: string | null = params.get("horizon");
  const stepMinutes: number = numberParam(params, "step", fallback.stepMinutes);
  return {
    siteIds: siteIds.length > 0 ? siteIds : fallback.siteIds,
    startDate: dateParam(params, "from", fallback.startDate),
    endDate: dateParam(params, "to", fallback.endDate),
    stepMinutes: STEP_OPTIONS.some((o: { minutes: number }): boolean => o.minutes === stepMinutes)
      ? stepMinutes
      : fallback.stepMinutes,
    observerHeightM: numberParam(params, "height", fallback.observerHeightM),
    horizon: horizonParam === "flat" || horizonParam === "terrain" ? horizonParam : fallback.horizon,
    earthMinClearanceDeg: numberParam(params, "dte", fallback.earthMinClearanceDeg),
  };
}
