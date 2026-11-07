import type { ScientificEvaluation, SiteResult, VisibilityWindow } from "@clps/api-client";

/**
 * Present a persisted candidate evaluation in the original CLPS sky diagram and timeline.
 * Every plotted value is copied from the evaluation; nothing is recomputed here. Visibility
 * bands are the evaluation's own visible intervals. `metrics` is required by the chart type but
 * not drawn by the charts; it holds sample fractions and no longest-window values.
 */
export interface EvaluationChart { times: string[]; rangeEnd: string; site: SiteResult }

function windows(evaluation: ScientificEvaluation, key: "sun" | "earth"): VisibilityWindow[] {
  return (evaluation.intervals[key] ?? []).map((interval): VisibilityWindow => ({
    start: interval.start_utc, end: interval.end_utc, duration_hours: interval.duration_seconds / 3600,
    visible: true, truncated: interval.truncated,
  }));
}

export function evaluationChart(evaluation: ScientificEvaluation, name: string): EvaluationChart | null {
  const samples: ScientificEvaluation["samples"] = evaluation.samples;
  const last: ScientificEvaluation["samples"][number] | undefined = samples.at(-1);
  if (last === undefined || evaluation.horizon_azimuth_deg.length === 0) return null;
  const fraction: (key: "sun_visible" | "earth_visible") => number = (key: "sun_visible" | "earth_visible"): number =>
    samples.filter((s: ScientificEvaluation["samples"][number]): boolean => s[key]).length / samples.length;
  const start: number = Date.parse(samples[0]?.time_utc ?? last.time_utc);
  const rangeEnd: string = new Date(start + evaluation.request.duration_hours * 3600_000).toISOString();
  const candidate: ScientificEvaluation["candidate"] = evaluation.candidate;
  return {
    times: samples.map((s): string => s.time_utc),
    rangeEnd,
    site: {
      rank: 1,
      site: { id: candidate.candidate_id, name, latitude_deg: candidate.latitude_deg, longitude_deg: candidate.longitude_deg,
        origin: "custom", note: "Persisted candidate evaluation", terrain_available: true, map_x_m: 0, map_y_m: 0 },
      horizon_model: "terrain",
      horizon_mask: { azimuth_deg: evaluation.horizon_azimuth_deg, elevation_deg: evaluation.horizon_elevation_deg },
      metrics: { sun_fraction: fraction("sun_visible"), earth_fraction: fraction("earth_visible"), longest_darkness: null, longest_earth_outage: null },
      sun: { azimuth_deg: samples.map((s): number => s.sun_azimuth_deg), elevation_deg: samples.map((s): number => s.sun_elevation_deg),
        horizon_deg: samples.map((s): number => s.sun_horizon_deg) },
      earth: { azimuth_deg: samples.map((s): number => s.earth_azimuth_deg), elevation_deg: samples.map((s): number => s.earth_elevation_deg),
        horizon_deg: samples.map((s): number => s.earth_horizon_deg) },
      sun_windows: windows(evaluation, "sun"),
      earth_windows: windows(evaluation, "earth"),
    },
  };
}

/** Plain status categories kept separate on purpose (Sprint 05): data, computation, validation. */
export type ComputationState = "not-run" | "succeeded" | "unavailable" | "failed";

export function computationState(evaluation: ScientificEvaluation | null): ComputationState {
  if (evaluation === null) return "not-run";
  if (evaluation.status === "COMPUTED_UNVERIFIED" || evaluation.status === "VALIDATED") return "succeeded";
  return evaluation.status === "UNAVAILABLE" ? "unavailable" : "failed";
}

export function visibleHours(evaluation: ScientificEvaluation, key: "sun" | "earth" | "simultaneous"): number {
  return (evaluation.intervals[key] ?? []).reduce((total: number, i): number => total + i.duration_seconds, 0) / 3600;
}

export interface HorizonGap { sunHours: number; earthHours: number; sunClosest: number; earthClosest: number }

/**
 * Closest approach to the terrain horizon over the stored samples, in degrees (negative: below).
 * Sun uses the upper limb, like the backend rule; the 0.2666° semidiameter is its mean value, so the
 * printed number is descriptive only. Visibility itself always comes from the stored flags.
 */
export function horizonGap(evaluation: ScientificEvaluation): HorizonGap | null {
  if (evaluation.samples.length === 0) return null;
  const SUN_SEMIDIAMETER_DEG: number = 0.2666;
  return {
    sunHours: visibleHours(evaluation, "sun"),
    earthHours: visibleHours(evaluation, "earth"),
    sunClosest: Math.max(...evaluation.samples.map((s): number => s.sun_elevation_deg + SUN_SEMIDIAMETER_DEG - s.sun_horizon_deg)),
    earthClosest: Math.max(...evaluation.samples.map((s): number => s.earth_elevation_deg - s.earth_horizon_deg)),
  };
}
