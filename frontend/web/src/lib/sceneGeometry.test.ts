import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { bodyDirection, directionAngles, directionalGuides, horizonRing, roiAzimuth, skyPath, skyRadiusKm, symbolScale } from "./sceneGeometry.ts";
import { evaluation } from "./testFixtures.ts";

describe("stored sky geometry", (): void => {
  it("maps north, east and altitude to the terrain axes", (): void => {
    expect(bodyDirection(0, 0).distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
    expect(bodyDirection(90, 0).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-10);
    expect(bodyDirection(0, 90).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
  });

  it("rotates candidate-local north into the ROI-centred projected frame", (): void => {
    expect(roiAzimuth(0, 66, 56)).toBeCloseTo(10);
    expect(roiAzimuth(90, 46, 56)).toBeCloseTo(80);
    expect(roiAzimuth(0, 1, 359)).toBeCloseTo(2);
  });

  it("places the body and its horizon at their stored elevations in the same azimuth", (): void => {
    const origin: Vector3 = new Vector3(1, 2, 3);
    const guides: ReturnType<typeof directionalGuides> = directionalGuides(origin, 90, 10, 20, 2);
    expect(guides.body.distanceTo(origin.clone().add(bodyDirection(90, 10).multiplyScalar(2)))).toBeLessThan(1e-10);
    expect(guides.horizon.distanceTo(origin.clone().add(bodyDirection(90, 20).multiplyScalar(2)))).toBeLessThan(1e-10);
    expect(guides.horizontal.distanceTo(new Vector3(3, 2, 3))).toBeLessThan(1e-10);
  });

  it("draws every stored sample of each body at its stored direction, in time order", (): void => {
    const stored: ReturnType<typeof evaluation> = evaluation();
    for (const body of ["sun", "earth"] as const) {
      const path: ReturnType<typeof skyPath> = skyPath(stored.samples, body, 66, 56);
      expect(path).toHaveLength(stored.samples.length);
      path.forEach((point, index): void => {
        const sample: (typeof stored.samples)[number] | undefined = stored.samples[index];
        if (sample === undefined) throw new Error("missing sample");
        const [az, el] = directionAngles(point.direction);
        const storedAz: number = body === "sun" ? sample.sun_azimuth_deg : sample.earth_azimuth_deg;
        expect(az).toBeCloseTo(roiAzimuth(storedAz, 66, 56), 9);
        expect(el).toBeCloseTo(body === "sun" ? sample.sun_elevation_deg : sample.earth_elevation_deg, 9);
        expect(point.direction.length()).toBeCloseTo(1, 12);
        expect(point.visible).toBe(body === "sun" ? sample.sun_visible : sample.earth_visible);
        expect(point.index).toBe(index);
      });
    }
  });

  it("closes the stored horizon mask into a ring at the stored elevations", (): void => {
    const ring: ReturnType<typeof horizonRing> = horizonRing([0, 90, 180, 270], [1, 2, 3, 4], 56, 56);
    expect(ring).toHaveLength(5);
    expect(ring[4]?.distanceTo(ring[0] ?? new Vector3())).toBeLessThan(1e-12);
    expect(directionAngles(ring[1] ?? new Vector3())).toEqual([expect.closeTo(90, 9), expect.closeTo(2, 9)]);
    expect(horizonRing([], [], 56, 56)).toEqual([]);
  });

  it("keeps symbolic dome and marker sizes legible at the 4 km and 40 km scales", (): void => {
    expect(skyRadiusKm(4)).toBeCloseTo(2.6);
    expect(skyRadiusKm(40)).toBeCloseTo(12);
    expect(symbolScale(2000)).toBe(1);
    expect(symbolScale(20000)).toBe(5);
  });
});
