import type { AnalysisRequest } from "@clps/api-client";

export const MIN_SITES: number = 2;
export const MAX_SITES: number = 4;
export const MAX_RANGE_DAYS: number = 366;

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
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

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
  return errors;
}

export function toggleSite(siteIds: readonly string[], siteId: string): string[] {
  return siteIds.includes(siteId)
    ? siteIds.filter((id: string): boolean => id !== siteId)
    : [...siteIds, siteId];
}
