import type { Candidate, RegionalTerrain, RoiTerrain, ScientificEvaluation } from "@clps/api-client";
import type { BrushOverlay, BrushVerdict, RegionOverlay } from "../lib/brushTypes.ts";
import { formatUtc } from "../lib/format.ts";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type JSX, type RefObject } from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { pickTerrain, type TerrainPick } from "../lib/terrainPicking.ts";
import { displayElevation, displayHeightM, validTriangleIndices, toGeographic, toLocal, type LocalPoint } from "../lib/roiFrame.ts";
import { bodyDirection, directionAngles, directionalGuides, horizonRing, roiAzimuth, skyPath, skyRadiusKm, symbolScale, type SkyPoint } from "../lib/sceneGeometry.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";

/**
 * One continuous mesh for a bounded ROI. World axes in km: x = east, y = up, z = south.
 * Heights and exaggeration are visual only; clicks report local east/north to the parent, which
 * asks the API to sample the original raster.
 */
export interface RoiTerrain3DProps {
  terrain: RoiTerrain;
  regional?: RegionalTerrain | null;
  candidates: Candidate[];
  selectedId: string | null;
  onPick: (point: LocalPoint) => void;
  onSelectMarker: (candidateId: string) => void;
  brush?: BrushOverlay;
  /** Active stored evaluation and the inspected sample index (display only). */
  temporal?: { evaluation: ScientificEvaluation; index: number } | null;
  /** Unsaved observer height of the active candidate, shown as a preview label only. */
  draftHeightM?: number | null;
}

interface SceneParts {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  terrain: Mesh<PlaneGeometry, MeshStandardMaterial>;
  markers: Group;
  overlay: Group;
  bodies: Group;
  /** Whole-interval Sun/Earth paths and the horizon silhouette; rebuilt per evaluation, not per cursor. */
  paths: Group;
  brush: Group;
  light: DirectionalLight;
  ambient: AmbientLight;
}

interface Hover { point: LocalPoint; latitude: number; longitude: number; elevation: number | null }

const ASPECT: number = 0.62;
const EXAGGERATIONS: readonly number[] = [1, 2, 3];
const SELECTED: string = "#f2c14e";
const OTHER: string = "#46c2d6";

function hasWebGL(): boolean {
  try {
    const canvas: HTMLCanvasElement = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

function heightKm(terrain: RoiTerrain, point: LocalPoint, exaggeration: number): number {
  const elevation: number | null = displayElevation(terrain, point);
  return elevation === null ? 0 : ((displayHeightM(elevation, terrain.center_elevation_m, point, terrain) + (exaggeration - 1) * (elevation - terrain.center_elevation_m)) / 1000);
}

function buildScene(host: HTMLDivElement, terrain: RoiTerrain, width: number): SceneParts {
  const renderer: WebGLRenderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, width * ASPECT);
  renderer.shadowMap.enabled = true;
  host.replaceChildren(renderer.domElement);
  const scene: Scene = new Scene();
  scene.background = new Color("#05060a");
  const extentKm: number = (2 * terrain.roi.half_width_m) / 1000;
  const camera: PerspectiveCamera = new PerspectiveCamera(45, 1 / ASPECT, 0.01, 150);
  camera.position.copy(defaultCameraPosition(extentKm));
  const geometry: PlaneGeometry = new PlaneGeometry(extentKm, extentKm, terrain.size - 1, terrain.size - 1);
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(terrain.size * terrain.size * 3), 3));
  const mesh: Mesh<PlaneGeometry, MeshStandardMaterial> = new Mesh<PlaneGeometry, MeshStandardMaterial>(
    geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const ambient: AmbientLight = new AmbientLight("#ffffff", 0.28);
  scene.add(ambient);
  const light: DirectionalLight = new DirectionalLight("#ffffff", 1.45);
  light.position.copy(RELIEF_LIGHT);
  light.shadow.mapSize.set(2048, 2048);
  const reach: number = extentKm * 0.8;
  light.shadow.camera.left = -reach; light.shadow.camera.right = reach;
  light.shadow.camera.top = reach; light.shadow.camera.bottom = -reach;
  light.shadow.camera.near = 0.1; light.shadow.camera.far = 40;
  light.shadow.bias = -0.0004;
  scene.add(light, light.target);
  const bodies: Group = new Group();
  const paths: Group = new Group();
  scene.add(bodies, paths);
  const markers: Group = new Group();
  const overlay: Group = new Group();
  const brush: Group = new Group();
  scene.add(markers, overlay, brush);
  const controls: OrbitControls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enableDamping = false;
  controls.minDistance = 0.2;
  controls.maxDistance = 80;
  controls.update();
  return { renderer, scene, camera, controls, terrain: mesh, markers, overlay, bodies, paths, brush, light, ambient };
}

function applyHeights(parts: SceneParts, terrain: RoiTerrain, exaggeration: number): void {
  const position: BufferAttribute = parts.terrain.geometry.getAttribute("position") as BufferAttribute;
  const color: BufferAttribute = parts.terrain.geometry.getAttribute("color") as BufferAttribute;
  const [low = -1, high = 1] = terrain.elevation_range_m;
  const half: number = terrain.roi.half_width_m;
  for (let i: number = 0; i < terrain.size * terrain.size; i++) {
    // PlaneGeometry vertices run row by row from the north-west corner, like the API grid.
    const point: LocalPoint = { east_m: -half + (i % terrain.size) * terrain.spacing_m,
      north_m: half - Math.floor(i / terrain.size) * terrain.spacing_m };
    const elevation: number | null = terrain.elevations_m[i] ?? null;
    position.setZ(i, elevation === null ? 0 : ((displayHeightM(elevation, terrain.center_elevation_m, point, terrain) + (exaggeration - 1) * (elevation - terrain.center_elevation_m)) / 1000));
    const col: number = i % terrain.size;
    const row: number = Math.floor(i / terrain.size);
    const left: number | null = terrain.elevations_m[i - (col > 0 ? 1 : 0)] ?? null;
    const right: number | null = terrain.elevations_m[i + (col < terrain.size - 1 ? 1 : 0)] ?? null;
    const north: number | null = terrain.elevations_m[i - (row > 0 ? terrain.size : 0)] ?? null;
    const south: number | null = terrain.elevations_m[i + (row < terrain.size - 1 ? terrain.size : 0)] ?? null;
    const slope: number = left === null || right === null || north === null || south === null ? 0 :
      Math.hypot(right - left, north - south) / (2 * terrain.spacing_m);
    const shade: number = elevation === null ? 0 : (0.32 + 0.55 * (elevation - low) / Math.max(high - low, 1)) *
      (1 - 0.14 * Math.min(1, slope));
    if (elevation === null) color.setXYZ(i, 0.8, 0.1, 0.1);
    else color.setXYZ(i, shade, shade * 0.98, shade * 0.94);
  }
  const index: BufferAttribute | null = parts.terrain.geometry.getIndex();
  if (index !== null && terrain.elevations_m.some((value: number | null): boolean => value === null)) {
    parts.terrain.geometry.setIndex(validTriangleIndices(index.array, terrain.elevations_m));
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
  parts.terrain.geometry.computeVertexNormals();
  parts.terrain.geometry.computeBoundingSphere();
}

function disposeObject(root: Object3D): void {
  root.traverse((object: Object3D): void => {
    if (object instanceof Sprite) { object.material.map?.dispose(); object.material.dispose(); }
    if (object instanceof Mesh || object instanceof LineSegments) {
      const mesh: Mesh | LineSegments = object;
      mesh.geometry.dispose();
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m: Material): void => { m.dispose(); });
    }
  });
}

function drawMarkers(parts: SceneParts, terrain: RoiTerrain, candidates: Candidate[], selectedId: string | null,
  exaggeration: number): void {
  const old: Object3D[] = [...parts.markers.children];
  old.forEach((child: Object3D): void => { disposeObject(child); parts.markers.remove(child); });
  for (const candidate of candidates) {
    const point: LocalPoint = toLocal(terrain, candidate.latitude_deg, candidate.longitude_deg);
    if (displayElevation(terrain, point) === null) continue;
    const selected: boolean = candidate.candidate_id === selectedId;
    const color: string = selected ? SELECTED : OTHER;
    const marker: Group = new Group();
    const markerScale: number = symbolScale(terrain.roi.half_width_m);
    const pinHeight: number = (selected ? 0.3 : 0.22) * markerScale;
    const pin: Mesh = new Mesh(new CylinderGeometry(0.008, 0.008, pinHeight, 8), new MeshBasicMaterial({ color }));
    pin.position.y = pinHeight / 2;
    const head: Mesh = new Mesh(new SphereGeometry((selected ? 0.05 : 0.038) * markerScale, 16, 12), new MeshBasicMaterial({ color }));
    head.position.y = pinHeight;
    marker.add(pin, head);
    marker.position.set(point.east_m / 1000, heightKm(terrain, point, exaggeration), -point.north_m / 1000);
    marker.traverse((object: Object3D): void => { object.userData["candidateId"] = candidate.candidate_id; });
    parts.markers.add(marker);
  }
}


const BRUSH_COLORS: Record<BrushVerdict, string> = {
  PASS: "#5ee3a3", FAIL: "#ff856e", UNAVAILABLE: "#bca8ff", ERROR: "#ff4874", NOT_EVALUATED: "#72d8ed",
};

/** Region geometry uses the active DEM surface for display; all plan coordinates stay in ROI metres. */
function drawBrush(parts: SceneParts, terrain: RoiTerrain, exaggeration: number, brush: BrushOverlay | undefined): void {
  for (const child of [...parts.brush.children]) { disposeObject(child); parts.brush.remove(child); }
  if (brush === undefined) return;
  const scale: number = symbolScale(terrain.roi.half_width_m);
  function dot(point: LocalPoint, color: string, radius: number, data: Record<string, unknown>, opacity: number = 1): void {
    if (displayElevation(terrain, point) === null) return;
    const marker: Mesh = new Mesh(new SphereGeometry(radius * scale, 12, 8),
      new MeshBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity }));
    marker.position.set(point.east_m / 1000, heightKm(terrain, point, exaggeration) + 0.045 * scale, -point.north_m / 1000);
    Object.assign(marker.userData, data); marker.renderOrder = 4; parts.brush.add(marker);
  }
  for (const region of brush.regions) {
    const color: string = region.active ? "#f7d472" : "#9d8a52";
    const linePoints: number[] = outlinePoints(terrain, exaggeration, region, 0.025 * scale);
    if (linePoints.length > 0) {
      const geometry: BufferGeometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(linePoints), 3));
      const outline: LineSegments = new LineSegments(geometry, new LineBasicMaterial({ color, depthTest: false, transparent: !region.active, opacity: region.active ? 1 : 0.7 }));
      outline.renderOrder = 3; parts.brush.add(outline);
    }
    if (region.active) region.vertices.forEach((point: LocalPoint, index: number): void => { dot(point, "#f7d472", 0.045, { brushVertex: index }); });
    for (const sample of region.samples) {
      dot(sample, BRUSH_COLORS[sample.verdict], sample.selected ? 0.07 : 0.04, { brushSample: sample.index, brushRegion: region.id }, region.active || sample.selected ? 1 : 0.6);
      if (sample.selected) dot(sample, "#ffffff", 0.095, { brushSample: sample.index, brushRegion: region.id }, 0.35);
    }
    const centre: LocalPoint | null = centroid(region.vertices);
    if (centre !== null && displayElevation(terrain, centre) !== null) {
      const sprite: Sprite = label(region.label, region.active ? "#f7d472" : "#d5c690");
      sprite.scale.multiplyScalar(scale * 0.8);
      sprite.position.set(centre.east_m / 1000, heightKm(terrain, centre, exaggeration) + 0.16 * scale, -centre.north_m / 1000);
      parts.brush.add(sprite);
    }
  }
}

/** Draped polygon edges (open while drawing, closed once finished). */
function outlinePoints(terrain: RoiTerrain, exaggeration: number, region: RegionOverlay, lift: number): number[] {
  const points: number[] = [];
  const vertices: LocalPoint[] = region.vertices;
  const segmentCount: number = region.closed ? vertices.length : Math.max(0, vertices.length - 1);
  for (let index: number = 0; index < segmentCount; index++) {
    const a: LocalPoint | undefined = vertices[index];
    const b: LocalPoint | undefined = vertices[(index + 1) % vertices.length];
    if (a === undefined || b === undefined) continue;
    const count: number = Math.max(1, Math.ceil(Math.hypot(b.east_m - a.east_m, b.north_m - a.north_m) / terrain.spacing_m));
    for (let step: number = 0; step < count; step++) {
      const at: (t: number) => LocalPoint = (t: number): LocalPoint => ({ east_m: a.east_m + (b.east_m - a.east_m) * t,
        north_m: a.north_m + (b.north_m - a.north_m) * t });
      const p: LocalPoint = at(step / count);
      const q: LocalPoint = at((step + 1) / count);
      if (displayElevation(terrain, p) === null || displayElevation(terrain, q) === null) continue;
      points.push(p.east_m / 1000, heightKm(terrain, p, exaggeration) + lift, -p.north_m / 1000,
        q.east_m / 1000, heightKm(terrain, q, exaggeration) + lift, -q.north_m / 1000);
    }
  }
  return points;
}

function centroid(vertices: LocalPoint[]): LocalPoint | null {
  if (vertices.length === 0) return null;
  return { east_m: vertices.reduce((sum: number, v: LocalPoint): number => sum + v.east_m, 0) / vertices.length,
    north_m: vertices.reduce((sum: number, v: LocalPoint): number => sum + v.north_m, 0) / vertices.length };
}


function defaultCameraPosition(extentKm: number): Vector3 {
  return new Vector3(extentKm * 0.42, extentKm * 0.55, extentKm * 0.7);
}

function label(text: string, color?: string): Sprite {
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
  if (context !== null) {
    context.fillStyle = "rgba(5, 6, 10, 0.7)";
    context.beginPath(); context.arc(32, 32, 28, 0, Math.PI * 2); context.fill();
    context.fillStyle = color ?? (text === "N" ? "#ff8a5c" : "#e8edf5");
    const size: number = text.length <= 1 ? 36 : text.length === 2 ? 28 : 20;
    context.font = `bold ${size.toString()}px system-ui, sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(text, 32, 34);
  }
  const sprite: Sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(0.22, 0.22, 1);
  return sprite;
}

/** 1 km grid draped on the displayed surface, and N/E/S/W edge labels (orientation aids only). */
function drawOverlay(parts: SceneParts, terrain: RoiTerrain, exaggeration: number): void {
  const old: Object3D[] = [...parts.overlay.children];
  old.forEach((child: Object3D): void => {
    disposeObject(child);
    parts.overlay.remove(child);
  });
  const half: number = terrain.roi.half_width_m;
  const points: number[] = [];
  const lift: number = 0.004;
  const interval: number = half > 2000 ? 5000 : 1000;
  for (let line: number = -half; line <= half + 1e-6; line += interval) {
    for (let t: number = -half; t < half - 1e-6; t += terrain.spacing_m) {
      {
        const a: number = t;
        const b: number = t + terrain.spacing_m;
        // Draw grid segments only where both DEM endpoints exist.
        if ([{ east_m: a, north_m: line }, { east_m: b, north_m: line },
          { east_m: line, north_m: a }, { east_m: line, north_m: b }].some(
          (point: LocalPoint): boolean => displayElevation(terrain, point) === null)) continue;
        points.push(a / 1000, heightKm(terrain, { east_m: a, north_m: line }, exaggeration) + lift, -line / 1000,
          b / 1000, heightKm(terrain, { east_m: b, north_m: line }, exaggeration) + lift, -line / 1000);
        points.push(line / 1000, heightKm(terrain, { east_m: line, north_m: a }, exaggeration) + lift, -a / 1000,
          line / 1000, heightKm(terrain, { east_m: line, north_m: b }, exaggeration) + lift, -b / 1000);
      }
    }
  }
  const geometry: BufferGeometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  parts.overlay.add(new LineSegments(geometry, new LineBasicMaterial({ color: "#7fb0e0", transparent: true, opacity: 0.35 })));
  if (half > 2000) {
    // Outline the scientifically supported 4 km square on the coarse display surface.
    const boundary: number[] = [];
    for (let t: number = -2000; t < 2000; t += terrain.spacing_m) {
      const next: number = Math.min(t + terrain.spacing_m, 2000);
      for (const side of [-2000, 2000]) {
        for (const [a, b] of [[{ east_m: t, north_m: side }, { east_m: next, north_m: side }],
          [{ east_m: side, north_m: t }, { east_m: side, north_m: next }]] as [LocalPoint, LocalPoint][]) {
          boundary.push(a.east_m / 1000, heightKm(terrain, a, exaggeration) + 0.02, -a.north_m / 1000,
            b.east_m / 1000, heightKm(terrain, b, exaggeration) + 0.02, -b.north_m / 1000);
        }
      }
    }
    const outline: BufferGeometry = new BufferGeometry();
    outline.setAttribute("position", new BufferAttribute(new Float32Array(boundary), 3));
    parts.overlay.add(new LineSegments(outline, new LineBasicMaterial({ color: "#f2c14e", depthTest: false })));
  }
  const scale: number = symbolScale(half);
  const edge: number = half / 1000 + 0.2 * scale;
  for (const [text, x, z, e, n] of [["N", 0, -edge, 0, half], ["S", 0, edge, 0, -half], ["E", edge, 0, half, 0], ["W", -edge, 0, -half, 0]] as const) {
    if (displayElevation(terrain, { east_m: e, north_m: n }) === null) continue;
    const sprite: Sprite = label(text);
    sprite.scale.multiplyScalar(scale);
    sprite.position.set(x, heightKm(terrain, { east_m: e, north_m: n }, exaggeration) + 0.12 * scale, z);
    parts.overlay.add(sprite);
  }
  // The geographic south pole, placed with the same projection as every other point.
  const pole: LocalPoint = toLocal(terrain, -90, 0);
  if (displayElevation(terrain, pole) !== null) {
    const ground: Vector3 = new Vector3(pole.east_m / 1000, heightKm(terrain, pole, exaggeration), -pole.north_m / 1000);
    const top: Vector3 = ground.clone().add(new Vector3(0, 0.35 * scale, 0));
    parts.overlay.add(new LineSegments(new BufferGeometry().setFromPoints([ground, top]), new LineBasicMaterial({ color: "#e8edf5", depthTest: false })));
    const sprite: Sprite = label("SP", "#e8edf5");
    sprite.scale.multiplyScalar(scale);
    sprite.position.copy(top);
    sprite.userData["southPole"] = true;
    parts.overlay.add(sprite);
  }
}

/** Fixed relief light (not the Sun). */
const RELIEF_LIGHT: Vector3 = new Vector3(-3, 2.2, -1.5);
const SUN_COLOR: string = "#eb6834";
const EARTH_COLOR: string = "#3987e5";
type Sample = ScientificEvaluation["samples"][number];

/** What the sky geometry currently shows, exposed on the canvas for verification. */
export interface SkyReadout { radiusKm: number; sunPath: number; earthPath: number; horizonPoints: number;
  cursor: number; sun: [number, number] | null; earth: [number, number] | null }

/** The evaluated observer, lifted by a symbolic pin so it stays visible at every scale. */
function observerOrigin(terrain: RoiTerrain, evaluation: ScientificEvaluation, exaggeration: number): { ground: Vector3; origin: Vector3 } | null {
  const point: LocalPoint = toLocal(terrain, evaluation.candidate.latitude_deg, evaluation.candidate.longitude_deg);
  if (displayElevation(terrain, point) === null) return null;
  const ground: Vector3 = new Vector3(point.east_m / 1000, heightKm(terrain, point, exaggeration), -point.north_m / 1000);
  return { ground, origin: ground.clone().add(new Vector3(0, 0.12 * symbolScale(terrain.roi.half_width_m), 0)) };
}

function segments(points: Vector3[], closed: boolean): BufferGeometry {
  const values: number[] = [];
  for (let i: number = 0; i + 1 < points.length; i++) {
    const a: Vector3 | undefined = points[i];
    const b: Vector3 | undefined = points[i + 1];
    if (a !== undefined && b !== undefined) values.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const first: Vector3 | undefined = points[0];
  const last: Vector3 | undefined = points.at(-1);
  if (closed && first !== undefined && last !== undefined && points.length > 2) values.push(last.x, last.y, last.z, first.x, first.y, first.z);
  const geometry: BufferGeometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(values), 3));
  return geometry;
}

/**
 * Whole-interval paths of the stored Sun and Earth directions and the stored terrain-horizon
 * silhouette, all on a symbolic dome of radius R around the observer. Visible stretches are solid,
 * blocked stretches faint. Directions are the stored SPICE/horizon values; R is not a distance.
 */
function drawPaths(parts: SceneParts, terrain: RoiTerrain, evaluation: ScientificEvaluation | null, exaggeration: number,
  showSun: boolean, showEarth: boolean, showHorizon: boolean): { sun: number; earth: number; horizon: number } {
  for (const child of [...parts.paths.children]) { disposeObject(child); parts.paths.remove(child); }
  const counts: { sun: number; earth: number; horizon: number } = { sun: 0, earth: 0, horizon: 0 };
  if (evaluation === null || evaluation.samples.length === 0) return counts;
  const place: ReturnType<typeof observerOrigin> = observerOrigin(terrain, evaluation, exaggeration);
  if (place === null) return counts;
  const radius: number = skyRadiusKm((2 * terrain.roi.half_width_m) / 1000);
  const scale: number = symbolScale(terrain.roi.half_width_m);
  const at: (direction: Vector3) => Vector3 = (direction: Vector3): Vector3 => place.origin.clone().add(direction.clone().multiplyScalar(radius));
  const lon: number = evaluation.candidate.longitude_deg;
  const centre: number = terrain.roi.center_longitude_deg;
  if (showHorizon) {
    const ring: Vector3[] = horizonRing(evaluation.horizon_azimuth_deg, evaluation.horizon_elevation_deg, lon, centre).map(at);
    counts.horizon = Math.max(0, ring.length - 1);
    const silhouette: LineSegments = new LineSegments(segments(ring, false), new LineBasicMaterial({ color: "#d9c58f", transparent: true, opacity: 0.85, depthTest: false }));
    silhouette.renderOrder = 1; parts.paths.add(silhouette);
    const level: Vector3[] = Array.from({ length: 145 }, (_: unknown, i: number): Vector3 => at(bodyDirection(i * 2.5, 0)));
    const horizontal: LineSegments = new LineSegments(segments(level, false), new LineDashedMaterial({ color: "#8c97a3", dashSize: 0.05 * scale, gapSize: 0.06 * scale, transparent: true, opacity: 0.5, depthTest: false }));
    horizontal.computeLineDistances(); horizontal.renderOrder = 1; parts.paths.add(horizontal);
    // Local north of the candidate (not the ROI centre's), from the same azimuth rotation as the bodies.
    const north: Sprite = label("N");
    north.scale.multiplyScalar(scale * 0.8);
    north.position.copy(at(bodyDirection(roiAzimuth(0, lon, centre), 0)));
    parts.paths.add(north);
  }
  for (const [enabled, body, color] of [[showSun, "sun", SUN_COLOR], [showEarth, "earth", EARTH_COLOR]] as const) {
    if (!enabled) continue;
    const path: SkyPoint[] = skyPath(evaluation.samples, body, lon, centre);
    counts[body] = path.length;
    const visible: number[] = [];
    const blocked: number[] = [];
    for (let i: number = 0; i + 1 < path.length; i++) {
      const a: SkyPoint | undefined = path[i];
      const b: SkyPoint | undefined = path[i + 1];
      if (a === undefined || b === undefined) continue;
      const p: Vector3 = at(a.direction);
      const q: Vector3 = at(b.direction);
      // A stretch takes the state of its starting sample (each sample holds until the next).
      (a.visible ? visible : blocked).push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    for (const [values, opacity] of [[visible, 1], [blocked, 0.35]] as const) {
      if (values.length === 0) continue;
      const geometry: BufferGeometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(values), 3));
      const line: LineSegments = new LineSegments(geometry, new LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
      line.renderOrder = 2; parts.paths.add(line);
    }
    // Sample ticks (thinned for long series) mark the discrete stored times.
    const every: number = Math.max(1, Math.ceil(path.length / 96));
    for (const point of path) {
      if (point.index % every !== 0 && point.index !== path.length - 1) continue;
      const tick: Mesh = new Mesh(new SphereGeometry(0.018 * scale, 8, 6), new MeshBasicMaterial({ color, transparent: true, opacity: point.visible ? 0.95 : 0.4, depthTest: false }));
      tick.position.copy(at(point.direction)); tick.renderOrder = 2; parts.paths.add(tick);
    }
  }
  return counts;
}

/** Stored SPICE Sun/Earth directions at the cursor sample, drawn from the evaluated candidate's position. */
function drawBodies(parts: SceneParts, terrain: RoiTerrain, evaluation: ScientificEvaluation | null, index: number,
  exaggeration: number, sunLighting: boolean, showSun: boolean, showEarth: boolean, showHorizon: boolean): Pick<SkyReadout, "sun" | "earth"> {
  const old: Object3D[] = [...parts.bodies.children];
  old.forEach((child: Object3D): void => { disposeObject(child); parts.bodies.remove(child); });
  const sample: Sample | undefined = evaluation?.samples[index];
  const extent: number = (2 * terrain.roi.half_width_m) / 1000;
  const useSun: boolean = sunLighting && evaluation !== null && sample !== undefined;
  parts.light.castShadow = useSun;
  parts.light.shadow.camera.far = Math.max(40, extent * 4);
  parts.light.shadow.camera.updateProjectionMatrix();
  if (!useSun || evaluation === null || sample === undefined) {
    parts.light.position.copy(RELIEF_LIGHT).multiplyScalar(Math.max(1, extent / 4));
    parts.light.intensity = 1.45;
    parts.ambient.intensity = 0.28;
  }
  const readout: Pick<SkyReadout, "sun" | "earth"> = { sun: null, earth: null };
  if (evaluation === null || sample === undefined) return readout;
  const place: ReturnType<typeof observerOrigin> = observerOrigin(terrain, evaluation, exaggeration);
  if (place === null) return readout;
  const { ground, origin } = place;
  const scale: number = symbolScale(terrain.roi.half_width_m);
  const radius: number = skyRadiusKm(extent);
  const size: number = radius / 2.2;
  const observer: Mesh = new Mesh(new SphereGeometry(0.045 * scale, 16, 12), new MeshBasicMaterial({ color: "#ffffff", depthTest: false }));
  observer.position.copy(origin); observer.renderOrder = 3; parts.bodies.add(observer);
  const stem: BufferGeometry = new BufferGeometry().setFromPoints([ground, origin]);
  parts.bodies.add(new LineSegments(stem, new LineBasicMaterial({ color: "#ffffff", depthTest: false })));
  const lon: number = evaluation.candidate.longitude_deg;
  const centre: number = terrain.roi.center_longitude_deg;
  for (const [body, enabled, color, az, el, horizon, visible] of [["sun", showSun, SUN_COLOR, sample.sun_azimuth_deg, sample.sun_elevation_deg, sample.sun_horizon_deg, sample.sun_visible],
    ["earth", showEarth, EARTH_COLOR, sample.earth_azimuth_deg, sample.earth_elevation_deg, sample.earth_horizon_deg, sample.earth_visible]] as const) {
    if (!enabled) continue;
    const displayAz: number = roiAzimuth(az, lon, centre);
    const guides: ReturnType<typeof directionalGuides> = directionalGuides(origin, displayAz, el, horizon, radius);
    readout[body] = directionAngles(guides.body.clone().sub(origin));
    const end: Vector3 = guides.body;
    if (showHorizon) {
      // An angular guide to the stored horizon in this azimuth, not a reconstruction of distant terrain.
      const threshold: BufferGeometry = new BufferGeometry().setFromPoints([origin, guides.horizon]);
      const thresholdLine: LineSegments = new LineSegments(threshold, new LineDashedMaterial({ color, dashSize: 0.025 * size, gapSize: 0.025 * size, transparent: true, opacity: 0.75, depthTest: false }));
      thresholdLine.computeLineDistances(); thresholdLine.renderOrder = 1; parts.bodies.add(thresholdLine);
      const horizontal: BufferGeometry = new BufferGeometry().setFromPoints([origin, guides.horizontal]);
      const horizontalLine: LineSegments = new LineSegments(horizontal, new LineDashedMaterial({ color: "#d6dbe3", dashSize: 0.025 * size, gapSize: 0.04 * size, transparent: true, opacity: 0.5, depthTest: false }));
      horizontalLine.computeLineDistances(); horizontalLine.renderOrder = 1; parts.bodies.add(horizontalLine);
      const thresholdMarker: Mesh = new Mesh(new SphereGeometry(0.045 * size, 12, 8), new MeshBasicMaterial({ color, wireframe: true, depthTest: false }));
      thresholdMarker.position.copy(guides.horizon); thresholdMarker.renderOrder = 2; parts.bodies.add(thresholdMarker);
      // Clearance arc between the stored horizon angle and the body: green clear, red blocked.
      const arc: Vector3[] = Array.from({ length: 17 }, (_: unknown, i: number): Vector3 =>
        origin.clone().add(bodyDirection(displayAz, horizon + ((el - horizon) * i) / 16).multiplyScalar(radius)));
      const clearance: LineSegments = new LineSegments(segments(arc, false), new LineBasicMaterial({ color: el > horizon ? "#5ee3a3" : "#ff6b5e", depthTest: false }));
      clearance.renderOrder = 3; parts.bodies.add(clearance);
    }
    // The path from the first stored sample up to the cursor (time already elapsed).
    const trail: Vector3[] = skyPath(evaluation.samples.slice(0, index + 1), body, lon, centre)
      .map((point: SkyPoint): Vector3 => origin.clone().add(point.direction.multiplyScalar(radius)));
    if (trail.length > 1) {
      const trailLine: LineSegments = new LineSegments(segments(trail, false), new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthTest: false }));
      trailLine.renderOrder = 3; parts.bodies.add(trailLine);
    }
    const geometry: BufferGeometry = new BufferGeometry().setFromPoints([origin, end]);
    // Solid when the stored terrain-horizon test says visible; dashed when it says blocked.
    const line: LineSegments = new LineSegments(geometry, visible
      ? new LineBasicMaterial({ color, depthTest: false })
      : new LineDashedMaterial({ color, dashSize: 0.06 * size, gapSize: 0.04 * size, depthTest: false }));
    line.computeLineDistances();
    line.renderOrder = 2;
    parts.bodies.add(line);
    const marker: Mesh = new Mesh(new SphereGeometry(0.09 * size, 20, 14),
      new MeshBasicMaterial({ color, wireframe: !visible, depthTest: false }));
    marker.renderOrder = 2;
    marker.position.copy(end);
    parts.bodies.add(marker);
  }
  if (useSun) {
    const sun: Vector3 = bodyDirection(roiAzimuth(sample.sun_azimuth_deg, lon, centre), sample.sun_elevation_deg);
    parts.light.position.copy(sun.multiplyScalar(Math.max(12, extent * 1.5)));
    // Lit while the Sun's upper limb is above the astronomical horizon; terrain blocking is separate.
    parts.light.intensity = sample.sun_elevation_deg > -0.27 ? 2.6 : 0;
    parts.ambient.intensity = 0.55;
  }
  return readout;
}

export function RoiTerrain3D({ terrain, regional = null, candidates, selectedId, onPick, onSelectMarker, temporal = null, brush, draftHeightM = null }: RoiTerrain3DProps): JSX.Element {
  const hostRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const canvasRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const partsRef: RefObject<SceneParts | null> = useRef<SceneParts | null>(null);
  const callbacks: RefObject<{ onPick: RoiTerrain3DProps["onPick"]; onSelectMarker: RoiTerrain3DProps["onSelectMarker"] }> =
    useRef({ onPick, onSelectMarker });
  const width: number = Math.max(320, useElementWidth(hostRef, 960));
  const [exaggeration, setExaggeration] = useState<number>(1);
  const [regionalMode, setRegionalMode] = useState<boolean>(true);
  const isRegional: boolean = regionalMode && regional !== null;
  const displayTerrain: RoiTerrain = useMemo((): RoiTerrain => !isRegional || regional === null ? terrain : {
    ...terrain, roi: { ...terrain.roi, half_width_m: regional.half_width_m }, size: regional.size,
    spacing_m: regional.spacing_m, elevations_m: regional.elevations_m, elevation_range_m: regional.elevation_range_m,
  }, [terrain, regional, isRegional]);
  const displayRef: RefObject<RoiTerrain> = useRef<RoiTerrain>(displayTerrain);
  useEffect((): void => { displayRef.current = displayTerrain; }, [displayTerrain]);
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>((): boolean => !hasWebGL());
  const [hover, setHover] = useState<Hover | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [sunLighting, setSunLighting] = useState<boolean>(false);
  const [showSun, setShowSun] = useState<boolean>(true);
  const [showEarth, setShowEarth] = useState<boolean>(true);
  const [showHorizon, setShowHorizon] = useState<boolean>(true);
  const evaluation: ScientificEvaluation | null = temporal?.evaluation ?? null;
  const cursorIndex: number = temporal?.index ?? 0;
  const sample: Sample | undefined = temporal === null ? undefined : evaluation?.samples[cursorIndex];
  const [pathCounts, setPathCounts] = useState<{ sun: number; earth: number; horizon: number }>({ sun: 0, earth: 0, horizon: 0 });
  const builds: RefObject<number> = useRef<number>(0);
  const brushRef: RefObject<BrushOverlay | undefined> = useRef<BrushOverlay | undefined>(brush);
  useEffect((): void => { brushRef.current = brush; }, [brush]);

  useEffect((): void => { callbacks.current = { onPick, onSelectMarker }; }, [onPick, onSelectMarker]);

  const render: () => void = (): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    parts.renderer.render(parts.scene, parts.camera);
    const p: Vector3 = parts.camera.position;
    // Exposed for verification that switching candidates leaves the camera alone.
    canvasRef.current?.setAttribute("data-camera", `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`);
    // Screen rotation of north: OrbitControls' azimuth is 0 when the camera looks north.
    const azimuth: number = Math.round((parts.controls.getAzimuthalAngle() * 180) / Math.PI);
    setHeading((previous: number): number => (previous === azimuth ? previous : azimuth));
  };
  const renderRef: RefObject<() => void> = useRef(render);
  useEffect((): void => { renderRef.current = render; });

  // The scene (and its camera) is built once per terrain; nothing else rebuilds it.
  useEffect((): (() => void) | undefined => {
    const host: HTMLDivElement | null = canvasRef.current;
    if (failed || host === null) return undefined;
    let parts: SceneParts;
    try {
      parts = buildScene(host, terrain, width);
    } catch {
      queueMicrotask((): void => { setFailed(true); });
      return undefined;
    }
    partsRef.current = parts;
    builds.current++;
    host.setAttribute("data-scene-builds", builds.current.toString());
    const onChange: () => void = (): void => { renderRef.current(); };
    parts.controls.addEventListener("change", onChange);
    const canvas: HTMLCanvasElement = parts.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    let dragging: number | null = null;
    function pointer(event: PointerEvent): Vector2 {
      const rect: DOMRect = canvas.getBoundingClientRect();
      return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    }
    const onDown: (event: PointerEvent) => void = (event: PointerEvent): void => {
      down = { x: event.clientX, y: event.clientY };
      if (brushRef.current?.mode !== "edit") return;
      const ray: Raycaster = new Raycaster(); ray.setFromCamera(pointer(event), parts.camera);
      const vertex: unknown = ray.intersectObject(parts.brush, true).find((hit): boolean => typeof hit.object.userData["brushVertex"] === "number")?.object.userData["brushVertex"];
      if (typeof vertex === "number") { dragging = vertex; parts.controls.enabled = false; canvas.setPointerCapture(event.pointerId); }
    };
    const onUp: (event: PointerEvent) => void = (event: PointerEvent): void => {
      if (dragging !== null) { dragging = null; parts.controls.enabled = true; down = null; return; }
      if (down === null || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const rect: DOMRect = canvas.getBoundingClientRect();
      const mouse: Vector2 = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const ray: Raycaster = new Raycaster();
      ray.setFromCamera(mouse, parts.camera);
      const activeBrush: BrushOverlay | undefined = brushRef.current;
      if (activeBrush?.mode === "edit") return;
      if (activeBrush?.mode !== "draw") {
        const sampleHit: Record<string, unknown> | undefined = ray.intersectObject(parts.brush, true)
          .find((hit): boolean => typeof hit.object.userData["brushSample"] === "number")?.object.userData;
        const sampleIndex: unknown = sampleHit?.["brushSample"];
        const sampleRegion: unknown = sampleHit?.["brushRegion"];
        if (typeof sampleIndex === "number" && typeof sampleRegion === "string") { activeBrush?.onSelectSample(sampleRegion, sampleIndex); return; }
        const marker: unknown = ray.intersectObject(parts.markers, true)[0]?.object.userData["candidateId"];
        if (typeof marker === "string") { callbacks.current.onSelectMarker(marker); return; }
      }
      const hit: TerrainPick | null = pickTerrain(parts.camera, parts.terrain, mouse);
      if (hit !== null) {
        if (Math.abs(hit.east_m) > terrain.roi.half_width_m || Math.abs(hit.north_m) > terrain.roi.half_width_m) {
          setPickNotice("Outside the outlined 4 × 4 km study area; candidate creation is unavailable here.");
          return;
        }
        const point: LocalPoint = { east_m: hit.east_m, north_m: hit.north_m };
        if (activeBrush?.mode === "draw") { setPickNotice(null); activeBrush.onAdd(point); return; }
        // Guards against accidental records: candidates are created only on the 20 m detail grid,
        // and never while a region evaluation is writing results.
        if (displayRef.current.roi.half_width_m > terrain.roi.half_width_m) {
          setPickNotice("Regional terrain is for exploration only. Switch to Scientific detail · 4 km to create a candidate.");
          return;
        }
        if (activeBrush?.busy === true) {
          setPickNotice("A region evaluation is running; terrain clicks do not create candidates until it finishes.");
          return;
        }
        setPickNotice(null);
        callbacks.current.onPick(point);
      }
    };
    let frame: number = 0;
    let pending: PointerEvent | null = null;
    const onMove: (event: PointerEvent) => void = (event: PointerEvent): void => {
      if (dragging !== null) {
        const hit: TerrainPick | null = pickTerrain(parts.camera, parts.terrain, pointer(event));
        if (hit !== null && Math.abs(hit.east_m) <= terrain.roi.half_width_m && Math.abs(hit.north_m) <= terrain.roi.half_width_m) {
          brushRef.current?.onMove(dragging, { east_m: hit.east_m, north_m: hit.north_m });
        }
        return;
      }
      pending = event;
      if (frame !== 0) return;
      frame = requestAnimationFrame((): void => {
        frame = 0;
        const last: PointerEvent | null = pending;
        if (last?.buttons !== 0) return;
        const rect: DOMRect = canvas.getBoundingClientRect();
        const mouse: Vector2 = new Vector2(((last.clientX - rect.left) / rect.width) * 2 - 1, -((last.clientY - rect.top) / rect.height) * 2 + 1);
        const hit: TerrainPick | null = pickTerrain(parts.camera, parts.terrain, mouse);
        if (hit === null) { setHover(null); return; }
        const point: LocalPoint = { east_m: hit.east_m, north_m: hit.north_m };
        const [latitude, longitude] = toGeographic(displayRef.current, point);
        const elevation: number | null = displayElevation(displayRef.current, point);
        // Full-precision readout for verification of the geographic alignment (display values only).
        host.setAttribute("data-hover", [point.east_m, point.north_m, latitude, longitude, elevation ?? NaN].map((v: number): string => v.toString()).join(","));
        setHover({ point, latitude, longitude, elevation });
      });
    };
    const onLeave: () => void = (): void => { pending = null; setHover(null); };
    const onCancel: () => void = (): void => { dragging = null; down = null; parts.controls.enabled = true; };
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return (): void => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      parts.controls.removeEventListener("change", onChange);
      parts.controls.dispose();
      disposeObject(parts.scene);
      parts.renderer.dispose();
      partsRef.current = null;
    };
    // Width changes resize the canvas in place below; rebuilding would reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, failed]);

  // Swap bounded grids in the existing scene; only an explicit scale change reframes the camera.
  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    const extent: number = 2 * displayTerrain.roi.half_width_m / 1000;
    parts.terrain.geometry.dispose();
    parts.terrain.geometry = new PlaneGeometry(extent, extent, displayTerrain.size - 1, displayTerrain.size - 1);
    parts.terrain.geometry.setAttribute("color", new BufferAttribute(new Float32Array(displayTerrain.size * displayTerrain.size * 3), 3));
    parts.controls.target.set(0, 0, 0);
    parts.camera.position.copy(defaultCameraPosition(extent));
    const reach: number = extent * 0.8;
    parts.light.shadow.camera.left = -reach; parts.light.shadow.camera.right = reach;
    parts.light.shadow.camera.top = reach; parts.light.shadow.camera.bottom = -reach;
    parts.light.shadow.camera.updateProjectionMatrix();
    parts.controls.update();
  }, [displayTerrain, failed]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    applyHeights(parts, displayTerrain, exaggeration);
    drawOverlay(parts, displayTerrain, exaggeration);
    renderRef.current();
  }, [displayTerrain, exaggeration, failed]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    drawMarkers(parts, displayTerrain, candidates, selectedId, exaggeration);
    renderRef.current();
  }, [displayTerrain, candidates, selectedId, exaggeration, failed]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    drawBrush(parts, displayTerrain, exaggeration, brush);
    renderRef.current();
  }, [displayTerrain, exaggeration, brush, failed]);

  // The timeline cursor moves only these display objects; the camera and the scene stay as they are.
  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    const readout: Pick<SkyReadout, "sun" | "earth"> = drawBodies(parts, displayTerrain, evaluation, cursorIndex, exaggeration, sunLighting, showSun, showEarth, showHorizon);
    const host: HTMLDivElement | null = canvasRef.current;
    const format: (value: [number, number] | null) => string = (value: [number, number] | null): string => value === null ? "" : `${value[0].toFixed(4)},${value[1].toFixed(4)}`;
    host?.setAttribute("data-cursor-index", sample === undefined ? "" : cursorIndex.toString());
    host?.setAttribute("data-sun-direction", format(readout.sun));
    host?.setAttribute("data-earth-direction", format(readout.earth));
    renderRef.current();
  }, [displayTerrain, evaluation, cursorIndex, sample, exaggeration, sunLighting, showSun, showEarth, showHorizon, failed]);

  // Whole-interval paths depend on the stored evaluation and the scale only, not on the cursor.
  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    const counts: { sun: number; earth: number; horizon: number } = drawPaths(parts, displayTerrain, evaluation, exaggeration, showSun, showEarth, showHorizon);
    setPathCounts((previous): { sun: number; earth: number; horizon: number } =>
      previous.sun === counts.sun && previous.earth === counts.earth && previous.horizon === counts.horizon ? previous : counts);
    const host: HTMLDivElement | null = canvasRef.current;
    host?.setAttribute("data-sky-radius-km", skyRadiusKm((2 * displayTerrain.roi.half_width_m) / 1000).toString());
    host?.setAttribute("data-sun-path", counts.sun.toString());
    host?.setAttribute("data-earth-path", counts.earth.toString());
    host?.setAttribute("data-horizon-points", counts.horizon.toString());
    renderRef.current();
  }, [displayTerrain, evaluation, exaggeration, showSun, showEarth, showHorizon, failed]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    parts.renderer.setSize(width, width * ASPECT);
    renderRef.current();
  }, [width]);

  /** Explicit camera actions: the only code paths, besides the user's mouse, that move the camera. */
  function view(action: "reset" | "top" | "in" | "out" | "selected"): void {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    const extentKm: number = (2 * displayTerrain.roi.half_width_m) / 1000;
    const { camera, controls } = parts;
    if (action === "reset") { controls.target.set(0, 0, 0); camera.position.copy(defaultCameraPosition(extentKm)); }
    if (action === "top") { camera.position.set(controls.target.x, controls.target.y + extentKm * 1.35, controls.target.z + 0.001); }
    if (action === "in" || action === "out") {
      const offset: Vector3 = camera.position.clone().sub(controls.target).multiplyScalar(action === "in" ? 0.75 : 1.33);
      camera.position.copy(controls.target).add(offset);
    }
    if (action === "selected") {
      const chosen: Candidate | undefined = candidates.find((c: Candidate): boolean => c.candidate_id === selectedId);
      if (chosen === undefined) return;
      const point: LocalPoint = toLocal(displayTerrain, chosen.latitude_deg, chosen.longitude_deg);
      const target: Vector3 = new Vector3(point.east_m / 1000, heightKm(displayTerrain, point, exaggeration), -point.north_m / 1000);
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
    }
    controls.update();
    renderRef.current();
  }

  if (failed) return <p className="muted">The 3D view needs WebGL, which is not available in this browser.</p>;
  return (
    <div className="terrain-3d" ref={hostRef}>
      <div className="terrain-stage">
        <div ref={canvasRef} className="terrain-canvas" role="img"
          aria-label={`3D terrain of the ${terrain.roi.name} region of interest with candidate markers`} />
        <div className="terrain-hud" aria-live="polite">
          {hover === null ? <span>Hover the terrain for coordinates</span> : <>
            <span><strong>{Math.abs(hover.latitude).toFixed(5)}°S {hover.longitude.toFixed(5)}°E</strong></span>
            <span>DEM {hover.elevation === null ? "no data" : `${hover.elevation.toFixed(1)} m`} <span className="muted">{isRegional ? "(240 m DEM, 250 m display grid)" : "(20 m DEM display grid)"}</span></span>
            <span className="muted">{hover.point.east_m.toFixed(0)} m E · {hover.point.north_m.toFixed(0)} m N of centre</span>
          </>}
        </div>
        {evaluation !== null && <div className="terrain-time" aria-live="polite">
          {sample === undefined ? <span>No stored samples ({evaluation.status}) — nothing to show in time.</span> : <>
            <span className="muted">Candidate evaluation context · {evaluation.evaluation_id.slice(0, 22)}…</span>
            <span><strong>{formatUtc(sample.time_utc)}</strong> · stored sample {((temporal?.index ?? 0) + 1).toString()}/{evaluation.samples.length.toString()} (every {evaluation.request.step_minutes.toString()} min)</span>
            <span>Observer: {evaluation.candidate.observer_height_m.toFixed(1)} m above terrain (saved)</span>
            <span><span className="sun-text">Sun</span> az {sample.sun_azimuth_deg.toFixed(1)}° · elevation {sample.sun_elevation_deg.toFixed(2)}° vs horizon {sample.sun_horizon_deg.toFixed(2)}° · centre clearance {(sample.sun_elevation_deg - sample.sun_horizon_deg).toFixed(2)}° → <strong>{sample.sun_visible ? "visible" : "blocked"}</strong></span>
            <span><span className="earth-text">Earth</span> az {sample.earth_azimuth_deg.toFixed(1)}° · elevation {sample.earth_elevation_deg.toFixed(2)}° vs horizon {sample.earth_horizon_deg.toFixed(2)}° · centre clearance {(sample.earth_elevation_deg - sample.earth_horizon_deg).toFixed(2)}° → <strong>{sample.earth_visible ? "in view" : "blocked"}</strong></span>
          </>}
          {sample !== undefined && <span className="sky-scale" data-testid="sky-scale">Sky dome (symbolic): radius {skyRadiusKm((2 * displayTerrain.roi.half_width_m) / 1000).toFixed(1)} km around the observer · {pathCounts.sun.toString()} Sun and {pathCounts.earth.toString()} Earth samples · directions are stored SPICE values; distances are not to scale (Sun ≈ 1 AU, Earth ≈ 384,000 km)</span>}
          {draftHeightM !== null && draftHeightM !== evaluation.candidate.observer_height_m && <span className="draft-text">Draft observer height {draftHeightM.toString()} m (unsaved; result above is for {evaluation.candidate.observer_height_m.toString()} m)</span>}
        </div>}
        <div className="terrain-compass" title="North arrow (follows the camera)" aria-label={`North is ${heading.toString()}° clockwise from screen up`}>
          <svg viewBox="-20 -20 40 40" width="44" height="44" style={{ transform: `rotate(${heading.toString()}deg)` }} aria-hidden="true">
            <circle r="18" className="compass-ring" /><path d="M0,-14 L6,4 L0,0 L-6,4 Z" className="compass-north" /><text y="-4" dy="-12" textAnchor="middle">N</text>
          </svg>
        </div>
      </div>
      <div className="terrain-scale" role="group" aria-label="Terrain scale">
        <button type="button" aria-pressed={isRegional} disabled={regional === null} onClick={(): void => { if (isRegional) view("reset"); else setRegionalMode(true); setPickNotice(null); }}>Regional explore · 40 km</button>
        <button type="button" aria-pressed={!isRegional} onClick={(): void => { setRegionalMode(false); setPickNotice(null); }}>Scientific detail · 4 km</button>
        <span>{isRegional ? "240 m LOLA DEM · 250 m display grid" : "20 m LOLA DEM · 20 m display grid"}</span>
      </div>
      {pickNotice !== null && <p role="status">{pickNotice}</p>}
      <div id="geometry-controls" className="terrain-controls" role="toolbar" aria-label="3D view controls">
        <button type="button" onClick={(): void => { view("reset"); }}>Reset view</button>
        <button type="button" onClick={(): void => { view("top"); }}>Top view</button>
        <button type="button" aria-label="Zoom in" onClick={(): void => { view("in"); }}>＋</button>
        <button type="button" aria-label="Zoom out" onClick={(): void => { view("out"); }}>－</button>
        <button type="button" disabled={selectedId === null || !candidates.some((c: Candidate): boolean => c.candidate_id === selectedId)}
          onClick={(): void => { view("selected"); }}>Centre on selected</button>
        <label><input type="checkbox" checked={showSun} disabled={sample === undefined} onChange={(event: ChangeEvent<HTMLInputElement>): void => { setShowSun(event.target.checked); }} /> Sun path &amp; ray</label>
        <label><input type="checkbox" checked={showEarth} disabled={sample === undefined} onChange={(event: ChangeEvent<HTMLInputElement>): void => { setShowEarth(event.target.checked); }} /> Earth path &amp; ray</label>
        <label><input type="checkbox" checked={showHorizon} disabled={sample === undefined} onChange={(event: ChangeEvent<HTMLInputElement>): void => { setShowHorizon(event.target.checked); }} /> Horizon guides</label>
        <label><input type="checkbox" checked={sunLighting} disabled={evaluation === null} onChange={(event: ChangeEvent<HTMLInputElement>): void => { setSunLighting(event.target.checked); }} /> Light from stored Sun direction</label>
        <label>Vertical exaggeration{" "}
          <select value={exaggeration} onChange={(event: ChangeEvent<HTMLSelectElement>): void => { setExaggeration(Number(event.target.value)); }}>
            {EXAGGERATIONS.map((value: number): JSX.Element => <option key={value} value={value}>{`${value.toString()}×`}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">
        Left-drag rotates, right-drag pans, scroll zooms. <strong>Click the terrain</strong> to save a new candidate there; click a marker to select it.
        Grid lines every {isRegional ? "5" : "1"} km; {isRegional && "Select Regional explore again to reset its view. "} {isRegional && "Gold outline: supported 4 km candidate study area; SP marks the geographic south pole. Regional terrain (40 × 40 km, 240 m DEM) is for exploration only: switch to Scientific detail to create candidates. "} <span className="legend-dot selected" /> selected, <span className="legend-dot other" /> other candidates.
        {sample !== undefined && <>White pin: evaluated observer (symbolic height). Orange Sun and blue Earth paths show every stored sample of the evaluation on a symbolic sky dome (solid stretches visible, faint stretches blocked); the white trail is the time elapsed up to the Timeline cursor, and the ray and sphere mark the cursor sample (dashed/open when blocked).
          Azimuths are measured clockwise from north at the candidate (the dome's N label). The tan line is the stored 200 km terrain-horizon silhouette, the grey dashed ring the local horizontal; the short green/red arc spans from the stored horizon angle to the body (clear/blocked).
          These are angular guides, not distant terrain or body distances. Visibility tests the Sun's upper limb and Earth's centre against the stored horizon. </>}
        {sunLighting && sample !== undefined ? "Sun lighting and shadows cover only the displayed mesh and do not represent distant occlusion." : "Lighting is fixed for relief and is not the Sun."}
        {" "}The two scales switch between separate LOLA grids; surface and marker heights can differ between resolutions.
        {" "}Heights, exaggeration and the hover elevation are for display; saved candidates use the original raster sample.
      </p>
    </div>
  );
}
