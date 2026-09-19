import type { SiteResult } from "@clps/api-client";
import type { JSX } from "react";
import { formatDegrees, formatUtc } from "../lib/format.ts";
import { visibleAt } from "../lib/playback.ts";

interface HoverReadoutProps {
  times: readonly string[];
  focused: SiteResult;
  index: number;
  previewing: boolean;
}

/** Text twin of the charts: values and visibility at the shown instant, readable without color. */
export function HoverReadout({ times, focused, index, previewing }: HoverReadoutProps): JSX.Element {
  const time: string = times[index] ?? times[0] ?? "";
  const sunEl: number = focused.sun.elevation_deg[index] ?? 0;
  const sunAz: number = focused.sun.azimuth_deg[index] ?? 0;
  const earthEl: number = focused.earth.elevation_deg[index] ?? 0;
  const earthAz: number = focused.earth.azimuth_deg[index] ?? 0;
  const terrain: boolean = focused.horizon_model === "terrain";
  const sunHorizon: number = focused.sun.horizon_deg[index] ?? 0;
  const earthHorizon: number = focused.earth.horizon_deg[index] ?? 0;
  const sunlit: boolean = visibleAt(focused.sun_windows, time);
  const dte: boolean = visibleAt(focused.earth_windows, time);
  return (
    <p className="readout" aria-live="off">
      <strong>{formatUtc(time)}</strong>
      {previewing && <span className="muted"> (preview)</span>} · {focused.site.name} ·{" "}
      <span className="swatch sun" aria-hidden="true" /> Sun {sunlit ? "up" : "hidden"}: elevation{" "}
      {formatDegrees(sunEl)}, azimuth {formatDegrees(sunAz)}
      {terrain && ` (terrain ${formatDegrees(sunHorizon)})`} ·{" "}
      <span className="swatch earth" aria-hidden="true" /> Earth {dte ? "in view (DTE)" : "not in view"}:
      elevation {formatDegrees(earthEl)}, azimuth {formatDegrees(earthAz)}
      {terrain && ` (terrain ${formatDegrees(earthHorizon)})`}
    </p>
  );
}
