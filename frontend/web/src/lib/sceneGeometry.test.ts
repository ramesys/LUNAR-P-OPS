import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { bodyDirection, directionalGuides } from "./sceneGeometry.ts";

describe("stored sky geometry", (): void => {
  it("maps north, east and altitude to the terrain axes", (): void => {
    expect(bodyDirection(0, 0).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
    expect(bodyDirection(90, 0).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-10);
    expect(bodyDirection(0, 90).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
  });

  it("places the body and its horizon at their stored elevations in the same azimuth", (): void => {
    const origin: Vector3 = new Vector3(1, 2, 3);
    const guides: ReturnType<typeof directionalGuides> = directionalGuides(origin, 90, 10, 20, 2);
    expect(guides.body.distanceTo(origin.clone().add(bodyDirection(90, 10).multiplyScalar(2)))).toBeLessThan(1e-10);
    expect(guides.horizon.distanceTo(origin.clone().add(bodyDirection(90, 20).multiplyScalar(2)))).toBeLessThan(1e-10);
    expect(guides.horizontal.distanceTo(new Vector3(3, 2, 3))).toBeLessThan(1e-10);
  });
});
