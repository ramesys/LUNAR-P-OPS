import type { Candidate, RoiTerrain } from "@clps/api-client";
import { useEffect, useRef, useState, type ChangeEvent, type JSX, type RefObject } from "react";
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
import { displayElevation, displayHeightM, toGeographic, toLocal, type LocalPoint } from "../lib/roiFrame.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";

/**
 * One continuous mesh for a bounded ROI. World axes in km: x = east, y = up, z = south.
 * Heights and exaggeration are visual only; clicks report local east/north to the parent, which
 * asks the API to sample the original raster.
 */
export interface RoiTerrain3DProps {
  terrain: RoiTerrain;
  candidates: Candidate[];
  selectedId: string | null;
  onPick: (point: LocalPoint) => void;
  onSelectMarker: (candidateId: string) => void;
}

interface SceneParts {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  terrain: Mesh<PlaneGeometry, MeshStandardMaterial>;
  markers: Group;
  overlay: Group;
}

interface Hover { point: LocalPoint; latitude: number; longitude: number; elevation: number | null }

const ASPECT: number = 0.62;
const EXAGGERATIONS: readonly number[] = [1, 2, 3];
const SELECTED: string = "#eb6834";
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
  return elevation === null ? 0 : (displayHeightM(elevation, terrain.center_elevation_m, point) / 1000) * exaggeration;
}

function buildScene(host: HTMLDivElement, terrain: RoiTerrain, width: number): SceneParts {
  const renderer: WebGLRenderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, width * ASPECT);
  host.replaceChildren(renderer.domElement);
  const scene: Scene = new Scene();
  scene.background = new Color("#05060a");
  const extentKm: number = (2 * terrain.roi.half_width_m) / 1000;
  const camera: PerspectiveCamera = new PerspectiveCamera(45, 1 / ASPECT, 0.01, 100);
  camera.position.copy(defaultCameraPosition(extentKm));
  const geometry: PlaneGeometry = new PlaneGeometry(extentKm, extentKm, terrain.size - 1, terrain.size - 1);
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(terrain.size * terrain.size * 3), 3));
  const mesh: Mesh<PlaneGeometry, MeshStandardMaterial> = new Mesh<PlaneGeometry, MeshStandardMaterial>(
    geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  // Fixed display lighting for relief; it is not the Sun position at any time.
  scene.add(new AmbientLight("#ffffff", 0.35));
  const light: DirectionalLight = new DirectionalLight("#ffffff", 2.2);
  light.position.set(-3, 2.2, -1.5);
  scene.add(light);
  const markers: Group = new Group();
  const overlay: Group = new Group();
  scene.add(markers, overlay);
  const controls: OrbitControls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enableDamping = false;
  controls.minDistance = 0.2;
  controls.maxDistance = extentKm * 4;
  controls.update();
  return { renderer, scene, camera, controls, terrain: mesh, markers, overlay };
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
    position.setZ(i, elevation === null ? 0 : (displayHeightM(elevation, terrain.center_elevation_m, point) / 1000) * exaggeration);
    const shade: number = elevation === null ? 0 : 0.35 + 0.55 * (elevation - low) / Math.max(high - low, 1);
    if (elevation === null) color.setXYZ(i, 0.8, 0.1, 0.1);
    else color.setXYZ(i, shade, shade * 0.98, shade * 0.94);
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
  parts.terrain.geometry.computeVertexNormals();
  parts.terrain.geometry.computeBoundingSphere();
}

function disposeObject(root: Object3D): void {
  root.traverse((object: Object3D): void => {
    if (object instanceof Mesh) {
      const mesh: Mesh = object as Mesh;
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
    const selected: boolean = candidate.candidate_id === selectedId;
    const color: string = selected ? SELECTED : OTHER;
    const marker: Group = new Group();
    const pinHeight: number = selected ? 0.3 : 0.22;
    const pin: Mesh = new Mesh(new CylinderGeometry(0.008, 0.008, pinHeight, 8), new MeshBasicMaterial({ color }));
    pin.position.y = pinHeight / 2;
    const head: Mesh = new Mesh(new SphereGeometry(selected ? 0.05 : 0.038, 16, 12), new MeshBasicMaterial({ color }));
    head.position.y = pinHeight;
    marker.add(pin, head);
    marker.position.set(point.east_m / 1000, heightKm(terrain, point, exaggeration), -point.north_m / 1000);
    marker.traverse((object: Object3D): void => { object.userData["candidateId"] = candidate.candidate_id; });
    parts.markers.add(marker);
  }
}


function defaultCameraPosition(extentKm: number): Vector3 {
  return new Vector3(extentKm * 0.6, extentKm * 0.7, extentKm * 1.0);
}

function label(text: string): Sprite {
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
  if (context !== null) {
    context.fillStyle = "rgba(5, 6, 10, 0.7)";
    context.beginPath(); context.arc(32, 32, 28, 0, Math.PI * 2); context.fill();
    context.fillStyle = text === "N" ? "#ff8a5c" : "#e8edf5";
    context.font = "bold 36px system-ui, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
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
    if (child instanceof Sprite) { child.material.map?.dispose(); child.material.dispose(); }
    parts.overlay.remove(child);
  });
  const half: number = terrain.roi.half_width_m;
  const points: number[] = [];
  const lift: number = 0.004;
  for (let line: number = -half; line <= half + 1e-6; line += 1000) {
    for (let t: number = -half; t < half - 1e-6; t += terrain.spacing_m) {
      {
        const a: number = t;
        const b: number = t + terrain.spacing_m;
        // East-west line at north = line, then north-south line at east = line.
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
  const edge: number = half / 1000 + 0.2;
  for (const [text, x, z, e, n] of [["N", 0, -edge, 0, half], ["S", 0, edge, 0, -half], ["E", edge, 0, half, 0], ["W", -edge, 0, -half, 0]] as const) {
    const sprite: Sprite = label(text);
    sprite.position.set(x, heightKm(terrain, { east_m: e, north_m: n }, exaggeration) + 0.12, z);
    parts.overlay.add(sprite);
  }
}

export function RoiTerrain3D({ terrain, candidates, selectedId, onPick, onSelectMarker }: RoiTerrain3DProps): JSX.Element {
  const hostRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const canvasRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const partsRef: RefObject<SceneParts | null> = useRef<SceneParts | null>(null);
  const callbacks: RefObject<{ onPick: RoiTerrain3DProps["onPick"]; onSelectMarker: RoiTerrain3DProps["onSelectMarker"] }> =
    useRef({ onPick, onSelectMarker });
  const width: number = Math.max(320, useElementWidth(hostRef, 960));
  const [exaggeration, setExaggeration] = useState<number>(1);
  const [failed, setFailed] = useState<boolean>((): boolean => !hasWebGL());
  const [hover, setHover] = useState<Hover | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const builds: RefObject<number> = useRef<number>(0);

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
    const onDown: (event: PointerEvent) => void = (event: PointerEvent): void => { down = { x: event.clientX, y: event.clientY }; };
    const onUp: (event: PointerEvent) => void = (event: PointerEvent): void => {
      if (down === null || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      down = null;
      const rect: DOMRect = canvas.getBoundingClientRect();
      const mouse: Vector2 = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const ray: Raycaster = new Raycaster();
      ray.setFromCamera(mouse, parts.camera);
      const marker: unknown = ray.intersectObject(parts.markers, true)[0]?.object.userData["candidateId"];
      if (typeof marker === "string") { callbacks.current.onSelectMarker(marker); return; }
      const hit: TerrainPick | null = pickTerrain(parts.camera, parts.terrain, mouse);
      if (hit !== null) callbacks.current.onPick({ east_m: hit.east_m, north_m: hit.north_m });
    };
    let frame: number = 0;
    let pending: PointerEvent | null = null;
    const onMove: (event: PointerEvent) => void = (event: PointerEvent): void => {
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
        const [latitude, longitude] = toGeographic(terrain, point);
        setHover({ point, latitude, longitude, elevation: displayElevation(terrain, point) });
      });
    };
    const onLeave: () => void = (): void => { pending = null; setHover(null); };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return (): void => {
      cancelAnimationFrame(frame);
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

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    applyHeights(parts, terrain, exaggeration);
    drawOverlay(parts, terrain, exaggeration);
    renderRef.current();
  }, [terrain, exaggeration, failed]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) return;
    drawMarkers(parts, terrain, candidates, selectedId, exaggeration);
    renderRef.current();
  }, [terrain, candidates, selectedId, exaggeration, failed]);

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
    const extentKm: number = (2 * terrain.roi.half_width_m) / 1000;
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
      const point: LocalPoint = toLocal(terrain, chosen.latitude_deg, chosen.longitude_deg);
      const target: Vector3 = new Vector3(point.east_m / 1000, heightKm(terrain, point, exaggeration), -point.north_m / 1000);
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
            <span>DEM {hover.elevation === null ? "no data" : `${hover.elevation.toFixed(1)} m`} <span className="muted">(20 m grid, display)</span></span>
            <span className="muted">{hover.point.east_m.toFixed(0)} m E · {hover.point.north_m.toFixed(0)} m N of centre</span>
          </>}
        </div>
        <div className="terrain-compass" title="North arrow (follows the camera)" aria-label={`North is ${heading.toString()}° clockwise from screen up`}>
          <svg viewBox="-20 -20 40 40" width="44" height="44" style={{ transform: `rotate(${heading.toString()}deg)` }} aria-hidden="true">
            <circle r="18" className="compass-ring" /><path d="M0,-14 L6,4 L0,0 L-6,4 Z" className="compass-north" /><text y="-4" dy="-12" textAnchor="middle">N</text>
          </svg>
        </div>
      </div>
      <div className="terrain-controls" role="toolbar" aria-label="3D view controls">
        <button type="button" onClick={(): void => { view("reset"); }}>Reset view</button>
        <button type="button" onClick={(): void => { view("top"); }}>Top view</button>
        <button type="button" aria-label="Zoom in" onClick={(): void => { view("in"); }}>＋</button>
        <button type="button" aria-label="Zoom out" onClick={(): void => { view("out"); }}>－</button>
        <button type="button" disabled={selectedId === null || !candidates.some((c: Candidate): boolean => c.candidate_id === selectedId)}
          onClick={(): void => { view("selected"); }}>Centre on selected</button>
        <label>Vertical exaggeration{" "}
          <select value={exaggeration} onChange={(event: ChangeEvent<HTMLSelectElement>): void => { setExaggeration(Number(event.target.value)); }}>
            {EXAGGERATIONS.map((value: number): JSX.Element => <option key={value} value={value}>{`${value.toString()}×`}</option>)}
          </select>
        </label>
      </div>
      <p className="muted small">
        Left-drag rotates, right-drag pans, scroll zooms. <strong>Click the terrain</strong> to save a new candidate there; click a marker to select it.
        Grid lines every 1 km; <span className="legend-dot selected" /> selected, <span className="legend-dot other" /> other candidates.
        Lighting is fixed for relief and is not the Sun. Heights, exaggeration and the hover elevation are for display; saved candidates use the original raster sample.
      </p>
    </div>
  );
}
