import { describe, expect, it } from "vitest";
import type { RoiTerrain } from "@clps/api-client";
import { displayElevation, displayHeightM, validTriangleIndices, toGeographic, toLocal, type LocalPoint } from "./roiFrame.ts";

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

  it("uses the spherical tangent height for a 20 km regional corner", (): void => {
    const point: LocalPoint = { east_m: 10000, north_m: 10000 };
    const [lat, lon] = toGeographic(FRAME, point);
    const [centerLat, centerLon] = toGeographic(FRAME, { east_m: 0, north_m: 0 });
    const unit: (a: number, b: number) => [number, number, number] = (a: number, b: number): [number, number, number] => {
      const phi: number = a * Math.PI / 180;
      const lambda: number = b * Math.PI / 180;
      return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
    };
    const p: [number, number, number] = unit(lat, lon);
    const c: [number, number, number] = unit(centerLat, centerLon);
    const expected: number = (1737400 + 1200) * (p[0] * c[0] + p[1] * c[1] + p[2] * c[2]) - (1737400 + 50);
    expect(displayHeightM(1200, 50, point, FRAME)).toBeCloseTo(expected, 5);
  });

  it("omits mesh faces touching missing DEM samples", (): void => {
    expect(validTriangleIndices([0, 1, 2, 1, 3, 2], [1, 2, null, 4])).toEqual([]);
    expect(validTriangleIndices([0, 1, 2, 1, 3, 2], [1, 2, 3, null])).toEqual([0, 1, 2]);
  });

  it("interpolates the display grid with row 0 at the north edge", (): void => {
    // 3 x 3 grid over ±10 m: elevation = east + 2 * north.
    const grid: Pick<RoiTerrain, "size" | "spacing_m" | "elevations_m" | "roi"> = { size: 3, spacing_m: 10, roi: { half_width_m: 10 } as never,
      elevations_m: [-10 + 20, 0 + 20, 10 + 20, -10, 0, 10, -10 - 20, -20, 10 - 20] };
    expect(displayElevation(grid, { east_m: 5, north_m: 5 })).toBeCloseTo(15);
    expect(displayElevation(grid, { east_m: -10, north_m: -10 })).toBeCloseTo(-30);
    expect(displayElevation(grid, { east_m: 11, north_m: 0 })).toBeNull();
    expect(displayElevation({ ...grid, elevations_m: [null, ...grid.elevations_m.slice(1)] }, { east_m: -9, north_m: 9 })).toBeNull();
    expect(displayHeightM(100, 40, { east_m: 0, north_m: 0 }, FRAME)).toBe(60);
    expect(displayHeightM(100, 40, { east_m: 2000, north_m: 2000 }, FRAME)).toBeCloseTo(60 - 8e6 / 3474800, 2);
  });
});

describe("40 km regional frame against the backend (lunar_core) values", (): void => {
  // Frame and corners exactly as returned by /api/rois/shackleton-rim-b/terrain and /regional-terrain.
  const frame: Parameters<typeof toGeographic>[0] = { center_projected_m: [11999.719394392474, 7999.813678027343],
    east_axis_projected: [0.5547002321529926, -0.8320502703860002], north_axis_projected: [0.8320502703860002, 0.5547002321529926] };
  const corners: [number, number, number, number][] = [
    [-20000, 20000, -88.68719581090211, 26.15222904617576], [20000, 20000, -88.68719581090211, 86.46763095382425],
    [20000, -20000, -89.31527766854369, 161.8940665248902], [-20000, -20000, -89.31527766854369, 310.7257934751098]];

  it("places the 40 km corners where the backend does", (): void => {
    for (const [east, north, lat, lon] of corners) {
      const [latitude, longitude] = toGeographic(frame, { east_m: east, north_m: north });
      expect(latitude).toBeCloseTo(lat, 9);
      expect(longitude).toBeCloseTo(lon, 8);
      const back: { east_m: number; north_m: number } = toLocal(frame, lat, lon);
      expect(back.east_m).toBeCloseTo(east, 5);
      expect(back.north_m).toBeCloseTo(north, 5);
    }
  });

  it("puts the geographic south pole inside the 40 km view on the local south axis", (): void => {
    const pole: { east_m: number; north_m: number } = toLocal(frame, -90, 0);
    expect(pole.east_m).toBeCloseTo(0, 6);
    expect(pole.north_m).toBeCloseTo(-14421.87, 1);
  });
});
