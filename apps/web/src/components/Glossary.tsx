import type { JSX } from "react";

const TERMS: readonly { term: string; definition: string }[] = [
  {
    term: "Azimuth",
    definition:
      "Compass direction of an object along the horizon, measured clockwise from north: N = 0°, E = 90°, S = 180°, W = 270°.",
  },
  {
    term: "Elevation",
    definition:
      "Angle of an object above (positive) or below (negative) the horizon. Near the lunar south pole the Sun never climbs more than a few degrees.",
  },
  {
    term: "DTE (direct-to-Earth)",
    definition:
      "Communicating straight with antennas on Earth, without a relay satellite. It needs the Earth above the local horizon.",
  },
  {
    term: "Upper limb",
    definition:
      "The top edge of the Sun's disk. A site counts as sunlit as soon as the upper limb rises above the horizon, even if the center has not.",
  },
  {
    term: "Libration",
    definition:
      "A slow apparent wobble of the Moon. It makes the Earth drift up and down near the horizon at polar sites, so DTE comes and goes.",
  },
  {
    term: "Truncated window",
    definition:
      "A period that touches the start or end of the selected dates, so it really lasts at least as long as shown (marked '≥').",
  },
];

export function Glossary(): JSX.Element {
  return (
    <section className="card" aria-labelledby="glossary-title">
      <h2 id="glossary-title">Glossary</h2>
      <dl className="glossary">
        {TERMS.map(
          (t: { term: string; definition: string }): JSX.Element => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.definition}</dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
