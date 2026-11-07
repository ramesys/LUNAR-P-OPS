import type { RoiTerrain } from "@clps/api-client";

/**
 * Display-side conversion between geographic coordinates and the ROI's local east/north frame.
 * It mirrors `lunar_core.polar_stereographic_south` and `lunar_core.roi.local_frame` only to place
 * markers of persisted candidates; candidate coordinates and elevations always come from the API.
 */

const MOON_RADIUS_M: number = 1_737_400;

export interface LocalPoint { east_m: number; north_m: number }

export function projectSouthPolar(latitudeDeg: number, longitudeDeg: number): [number, number] {
  const lat: number = (latitudeDeg * Math.PI) / 180;
  const lon: number = (longitudeDeg * Math.PI) / 180;
  const rho: number = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + lat / 2);
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

export function unprojectSouthPolar(x: number, y: number): [number, number] {
  const rho: number = Math.hypot(x, y);
  const lat: number = (2 * Math.atan(rho / (2 * MOON_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI;
  const lon: number = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return [lat, lon];
}

type Frame = Pick<RoiTerrain, "center_projected_m" | "east_axis_projected" | "north_axis_projected">;

export function toLocal(frame: Frame, latitudeDeg: number, longitudeDeg: number): LocalPoint {
  const [x, y] = projectSouthPolar(latitudeDeg, longitudeDeg);
  const [cx = 0, cy = 0] = frame.center_projected_m;
  const [ex = 0, ey = 0] = frame.east_axis_projected;
  const [nx = 0, ny = 0] = frame.north_axis_projected;
  const dx: number = x - cx;
  const dy: number = y - cy;
  return { east_m: dx * ex + dy * ey, north_m: dx * nx + dy * ny };
}

export function toGeographic(frame: Frame, point: LocalPoint): [number, number] {
  const [cx = 0, cy = 0] = frame.center_projected_m;
  const [ex = 0, ey = 0] = frame.east_axis_projected;
  const [nx = 0, ny = 0] = frame.north_axis_projected;
  return unprojectSouthPolar(cx + point.east_m * ex + point.north_m * nx, cy + point.east_m * ey + point.north_m * ny);
}

type Grid = Pick<RoiTerrain, "size" | "spacing_m" | "elevations_m" | "roi">;

/** Bilinear value of the display grid at a local point (visual placement only); null outside. */
export function displayElevation(grid: Grid, point: LocalPoint): number | null {
  const half: number = grid.roi.half_width_m;
  const col: number = (point.east_m + half) / grid.spacing_m;
  const row: number = (half - point.north_m) / grid.spacing_m;
  const last: number = grid.size - 1;
  if (!(col >= 0 && row >= 0 && col <= last && row <= last)) return null;
  const c0: number = Math.min(Math.floor(col), last - 1);
  const r0: number = Math.min(Math.floor(row), last - 1);
  const fc: number = col - c0;
  const fr: number = row - r0;
  const at: (r: number, c: number) => number | null = (r: number, c: number): number | null => grid.elevations_m[r * grid.size + c] ?? null;
  const values: (number | null)[] = [at(r0, c0), at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)];
  if (values.some((v: number | null): boolean => v === null)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = values as number[];
  return (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr;
}

/** Height relative to the centre's spherical tangent plane; projected x/z remain display axes. */
export function displayHeightM(elevationM: number, centerElevationM: number, point: LocalPoint, frame: Frame): number {
  const [cx = 0, cy = 0] = frame.center_projected_m;
  const [ex = 0, ey = 0] = frame.east_axis_projected;
  const [nx = 0, ny = 0] = frame.north_axis_projected;
  const x: number = cx + point.east_m * ex + point.north_m * nx;
  const y: number = cy + point.east_m * ey + point.north_m * ny;
  const scale: number = 4 * MOON_RADIUS_M ** 2;
  const chordTerm: number = 2 * scale * ((x - cx) ** 2 + (y - cy) ** 2) /
    ((scale + x ** 2 + y ** 2) * (scale + cx ** 2 + cy ** 2));
  return elevationM - centerElevationM - (MOON_RADIUS_M + elevationM) * chordTerm;
}

/** Omit every triangle that touches a missing DEM sample. */
export function validTriangleIndices(indices: ArrayLike<number>, elevations: readonly (number | null)[]): number[] {
  const result: number[] = [];
  for (let i: number = 0; i + 2 < indices.length; i += 3) {
    const a: number = indices[i] ?? -1;
    const b: number = indices[i + 1] ?? -1;
    const c: number = indices[i + 2] ?? -1;
    if ([a, b, c].every((index: number): boolean => Number.isFinite(elevations[index]))) result.push(a, b, c);
  }
  return result;
}
