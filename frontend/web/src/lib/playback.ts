import type { VisibilityWindow } from "@clps/api-client";

export const TICK_MS: number = 50;
export const TRAIL_HOURS: number = 24;

export const SPEED_OPTIONS: readonly { hoursPerSecond: number; label: string }[] = [
  { hoursPerSecond: 6, label: "6 h / s" },
  { hoursPerSecond: 24, label: "1 day / s" },
  { hoursPerSecond: 120, label: "5 days / s" },
  { hoursPerSecond: 480, label: "20 days / s" },
];

export const DEFAULT_SPEED: number = 24;

/** Samples to advance per animation tick (can be fractional; the caller accumulates). */
export function samplesPerTick(hoursPerSecond: number, stepMinutes: number): number {
  return ((hoursPerSecond * 60) / stepMinutes) * (TICK_MS / 1000);
}

/** Number of samples covering the recent-path trail drawn on the sky diagram. */
export function trailSamples(stepMinutes: number): number {
  return Math.max(1, Math.round((TRAIL_HOURS * 60) / stepMinutes));
}

/** Visibility at an instant, read from the API's windows (half-open [start, end)). */
export function visibleAt(windows: readonly VisibilityWindow[], timeIso: string): boolean {
  const t: number = Date.parse(timeIso);
  return windows.some(
    (w: VisibilityWindow): boolean => w.visible && Date.parse(w.start) <= t && t < Date.parse(w.end),
  );
}

export function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(0, index), Math.max(0, length - 1));
}
