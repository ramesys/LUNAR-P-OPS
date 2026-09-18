import type { Assumption, DataSource } from "@clps/api-client";
import type { JSX } from "react";

interface AssumptionsPanelProps {
  assumptions: readonly Assumption[];
  dataSources: readonly DataSource[];
}

export function AssumptionsPanel({ assumptions, dataSources }: AssumptionsPanelProps): JSX.Element {
  return (
    <section className="card" aria-labelledby="assumptions-title">
      <h2 id="assumptions-title">Assumptions &amp; sources</h2>
      <dl className="assumptions">
        {assumptions.map(
          (a: Assumption): JSX.Element => (
            <div key={a.key}>
              <dt>{a.label}</dt>
              <dd>{a.value}</dd>
            </div>
          ),
        )}
        <div>
          <dt>Sites</dt>
          <dd>Placeholder samples with arbitrary coordinates, not official CLPS landing sites.</dd>
        </div>
      </dl>
      <h3>Data sources</h3>
      <ul className="sources">
        {dataSources.map(
          (s: DataSource): JSX.Element => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>{" "}
              <span className="muted">{s.description}</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
