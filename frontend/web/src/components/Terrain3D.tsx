import type { ApiClient, Candidate, SiteResult } from "@clps/api-client";
import { useEffect, useRef, useState, type ChangeEvent, type JSX, type RefObject } from "react";
import {
  AmbientLight,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DirectionalLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Vector2,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LandingGraph } from "./LandingGraph.tsx";
import { CandidateInspector } from "./CandidateInspector.tsx";
import { pickTerrain, type TerrainPick } from "../lib/terrainPicking.ts";
import { SelectionGuard } from "../lib/selectionGuard.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";

/**
 * RF-19: local LOLA terrain (±6 km) in 3D, lit by the Sun at the instant shown.
 * World axes in km: x = east, y = up, z = south (north is -z).
 */

export interface Terrain3DProps {
  apiClient: ApiClient;
  site: SiteResult;
  selectedTimeUtc: string;
  observerHeightM: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  earthAzimuthDeg: number;
  earthElevationDeg: number;
  /** Visibility at the site from the API (includes distant terrain that is not drawn). */
  sunVisible: boolean;
  earthVisible: boolean;
}

interface TerrainPatch {
  half_width_m: number;
  size: number;
  heights_m: number[];
}

interface SceneParts {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  terrain: Mesh<PlaneGeometry, MeshStandardMaterial>;
  sunLight: DirectionalLight;
  sunMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  earthMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  pin: Mesh<CylinderGeometry, MeshBasicMaterial>;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; patch: TerrainPatch }
  | { kind: "error"; message: string };

const ASPECT: number = 0.6;
const MARKER_DISTANCE_KM: number = 7.5;
const EXAGGERATIONS: readonly number[] = [1, 2, 3, 5];

/** Unit vector toward (azimuth clockwise from north, elevation) in world axes. */
export function directionVector(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az: number = (azimuthDeg * Math.PI) / 180;
  const el: number = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function hasWebGL(): boolean {
  try {
    const canvas: HTMLCanvasElement = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

const NO_WEBGL: string = "The 3D view needs WebGL, which is not available in this browser.";

function cssColor(name: string, fallback: string): Color {
  const value: string = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(value === "" ? fallback : value);
}

function buildScene(canvasHost: HTMLDivElement, patch: TerrainPatch, width: number): SceneParts {
  const renderer: WebGLRenderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, width * ASPECT);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  canvasHost.replaceChildren(renderer.domElement);

  const scene: Scene = new Scene();
  scene.background = new Color("#05060a");
  const extentKm: number = (2 * patch.half_width_m) / 1000;
  const camera: PerspectiveCamera = new PerspectiveCamera(45, 1 / ASPECT, 0.05, 200);
  camera.position.set(extentKm * 0.55, extentKm * 0.45, extentKm * 0.8);

  const geometry: PlaneGeometry = new PlaneGeometry(extentKm, extentKm, patch.size - 1, patch.size - 1);
  const material: MeshStandardMaterial = new MeshStandardMaterial({ color: "#b9b5ab", roughness: 1 });
  const terrain: Mesh<PlaneGeometry, MeshStandardMaterial> = new Mesh<PlaneGeometry, MeshStandardMaterial>(
    geometry,
    material,
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  scene.add(terrain);

  scene.add(new AmbientLight("#9aa3b5", 0.08));
  const sunLight: DirectionalLight = new DirectionalLight("#ffffff", 3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const shadowExtent: number = extentKm * 0.75;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 60;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const sunMarker: Mesh<SphereGeometry, MeshBasicMaterial> = new Mesh<SphereGeometry, MeshBasicMaterial>(
    new SphereGeometry(0.25, 24, 16),
    new MeshBasicMaterial({ color: cssColor("--sun", "#eb6834") }),
  );
  const earthMarker: Mesh<SphereGeometry, MeshBasicMaterial> = new Mesh<SphereGeometry, MeshBasicMaterial>(
    new SphereGeometry(0.25, 24, 16),
    new MeshBasicMaterial({ color: cssColor("--earth", "#2a78d6") }),
  );
  const pin: Mesh<CylinderGeometry, MeshBasicMaterial> = new Mesh<CylinderGeometry, MeshBasicMaterial>(
    new CylinderGeometry(0.04, 0.04, 0.6, 12),
    new MeshBasicMaterial({ color: "#ffffff" }),
  );
  pin.position.set(0, 0.3, 0);
  scene.add(sunMarker, earthMarker, pin);

  const controls: OrbitControls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1;
  controls.maxDistance = extentKm * 3;
  controls.update();

  return { renderer, scene, camera, controls, terrain, sunLight, sunMarker, earthMarker, pin };
}

function applyHeights(parts: SceneParts, patch: TerrainPatch, exaggeration: number): void {
  const position: BufferAttribute = parts.terrain.geometry.getAttribute("position") as BufferAttribute;
  patch.heights_m.forEach((height: number, i: number): void => {
    // PlaneGeometry vertices run row by row from the north-west corner, like the API patch.
    position.setZ(i, (height / 1000) * exaggeration);
  });
  position.needsUpdate = true;
  parts.terrain.geometry.computeVertexNormals();
  parts.terrain.geometry.computeBoundingSphere();
}

export function Terrain3D({
  apiClient,
  site,
  selectedTimeUtc,
  observerHeightM,
  sunAzimuthDeg,
  sunElevationDeg,
  earthAzimuthDeg,
  earthElevationDeg,
  sunVisible,
  earthVisible,
}: Terrain3DProps): JSX.Element {
  const hostRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const canvasRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const partsRef: RefObject<SceneParts | null> = useRef<SceneParts | null>(null);
  const selectedPoint: RefObject<Vector3 | null> = useRef<Vector3 | null>(null);
  const width: number = Math.max(320, useElementWidth(hostRef, 960));
  // Keyed by site in the parent, so each site starts from a fresh "loading" state.
  const [state, setState] = useState<LoadState>((): LoadState =>
    hasWebGL() ? { kind: "loading" } : { kind: "error", message: NO_WEBGL },
  );
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const restoreGuard: RefObject<SelectionGuard> = useRef<SelectionGuard>(new SelectionGuard());
  const selectionGuard: RefObject<SelectionGuard> = useRef<SelectionGuard>(new SelectionGuard());
  const [exaggeration, setExaggeration] = useState<number>(2);
  const siteId: string = site.site.id;

  const webglMissing: boolean = state.kind === "error" && state.message === NO_WEBGL;

  useEffect((): (() => void) | undefined => {
    if (webglMissing) {
      return undefined;
    }
    let cancelled: boolean = false;
    apiClient
      .GET("/api/sites/{site_id}/terrain", { params: { path: { site_id: siteId } } })
      .then(({ data }): void => {
        if (cancelled) return;
        setState(
          data === undefined
            ? { kind: "error", message: "No terrain data for this site (it uses a flat horizon)." }
            : { kind: "ready", patch: data },
        );
      })
      .catch((caught: unknown): void => {
        if (!cancelled) {
          setState({ kind: "error", message: caught instanceof Error ? caught.message : String(caught) });
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, [apiClient, siteId, webglMissing]);

  useEffect((): (() => void) => {
    const guard: SelectionGuard = restoreGuard.current;
    const token: number = guard.next();
    const saved: string | null = localStorage.getItem("lunar-ops-c0");
    if (saved !== null && siteId === "sample-a") {
      void apiClient.GET("/api/candidates/{candidate_id}", { params: { path: { candidate_id: saved } } })
        .then(({ data }): void => { if (guard.isCurrent(token) && data !== undefined) setCandidate(data); })
        .catch((): void => { /* A missing saved candidate leaves the viewer ready for a new selection. */ });
    }
    return (): void => { guard.invalidate(); };
  }, [apiClient, siteId]);

  const patch: TerrainPatch | null = state.kind === "ready" ? state.patch : null;

  // Build (and dispose) the scene when the terrain changes.
  useEffect((): (() => void) | undefined => {
    const host: HTMLDivElement | null = canvasRef.current;
    if (patch === null || host === null) {
      return undefined;
    }
    let parts: SceneParts;
    try {
      parts = buildScene(host, patch, width);
    } catch {
      // Report asynchronously: the effect itself must not set state synchronously.
      queueMicrotask((): void => {
        setState({ kind: "error", message: NO_WEBGL });
      });
      return undefined;
    }
    partsRef.current = parts;
    const render: () => void = (): void => {
      parts.renderer.render(parts.scene, parts.camera);
    };
    parts.controls.addEventListener("change", render);
    return (): void => {
      parts.controls.removeEventListener("change", render);
      parts.controls.dispose();
      parts.scene.traverse((object: Object3D): void => {
        if (object instanceof Mesh) {
          const mesh: Mesh = object as Mesh;
          mesh.geometry.dispose();
          const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((m: Material): void => {
            m.dispose();
          });
        }
      });
      parts.renderer.dispose();
      partsRef.current = null;
    };
    // The canvas is resized in place below; rebuilding on width changes would reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch]);

  // Heights change only with the terrain or the exaggeration (not on every playback frame).
  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null || patch === null) {
      return;
    }
    applyHeights(parts, patch, exaggeration);
    if (selectedPoint.current !== null) {
      const point: Vector3 = selectedPoint.current;
      parts.pin.position.set(point.x, point.y * exaggeration + 0.3, point.z);
    }
    parts.renderer.render(parts.scene, parts.camera);
  }, [patch, exaggeration]);

  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null) {
      return;
    }
    parts.renderer.setSize(width, width * ASPECT);
    parts.renderer.render(parts.scene, parts.camera);
  }, [width]);

  // Each click starts a new request. Cleanup invalidates requests when the scenario changes.
  useEffect((): (() => void) | undefined => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null || patch === null || siteId !== "sample-a") return undefined;
    const canvas: HTMLCanvasElement = parts.renderer.domElement;
    const guard: SelectionGuard = selectionGuard.current;
    let down: { x: number; y: number } | null = null;
    const onDown: (event: PointerEvent) => void = (event: PointerEvent): void => { down = { x: event.clientX, y: event.clientY }; };
    const onUp: (event: PointerEvent) => void = (event: PointerEvent): void => {
      if (down === null || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      down = null;
      const rect: DOMRect = canvas.getBoundingClientRect();
      const mouse: Vector2 = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1);
      const hit: TerrainPick | null = pickTerrain(parts.camera, parts.terrain, mouse);
      const sequence: number = guard.next();
      restoreGuard.current.invalidate();
      setCandidate(null);
      setSelectionError(null);
      selectedPoint.current = null;
      parts.pin.visible = false;
      parts.renderer.render(parts.scene, parts.camera);
      if (hit === null) return;
      const point: Vector3 = hit.point;
      void apiClient.POST("/api/sites/{site_id}/candidate", {
        params: { path: { site_id: siteId } },
        body: { east_m: hit.east_m, north_m: hit.north_m,
          observer_height_m: observerHeightM, selected_time_utc: selectedTimeUtc },
      }).then(({ data }): void => {
        if (!guard.isCurrent(sequence)) return;
        if (data === undefined) { setSelectionError("Selection is outside valid DEM coverage or terrain is unavailable."); return; }
        selectedPoint.current = new Vector3(point.x, point.y / exaggeration, point.z);
        parts.pin.visible = true;
        parts.pin.position.set(point.x, point.y + 0.3, point.z);
        parts.renderer.render(parts.scene, parts.camera);
        localStorage.setItem("lunar-ops-c0", data.candidate_id);
        setCandidate(data);
      }).catch((): void => { if (guard.isCurrent(sequence)) setSelectionError("Could not load DEM data for this selection."); });
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return (): void => { guard.invalidate(); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerup", onUp); };
  }, [apiClient, patch, siteId, selectedTimeUtc, observerHeightM, exaggeration]);

  // Lights and markers follow the instant shown; render once per change.
  useEffect((): void => {
    const parts: SceneParts | null = partsRef.current;
    if (parts === null || patch === null) {
      return;
    }
    const sun: Vector3 = directionVector(sunAzimuthDeg, sunElevationDeg);
    parts.sunLight.position.copy(sun.clone().multiplyScalar(30));
    // Light while the Sun's upper limb is above the astronomical horizon (~0.27° semidiameter).
    parts.sunLight.intensity = sunElevationDeg > -0.3 ? 3 : 0;
    parts.sunMarker.position.copy(sun.clone().multiplyScalar(MARKER_DISTANCE_KM));
    parts.earthMarker.position.copy(
      directionVector(earthAzimuthDeg, earthElevationDeg).multiplyScalar(MARKER_DISTANCE_KM),
    );
    parts.earthMarker.material.opacity = earthVisible ? 1 : 0.35;
    parts.earthMarker.material.transparent = !earthVisible;
    parts.pin.material.color = sunVisible ? cssColor("--sun", "#eb6834") : new Color("#6f6d68");
    parts.renderer.render(parts.scene, parts.camera);
  }, [patch, sunAzimuthDeg, sunElevationDeg, earthAzimuthDeg, earthElevationDeg, sunVisible, earthVisible]);

  return (
    <div className="terrain-3d" ref={hostRef}>
      {state.kind === "loading" && <p className="muted">Loading terrain…</p>}
      {state.kind === "error" && <p className="muted">{state.message}</p>}
      <div
        ref={canvasRef}
        className="terrain-canvas"
        role="img"
        aria-label={`3D terrain around ${site.site.name}, lit by the Sun at the time shown`}
        hidden={state.kind !== "ready"}
      />
      {selectionError !== null && <p role="alert">{selectionError}</p>}
      {candidate !== null && <><CandidateInspector candidate={candidate} /><LandingGraph key={candidate.candidate_id} apiClient={apiClient} candidate={candidate} /></>}
      {state.kind === "ready" && (
        <div className="terrain-caption">
          <p>
            At the site now: <strong>{sunVisible ? "Sun up" : "Sun hidden"}</strong> ·{" "}
            <strong>{earthVisible ? "Earth in view" : "Earth not in view"}</strong> (pin: orange when sunlit).
            Drag to rotate, scroll to zoom. {siteId === "sample-a" ? "Click terrain to create Candidate C0." : "Candidate selection is available at Sample A."}
          </p>
          <p className="muted">
            Local terrain ±{(state.patch.half_width_m / 1000).toFixed(0)} km around the site from NASA LOLA
            (20 m). Distant peaks also block the Sun and the Earth; they are included in the results but
            not drawn here.{" "}
            <label>
              Vertical exaggeration{" "}
              <select
                value={exaggeration}
                onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                  setExaggeration(Number(event.target.value));
                }}
              >
                {EXAGGERATIONS.map(
                  (value: number): JSX.Element => (
                    <option key={value} value={value}>
                      {`${value.toString()}×`}
                    </option>
                  ),
                )}
              </select>
            </label>
          </p>
        </div>
      )}
    </div>
  );
}
