import type { SiteResult } from "@clps/api-client";
import type { JSX } from "react";
import { formatLatLon, formatPercent, formatWindowDuration } from "../lib/format.ts";
import { InfoTip } from "./InfoTip.tsx";

interface ComparisonTableProps {
  sites: readonly SiteResult[];
  focusedId: string | null;
  onFocus: (siteId: string) => void;
}

export function ComparisonTable({ sites, focusedId, onFocus }: ComparisonTableProps): JSX.Element {
  return (
    <div className="table-scroll">
      <table className="comparison">
        <caption>Sites ranked by sunlit time (highest first)</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Site</th>
            <th scope="col" className="num">
              Sunlit <InfoTip text="Share of samples in which the Sun's upper limb is above the horizon." />
            </th>
            <th scope="col" className="num">
              Earth in view{" "}
              <InfoTip text="Share of samples in which the Earth's center is above the horizon, allowing direct-to-Earth (DTE) communication." />
            </th>
            <th scope="col" className="num">
              Longest darkness{" "}
              <InfoTip text="Longest continuous period without sunlight: key for sizing batteries. '≥' means it is cut by the edge of the date range." />
            </th>
            <th scope="col" className="num">
              Longest DTE gap{" "}
              <InfoTip text="Longest continuous period with the Earth below the horizon (no direct communication)." />
            </th>
            <th scope="col">
              Horizon{" "}
              <InfoTip text="Terrain: NASA LOLA elevation data. Flat: no terrain (requested, or no terrain data for this site)." />
            </th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((result: SiteResult): JSX.Element => {
            const focused: boolean = result.site.id === focusedId;
            return (
              <tr key={result.site.id} className={focused ? "focused" : undefined}>
                <td className="num">{result.rank}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    aria-pressed={focused}
                    onClick={(): void => {
                      onFocus(result.site.id);
                    }}
                  >
                    {result.site.name}
                  </button>
                  {result.site.origin === "sample" && <span className="chip">sample</span>}
                </td>
                <td className="num">{formatPercent(result.metrics.sun_fraction)}</td>
                <td className="num">{formatPercent(result.metrics.earth_fraction)}</td>
                <td className="num">{formatWindowDuration(result.metrics.longest_darkness)}</td>
                <td className="num">
                  {formatWindowDuration(result.metrics.longest_earth_outage)}
                </td>
                <td>{result.horizon_model === "terrain" ? "Terrain" : "Flat"}</td>
                <td className="muted">
                  {formatLatLon(result.site.latitude_deg, result.site.longitude_deg)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
