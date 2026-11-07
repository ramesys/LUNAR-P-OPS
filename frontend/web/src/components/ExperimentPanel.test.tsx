import { createApiClient, type ApiClient, type ExperimentManifest, type RecomputeReport, type ScientificEvaluation } from "@clps/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluation } from "../lib/testFixtures.ts";
import { ExperimentPanel } from "./ExperimentPanel.tsx";

const downloads: { name: string; blob: Blob }[] = [];
vi.mock("../lib/download.ts", () => ({ downloadBlob: (name: string, blob: Blob): void => { downloads.push({ name, blob }); } }));

const stored: ScientificEvaluation = evaluation();
const MANIFEST: ExperimentManifest = { schema_version: "lunar-ops-experiment/1", evaluation_id: stored.evaluation_id, candidate_id: "c0", parent_candidate_id: null,
  candidate: stored.candidate, request: stored.request, terrain: { near: { sha256: "99be" } }, software: { software_commit: "not_recorded" },
  not_recorded: ["software_commit"] } as unknown as ExperimentManifest;
const REPORT: RecomputeReport = { evaluation_id: stored.evaluation_id, persisted: false, outcome: "reproduced", stored_status: "COMPUTED_UNVERIFIED",
  recomputed_status: "COMPUTED_UNVERIFIED", stored_output_sha256: "a", recomputed_output_sha256: "a", recomputed_errors: [],
  input_checks: [{ name: "near_sha256", stored: "\"99be\"", current: "\"99be\"", match: true }], tolerances: { angles_deg: 1e-9 },
  differences: { sun_elevation_deg_max_abs: 0 }, validation_status: "not_independently_validated", notes: ["Not stored."] } as unknown as RecomputeReport;

function api(calls: string[]): ApiClient {
  return createApiClient({ baseUrl: "http://api.test", fetch: (request: Request): Promise<Response> => {
    const path: string = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    return Promise.resolve(Response.json(path.endsWith("/manifest") ? MANIFEST : REPORT));
  } });
}

afterEach((): void => { cleanup(); downloads.length = 0; });

describe("Experiment panel", (): void => {
  it("exports the stored manifest as JSON and names unrecorded provenance", async (): Promise<void> => {
    const calls: string[] = [];
    render(<ExperimentPanel apiClient={api(calls)} evaluation={stored} />);
    fireEvent.click(screen.getByRole("button", { name: "Export experiment (JSON)" }));
    expect(await screen.findByText(/Not recorded for this evaluation: software_commit/)).toBeDefined();
    expect(calls).toEqual([`GET /api/evaluations/${stored.evaluation_id}/manifest`]);
    expect(downloads[0]?.name).toMatch(/^lunar-ops-experiment_.*\.json$/);
    expect(JSON.parse(await downloads[0]?.blob.text() ?? "{}")).toEqual(MANIFEST);
  });

  it("reports a recompute without claiming validation", async (): Promise<void> => {
    const calls: string[] = [];
    render(<ExperimentPanel apiClient={api(calls)} evaluation={stored} />);
    fireEvent.click(screen.getByRole("button", { name: /Recompute/ }));
    const report: HTMLElement = await screen.findByLabelText("Recompute report");
    expect(report.textContent).toContain("Reproduced");
    expect(report.textContent).toContain("not stored");
    expect(report.textContent).toContain("not independently validated");
    expect(calls).toEqual([`POST /api/evaluations/${stored.evaluation_id}/recompute`]);
  });
});
