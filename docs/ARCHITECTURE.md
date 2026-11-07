# LUNA-P/OPS architecture

Status: describes the code at commit `06bda7c` (reviewed 2026-11-07). Technical package and
service names (`clps_api`, `lunar_core`, `@clps/web`, `CLPS_DATA_DIR`, the Docker service names)
are kept from the upstream CLPS Lunar Mission Browser for compatibility.

## 1. Layers and authority

| Layer | Location | Responsibility |
| --- | --- | --- |
| Scientific core | `backend/lunar-core` (`lunar_core`) | Pure Python, no web code: projection, DEM grids, horizon masks, SPICE geometry, visibility rules, windows, ROI definition. The only place physical rules live. |
| API | `backend/api` (`clps_api`, FastAPI) | Candidate creation, evaluation, brush orchestration, experiment manifests, SQLite persistence, provenance. Calls into `lunar_core`; never adds its own physics. |
| Data pipelines | `backend/pipelines` (`clps_pipelines`) | Download bounded LOLA windows, SPICE kernels and the pole-map relief into `data/`. |
| API client | `frontend/api-client` | OpenAPI schema and generated TypeScript types (`make openapi`). |
| Web app | `frontend/web` (React 19, TypeScript, Vite) | Interaction and display only. Three.js terrain, Rete.js graph, Inspector, Timeline, Constraint Brush, original catalog comparison. |
| Infrastructure | `infrastructure/`, `compose.yaml`, `Makefile` | Development, production and isolated E2E Docker stacks. |

Rule: the browser never computes a scientific value. Display heights, exaggeration, mesh
curvature, lighting and rays in the 3D view are visual; every stored or reported number comes
from an API response.

## 2. Backend modules

- `lunar_core/terrain.py`: spherical south polar stereographic projection on R = 1737.4 km (+y
  toward 0°E, +x toward 90°E), `TerrainGrid` with bilinear sampling at pixel centres (NaN outside).
- `lunar_core/roi.py`: the Shackleton Rim B ROI (±2 km study square; 12 km near and 205 km far
  download windows) and the ROI-centre local east/north frame.
- `lunar_core/horizon.py`: terrain horizon mask (great-circle rays, two nested grids).
- `lunar_core/geometry.py`, `visibility.py`, `windows.py`: SPICE positions, Sun/Earth rules,
  sampled windows.
- `clps_api/candidate.py`: C0 creation from local offsets; DEM re-sampling; content-hash identity.
- `clps_api/candidate_store.py`: SQLite `candidates` table; C1 derivation (`evolve`); read-only
  existence check for brush previews.
- `clps_api/evaluation.py`: strict per-candidate evaluation (`compute`), storage (`save`),
  provenance and software commit.
- `clps_api/brush.py`: polygon validation, grid sampling, preview token, batch execution, metrics
  and constraint verdicts.
- `clps_api/experiment.py`: experiment manifest and recompute-and-compare.
- `clps_api/roi_terrain.py`: 4 km display grid (20 m) with coverage checks; 40 km regional
  display grid (161 × 161 nodes, 250 m spacing, bilinear samples of the 240 m DEM, with corner
  coordinates). The 40 km square contains the south pole (local 0 m E, −14.42 km N).
- `clps_api/service.py`, `pole_map.py`, `terrain_store.py`: the original catalog comparison.

SPICE calls are serialized with a lock (`SPICE_LOCK`) because CSPICE is not thread-safe. The API
records the SHA-256 of the loaded kernels at start-up and refuses to evaluate if the kernel files
change while it runs.

## 3. API contract (LUNA-P/OPS endpoints)

Interactive documentation at `/docs` on a running API.

| Method and path | Effect |
| --- | --- |
| `GET /api/rois` | List ROIs and whether their LOLA windows are present |
| `GET /api/rois/{roi_id}/terrain` | 4 km display grid, corners, coverage checks, datasets, limitations |
| `GET /api/rois/{roi_id}/regional-terrain` | 40 km display-only far-field grid and its corners |
| `POST /api/rois/{roi_id}/candidates` | Create (or reuse) a C0 at local east/north offsets — **writes** |
| `GET /api/rois/{roi_id}/candidates` | C0 candidates of the ROI |
| `POST /api/rois/{roi_id}/brush/preview` | Validate and sample a polygon — read-only |
| `POST /api/rois/{roi_id}/brush/execute` | Evaluate a confirmed preview — **writes** (requires `confirmed: true` and the preview token) |
| `GET /api/candidates/{id}`, `/ref`, `/children` | Read a candidate, its reference hash, its C1 children |
| `POST /api/candidates/{id}/evolve` | Derive a C1 (observer height, time) — **writes** |
| `POST /api/candidates/{id}/evaluations` | Compute and store an evaluation — **writes** |
| `GET /api/candidates/{id}/evaluations`, `GET /api/evaluations/{id}` | Read stored evaluations |
| `GET /api/evaluations/{id}/manifest` | Reproducibility manifest built from stored records |
| `POST /api/evaluations/{id}/recompute` | Recompute and compare; never stores |

The catalog endpoints (`/api/sites…`, `/api/analysis`, `/api/map…`) are unchanged from upstream.
Use the exact paths in `frontend/api-client/openapi.json` when in doubt.

## 4. Frontend state and interaction

- `lib/explorationStore.ts` is the single shared state (`useSyncExternalStore`): `context`
  (candidate or catalog), `rootId`, `revisionId`, `evaluation`, `cursorUtc`, `draft`, `settings`,
  `playing`, `activity`, and a separate `catalog` sub-state. Its header comment lists which actions may change
  display, draft, persisted and evaluation state.
- Writes happen only on explicit actions: a terrain click inside the study area (C0), **Create
  Candidate C1**, **Evaluate**, and the confirmed brush execution. Cursor, camera, hover and
  selection never call a writing endpoint (asserted in the browser tests).
- `App.tsx` persists identifiers only (root, revision, evaluation, cursor, context) to
  `localStorage`, debounced by 300 ms and flushed on `pagehide`, and re-reads every record from
  the API on load.
- `components/RoiTerrain3D.tsx` (Three.js): one scene; the 40 km and 4 km grids are swapped in it.
  Candidate creation happens only on the 4 km grid, inside the study area and never while a region
  evaluation runs. Sky geometry (paths, trail, cursor ray, horizon silhouette) is built from the
  stored evaluation by the pure helpers in `lib/sceneGeometry.ts` on a symbolic dome; whole paths
  are rebuilt per evaluation and scale, the cursor objects per Timeline step. The canvas exposes
  `data-*` attributes (path counts, cursor index, drawn Sun/Earth directions, hover coordinates)
  that the browser tests compare with the API.
  Click picking returns local east/north offsets to the parent; markers, brush polygon, sample
  markers, Sun/Earth rays and horizon guides are overlays.
- `components/LandingGraph.tsx`, `landingGraph.ts` (Rete.js v2 with `rete-engine`): Location,
  Terrain, Observer Height, Time → Candidate (`preview`, `candidate_ref`) → Scientific computation
  (memoised; runs only on Evaluate) → Results. There are no region-level nodes.
- `components/ConstraintBrush.tsx`: the Region Brush dock. Regions (vertices, parameters, revision,
  preview, execution), the active region, the drawing mode and the inspected result live in the
  shared store. Every edit increments the region's revision and discards its preview/results view;
  preview and execution responses are applied only to the revision they were requested for.
  Deleting a region removes the drawing only. Selecting a candidate anywhere moves the inspected
  result to the matching region result or clears it. Region definitions are saved to
  `localStorage` (`lunar-ops-regions`); previews and results are not. The dock is fixed below the
  Timeline in the candidate context and publishes its height (`--brush-dock-h`) so the Timeline and
  page padding sit above it.
- `components/WorkspaceInspector.tsx`, `ExperimentPanel.tsx`, `ContextBar.tsx`: inspection,
  manifest export, recompute-and-compare, active-context bar.
- Page order (desktop): workspace, catalog Sky & timeline (`ChartsPanel`), catalog comparison,
  Learn more, the saved-candidate list (rendered by `ShackletonWorkspace` through a portal into the
  `#saved-candidates` section), then Assumptions & sources and Glossary.
- The original catalog UI (`ChartsPanel`, `SkyChart`, `Timeline`, `PoleMap`, …) is intact; its
  sky diagram and timeline are reused to display stored candidate evaluations.

## 5. Persistence

`data/candidates.sqlite3` (path from `CLPS_DATA_DIR`, default `data`):

```sql
CREATE TABLE candidates  (id TEXT PRIMARY KEY, parent TEXT, payload TEXT NOT NULL);
CREATE TABLE evaluations (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, payload TEXT NOT NULL);
```

- Payloads are the JSON of `CandidateOut` / `EvaluationOut`.
- Inserts use `INSERT OR IGNORE` followed by a read-back comparison: identical records are reused,
  a different payload under an existing ID raises an identity collision. Nothing is updated or
  deleted by the application.
- **C0 identity:** SHA-256 of site ID, latitude, longitude, observer height, UTC time, DEM source
  URL, DEM window SHA-256, DEM resolution, coordinate reference and sampled elevation.
- **C1 identity:** SHA-256 of parent ID, observer height and UTC time.
- **Evaluation identity:** SHA-256 of the whole result (candidate, request, provenance, status,
  errors, warnings, samples, intervals, horizon). A rerun with identical data and code reuses the
  record; any difference creates a new one.
- The brush preview checks existing IDs through a read-only (`mode=ro`) connection and never
  creates the database file.

## 6. Provenance recorded per evaluation

Algorithm ID (`candidate-horizon-spice-v1`), horizon parameters, visibility rules, time-sampling
rule, SPICE settings, near/far DEM source URLs, window SHA-256 and resolutions, kernel SHA-256s,
SPICE lunar radii, versions of `lunar-core`, `clps-api`, `spiceypy` and `numpy`, and the software
commit (`CLPS_BUILD_COMMIT` baked into the image by `make up`, or `CLPS_GIT_COMMIT` at runtime,
with `-dirty` when the tree had uncommitted changes). Under `make dev` live sync the recorded
commit describes the image build, not later synced edits.

## 7. Docker stacks

| Stack | File | Data |
| --- | --- | --- |
| Development | `compose.yaml` → `infrastructure/docker-compose.yml` | `./data` bind mount (real database) |
| Production | `infrastructure/docker-compose.prod.yml` | named volume `clps-data`; nginx + API on one port |
| Isolated E2E | `infrastructure/docker-compose.e2e.yml` | kernels/terrain/basemap read-only; database in `tmpfs`; web on `127.0.0.1:15180` |

The development `data` service runs `clps-fetch-kernels`, `clps-fetch-terrain` (catalog sites) and
`clps-fetch-basemap`. The Shackleton Rim B windows come from
`python -m clps_pipelines.fetch_roi`, which is not part of that service.
