import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createExplorationStore, ExplorationContext, INITIAL, type ExplorationStore } from "../lib/explorationStore.ts";
import { evaluation } from "../lib/testFixtures.ts";
import { ContextBadge, ContextBar } from "./ContextBar.tsx";

afterEach(cleanup);

describe("Context bar", (): void => {
  it("names each context's result, sample and draft state, and switches the active one", (): void => {
    const store: ExplorationStore = createExplorationStore({ ...INITIAL, rootId: "c0", revisionId: "c0" });
    store.dispatch({ type: "evaluation", evaluation: evaluation() });
    store.dispatch({ type: "draft", draft: { observer_height_m: 9, selected_time_utc: "2026-11-07T00:00:00Z" } });
    store.dispatch({ type: "catalog-analysis", analysisKey: "analysis-0badf00d", label: "3 sites · 2026-11-07 → 2026-12-06 · 60 min · terrain horizon",
      times: ["2026-11-07T00:00:00Z", "2026-11-07T01:00:00Z"], stepMinutes: 60 });
    store.dispatch({ type: "catalog-focus", focus: { siteId: "sample-b", name: "Sample B", latitude_deg: -89, longitude_deg: 120 } });
    render(<ExplorationContext.Provider value={store}><ContextBar /><ContextBadge of="catalog" /></ExplorationContext.Provider>);
    const candidate: HTMLElement = screen.getByRole("button", { name: /Candidate evaluation/ });
    const catalog: HTMLElement = screen.getByRole("button", { name: /Catalog comparison/ });
    expect(candidate.getAttribute("aria-pressed")).toBe("true");
    expect(candidate.textContent).toContain("C0");
    expect(candidate.textContent).toContain("e1");
    expect(candidate.textContent).toContain("sample 1/2");
    expect(candidate.textContent).toContain("Unsaved draft differs from the evaluated inputs");
    expect(catalog.textContent).toContain("Sample B");
    expect(catalog.textContent).toContain("analysis-0badf00d");
    expect(screen.getByText(/Catalog comparison · inactive/)).toBeDefined();
    fireEvent.click(catalog);
    expect(store.getState().context).toBe("catalog");
    expect(catalog.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Catalog comparison · active context/)).toBeDefined();
    act((): void => { store.dispatch({ type: "catalog-cursor", utc: "2026-11-07T01:00:00Z" }); });
    expect(catalog.textContent).toContain("sample 2/2");
    expect(candidate.textContent).toContain("sample 1/2");
  });
});
