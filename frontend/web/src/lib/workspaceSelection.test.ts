import { afterEach, describe, expect, it } from "vitest";
import { loadSelection, saveSelection } from "./workspaceSelection.ts";

afterEach((): void => { localStorage.clear(); });

describe("workspace selection", (): void => {
  it("restores the root and the committed revision", (): void => {
    saveSelection({ rootId: "c0", revisionId: "c1", evaluationId: "e1", cursorUtc: "2026-11-07T05:00:00Z" });
    expect(loadSelection()).toEqual({ rootId: "c0", revisionId: "c1", evaluationId: "e1", cursorUtc: "2026-11-07T05:00:00Z" });
    // The Sprint 02–04 pointer stays in sync for older builds.
    expect(localStorage.getItem("lunar-ops-c0")).toBe("c0");
  });

  it("migrates the legacy C0 pointer and ignores malformed data", (): void => {
    expect(loadSelection()).toBeNull();
    localStorage.setItem("lunar-ops-c0", "legacy");
    expect(loadSelection()).toEqual({ rootId: "legacy", revisionId: "legacy", evaluationId: null, cursorUtc: null });
    localStorage.setItem("lunar-ops-selection", "{not json");
    expect(loadSelection()).toEqual({ rootId: "legacy", revisionId: "legacy", evaluationId: null, cursorUtc: null });
    localStorage.setItem("lunar-ops-selection", JSON.stringify({ rootId: "c0" }));
    expect(loadSelection()).toEqual({ rootId: "c0", revisionId: "c0", evaluationId: null, cursorUtc: null });
  });
});
