import { Raycaster, type Intersection, type Camera, type Object3D, type Vector2, type Vector3 } from "three";

export interface TerrainPick { east_m: number; north_m: number; point: Vector3 }

/** Three.js world axes are kilometres east, up, south. */
export function pickTerrain(camera: Camera, mesh: Object3D, pointer: Vector2): TerrainPick | null {
  const ray: Raycaster = new Raycaster();
  ray.setFromCamera(pointer, camera);
  const hit: Intersection | undefined = ray.intersectObject(mesh)[0];
  if (hit === undefined) return null;
  return { east_m: hit.point.x * 1000, north_m: -hit.point.z * 1000, point: hit.point.clone() };
}
