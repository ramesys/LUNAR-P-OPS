import type { BrushResult } from "@clps/api-client";
import type { JSX } from "react";
import type { BrushRegion } from "../lib/explorationStore.ts";

/** Read-only relationship to the existing C0; does not change the Rete C0/C1 dataflow. */
export function RegionLineage({ regions, candidateId, evaluationId = null, regionId = null }: { regions: readonly BrushRegion[]; candidateId: string; evaluationId?: string | null; regionId?: string | null }): JSX.Element | null {
  const matching: (x: BrushResult) => boolean = (x: BrushResult): boolean => x.sample.candidate_id === candidateId && x.evaluation?.evaluation_id === evaluationId;
  const region: BrushRegion | undefined = regions.find((r): boolean => r.id === regionId && r.execution?.results.some((x): boolean => x.sample.candidate_id === candidateId) === true)
    ?? regions.find((r): boolean => r.execution?.results.some(matching) === true)
    ?? regions.find((r): boolean => r.execution?.results.some((x): boolean => x.sample.candidate_id === candidateId) === true);
  const item: BrushResult | undefined = region?.execution?.results.find(matching)
    ?? region?.execution?.results.find((x): boolean => x.sample.candidate_id === candidateId);
  if (region === undefined || item === undefined) return null;
  const ancestors: BrushResult[] = [];
  const visited: Set<string> = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const parent: BrushResult | undefined = region?.execution?.results.find((entry): boolean => entry.evaluation?.evaluation_id === id);
    if (parent === undefined) return;
    parent.sample.parent_evaluation_ids.forEach(visit);
    ancestors.push(parent);
  }
  item.sample.parent_evaluation_ids.forEach(visit);
  return <details className="region-lineage"><summary>Region-to-candidate evidence</summary>
    <p>Region {region.number} → {item.sample.iteration === 0 ? "initial candidate" : `adaptive refinement ${item.sample.iteration.toString()}`} → candidate {candidateId}</p>
    <p>{item.sample.reason ?? "Uniform grid location"}</p>
    {item.sample.priority && <p>Selection priority: {item.sample.priority}</p>}
    {item.sample.parent_candidate_ids.length > 0 && <p>Parent candidates: {item.sample.parent_candidate_ids.join(", ")}<br />Parent evaluations: {item.sample.parent_evaluation_ids.join(", ")}</p>}
    {ancestors.length > 0 && <ol aria-label="Scientific ancestors">{ancestors.map((parent): JSX.Element => <li key={parent.evaluation?.evaluation_id}>
      Candidate {parent.sample.candidate_id ?? "unavailable"} · evaluation {parent.evaluation?.evaluation_id ?? "unavailable"} · {parent.sample.reason ?? "initial"}
    </li>)}</ol>}
    <p>Evaluation: {item.evaluation?.evaluation_id ?? "unavailable"} · {item.evaluation?.status ?? item.verdict}</p>
    {region.execution?.experiment_id && <p>Experiment: {region.execution.experiment_id}</p>}
  </details>;
}
