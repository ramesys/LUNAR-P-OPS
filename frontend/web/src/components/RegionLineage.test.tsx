import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { BrushRegion } from "../lib/explorationStore.ts";
import { RegionLineage } from "./RegionLineage.tsx";

afterEach(cleanup);

it("shows the selected candidate's actual region and parent evaluations", (): void => {
  const regions: BrushRegion[] = [{ id: "r", number: 1, execution: { experiment_id: "brush-1", results: [
    { sample: { candidate_id: "child", iteration: 1, reason: "visibility difference", parent_candidate_ids: ["parent"], parent_evaluation_ids: ["eval-parent"], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "eval-child" } },
  ] } }] as unknown as BrushRegion[];
  render(<RegionLineage regions={regions} candidateId="child" />);
  expect(screen.getByText(/Region 1/)).toBeTruthy();
  expect(screen.getByText(/visibility difference/)).toBeTruthy();
  expect(screen.getAllByText(/eval-parent/).length).toBeGreaterThan(0);
  expect(screen.getByText(/eval-child/)).toBeTruthy();
});

it("chooses temporal refinement lineage by evaluation ID when the candidate ID is reused", (): void => {
  const regions: BrushRegion[] = [{ id: "r", number: 1, execution: { experiment_id: "brush-1", results: [
    { sample: { candidate_id: "same", iteration: 0, reason: "seed", parent_candidate_ids: [], parent_evaluation_ids: [], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "coarse" } },
    { sample: { candidate_id: "same", iteration: 1, reason: "transition", parent_candidate_ids: ["same"], parent_evaluation_ids: ["coarse"], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "fine" } },
  ] } }] as unknown as BrushRegion[];
  render(<RegionLineage regions={regions} candidateId="same" evaluationId="fine" />);
  expect(screen.getByText(/transition/)).toBeTruthy();
  expect(screen.getByText(/Parent evaluations: coarse/)).toBeTruthy();
});

it("exposes ancestors beyond the immediate refinement parents", (): void => {
  const regions: BrushRegion[] = [{ id: "r", number: 2, execution: { results: [
    { sample: { candidate_id: "root", iteration: 0, reason: "seed", parent_candidate_ids: [], parent_evaluation_ids: [], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "root-e" } },
    { sample: { candidate_id: "middle", iteration: 1, reason: "middle reason", parent_candidate_ids: ["root"], parent_evaluation_ids: ["root-e"], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "middle-e" } },
    { sample: { candidate_id: "leaf", iteration: 2, reason: "leaf reason", parent_candidate_ids: ["middle"], parent_evaluation_ids: ["middle-e"], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "leaf-e" } },
  ] } }] as unknown as BrushRegion[];
  render(<RegionLineage regions={regions} candidateId="leaf" evaluationId="leaf-e" />);
  expect(screen.getByText(/root-e/)).toBeTruthy();
  expect(screen.getByText(/middle reason/)).toBeTruthy();
});

it("uses the inspected region when the same candidate appears in several regions", (): void => {
  const row: unknown = { sample: { candidate_id: "shared", iteration: 0, reason: "seed", parent_candidate_ids: [], parent_evaluation_ids: [], parent_terrain_screen_ids: [] }, evaluation: { evaluation_id: "shared-e" } };
  const regions: BrushRegion[] = [{ id: "one", number: 1, execution: { results: [row] } },
    { id: "two", number: 2, execution: { results: [row] } }] as unknown as BrushRegion[];
  render(<RegionLineage regions={regions} candidateId="shared" evaluationId="shared-e" regionId="two" />);
  expect(screen.getByText(/Region 2/)).toBeTruthy();
});
