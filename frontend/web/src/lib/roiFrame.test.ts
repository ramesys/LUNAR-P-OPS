import { describe, expect, it } from "vitest";
import type { RoiTerrain } from "@clps/api-client";
import { displayElevation, displayHeightM, toGeographic, toLocal, type LocalPoint } from "./roiFrame.ts";

// Values returned by the backend (`lunar_core.roi.local_frame` + `polar_stereographic_south_inverse`)
// for the Shackleton Rim B ROI.
const FRAME: Pick<RoiTerrain, "center_projected_m" | "east_axis_projected" | "north_axis_projected"> = {
  center_projected_m: [11999.719394392474, 7999.813678027343],
  east_axis_projected: [0.5547002321529926, -0.8320502703860002],
  north_axis_projected: [0.8320502703860002, 0.5547002321529926],
};
const BACKEND: [number, number, number, number][] = [
  [-1500, 800, -89.49558681541568, 50.6820340759234],
  [1200, -1700, -89.5785993097496, 61.69845497109708],
];

describe("ROI frame", (): void => {
  it("agrees with the backend projection in both directions", (): void => {
    for (const [east, north, lat, lon] of BACKEND) {
      const local: LocalPoint = toLocal(FRAME, lat, lon);
      expect(local.east_m).toBeCloseTo(east, 6);
      expect(local.north_m).toBeCloseTo(north, 6);
      const [gLat, gLon] = toGeographic(FRAME, { east_m: east, north_m: north });
      expect(gLat).toBeCloseTo(lat, 10);
      expect(gLon).toBeCloseTo(lon, 10);
    }
  });

  it("interpolates the display grid with row 0 at the north edge", (): void => {
    // 3 x 3 grid over ±10 m: elevation = east + 2 * north.
    const grid: Pick<RoiTerrain, "size" | "spacing_m" | "elevations_m" | "roi"> = { size: 3, spacing_m: 10, roi: { half_width_m: 10 } as never,
      elevations_m: [-10 + 20, 0 + 20, 10 + 20, -10, 0, 10, -10 - 20, -20, 10 - 20] };
    expect(displayElevation(grid, { east_m: 5, north_m: 5 })).toBeCloseTo(15);
    expect(displayElevation(grid, { east_m: -10, north_m: -10 })).toBeCloseTo(-30);
    expect(displayElevation(grid, { east_m: 11, north_m: 0 })).toBeNull();
    expect(displayElevation({ ...grid, elevations_m: [null, ...grid.elevations_m.slice(1)] }, { east_m: -9, north_m: 9 })).toBeNull();
    expect(displayHeightM(100, 40, { east_m: 0, north_m: 0 })).toBe(60);
    expect(displayHeightM(100, 40, { east_m: 2000, north_m: 2000 })).toBeCloseTo(60 - 8e6 / 3474800, 9);
  });
});
