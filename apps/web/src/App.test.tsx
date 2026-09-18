import {
  createApiClient,
  type AnalysisRequest,
  type AnalysisResponse,
  type ApiClient,
  type Site,
  type SiteResult,
} from "@clps/api-client";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";

const SITES: Site[] = [
  { id: "sample-a", name: "Sample A", latitude_deg: -89.5, longitude_deg: 0, origin: "sample", note: "", terrain_available: true },
  { id: "sample-b", name: "Sample B", latitude_deg: -89, longitude_deg: 120, origin: "sample", note: "", terrain_available: true },
  { id: "sample-c", name: "Sample C", latitude_deg: -88.5, longitude_deg: 240, origin: "sample", note: "", terrain_available: true },
];

const TIMES: string[] = ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"];

function siteResult(site: Site, rank: number, sunFraction: number): SiteResult {
  return {
    rank,
    site,
    metrics: {
      sun_fraction: sunFraction,
      earth_fraction: 0.25,
      longest_darkness: {
        start: TIMES[0] ?? "",
        end: "2026-01-01T02:00:00Z",
        duration_hours: 2,
        visible: false,
        truncated: true,
      },
      longest_earth_outage: null,
    },
    horizon_model: "terrain",
    horizon_mask: { azimuth_deg: [0, 90, 180, 270], elevation_deg: [1, 2, 3, 2] },
    sun: { azimuth_deg: [10, 20], elevation_deg: [-1, 1.5], horizon_deg: [1.1, 1.2] },
    earth: { azimuth_deg: [350, 355], elevation_deg: [2, 3], horizon_deg: [1.1, 1.05] },
    sun_windows: [
      { start: TIMES[0] ?? "", end: "2026-01-01T02:00:00Z", duration_hours: 2, visible: false, truncated: true },
    ],
    earth_windows: [
      { start: TIMES[0] ?? "", end: "2026-01-01T02:00:00Z", duration_hours: 2, visible: true, truncated: true },
    ],
  };
}

function analysisFor(request: AnalysisRequest): AnalysisResponse {
  const selected: Site[] = SITES.filter((s: Site): boolean => request.site_ids.includes(s.id));
  return {
    request,
    times: TIMES,
    sites: selected
      .map((s: Site, i: number): SiteResult => siteResult(s, 0, i === 1 ? 0.9 : 0.4))
      .sort((a: SiteResult, b: SiteResult): number => b.metrics.sun_fraction - a.metrics.sun_fraction)
      .map((r: SiteResult, i: number): SiteResult => ({ ...r, rank: i + 1 })),
    assumptions: [{ key: "horizon", label: "Horizon model", value: "Flat local horizon" }],
    data_sources: [{ name: "NASA/JPL NAIF — de440s.bsp", description: "Ephemeris", url: "https://naif.jpl.nasa.gov/" }],
  };
}

function fakeApi(requests: AnalysisRequest[]): ApiClient {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: async (input: Request): Promise<Response> => {
      const path: string = new URL(input.url).pathname;
      if (path === "/api/sites") {
        return Response.json(SITES);
      }
      if (path === "/api/analysis") {
        const body: AnalysisRequest = (await input.json()) as AnalysisRequest;
        requests.push(body);
        if (body.site_ids.includes("sample-c") && body.site_ids.length === 2) {
          return Response.json({ detail: "unknown site ids: sample-c" }, { status: 422 });
        }
        return Response.json(analysisFor(body));
      }
      return Response.json({ status: "ok", api_version: "0.1.0", lunar_core_version: "0.1.0" });
    },
  });
}

afterEach((): void => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("App", (): void => {
  it("loads the catalog, runs a default comparison and shows the ranked table", async (): Promise<void> => {
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);

    const table: HTMLElement = await screen.findByRole("table", { name: /ranked by sunlit time/i });
    const rows: HTMLElement[] = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r: HTMLElement): string => within(r).getAllByRole("cell")[1]?.textContent ?? "")).toEqual([
      "Sample Bsample",
      "Sample Asample",
      "Sample Csample",
    ]);
    expect(within(table).getAllByText("≥ 2.0 h")).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      site_ids: ["sample-a", "sample-b", "sample-c"],
      start: "2026-03-15T00:00:00Z",
      end: "2026-04-14T00:00:00.000Z",
      step_minutes: 60,
      observer_height_m: 2,
      horizon: "terrain",
      earth_min_clearance_deg: 0,
    });
    expect(window.location.search).toContain("sites=sample-a%2Csample-b%2Csample-c");
    expect(screen.getByText("Flat local horizon")).toBeDefined();
    expect(screen.getByRole("link", { name: /de440s\.bsp/ })).toBeDefined();
    expect(screen.getByRole("img", { name: /Sky diagram for Sample B/ })).toBeDefined();
  });

  it("blocks invalid selections and shows API errors", async (): Promise<void> => {
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    const checkboxA: HTMLElement = screen.getByRole("checkbox", { name: /Sample A/ });
    const checkboxB: HTMLElement = screen.getByRole("checkbox", { name: /Sample B/ });
    fireEvent.click(checkboxA);
    fireEvent.click(checkboxB);
    expect(screen.getByText("Select between 2 and 4 sites.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Compare sites" })).toHaveProperty("disabled", true);

    fireEvent.click(checkboxA);
    fireEvent.click(screen.getByRole("button", { name: "Compare sites" }));

    expect(await screen.findByText("unknown site ids: sample-c")).toBeDefined();
  });

  it("opens the scenario encoded in a shared URL", async (): Promise<void> => {
    window.history.replaceState(
      null,
      "",
      "/?sites=sample-b,sample-a,unknown&from=2026-06-01&to=2026-06-07&step=120&height=5&horizon=flat&dte=3",
    );
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    expect(requests[0]).toEqual({
      site_ids: ["sample-b", "sample-a"],
      start: "2026-06-01T00:00:00Z",
      end: "2026-06-08T00:00:00.000Z",
      step_minutes: 120,
      observer_height_m: 5,
      horizon: "flat",
      earth_min_clearance_deg: 3,
    });
    expect(screen.getByRole("combobox", { name: /Horizon/ })).toHaveProperty("value", "flat");
  });
});
