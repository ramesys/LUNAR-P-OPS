import type { SiteResult } from "@clps/api-client";
import type { JSX } from "react";
import { formatDegrees, formatUtc } from "../lib/format.ts";

interface HoverReadoutProps {
  times: readonly string[];
  focused: SiteResult;
  hoverIndex: number | null;
}

/** Text twin of the chart hover: the values under the pointer, readable without color. */
export function HoverReadout({ times, focused, hoverIndex }: HoverReadoutProps): JSX.Element {
  const time: string | undefined = hoverIndex === null ? undefined : times[hoverIndex];
  if (hoverIndex === null || time === undefined) {
    return (
      <p className="readout muted" aria-live="polite">
        Hover a chart to read exact values.
      </p>
    );
  }
  const sunEl: number = focused.sun.elevation_deg[hoverIndex] ?? 0;
  const sunAz: number = focused.sun.azimuth_deg[hoverIndex] ?? 0;
  const earthEl: number = focused.earth.elevation_deg[hoverIndex] ?? 0;
  const earthAz: number = focused.earth.azimuth_deg[hoverIndex] ?? 0;
  const terrain: boolean = focused.horizon_model === "terrain";
  const sunHorizon: number = focused.sun.horizon_deg[hoverIndex] ?? 0;
  const earthHorizon: number = focused.earth.horizon_deg[hoverIndex] ?? 0;
  return (
    <p className="readout" aria-live="polite">
      <strong>{formatUtc(time)}</strong> · {focused.site.name} ·{" "}
      <span className="swatch sun" aria-hidden="true" /> Sun elevation {formatDegrees(sunEl)}, azimuth{" "}
      {formatDegrees(sunAz)}
      {terrain && ` (terrain ${formatDegrees(sunHorizon)})`} ·{" "}
      <span className="swatch earth" aria-hidden="true" /> Earth elevation {formatDegrees(earthEl)},
      azimuth {formatDegrees(earthAz)}
      {terrain && ` (terrain ${formatDegrees(earthHorizon)})`}
    </p>
  );
}
