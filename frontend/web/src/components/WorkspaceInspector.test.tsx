import type { Candidate } from "@clps/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { evaluation } from "../lib/testFixtures.ts";
import { WorkspaceInspector, type Draft } from "./WorkspaceInspector.tsx";

const root: Candidate = evaluation().candidate;
const child: Candidate = { ...root, candidate_id: "c1", parent_candidate_id: "c0", observer_height_m: 6 };

afterEach(cleanup);

function view(props: Partial<Parameters<typeof WorkspaceInspector>[0]>, log: string[] = [], drafts: Draft[] = []): void {
  render(<WorkspaceInspector root={root} child={child} selected={root} selectedRef={null} evaluation={null} c0Result={null} c1Result={null}
    draft={{ observer_height_m: 2, selected_time_utc: root.selected_time_utc }} mode="simple" busy={false}
    onSelectRevision={(c: Candidate): void => { log.push(c.candidate_id); }} onDraftChange={(d: Draft): void => { drafts.push(d); }} {...props} />);
}

describe("Workspace inspector", (): void => {
  it("keeps data availability, computation and validation as separate statuses", (): void => {
    view({ evaluation: evaluation() });
    expect(screen.getByText("Data available")).toBeDefined();
    expect(screen.getByText("Computed")).toBeDefined();
    expect(screen.getByText("Not independently validated")).toBeDefined();
    // The original sky diagram and timeline render the persisted result.
    expect(screen.getByRole("img", { name: /Sky diagram for C0 candidate/ })).toBeDefined();
    expect(screen.getByRole("img", { name: /Timeline: height of the Sun and the Earth above the terrain horizon/ })).toBeDefined();
  });

  it("shows unavailable and not-evaluated states explicitly", (): void => {
    view({ evaluation: evaluation("UNAVAILABLE") });
    expect(screen.getByText("Unavailable")).toBeDefined();
    expect(screen.getAllByRole("alert")[0]?.textContent).toContain("coverage");
    expect(screen.queryByRole("img", { name: /Sky diagram/ })).toBeNull();
    cleanup();
    view({});
    expect(screen.getByText("Not evaluated")).toBeDefined();
  });

  it("selects revisions and reports parameter edits without saving them", (): void => {
    const log: string[] = [];
    const drafts: Draft[] = [];
    view({ draft: { observer_height_m: 9, selected_time_utc: root.selected_time_utc } }, log, drafts);
    expect(screen.getByRole("status").textContent).toMatch(/Unsaved edit/);
    fireEvent.click(screen.getByRole("button", { name: "C1" }));
    expect(log).toEqual(["c1"]);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Observer height/ }), { target: { value: "12" } });
    expect(drafts).toEqual([{ observer_height_m: 12, selected_time_utc: root.selected_time_utc }]);
  });
});
