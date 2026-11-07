import {
  createApiClient,
  type AnalysisRequest,
  type AnalysisResponse,
  type ApiClient,
  type Candidate,
  type Site,
  type SiteResult,
} from "@clps/api-client";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "react";
import { App } from "./App.tsx";

vi.mock("./components/LandingGraph.tsx", () => ({
  LandingGraph: ({ selectedRevisionId }: { selectedRevisionId: string }): JSX.Element =>
    <div data-testid="stable-editor" data-revision={selectedRevisionId}><input aria-label="Editor draft" defaultValue="draft" /></div>,
}));

const RESTORED: Candidate = { candidate_id: "saved-c0", site_id: "site", latitude_deg: -89.5,
  longitude_deg: 0, terrain_elevation_m: 10, observer_height_m: 2, selected_time_utc: "2026-01-01T00:00:00Z",
  terrain_dataset_id: "LOLA", terrain_source_url: "https://example.org", terrain_dataset_sha256: "hash",
  terrain_nodata: "NaN", coverage_bounds_m: [0,0,1,1], dem_resolution_m: 20, coordinate_reference: "MOON_ME",
  validation_status: "not_independently_validated", data_availability: "available", terrain_window_id: "sample-a" };

const SITES: Site[] = [
  { id: "sample-a", name: "Sample A", latitude_deg: -89.5, longitude_deg: 0, origin: "sample", note: "", terrain_available: true, map_x_m: 0, map_y_m: 15000 },
  { id: "sample-b", name: "Sample B", latitude_deg: -89, longitude_deg: 120, origin: "sample", note: "", terrain_available: true, map_x_m: 0, map_y_m: 15000 },
  { id: "sample-c", name: "Sample C", latitude_deg: -88.5, longitude_deg: 240, origin: "sample", note: "", terrain_available: true, map_x_m: 0, map_y_m: 15000 },
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
  const selected: Site[] = request.site_ids.map(
    (id: string): Site =>
      SITES.find((s: Site): boolean => s.id === id) ??
      customSite(Number(id.split(":")[1]), Number(id.split(":")[2])),
  );
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

function customSite(latitude: number, longitude: number): Site {
  return {
    id: `custom:${latitude.toString()}:${longitude.toString()}`,
    name: `Custom ${Math.abs(latitude).toFixed(2)}°S ${longitude.toFixed(2)}°E`,
    latitude_deg: latitude,
    longitude_deg: longitude,
    origin: "custom",
    note: "",
    terrain_available: false,
    map_x_m: 1000,
    map_y_m: 1000,
  };
}

function fakeApi(requests: AnalysisRequest[]): ApiClient {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: async (input: Request): Promise<Response> => {
      const path: string = new URL(input.url).pathname;
      if (path === "/api/candidates/saved-c0") return Response.json(RESTORED);
      if (path === "/api/rois/shackleton-rim-b/terrain") return Response.json({ detail: "LOLA windows for shackleton-rim-b are not downloaded" }, { status: 404 });
      if (path === "/api/rois/shackleton-rim-b/candidates") return Response.json([]);
      if (path === "/api/sites") {
        return Response.json(SITES);
      }
      if (path === "/api/sites/custom") {
        const query: URLSearchParams = new URL(input.url).searchParams;
        const latitude: number = Number(query.get("latitude"));
        if (latitude > -60) {
          return Response.json({ detail: "custom sites must be in the south polar region" }, { status: 422 });
        }
        return Response.json(customSite(latitude, Number(query.get("longitude"))));
      }
      if (path.startsWith("/api/sites/")) {
        const id: string = decodeURIComponent(path.slice("/api/sites/".length));
        const match: RegExpExecArray | null = /^custom:(-?[\d.]+):(-?[\d.]+)$/.exec(id);
        if (match === null) {
          return Response.json({ detail: `unknown site id: ${id}` }, { status: 404 });
        }
        return Response.json(customSite(Number(match[1]), Number(match[2])));
      }
      if (path === "/api/map") {
        return Response.json({
          half_width_m: 100_000,
          image_url: null,
          parallels: [],
          meridians: [],
          source_name: "LOLA hillshade",
          source_url: "https://pgda.gsfc.nasa.gov/products/90",
        });
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
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("App", (): void => {
  it("keeps the empty landing workspace visible without a candidate", async (): Promise<void> => {
    localStorage.clear();
    render(<App apiClient={fakeApi([])} now={new Date("2026-03-15T10:00:00Z")} />);
    expect(await screen.findByRole("heading", { name: "Landing Graph" })).toBeDefined();
    expect(screen.getByText(/select a terrain point to create a candidate/i)).toBeDefined();
    expect(screen.getByRole("region", { name: "Candidate timeline dock" }).textContent).toContain("No evaluation");
  });

  it("restores the selected committed revision and keeps every area in both modes", async (): Promise<void> => {
    localStorage.setItem("lunar-ops-selection", JSON.stringify({ rootId: "saved-c0", revisionId: "saved-c1" }));
    render(<App apiClient={fakeApi([])} now={new Date("2026-03-15T10:00:00Z")} />);
    const editor: HTMLElement = await screen.findByTestId("stable-editor");
    expect(editor.getAttribute("data-revision")).toBe("saved-c1");
    await screen.findByRole("table", { name: /ranked by sunlit time/i });
    for (const mode of ["Expert", "Simple"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      expect(screen.getByRole("heading", { name: /Terrain explorer/ })).toBeDefined();
      expect(screen.getByRole("heading", { name: "Catalog site comparison" })).toBeDefined();
      expect(screen.getByRole("heading", { name: "Sky & timeline" })).toBeDefined();
      expect(screen.getByRole("heading", { name: "South pole map" })).toBeDefined();
      expect(screen.getByTestId("stable-editor")).toBe(editor);
    }
    // The ROI terrain is missing in this fake API: the workspace says so instead of hiding.
    expect(screen.getByText(/ROI terrain unavailable/)).toBeDefined();
  });

  it("restores the editor and preserves its draft when comparisons and modes change", async (): Promise<void> => {
    localStorage.setItem("lunar-ops-c0", "saved-c0");
    render(<App apiClient={fakeApi([])} now={new Date("2026-03-15T10:00:00Z")} />);
    const draft: HTMLElement = await screen.findByRole("textbox", { name: "Editor draft" });
    fireEvent.change(draft, { target: { value: "my retained draft" } });
    await screen.findByRole("table", { name: /ranked by sunlit time/i });
    fireEvent.click(screen.getByRole("button", { name: "Compare sites" }));
    fireEvent.click(screen.getByRole("button", { name: /Expert/ }));
    expect(await screen.findByRole("textbox", { name: "Editor draft" })).toBe(draft);
    expect(draft).toHaveProperty("value", "my retained draft");
    expect(screen.getByRole("heading", { name: "Sky & timeline" })).toBeDefined();
  });
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
      "/?sites=sample-b,sample-a,unknown&from=2026-06-01&to=2026-06-07&step=120&height=5&horizon=flat&dte=3&mode=expert",
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

  it("selects sites from the pole map", async (): Promise<void> => {
    render(<App apiClient={fakeApi([])} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    const checkboxC: HTMLElement = screen.getByRole("checkbox", { name: /Sample C/ });
    expect(checkboxC).toHaveProperty("checked", true);
    fireEvent.click(await screen.findByRole("button", { name: /^Sample C,/ }));
    expect(checkboxC).toHaveProperty("checked", false);
  });

  it("adds a custom site by coordinates and marks it as flat-only", async (): Promise<void> => {
    window.history.replaceState(null, "", "/?mode=expert");
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });
    fireEvent.click(screen.getByRole("checkbox", { name: /Sample C/ }));

    fireEvent.change(screen.getByRole("spinbutton", { name: /Latitude/ }), { target: { value: "-45" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Longitude/ }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    expect(await screen.findByText(/between -90° and -60°/)).toBeDefined();

    fireEvent.change(screen.getByRole("spinbutton", { name: /Latitude/ }), { target: { value: "-87.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add site" }));
    const custom: HTMLElement = await screen.findByRole("checkbox", { name: /Custom 87.50°S 10.00°E/ });
    expect(custom).toHaveProperty("checked", true);
    expect(screen.getAllByText("custom").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Compare sites" }));
    const inResults: HTMLElement[] = await screen.findAllByRole("button", { name: "Custom 87.50°S 10.00°E" });
    expect(inResults.length).toBeGreaterThan(0);
    expect(requests.at(-1)?.site_ids).toEqual(["sample-a", "sample-b", "custom:-87.5:10"]);
  });

  it("restores custom sites from a shared link", async (): Promise<void> => {
    window.history.replaceState(null, "", "/?sites=sample-a,custom:-86:200,custom:bad&from=2026-06-01&to=2026-06-02");
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    expect(requests[0]?.site_ids).toEqual(["sample-a", "custom:-86:200"]);
    expect(screen.getByRole("checkbox", { name: /Custom 86.00°S 200.00°E/ })).toHaveProperty("checked", true);
  });

  it("starts in Simple mode with plain-language results and hidden expert settings", async (): Promise<void> => {
    render(<App apiClient={fakeApi([])} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    expect(screen.getByRole("button", { name: "Simple" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/leads on both counts|Most sunlight:/)).toBeDefined();
    expect(screen.getAllByText(/days of sunlight per month/).length).toBe(3);
    expect(screen.queryByRole("combobox", { name: /Horizon/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add site" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Export" })).toBeNull();
    expect(screen.getByText("How to read the sky diagram").closest("details")?.open).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expert" }));
    expect(window.location.search).toContain("mode=expert");
    expect(screen.getByRole("combobox", { name: /Horizon/ })).toBeDefined();
    expect(screen.getByRole("group", { name: "Export" })).toBeDefined();
    expect(screen.queryByText(/days of sunlight per month/)).toBeNull();
  });

  it("warns in Simple mode about expert settings from a link and resets them", async (): Promise<void> => {
    window.history.replaceState(null, "", "/?sites=sample-a,sample-b&horizon=flat&dte=2&mode=simple");
    const requests: AnalysisRequest[] = [];
    render(<App apiClient={fakeApi(requests)} now={new Date("2026-03-15T10:00:00Z")} />);
    await screen.findByRole("table", { name: /ranked by sunlit time/i });

    expect(screen.getByText(/Expert settings in use: flat horizon \(terrain ignored\); Earth at least 2°/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.queryByText(/Expert settings in use/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Compare sites" }));
    await screen.findAllByRole("button", { name: "Sample B" });
    expect(requests.at(-1)).toMatchObject({ horizon: "terrain", earth_min_clearance_deg: 0 });
  });
});
