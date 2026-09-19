import type { ScenarioForm } from "./scenario.ts";

/** RF-16: Simple (public, education) or Expert (mission planning) presentation of the same data. */
export type Mode = "simple" | "expert";

export const DEFAULT_MODE: Mode = "simple";

export function modeFromSearch(search: string): Mode {
  const raw: string | null = new URLSearchParams(search).get("mode");
  return raw === "expert" || raw === "simple" ? raw : DEFAULT_MODE;
}

/** Append the mode to a scenario query string (`?sites=...`). */
export function withMode(search: string, mode: Mode): string {
  const params: URLSearchParams = new URLSearchParams(search);
  params.set("mode", mode);
  return `?${params.toString()}`;
}

export interface ExpertDefaults {
  stepMinutes: number;
  observerHeightM: number;
  horizon: ScenarioForm["horizon"];
  earthMinClearanceDeg: number;
}

export const EXPERT_DEFAULTS: ExpertDefaults = {
  stepMinutes: 60,
  observerHeightM: 2,
  horizon: "terrain",
  earthMinClearanceDeg: 0,
};

/**
 * Settings only editable in Expert mode that differ from their defaults. Simple mode lists them so a
 * hidden setting never changes the results silently.
 */
export function nonDefaultExpertSettings(form: ScenarioForm): string[] {
  const notes: string[] = [];
  if (form.stepMinutes !== EXPERT_DEFAULTS.stepMinutes) {
    notes.push(`sampling step ${form.stepMinutes.toString()} min`);
  }
  if (form.horizon !== EXPERT_DEFAULTS.horizon) {
    notes.push("flat horizon (terrain ignored)");
  }
  if (form.observerHeightM !== EXPERT_DEFAULTS.observerHeightM) {
    notes.push(`observer height ${form.observerHeightM.toString()} m`);
  }
  if (form.earthMinClearanceDeg !== EXPERT_DEFAULTS.earthMinClearanceDeg) {
    notes.push(`Earth at least ${form.earthMinClearanceDeg.toString()}° above the horizon`);
  }
  return notes;
}

export function withExpertDefaults(form: ScenarioForm): ScenarioForm {
  return { ...form, ...EXPERT_DEFAULTS };
}
