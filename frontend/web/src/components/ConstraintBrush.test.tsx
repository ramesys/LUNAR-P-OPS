import { createApiClient, type ApiClient, type BrushDefinition, type BrushPreview, type BrushSample, type ScientificEvaluation, type Candidate } from "@clps/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { JSX } from "react";
import { evaluation } from "../lib/testFixtures.ts";
import type { BrushOverlay } from "../lib/brushTypes.ts";
import { ConstraintBrush } from "./ConstraintBrush.tsx";

function fakeApi(calls: string[]): ApiClient {
  return createApiClient({ baseUrl: "http://api.test", fetch: async (request: Request): Promise<Response> => {
    const path: string = new URL(request.url).pathname;
    calls.push(path);
    const body: Record<string, unknown> = await request.json() as Record<string, unknown>;
    const definition: BrushDefinition = (path.endsWith("/preview") ? body : body["definition"]) as BrushDefinition;
    const sample: BrushSample = { east_m: 0, north_m: 0, latitude_deg: -89.5, longitude_deg: 56, elevation_m: -28,
      candidate_id: "c0", status: "READY", already_persisted: false, error: null };
    const preview: BrushPreview = { definition, coordinate_reference: "MOON_ME", alignment: "ROI origin", tolerance_m: 1e-7,
      samples: [sample], ready_count: 1, new_count: 1, existing_count: 0, temporal_samples_per_point: 2, estimated_total_samples: 2, preview_token: "preview-token" };
    if (path.endsWith("/preview")) return Response.json(preview);
    const result: ScientificEvaluation = evaluation();
    return Response.json({ schema_version: "lunar-ops-brush/1", preview, results: [{ sample, verdict: "PASS", candidate: result.candidate,
      evaluation: result, persisted: true, errors: [], metrics: { sample_count: 2, duration_hours: 2, sun_fraction: 0.5,
        earth_fraction: 0, simultaneous_fraction: 0, longest_darkness_hours: 1, longest_earth_gap_hours: 2 } }], notes: [] });
  } });
}

afterEach(cleanup);

it("keeps drawing and preview read-only, and inspects a result only after explicit approval", async (): Promise<void> => {
  const calls: string[] = [];
  const created: Candidate[][] = [];
  const inspected: { candidate: Candidate; evaluationId: string | undefined }[] = [];
  render(<ConstraintBrush apiClient={fakeApi(calls)} defaultTimeUtc="2026-11-07T00:00:00Z"
    onCandidatesCreated={(c: Candidate[]): void => { created.push(c); }} onInspect={(candidate: Candidate, evaluationId?: string): void => { inspected.push({ candidate, evaluationId }); }}
    renderTerrain={(brush: BrushOverlay): JSX.Element => <button type="button" onClick={(): void => {
      brush.onAdd({ east_m: brush.vertices.length * 100, north_m: brush.vertices.length * 50 });
    }}>Test terrain click</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "Draw region" }));
  for (let i: number = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Test terrain click" }));
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Finish region" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  expect(calls).toEqual(["/api/rois/shackleton-rim-b/brush/preview"]);
  expect(screen.getByRole("button", { name: "Evaluate region & create candidates" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve evaluating/ }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate region & create candidates" }));
  await screen.findByRole("heading", { name: "Experiment results" });
  expect(created[0]?.[0]?.candidate_id).toBe("c0");
  fireEvent.click(screen.getByRole("button", { name: /PASS · 0 m E, 0 m N/ }));
  expect(inspected[0]?.candidate.candidate_id).toBe("c0");
  expect(inspected[0]?.evaluationId).toBe("e1");
});
