import { createApiClient, type AnalysisResponse, type Site, type SiteResult } from "@clps/api-client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExplorationStore, ExplorationContext } from "../lib/explorationStore.ts";
import { ChartsPanel } from "./ChartsPanel.tsx";

const HOURS: number = 48;
const T0: number = Date.parse("2026-01-01T00:00:00Z");
const TIMES: string[] = Array.from({ length: HOURS }, (_u: unknown, i: number): string =>
  new Date(T0 + i * 3_600_000).toISOString().replace(".000Z", "Z"),
);
const END: string = new Date(T0 + HOURS * 3_600_000).toISOString().replace(".000Z", "Z");
const MID: string = TIMES[12] ?? "";

const SITE: Site = {
  id: "sample-a",
  name: "Sample A",
  latitude_deg: -89.5,
  longitude_deg: 0,
  origin: "sample",
  note: "",
  terrain_available: false,
  map_x_m: 0,
  map_y_m: 15_000,
};

const series: { azimuth_deg: number[]; elevation_deg: number[]; horizon_deg: number[] } = {
  azimuth_deg: TIMES.map((_t: string, i: number): number => (i * 7.5) % 360),
  elevation_deg: TIMES.map((_t: string, i: number): number => (i < 12 ? 1 : -1)),
  horizon_deg: TIMES.map((): number => 0),
};

const FOCUSED: SiteResult = {
  rank: 1,
  site: SITE,
  horizon_model: "flat",
  horizon_mask: null,
  metrics: { sun_fraction: 0.25, earth_fraction: 1, longest_darkness: null, longest_earth_outage: null },
  sun: series,
  earth: series,
  sun_windows: [
    { start: TIMES[0] ?? "", end: MID, duration_hours: 12, visible: true, truncated: true },
    { start: MID, end: END, duration_hours: 36, visible: false, truncated: true },
  ],
  earth_windows: [{ start: TIMES[0] ?? "", end: END, duration_hours: 48, visible: true, truncated: true }],
};

const RESULT: AnalysisResponse = {
  request: {
    site_ids: ["sample-a", "sample-b"],
    start: TIMES[0] ?? "",
    end: END,
    step_minutes: 60,
    observer_height_m: 2,
    horizon: "flat",
    earth_min_clearance_deg: 0,
  },
  times: TIMES,
  sites: [FOCUSED],
  assumptions: [],
  data_sources: [],
};

function renderPanel(): void {
  // Each test gets its own exploration store, as each App instance does.
  render(
    <ExplorationContext.Provider value={createExplorationStore()}><ChartsPanel
      result={RESULT}
      focused={FOCUSED}
      mode="expert"
      apiClient={createApiClient({ baseUrl: "http://api.test" })}
      onCandidateSelected={(): void => { /* no-op */ }}
      onSelectionStarted={(): void => { /* no-op */ }}
      onFocus={(): void => {
        /* no-op */
      }}
    /></ExplorationContext.Provider>,
  );
}

function shownTime(): string {
  return screen.getByRole("group", { name: "Time control" }).querySelector("output")?.textContent ?? "";
}

beforeEach((): void => {
  vi.useFakeTimers();
});

afterEach((): void => {
  cleanup();
  vi.useRealTimers();
});

describe("ChartsPanel time control (RF-12)", (): void => {
  it("plays at the selected speed and stops at the end of the range", (): void => {
    renderPanel();
    expect(shownTime()).toBe("2026-01-01 00:00 UTC");

    fireEvent.change(screen.getByRole("combobox", { name: "Speed" }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act((): void => {
      vi.advanceTimersByTime(1000);
    });
    expect(shownTime()).toBe("2026-01-01 06:00 UTC");

    act((): void => {
      vi.advanceTimersByTime(60_000);
    });
    expect(shownTime()).toBe("2026-01-02 23:00 UTC");
    expect(screen.getByRole("button", { name: "Play" })).toBeDefined();
  });

  it("steps, scrubs and reports visibility at the shown instant", (): void => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(shownTime()).toBe("2026-01-01 01:00 UTC");
    expect(screen.getByText(/Sun up/)).toBeDefined();

    fireEvent.change(screen.getByRole("slider", { name: "Time" }), { target: { value: "20" } });
    expect(shownTime()).toBe("2026-01-01 20:00 UTC");
    expect(screen.getByText(/Sun hidden/)).toBeDefined();
    expect(screen.getByText(/Earth in view \(DTE\)/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Step back" }));
    expect(shownTime()).toBe("2026-01-01 19:00 UTC");

    fireEvent.click(screen.getByRole("button", { name: "Go to start" }));
    expect(shownTime()).toBe("2026-01-01 00:00 UTC");
  });
});
