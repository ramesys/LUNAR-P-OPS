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
