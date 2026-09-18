import type { Meridian, Parallel, PoleMap as PoleMapData, Site } from "@clps/api-client";
import type { JSX, KeyboardEvent } from "react";
import { formatLatLon } from "../lib/format.ts";
import { linearScale, type Scale } from "../lib/scale.ts";

const SIZE: number = 600;
const SCALE_BAR_KM: number = 50;
/** Approximate label glyph width (map-label font, SVG units) to size the click target. */
const LABEL_CHAR_WIDTH: number = 12;
/** Parallel labels sit between the 0°E and 30°E meridians, away from meridian lines. */
const PARALLEL_LABEL_ANGLE_RAD: number = (15 * Math.PI) / 180;

interface PoleMapProps {
  map: PoleMapData;
  sites: readonly Site[];
  selectedIds: readonly string[];
  ranks: ReadonlyMap<string, number>;
  maxSelected: number;
  onToggle: (siteId: string) => void;
}

function meridianLabel(longitude: number): string {
  if (longitude === 0) return "0°";
  if (longitude === 180) return "180°";
  return `${longitude.toString()}°E`;
}

/** Top-down map of the south pole (RF-15). Up = 0°E meridian, right = 90°E, as in LOLA maps. */
export function PoleMap({ map, sites, selectedIds, ranks, maxSelected, onToggle }: PoleMapProps): JSX.Element {
  const half: number = map.half_width_m;
  const x: Scale = linearScale([-half, half], [0, SIZE]);
  const y: Scale = linearScale([-half, half], [SIZE, 0]);
  const metersToPx: number = SIZE / (2 * half);
  const center: number = SIZE / 2;
  const full: boolean = selectedIds.length >= maxSelected;

  return (
    <figure className="pole-map">
      <svg
        className="chart map"
        viewBox={`0 0 ${SIZE.toString()} ${SIZE.toString()}`}
        role="group"
        aria-label={`Map of the lunar south pole, ±${(half / 1000).toFixed(0)} km around the pole, with candidate sites`}
      >
        <defs>
          <clipPath id="map-clip">
            <rect width={SIZE} height={SIZE} />
          </clipPath>
        </defs>
        <g clipPath="url(#map-clip)" className="map-background">
          {map.image_url === null ? (
            <rect className="map-empty" width={SIZE} height={SIZE} />
          ) : (
            <image href={map.image_url} width={SIZE} height={SIZE} preserveAspectRatio="none" />
          )}
          {map.parallels.map(
            (p: Parallel): JSX.Element => (
              <g key={`lat${p.latitude_deg.toString()}`}>
                <circle className="graticule" cx={center} cy={center} r={p.radius_m * metersToPx} />
                <text
                  className="graticule-label"
                  x={center + p.radius_m * metersToPx * Math.sin(PARALLEL_LABEL_ANGLE_RAD)}
                  y={center - p.radius_m * metersToPx * Math.cos(PARALLEL_LABEL_ANGLE_RAD)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {`${Math.abs(p.latitude_deg).toString()}°S`}
                </text>
              </g>
            ),
          )}
          {map.meridians.map(
            (m: Meridian): JSX.Element => (
              <g key={`lon${m.longitude_deg.toString()}`}>
                <line className="graticule" x1={center} y1={center} x2={x(m.x_m)} y2={y(m.y_m)} />
                <text
                  className="graticule-label"
                  x={center + (x(m.x_m) - center) * 0.93}
                  y={center + (y(m.y_m) - center) * 0.93}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {meridianLabel(m.longitude_deg)}
                </text>
              </g>
            ),
          )}
        </g>
        <path
          className="pole-mark"
          d={`M${(center - 9).toString()},${center.toString()}h18M${center.toString()},${(center - 9).toString()}v18`}
        />
        <text className="map-label" x={center - 10} y={center - 10} textAnchor="end">
          South Pole
        </text>

        {sites.map((site: Site): JSX.Element => {
          const selected: boolean = selectedIds.includes(site.id);
          const disabled: boolean = !selected && full;
          const rank: number | undefined = ranks.get(site.id);
          const cx: number = x(site.map_x_m);
          const cy: number = y(site.map_y_m);
          const toggle: () => void = (): void => {
            if (!disabled) {
              onToggle(site.id);
            }
          };
          const label: string = rank === undefined ? site.name : `#${rank.toString()} ${site.name}`;
          const description: string = `${site.name}, ${formatLatLon(site.latitude_deg, site.longitude_deg)}${
            rank === undefined ? "" : `, rank ${rank.toString()}`
          }${disabled ? " (limit reached)" : ""}`;
          return (
            <g
              key={site.id}
              className={`map-site${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-pressed={selected}
              aria-disabled={disabled}
              aria-label={description}
              onClick={toggle}
              onKeyDown={(event: KeyboardEvent<SVGGElement>): void => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }}
            >
              <title>{description}</title>
              {/* One target for dot and name, so clicking the label also toggles the site. */}
              <rect
                className="hit"
                x={cx - 22}
                y={cy - 22}
                width={44 + label.length * LABEL_CHAR_WIDTH}
                height={44}
                rx={22}
              />
              <circle className="dot" cx={cx} cy={cy} r={10} />
              <text className="map-label" x={cx + 15} y={cy + 6}>
                {label}
              </text>
            </g>
          );
        })}

        <g className="scale-bar" transform={`translate(20 ${(SIZE - 24).toString()})`}>
          <line x1={0} x2={SCALE_BAR_KM * 1000 * metersToPx} y1={0} y2={0} />
          <text className="map-label" x={0} y={-9}>
            {`${SCALE_BAR_KM.toString()} km`}
          </text>
        </g>
      </svg>
      <figcaption className="muted">
        Click a site (or focus it and press Enter) to add or remove it.{" "}
        {map.image_url === null ? (
          "Relief image not downloaded yet."
        ) : (
          <>
            Relief:{" "}
            <a href={map.source_url} target="_blank" rel="noreferrer">
              {map.source_name}
            </a>
            .
          </>
        )}
      </figcaption>
    </figure>
  );
}
