import type { BodySeries, SiteResult, VisibilityWindow } from "@clps/api-client";
import { useMemo, type JSX, type MouseEvent } from "react";
import { formatUtcDate } from "../lib/format.ts";
import { elevationDomain, linearScale, niceTicks, type Scale } from "../lib/scale.ts";

const WIDE_LEFT: number = 132;
const NARROW_LEFT: number = 88;
const NARROW_BREAKPOINT: number = 600;
const RIGHT: number = 16;
const TOP: number = 12;
const PLOT_HEIGHT: number = 200;
const BAND_HEIGHT: number = 12;
const BAND_GAP: number = 3;
const GROUP_GAP: number = 12;
const SECTION_GAP: number = 28;
const AXIS_HEIGHT: number = 28;

interface TimelineProps {
  times: readonly string[];
  /** Drawing width in CSS pixels (the measured container width), so text keeps its real size. */
  width: number;
  sites: readonly SiteResult[];
  focused: SiteResult;
  rangeEnd: string;
  index: number;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
}

/** Degrees above the local horizon (flat or terrain) in the body's direction. */
function clearance(series: BodySeries): number[] {
  return series.elevation_deg.map((e: number, i: number): number => e - (series.horizon_deg[i] ?? 0));
}

function linePath(times: readonly number[], values: readonly number[], x: Scale, y: Scale): string {
  return times
    .map((t: number, i: number): string => {
      const value: number = values[i] ?? 0;
      return `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(value).toFixed(1)}`;
    })
    .join("");
}

function bandRects(
  windows: readonly VisibilityWindow[],
  x: Scale,
  top: number,
  className: string,
): JSX.Element[] {
  return windows
    .filter((w: VisibilityWindow): boolean => w.visible)
    .map(
      (w: VisibilityWindow): JSX.Element => (
        <rect
          key={w.start}
          className={`band ${className}`}
          x={x(Date.parse(w.start))}
          y={top}
          width={Math.max(1, x(Date.parse(w.end)) - x(Date.parse(w.start)))}
          height={BAND_HEIGHT}
        />
      ),
    );
}

export function Timeline({
  times,
  width,
  sites,
  focused,
  rangeEnd,
  index,
  onHover,
  onSelect,
}: TimelineProps): JSX.Element {
  const narrow: boolean = width < NARROW_BREAKPOINT;
  const left: number = narrow ? NARROW_LEFT : WIDE_LEFT;
  const timeTickCount: number = narrow ? 3 : 6;
  const timeMs: number[] = useMemo((): number[] => times.map((t: string): number => Date.parse(t)), [times]);
  const t0: number = timeMs[0] ?? 0;
  const tEnd: number = Date.parse(rangeEnd);
  const x: Scale = useMemo((): Scale => linearScale([t0, tEnd], [left, width - RIGHT]), [t0, tEnd, left, width]);
  const sunClearance: number[] = useMemo((): number[] => clearance(focused.sun), [focused]);
  const earthClearance: number[] = useMemo((): number[] => clearance(focused.earth), [focused]);
  const [yMin, yMax] = useMemo(
    (): [number, number] => elevationDomain([...sunClearance, ...earthClearance]),
    [sunClearance, earthClearance],
  );
  const y: Scale = useMemo(
    (): Scale => linearScale([yMin, yMax], [TOP + PLOT_HEIGHT, TOP]),
    [yMin, yMax],
  );
  const sunPath: string = useMemo(
    (): string => linePath(timeMs, sunClearance, x, y),
    [timeMs, sunClearance, x, y],
  );
  const earthPath: string = useMemo(
    (): string => linePath(timeMs, earthClearance, x, y),
    [timeMs, earthClearance, x, y],
  );

  const bandsTop: number = TOP + PLOT_HEIGHT + SECTION_GAP;
  const groupHeight: number = 2 * BAND_HEIGHT + BAND_GAP + GROUP_GAP;
  const axisTop: number = bandsTop + sites.length * groupHeight;
  const height: number = axisTop + AXIS_HEIGHT;
  const step: number = timeMs.length > 1 ? (timeMs[1] ?? t0) - t0 : 1;
  const timeTicks: number[] = Array.from(
    { length: timeTickCount },
    (_unused: unknown, i: number): number => t0 + ((tEnd - t0) * i) / (timeTickCount - 1),
  );

  function indexAt(event: MouseEvent<SVGSVGElement>): number | null {
    const rect: DOMRect = event.currentTarget.getBoundingClientRect();
    const px: number = ((event.clientX - rect.left) / rect.width) * width;
    if (px < left || px > width - RIGHT || timeMs.length === 0) {
      return null;
    }
    const t: number = t0 + ((px - left) / (width - RIGHT - left)) * (tEnd - t0);
    return Math.min(timeMs.length - 1, Math.max(0, Math.round((t - t0) / step)));
  }

  const cursorX: number = x(timeMs[index] ?? t0);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width.toString()} ${height.toString()}`}
      role="img"
      aria-label={`Timeline: height of the Sun and the Earth above the ${focused.horizon_model} horizon at ${focused.site.name}, and sunlight and direct-to-Earth periods for every site`}
      onMouseMove={(event: MouseEvent<SVGSVGElement>): void => {
        onHover(indexAt(event));
      }}
      onClick={(event: MouseEvent<SVGSVGElement>): void => {
        const at: number | null = indexAt(event);
        if (at !== null) {
          onSelect(at);
        }
      }}
      onMouseLeave={(): void => {
        onHover(null);
      }}
    >
      <rect className="below-horizon" x={left} y={y(0)} width={width - left - RIGHT} height={TOP + PLOT_HEIGHT - y(0)} />
      {niceTicks(yMin, yMax, 5).map(
        (tick: number): JSX.Element => (
          <g key={`y${tick.toString()}`}>
            <line className="grid" x1={left} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} />
            <text className="tick" x={left - 6} y={y(tick)} dy="0.32em" textAnchor="end">
              {`${tick.toString()}°`}
            </text>
          </g>
        ),
      )}
      <text className="axis-title" x={0} y={TOP + 10}>
        Above horizon
      </text>
      <text className="axis-title muted" x={0} y={TOP + 24}>
        {focused.site.name}
      </text>
      <line className="horizon" x1={left} x2={width - RIGHT} y1={y(0)} y2={y(0)} />
      <path className="track sun" d={sunPath} />
      <path className="track earth" d={earthPath} />

      <text className="axis-title" x={0} y={bandsTop - 10}>
        Sunlight &amp; DTE by site
      </text>
      {sites.map((site: SiteResult, i: number): JSX.Element => {
        const top: number = bandsTop + i * groupHeight;
        return (
          <g key={site.site.id}>
            <text className="band-label" x={0} y={top + BAND_HEIGHT - 2}>
              {site.site.name}
            </text>
            <text className="band-kind" x={left - 6} y={top + BAND_HEIGHT - 2} textAnchor="end">
              Sun
            </text>
            <rect className="band-track" x={left} y={top} width={width - left - RIGHT} height={BAND_HEIGHT} />
            {bandRects(site.sun_windows, x, top, "sun")}
            <text
              className="band-kind"
              x={left - 6}
              y={top + 2 * BAND_HEIGHT + BAND_GAP - 2}
              textAnchor="end"
            >
              DTE
            </text>
            <rect
              className="band-track"
              x={left}
              y={top + BAND_HEIGHT + BAND_GAP}
              width={width - left - RIGHT}
              height={BAND_HEIGHT}
            />
            {bandRects(site.earth_windows, x, top + BAND_HEIGHT + BAND_GAP, "earth")}
          </g>
        );
      })}

      {timeTicks.map(
        (tick: number, i: number): JSX.Element => (
          <text
            key={`t${tick.toString()}`}
            className="tick"
            x={x(tick)}
            y={axisTop + 16}
            textAnchor={i === 0 ? "start" : i === timeTickCount - 1 ? "end" : "middle"}
          >
            {formatUtcDate(new Date(tick).toISOString())}
          </text>
        ),
      )}
      <line className="crosshair" x1={cursorX} x2={cursorX} y1={TOP} y2={axisTop} />
      <circle className="marker sun" cx={cursorX} cy={y(sunClearance[index] ?? 0)} r={4} />
      <circle className="marker earth" cx={cursorX} cy={y(earthClearance[index] ?? 0)} r={4} />
    </svg>
  );
}
