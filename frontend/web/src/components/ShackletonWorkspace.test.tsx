import { createApiClient, type ApiClient, type Candidate, type RoiTerrain } from "@clps/api-client";
import { act, cleanup, fireEvent, render, screen, within, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "react";
import type { RoiTerrain3DProps } from "./RoiTerrain3D.tsx";
import { ShackletonWorkspace } from "./ShackletonWorkspace.tsx";

// WebGL is unavailable in jsdom: the stand-in exposes the same picking callbacks and markers.
vi.mock("./RoiTerrain3D.tsx", () => ({
  RoiTerrain3D: ({ candidates, selectedId, onPick, onSelectMarker }: RoiTerrain3DProps): JSX.Element => <div>
    <button type="button" onClick={(): void => { onPick({ east_m: -1500, north_m: 800 }); }}>pick west</button>
    <button type="button" onClick={(): void => { onPick({ east_m: 1200, north_m: -1700 }); }}>pick east</button>
    <button type="button" onClick={(): void => { onPick({ east_m: 2500, north_m: 0 }); }}>pick outside</button>
    <ul aria-label="scene markers">{candidates.map((c) => <li key={c.candidate_id}>
      <button type="button" onClick={(): void => { onSelectMarker(c.candidate_id); }}>{`marker ${c.candidate_id}${c.candidate_id === selectedId ? " selected" : ""}`}</button></li>)}</ul>
  </div>,
}));

const TERRAIN: RoiTerrain = { roi: { roi_id: "shackleton-rim-b", name: "Shackleton Rim B", center_latitude_deg: -89.5244, center_longitude_deg: 56.30993,
  half_width_m: 2000, center_source_name: "NASA LSDB", center_source_url: "https://ntrs.nasa.gov", note: "Proposed area", terrain_available: true },
  coordinate_reference: "MOON_ME", projection: "south polar stereographic", reference_radius_m: 1737400,
  center_projected_m: [12000, 8000], east_axis_projected: [0.55, -0.83], north_axis_projected: [0.83, 0.55], stereographic_scale_factor: 1.0000172,
  corners: [], latitude_range_deg: [-89.59, -89.45], longitude_range_deg: [47.1, 65.5], size: 2, spacing_m: 4000, elevations_m: [0, 0, 0, 0],
  center_elevation_m: -28.3, elevation_range_m: [-633, 653],
  datasets: [{ role: "near", dataset_id: "LDEM_80S_20MPP_ADJ", source_url: "https://pgda.gsfc.nasa.gov/x.TIF", resolution_m: 20, local_window_sha256: "99be", nodata: "NaN", window_bounds_m: [0, -4000, 24000, 20000] }],
  coverage: { grid_status: "complete", grid_missing_samples: 0, grid_total_samples: 40401, horizon_checks: [{ label: "centre", latitude_deg: -89.5244, longitude_deg: 56.3, status: "covered", detail: "ok" }], note: "five points" },
  limitations: ["Not a landing site."] };

function candidate(id: string, latitude: number): Candidate {
  return { candidate_id: id, site_id: `site-${id}`, latitude_deg: latitude, longitude_deg: 50, terrain_elevation_m: -12, observer_height_m: 2,
    selected_time_utc: "2026-11-07T00:00:00Z", terrain_dataset_id: "LDEM_80S_20MPP_ADJ", terrain_source_url: "u", terrain_dataset_sha256: "99be",
    terrain_nodata: "NaN", coverage_bounds_m: [], dem_resolution_m: 20, coordinate_reference: "MOON_ME", validation_status: "not_independently_validated",
    data_availability: "available", terrain_window_id: "shackleton-rim-b" };
}

interface Posted { east_m: number; north_m: number; observer_height_m: number; selected_time_utc: string }

function api(posted: Posted[], hold?: Promise<void>): ApiClient {
  return createApiClient({ baseUrl: "http://api.test", fetch: async (request: Request): Promise<Response> => {
    const path: string = new URL(request.url).pathname;
    if (path.endsWith("/terrain")) return Response.json(TERRAIN);
    if (request.method === "GET") return Response.json([candidate("saved", -89.5)]);
    const body: Posted = (await request.json()) as Posted;
    posted.push(body);
    if (body.east_m > 2000) return Response.json({ detail: "point lies outside the Shackleton Rim B ROI (±2000 m)" }, { status: 422 });
    if (hold !== undefined && body.east_m < 0) await hold;
    return Response.json(candidate(`new-${body.east_m.toString()}`, -89.4));
  } });
}

afterEach(cleanup);

describe("Shackleton workspace", (): void => {
  it("creates two candidates from two terrain picks and keeps every marker in one scene", async (): Promise<void> => {
    const posted: Posted[] = [];
    const selected: Candidate[] = [];
    const view: RenderResult = render(<ShackletonWorkspace apiClient={api(posted)} selectedCandidateId={null}
      onCandidateSelected={(c): void => { selected.push(c); }} defaultTimeUtc="2026-11-07T00:00:00Z" defaultObserverHeightM={2} />);
    expect(await screen.findByText(/marker saved/)).toBeDefined();
    expect(screen.getByText(/Coverage:/).textContent).toContain("complete");
    fireEvent.change(screen.getByRole("spinbutton", { name: /Observer height/ }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "pick west" }));
    await screen.findByText(/marker new--1500/);
    fireEvent.click(screen.getByRole("button", { name: "pick east" }));
    await screen.findByText(/marker new-1200/);
    expect(posted).toEqual([
      { east_m: -1500, north_m: 800, observer_height_m: 4, selected_time_utc: "2026-11-07T00:00:00Z" },
      { east_m: 1200, north_m: -1700, observer_height_m: 4, selected_time_utc: "2026-11-07T00:00:00Z" },
    ]);
    expect(within(screen.getByRole("list", { name: "scene markers" })).getAllByRole("button")).toHaveLength(3);
    expect(selected.map((c) => c.candidate_id)).toEqual(["new--1500", "new-1200"]);
    view.rerender(<ShackletonWorkspace apiClient={api(posted)} selectedCandidateId="new--1500"
      onCandidateSelected={(c): void => { selected.push(c); }} defaultTimeUtc="2026-11-07T00:00:00Z" defaultObserverHeightM={2} />);
    expect(screen.getByText("marker new--1500 selected")).toBeDefined();
    fireEvent.click(screen.getByText("marker saved"));
    expect(selected.at(-1)?.candidate_id).toBe("saved");
  });

  it("reports picks outside the ROI and ignores a stale earlier response", async (): Promise<void> => {
    const posted: Posted[] = [];
    let release: () => void = (): void => undefined;
    const hold: Promise<void> = new Promise<void>((resolve): void => { release = resolve; });
    const selected: string[] = [];
    render(<ShackletonWorkspace apiClient={api(posted, hold)} selectedCandidateId={null}
      onCandidateSelected={(c): void => { selected.push(c.candidate_id); }} defaultTimeUtc="2026-11-07T00:00:00Z" defaultObserverHeightM={2} />);
    await screen.findByText(/marker saved/);
    fireEvent.click(screen.getByRole("button", { name: "pick outside" }));
    expect(await screen.findByText(/outside the Shackleton Rim B ROI/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "pick west" }));
    fireEvent.click(screen.getByRole("button", { name: "pick east" }));
    await screen.findByText(/marker new-1200/);
    await act(async (): Promise<void> => { release(); await hold; await new Promise((r) => setTimeout(r, 0)); });
    expect(selected).toEqual(["new-1200"]);
    expect(screen.queryByText(/marker new--1500/)).toBeNull();
  });
});
