import type { BodySeries, SiteResult, VisibilityWindow } from "@clps/api-client";
import { useMemo, type JSX, type MouseEvent } from "react";
import { formatUtcDate } from "../lib/format.ts";
import { elevationDomain, linearScale, niceTicks, type Scale } from "../lib/scale.ts";

const WIDTH: number = 960;
const LEFT: number = 132;
const RIGHT: number = 16;
const TOP: number = 12;
const PLOT_HEIGHT: number = 200;
const BAND_HEIGHT: number = 12;
const BAND_GAP: number = 3;
const GROUP_GAP: number = 12;
const SECTION_GAP: number = 28;
const AXIS_HEIGHT: number = 28;
const TIME_TICKS: number = 6;

interface TimelineProps {
  times: readonly string[];
  sites: readonly SiteResult[];
  focused: SiteResult;
  rangeEnd: string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

function linePath(times: readonly number[], series: BodySeries, x: Scale, y: Scale): string {
  return times
    .map((t: number, i: number): string => {
      const elevation: number = series.elevation_deg[i] ?? 0;
      return `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(elevation).toFixed(1)}`;
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
  sites,
  focused,
  rangeEnd,
  hoverIndex,
  onHover,
}: TimelineProps): JSX.Element {
  const timeMs: number[] = useMemo((): number[] => times.map((t: string): number => Date.parse(t)), [times]);
  const t0: number = timeMs[0] ?? 0;
  const tEnd: number = Date.parse(rangeEnd);
  const x: Scale = useMemo((): Scale => linearScale([t0, tEnd], [LEFT, WIDTH - RIGHT]), [t0, tEnd]);
  const [yMin, yMax] = useMemo(
    (): [number, number] =>
      elevationDomain([...focused.sun.elevation_deg, ...focused.earth.elevation_deg]),
    [focused],
  );
  const y: Scale = useMemo(
    (): Scale => linearScale([yMin, yMax], [TOP + PLOT_HEIGHT, TOP]),
    [yMin, yMax],
  );
  const sunPath: string = useMemo((): string => linePath(timeMs, focused.sun, x, y), [timeMs, focused, x, y]);
  const earthPath: string = useMemo(
    (): string => linePath(timeMs, focused.earth, x, y),
    [timeMs, focused, x, y],
  );

  const bandsTop: number = TOP + PLOT_HEIGHT + SECTION_GAP;
  const groupHeight: number = 2 * BAND_HEIGHT + BAND_GAP + GROUP_GAP;
  const axisTop: number = bandsTop + sites.length * groupHeight;
  const height: number = axisTop + AXIS_HEIGHT;
  const step: number = timeMs.length > 1 ? (timeMs[1] ?? t0) - t0 : 1;
  const timeTicks: number[] = Array.from(
    { length: TIME_TICKS },
    (_unused: unknown, i: number): number => t0 + ((tEnd - t0) * i) / (TIME_TICKS - 1),
  );

  function handleMove(event: MouseEvent<SVGSVGElement>): void {
    const rect: DOMRect = event.currentTarget.getBoundingClientRect();
    const px: number = ((event.clientX - rect.left) / rect.width) * WIDTH;
    if (px < LEFT || px > WIDTH - RIGHT || timeMs.length === 0) {
      onHover(null);
      return;
    }
    const t: number = t0 + ((px - LEFT) / (WIDTH - RIGHT - LEFT)) * (tEnd - t0);
    onHover(Math.min(timeMs.length - 1, Math.max(0, Math.round((t - t0) / step))));
  }

  const hoverX: number | null = hoverIndex === null ? null : x(timeMs[hoverIndex] ?? t0);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH.toString()} ${height.toString()}`}
      role="img"
      aria-label={`Timeline: elevation of the Sun and the Earth at ${focused.site.name}, and sunlight and direct-to-Earth periods for every site`}
      onMouseMove={handleMove}
      onMouseLeave={(): void => {
        onHover(null);
      }}
    >
      <rect className="below-horizon" x={LEFT} y={y(0)} width={WIDTH - LEFT - RIGHT} height={TOP + PLOT_HEIGHT - y(0)} />
      {niceTicks(yMin, yMax, 5).map(
        (tick: number): JSX.Element => (
          <g key={`y${tick.toString()}`}>
            <line className="grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} />
            <text className="tick" x={LEFT - 6} y={y(tick)} dy="0.32em" textAnchor="end">
              {`${tick.toString()}°`}
            </text>
          </g>
        ),
      )}
      <text className="axis-title" x={0} y={TOP + 10}>
        Elevation
      </text>
      <text className="axis-title muted" x={0} y={TOP + 24}>
        {focused.site.name}
      </text>
      <line className="horizon" x1={LEFT} x2={WIDTH - RIGHT} y1={y(0)} y2={y(0)} />
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
            <text className="band-kind" x={LEFT - 6} y={top + BAND_HEIGHT - 2} textAnchor="end">
              Sun
            </text>
            <rect className="band-track" x={LEFT} y={top} width={WIDTH - LEFT - RIGHT} height={BAND_HEIGHT} />
            {bandRects(site.sun_windows, x, top, "sun")}
            <text
              className="band-kind"
              x={LEFT - 6}
              y={top + 2 * BAND_HEIGHT + BAND_GAP - 2}
              textAnchor="end"
            >
              DTE
            </text>
            <rect
              className="band-track"
              x={LEFT}
              y={top + BAND_HEIGHT + BAND_GAP}
              width={WIDTH - LEFT - RIGHT}
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
            textAnchor={i === 0 ? "start" : i === TIME_TICKS - 1 ? "end" : "middle"}
          >
            {formatUtcDate(new Date(tick).toISOString())}
          </text>
        ),
      )}
      {hoverX !== null && (
        <line className="crosshair" x1={hoverX} x2={hoverX} y1={TOP} y2={axisTop} />
      )}
    </svg>
  );
}
