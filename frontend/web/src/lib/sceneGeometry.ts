import { Vector3 } from "three";

/** Azimuth clockwise from north, in the ROI display frame (east, up, south). */
export function bodyDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az: number = azimuthDeg * Math.PI / 180;
  const el: number = elevationDeg * Math.PI / 180;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Display endpoints only: the horizon is the stored angle at this body's azimuth. */
export function directionalGuides(origin: Vector3, azimuthDeg: number, elevationDeg: number,
  horizonDeg: number, distance: number): { body: Vector3; horizon: Vector3; horizontal: Vector3 } {
  const endpoint: (angle: number) => Vector3 = (angle: number): Vector3 =>
    origin.clone().add(bodyDirection(azimuthDeg, angle).multiplyScalar(distance));
  return { body: endpoint(elevationDeg), horizon: endpoint(horizonDeg), horizontal: endpoint(0) };
}

/** Convert local true-north azimuth to the south-polar ROI centre's display axes. */
export function roiAzimuth(azimuthDeg: number, candidateLongitudeDeg: number, centerLongitudeDeg: number): number {
  return ((azimuthDeg + candidateLongitudeDeg - centerLongitudeDeg) % 360 + 360) % 360;
}

/**
 * Radius (km) of the symbolic sky dome drawn around the evaluated observer. Only directions are
 * real (stored SPICE azimuth/elevation); the radius is chosen for legibility at each scale.
 */
export function skyRadiusKm(extentKm: number): number {
  return Math.max(2.6, 0.3 * extentKm);
}

/** Size multiplier for markers, labels and rings so they stay legible on larger display grids. */
export function symbolScale(halfWidthM: number): number {
  return Math.max(1, halfWidthM / 4000);
}

export interface SkyPoint { direction: Vector3; visible: boolean; index: number }

interface StoredSample {
  sun_azimuth_deg: number; sun_elevation_deg: number; sun_visible: boolean;
  earth_azimuth_deg: number; earth_elevation_deg: number; earth_visible: boolean;
}

/** Unit directions of every stored sample of one body, in the ROI display frame. */
export function skyPath(samples: readonly StoredSample[], body: "sun" | "earth", candidateLongitudeDeg: number,
  centerLongitudeDeg: number): SkyPoint[] {
  return samples.map((sample: StoredSample, index: number): SkyPoint => {
    const az: number = body === "sun" ? sample.sun_azimuth_deg : sample.earth_azimuth_deg;
    const el: number = body === "sun" ? sample.sun_elevation_deg : sample.earth_elevation_deg;
    return { direction: bodyDirection(roiAzimuth(az, candidateLongitudeDeg, centerLongitudeDeg), el),
      visible: body === "sun" ? sample.sun_visible : sample.earth_visible, index };
  });
}

/** Unit directions of the stored terrain-horizon mask (closed: the first point is repeated). */
export function horizonRing(azimuthsDeg: readonly number[], elevationsDeg: readonly number[], candidateLongitudeDeg: number,
  centerLongitudeDeg: number): Vector3[] {
  const count: number = Math.min(azimuthsDeg.length, elevationsDeg.length);
  const ring: Vector3[] = [];
  for (let i: number = 0; i <= count && count > 0; i++) {
    const k: number = i % count;
    ring.push(bodyDirection(roiAzimuth(azimuthsDeg[k] ?? 0, candidateLongitudeDeg, centerLongitudeDeg), elevationsDeg[k] ?? 0));
  }
  return ring;
}

/** Inverse of `bodyDirection`: [azimuth clockwise from display north, elevation] in degrees. */
export function directionAngles(direction: Vector3): [number, number] {
  const length: number = direction.length();
  const az: number = ((Math.atan2(direction.x, -direction.z) * 180) / Math.PI + 360) % 360;
  const el: number = (Math.asin(Math.max(-1, Math.min(1, direction.y / length))) * 180) / Math.PI;
  return [az, el];
}
