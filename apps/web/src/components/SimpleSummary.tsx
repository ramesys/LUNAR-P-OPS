import type { SiteResult } from "@clps/api-client";
import type { JSX } from "react";
import { darknessSentence, earthSentence, sunSentence, verdict } from "../lib/plainLanguage.ts";
import { OriginChip } from "./OriginChip.tsx";

interface SimpleSummaryProps {
  sites: readonly SiteResult[];
}

/** RF-16: one plain-language card per site, in ranking order, with an overall verdict. */
export function SimpleSummary({ sites }: SimpleSummaryProps): JSX.Element {
  return (
    <div className="simple-summary">
      <p className="verdict">{verdict(sites)}</p>
      <ol className="site-cards">
        {sites.map(
          (s: SiteResult): JSX.Element => (
            <li key={s.site.id} className="site-card">
              <h3>
                <span className="rank">#{s.rank}</span> {s.site.name} <OriginChip origin={s.site.origin} />
              </h3>
              <ul>
                <li>
                  <span className="swatch sun" aria-hidden="true" /> {sunSentence(s)}
                </li>
                <li>
                  <span className="swatch night" aria-hidden="true" /> {darknessSentence(s.metrics.longest_darkness)}
                </li>
                <li>
                  <span className="swatch earth" aria-hidden="true" /> {earthSentence(s)}
                </li>
              </ul>
              {s.horizon_model === "flat" && (
                <p className="muted small-note">
                  Computed with a flat horizon: real hills and craters are not included for this site.
                </p>
              )}
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
