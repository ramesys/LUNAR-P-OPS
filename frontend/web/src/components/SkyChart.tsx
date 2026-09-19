import type { HorizonMask, SiteResult } from "@clps/api-client";
import { useMemo, type JSX, type MouseEvent } from "react";
import { elevationDomain, linearScale, niceTicks, type Scale } from "../lib/scale.ts";
import { splitAtAzimuthWrap, type SkyPoint } from "../lib/sky.ts";

const HEIGHT: number = 300;
const MARGIN: { top: number; right: number; bottom: number; left: number } = {
  top: 12,
  right: 16,
  bottom: 36,
  left: 48,
};
const COMPASS: readonly { azimuth: number; label: string }[] = [
  { azimuth: 0, label: "N" },
  { azimuth: 45, label: "NE" },
  { azimuth: 90, label: "E" },
  { azimuth: 135, label: "SE" },
  { azimuth: 180, label: "S" },
  { azimuth: 225, label: "SW" },
  { azimuth: 270, label: "W" },
  { azimuth: 315, label: "NW" },
  { azimuth: 360, label: "N" },
];
const HOVER_RADIUS_PX: number = 24;

interface SkyChartProps {
  result: SiteResult;
  /** Drawing width in CSS pixels (the measured container width), so text keeps its real size. */
  width: number;
  index: number;
  trailSamples: number;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
}

function toPath(segments: readonly SkyPoint[][], x: Scale, y: Scale): string {
  return segments
    .map((segment: SkyPoint[]): string =>
      segment
        .map(
          (p: SkyPoint, i: number): string =>
            `${i === 0 ? "M" : "L"}${x(p.azimuthDeg).toFixed(1)},${y(p.elevationDeg).toFixed(1)}`,
        )
        .join(""),
    )
    .join("");
}

function trailPath(
  azimuthDeg: readonly number[],
  elevationDeg: readonly number[],
  index: number,
  length: number,
  x: Scale,
  y: Scale,
): string {
  const from: number = Math.max(0, index - length);
  return toPath(
    splitAtAzimuthWrap(azimuthDeg.slice(from, index + 1), elevationDeg.slice(from, index + 1)),
    x,
    y,
  );
}

export function SkyChart({
  result,
  width,
  index,
  trailSamples,
  onHover,
  onSelect,
}: SkyChartProps): JSX.Element {
  const x: Scale = useMemo(
    (): Scale => linearScale([0, 360], [MARGIN.left, width - MARGIN.right]),
    [width],
  );
  const [yMin, yMax] = useMemo(
    (): [number, number] =>
      elevationDomain([
        ...result.sun.elevation_deg,
        ...result.earth.elevation_deg,
        ...(result.horizon_mask?.elevation_deg ?? []),
      ]),
    [result],
  );
  const y: Scale = useMemo(
    (): Scale => linearScale([yMin, yMax], [HEIGHT - MARGIN.bottom, MARGIN.top]),
    [yMin, yMax],
  );
  const sunPath: string = useMemo(
    (): string =>
      toPath(splitAtAzimuthWrap(result.sun.azimuth_deg, result.sun.elevation_deg), x, y),
    [result, x, y],
  );
  const earthPath: string = useMemo(
    (): string =>
      toPath(splitAtAzimuthWrap(result.earth.azimuth_deg, result.earth.elevation_deg), x, y),
    [result, x, y],
  );
  const terrainPath: string | null = useMemo((): string | null => {
    const mask: HorizonMask | null = result.horizon_mask;
    if (mask === null) {
      return null;
    }
    const first: number = mask.elevation_deg[0] ?? 0;
    const outline: string = [...mask.azimuth_deg, 360]
      .map((azimuth: number, i: number): string => {
        const elevation: number = mask.elevation_deg[i] ?? first;
        return `L${x(azimuth).toFixed(1)},${y(elevation).toFixed(1)}`;
      })
      .join("");
    const bottom: string = (HEIGHT - MARGIN.bottom).toFixed(1);
    return `M${x(0).toFixed(1)},${bottom}${outline}L${x(360).toFixed(1)},${bottom}Z`;
  }, [result, x, y]);
  const yTicks: number[] = niceTicks(yMin, yMax, 6);

  function nearestIndex(event: MouseEvent<SVGSVGElement>): number | null {
    const rect: DOMRect = event.currentTarget.getBoundingClientRect();
    const px: number = ((event.clientX - rect.left) / rect.width) * width;
    const py: number = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    let best: number | null = null;
    let bestDistance: number = HOVER_RADIUS_PX * HOVER_RADIUS_PX;
    for (const series of [result.sun, result.earth]) {
      series.azimuth_deg.forEach((azimuth: number, sampleIndex: number): void => {
        const elevation: number = series.elevation_deg[sampleIndex] ?? 0;
        const dx: number = x(azimuth) - px;
        const dy: number = y(elevation) - py;
        const distance: number = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = sampleIndex;
        }
      });
    }
    return best;
  }

  const sunMarker: SkyPoint = {
    azimuthDeg: result.sun.azimuth_deg[index] ?? 0,
    elevationDeg: result.sun.elevation_deg[index] ?? 0,
  };
  const earthMarker: SkyPoint = {
    azimuthDeg: result.earth.azimuth_deg[index] ?? 0,
    elevationDeg: result.earth.elevation_deg[index] ?? 0,
  };
  const sunTrail: string = trailPath(result.sun.azimuth_deg, result.sun.elevation_deg, index, trailSamples, x, y);
  const earthTrail: string = trailPath(
    result.earth.azimuth_deg,
    result.earth.elevation_deg,
    index,
    trailSamples,
    x,
    y,
  );

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width.toString()} ${HEIGHT.toString()}`}
      role="img"
      aria-label={`Sky diagram for ${result.site.name}: azimuth and elevation of the Sun and the Earth over the ${result.horizon_model === "terrain" ? "terrain" : "flat"} horizon`}
      onMouseMove={(event: MouseEvent<SVGSVGElement>): void => {
        onHover(nearestIndex(event));
      }}
      onClick={(event: MouseEvent<SVGSVGElement>): void => {
        const nearest: number | null = nearestIndex(event);
        if (nearest !== null) {
          onSelect(nearest);
        }
      }}
      onMouseLeave={(): void => {
        onHover(null);
      }}
    >
      {terrainPath === null && (
        <rect
          className="below-horizon"
          x={MARGIN.left}
          y={y(0)}
          width={width - MARGIN.left - MARGIN.right}
          height={HEIGHT - MARGIN.bottom - y(0)}
        />
      )}
      {yTicks.map(
        (tick: number): JSX.Element => (
          <g key={`y${tick.toString()}`}>
            <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
            <text className="tick" x={MARGIN.left - 6} y={y(tick)} dy="0.32em" textAnchor="end">
              {`${tick.toString()}°`}
            </text>
          </g>
        ),
      )}
      {COMPASS.map(
        (c: { azimuth: number; label: string }): JSX.Element => (
          <g key={`x${c.azimuth.toString()}`}>
            <line className="grid" x1={x(c.azimuth)} x2={x(c.azimuth)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
            <text className="tick" x={x(c.azimuth)} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle">
              {c.label}
            </text>
          </g>
        ),
      )}
      {terrainPath === null ? (
        <>
          <line className="horizon" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} />
          <text className="horizon-label" x={x(112.5)} y={y(0) + 14} textAnchor="middle">
            Horizon (flat) · below it: not visible
          </text>
        </>
      ) : (
        <>
          <line className="grid zero" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} />
          <text className="horizon-label" x={width - MARGIN.right - 4} y={y(0) - 4} textAnchor="end">
            0°
          </text>
        </>
      )}
      <text className="axis-title" x={MARGIN.left} y={HEIGHT - 4}>
        Azimuth (clockwise from north)
      </text>
      <path className="track sun" d={sunPath} />
      <path className="track earth" d={earthPath} />
      <path className="trail sun" d={sunTrail} />
      <path className="trail earth" d={earthTrail} />
      {terrainPath !== null && <path className="terrain" d={terrainPath} />}
      <circle className="marker sun" cx={x(sunMarker.azimuthDeg)} cy={y(sunMarker.elevationDeg)} r={6} />
      <circle className="marker earth" cx={x(earthMarker.azimuthDeg)} cy={y(earthMarker.elevationDeg)} r={6} />
    </svg>
  );
}
