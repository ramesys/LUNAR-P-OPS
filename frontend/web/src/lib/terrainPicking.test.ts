import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector2 } from "three";
import { pickTerrain, type TerrainPick } from "./terrainPicking.ts";

describe("terrain picking", () => {
  it("raycasts the surface and maps east and north in metres", () => {
    const camera: PerspectiveCamera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(1, 10, -2);
    camera.up.set(0, 0, -1);
    camera.lookAt(1, 0, -2);
    camera.updateMatrixWorld();
    const mesh: Mesh<PlaneGeometry, MeshBasicMaterial> = new Mesh<PlaneGeometry, MeshBasicMaterial>(new PlaneGeometry(12, 12), new MeshBasicMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld();
    const hit: TerrainPick | null = pickTerrain(camera, mesh, new Vector2(0, 0));
    expect(hit?.east_m).toBeCloseTo(1000);
    expect(hit?.north_m).toBeCloseTo(2000);
    expect(pickTerrain(camera, mesh, new Vector2(5, 5))).toBeNull();
  });
});
