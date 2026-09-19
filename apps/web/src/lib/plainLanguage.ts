import type { SiteResult, VisibilityWindow } from "@clps/api-client";

/** RF-16: plain-language reading of the metrics for Simple mode. */

/** Mean synodic month (days): the Sun's cycle as seen from the Moon. */
export const SYNODIC_MONTH_DAYS: number = 29.53;

function days(hours: number): string {
  const value: number = hours / 24;
  if (value < 2) {
    return `${Math.round(hours).toString()} hours`;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} days`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100).toString()}%`;
}

export function sunSentence(site: SiteResult): string {
  const perMonth: number = site.metrics.sun_fraction * SYNODIC_MONTH_DAYS;
  if (site.metrics.sun_fraction === 0) {
    return "The Sun never reaches this spot in the selected dates: solar panels would get no light.";
  }
  if (site.metrics.sun_fraction === 1) {
    return "Sunlit the whole time: solar panels would never be in the dark in these dates.";
  }
  return `Sunlit ${percent(site.metrics.sun_fraction)} of the time: about ${perMonth.toFixed(0)} days of sunlight per month.`;
}

export function darknessSentence(window: VisibilityWindow | null): string {
  if (window === null) {
    return "No darkness at all in these dates.";
  }
  const atLeast: string = window.truncated ? "at least " : "";
  return `Longest night: ${atLeast}${days(window.duration_hours)}. A solar-powered lander must survive that long on batteries.`;
}

export function earthSentence(site: SiteResult): string {
  if (site.metrics.earth_fraction === 0) {
    return "The Earth never rises above the horizon here: talking to Earth would need a relay satellite.";
  }
  if (site.metrics.earth_fraction === 1) {
    return "The Earth is always in view: direct radio contact is possible the whole time.";
  }
  const gap: VisibilityWindow | null = site.metrics.longest_earth_outage;
  const gapText: string =
    gap === null ? "" : ` The longest silence lasts ${gap.truncated ? "at least " : ""}${days(gap.duration_hours)}.`;
  return `The Earth is in view ${percent(site.metrics.earth_fraction)} of the time.${gapText}`;
}

/** One-line verdict: which site is best for power and which for talking to Earth. */
export function verdict(sites: readonly SiteResult[]): string {
  const best: SiteResult | undefined = sites[0];
  if (best === undefined) {
    return "";
  }
  const bestEarth: SiteResult = sites.reduce(
    (a: SiteResult, b: SiteResult): SiteResult => (b.metrics.earth_fraction > a.metrics.earth_fraction ? b : a),
    best,
  );
  if (bestEarth.site.id === best.site.id) {
    return `${best.site.name} leads on both counts: the most sunlight and the most time in contact with Earth.`;
  }
  return `Most sunlight: ${best.site.name}. Most time in contact with Earth: ${bestEarth.site.name}. Power and communication pull in different directions, as they often do near the pole.`;
}
