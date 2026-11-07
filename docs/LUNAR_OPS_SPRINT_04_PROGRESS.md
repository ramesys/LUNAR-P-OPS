# Sprint 04: Shackleton ROI, CandidateRef dataflow and workspace

Status (2026-11-07): the Sprint 04 scope is implemented and verified locally with automated
tests and a browser run against the Docker stack. The earlier Sprint 04 fixes (the landing
workspace sits outside the remounting comparison panel, and the graph survives Simple/Expert
changes) are unchanged. Nothing here validates illumination, terrain accuracy or landing safety.

## Shackleton Rim B input data

The ROI is a 4 km × 4 km square in local east/north coordinates around planetocentric latitude
−89.5244°, east longitude 56.30993°. NASA's
[Lunar Surface Data Book, table A2.1-1](https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf)
identifies this point as Shackleton Rim B. The square is a proposed study area, not an official
landing site or a surveyed rim boundary. The definition lives in `lunar_core/roi.py`
(`SHACKLETON_RIM_B`).

The local NPZ windows are not committed. Their SHA-256 hashes were checked again on 2026-11-07
and still match:

| Window | Dataset | Shape | Bounds x, y (m) | SHA-256 of local NPZ |
| --- | --- | --- | --- | --- |
| `shackleton-rim-b_near.npz` | `LDEM_80S_20MPP_ADJ.TIF`, 20 m/pixel | 1200 × 1200 | x [0, 24000], y [−4000, 20000] | `99be1952c9c4c542c786e59102110b4d9c1c744b971702c1e0d9e4377ba73b5f` |
| `shackleton-rim-b_far.npz` | `LDEM_60S_240MPP_ADJ.TIF`, 240 m/pixel | 1708 × 1708 | x [−193200, 216720], y [−196800, 213120] | `e1f348b1a942ddd8430158d2ab68ab5e7056b146a2d0b679dae3762e7b61e6b7` |

The bounds are pixel edges in south polar stereographic metres, with +y toward 0°E. The hashes
identify the extracted windows, not the full NASA files. To recreate the windows, run
`python -m clps_pipelines.fetch_roi`. It uses the existing `read_window` with a 12 km near and a
205 km far half-width. Existing files are kept. The source data may change, so check the hashes
and nodata again after any download.

Earlier independent checks remain bounded evidence. At projected pixel centre (11990, 7990) m,
Rasterio and the cached grid both gave −25.660717 m. pyproj matched the stereographic transform
to about 2×10⁻¹² m.

## What was implemented

**Task A: ROI API** (`clps_api/roi_terrain.py`, `lunar_core/roi.py`)

- `GET /api/rois`: the registered ROIs.
- `GET /api/rois/{roi_id}/terrain`: one continuous 201 × 201 grid at 20 m spacing over ±2000 m
  east/north. Elevations come from the cached 20 m DEM by bilinear sampling, in metres above the
  1737.4 km sphere, with null where there is no value. The response also includes:
  - the centre and its projected coordinates, and the east/north axes in the projected plane;
  - the stereographic scale factor (1.0000172), the corner coordinates, and the latitude and
    longitude extent over all grid nodes;
  - near and far dataset identity, URL, resolution, local SHA-256, nodata and window bounds;
  - grid coverage, plus `verify_coverage` horizon ray checks at the centre and four corners;
  - a list of limitations.
  Results are cached per pair of window hashes. Missing windows return 404.
- `POST /api/rois/{roi_id}/candidates` creates a candidate from local east/north offsets.
  Offsets outside the ROI or outside DEM coverage return 422. The code reuses the Sample A path:
  the same projection, the same `TerrainGrid.sample` bilinear raster sample and the same identity
  hash.
- `GET /api/rois/{roi_id}/candidates` lists persisted root (C0) candidates, oldest first.
- `GET /api/candidates/{id}/ref` returns the `CandidateRef`: `schema_version: candidate-ref/1`,
  `candidate_id`, `site_id`, `parent_candidate_id`, `terrain_window_id` and `snapshot_sha256`.
  The last is the SHA-256 of the stored SQLite payload.
- `CandidateOut.terrain_window_id` is a new field. It defaults to `sample-a`, so stored
  candidates from before Sprint 04 still parse. The evaluation now reads the candidate's own
  near and far windows. Before this change it was hard-coded to Sample A, which would have
  reused Sample A terrain for Shackleton candidates. It records `terrain_window_id` in the
  provenance. Unknown window ids are refused. Candidate ID formulas are unchanged. Evaluation IDs
  of new runs differ from runs stored before Sprint 04 for the same inputs, because the candidate
  dump and the provenance now include the window id. Old records remain readable.

**Task B: one Shackleton 3D scene** (`RoiTerrain3D.tsx`, `ShackletonWorkspace.tsx`, `lib/roiFrame.ts`)

- One georeferenced PlaneGeometry mesh. Row 0 is north and column 0 is west; world axes are
  kilometres east, up and south.
  - The mesh height is the DEM elevation minus the centre elevation minus the sphere's drop,
    times an optional 1–3× exaggeration. It is used for display only.
  - Vertex shading follows elevation. The lighting is fixed and is labelled as not being the Sun.
- Orbit, pan and zoom use OrbitControls. A click raycasts markers first, then the terrain. The
  terrain hit becomes local east/north metres, and the API samples the original raster there.
- Markers of persisted candidates are placed from their latitude and longitude with a TypeScript
  mirror of the projection. It is tested against backend values to within 10⁻⁶ m and
  10⁻¹⁰ degrees. The scene is built once per terrain load. Selection only redraws the markers,
  so the camera never resets.
- The workspace sits in the always-mounted Landing workspace card. It shows the ROI georeference,
  datasets, coverage and limitations, and the settings for new candidates. A candidate list
  doubles as an accessible way to select markers. A stale earlier POST cannot replace a newer
  selection.

**Tasks C and D: CandidateRef → Scientific computation → Results** (`landingGraph.ts`, `LandingGraph.tsx`)

- The Candidate node has two typed outputs:
  - `preview` (CandidatePreview): the unsaved live preview, never evaluated;
  - `candidate_ref` (CandidateRef): the reference to a committed, persisted candidate.

  The old separate "Saved Candidate" node is removed. Sockets are shared objects, so the
  connection pipe accepts only identical socket types.
- `Output C0` and `Output C1` choose which committed candidate is on `candidate_ref`. Creating
  C1 still uses `/evolve`, so C0 is unchanged, and the new C1 is selected automatically.
- `ScientificComputationNode` receives the CandidateRef through `DataflowEngine`.
  - Without an explicit Evaluate it only restores the latest persisted evaluation.
  - After Evaluate it retrieves the authoritative candidate and checks the site id and the stored
    snapshot hash against the reference. It then calls the existing FastAPI evaluation and
    outputs an `EvaluationRef` (`evaluation-ref/1`).
  - Calls are memoised per candidate, duration and step. Rete cache resets and React re-renders
    therefore never repeat a POST; a unit test checks this.
- `ResultsNode` receives the EvaluationRef, retrieves `GET /api/evaluations/{id}`, and checks
  that the evaluation and candidate ids match. The panel and the node controls show the
  persisted status, errors, warnings and provenance.
- Removing a wire resets its target node, so a disconnected computation reports "No CandidateRef
  received" and does not keep its old output. A `rete-engine` `Cancelled` fetch is retried.
  Stale responses are ignored when the selected reference or the request token has changed.
- Preview edits reset the Height and Time nodes, which cascades through Candidate and its
  successors. The browser run found and fixed a regression where only Candidate was reset and
  the preview kept showing the old height.

**Task E**: the comparison, maps, Sample A 3D view, charts, timelines, inspector, Simple/Expert
modes and comparison views are unchanged and still reachable. Selecting a Shackleton candidate
from the scene or the list does four things: it updates the marker highlight and the inspector
(now showing the terrain window), rebuilds the Landing Graph for that C0, and moves
`candidate_ref`. The browser's local storage keeps the selected candidate across reloads, and
SQLite keeps the candidates and evaluations.

## Verification (2026-11-07, local Docker stack)

Automated checks:

- Backend: `docker compose run --rm --no-deps -T -v ./backend:/workspace api sh -c "ruff check . && ruff format --check . && mypy && pytest -q -p no:cacheprovider"`
  gives **129 passed**, with 0 skipped (121 at the baseline). The new `api/tests/test_roi.py`
  covers:
  - ROI grid georeference and orientation, using a synthetic planar DEM;
  - two candidates located exactly from the raster, the out-of-ROI 422, and the root listing;
  - the CandidateRef snapshot hash and missing windows;
  - Shackleton evaluations reading the ROI windows, and far-field nodata giving `UNAVAILABLE`;
  - a real-data test: the real ROI matches direct raster samples, all five checks are covered,
    and two real Shackleton candidates evaluate to `COMPUTED_UNVERIFIED` with the ROI hashes.
- Frontend: `pnpm -r --workspace-root test` gives **54 passed** (49 at the baseline). `lint` and
  `typecheck` pass. `pnpm --filter @clps/web build` passes with the existing warning about chunks
  over 500 kB (the three.js chunk).
- The OpenAPI file and `api-client/src/schema.d.ts` were regenerated.
- The Playwright e2e suite (`make e2e`, which needs Edge on the host) was not run.

Browser run at http://localhost:5180:

1. The ROI terrain came from the verified DEM: 40401 of 40401 samples finite, elevations −633 m
   to +653 m, and the near and far hashes in the table above.
2. Clicks on distinct terrain points created separate persisted candidates with distinct
   coordinates. All markers stayed visible in the one scene.
   - Five Shackleton candidates are now stored.
   - One controlled click produced exactly one pointer sequence and one POST.
   - The first session logged four POSTs for two automated clicks, at four distinct points. This
     suggests separate pointer sequences, possibly manual interaction in the shared pane; it was
     not reproduced.
3. After orbiting to camera (2.9364, 0.1088, −4.5788) and switching between candidates twice, the
   camera position was the same.
4. Selection updated the marker highlight, the inspector, the graph and the CandidateRef. The
   CandidateRef had `snapshot_sha256` set and window `shackleton-rim-b`.
5. Evaluate C0 (24 h, 60 min) gave `COMPUTED_UNVERIFIED`, evaluation `evaluation-13af6d32…`.
   - Provenance shows window `shackleton-rim-b`, near `99be1952…`, far `e1f348b1…`, five kernel
     hashes and 720 horizon samples.
   - The Sun was at about 1.1° elevation against a sampled terrain horizon of about 14.4° in its
     direction, so no sampled Sun or Earth visibility in that window. This is a geometric output,
     not a validated illumination result.
6. A reload restored the five markers, the selection, and the same evaluation through the
   graph's restore path.
7. Editing the height to 10 m in the graph updated the preview, while `candidate_ref` stayed on
   C0. Creating C1 moved `candidate_ref` to C1. Evaluate C1 gave `COMPUTED_UNVERIFIED`
   (`evaluation-d9f61acb…`). The stored C0 kept 2 m.
8. A Sample A candidate about 4 km from the site gave an explicit `UNAVAILABLE`: 3593 of 287280
   near-field ray samples were missing. A Sample A centre candidate gave `COMPUTED_UNVERIFIED`
   with the Sample A window (`753de3fe…`). That candidate was created with the same POST the 3D
   click uses.
9. Expert → Simple → Expert and a comparison rerun kept the 7-node graph, the Shackleton
   workspace, the same WebGL canvas element and the displayed result.

The local `data/candidates.sqlite3` now also holds these demonstration candidates and evaluations.

## Scientific limitations

- Display-grid elevations are bilinear samples of the 20 m raster at nodes of a rotated
  east/north grid. They are not the raw pixel lattice. East/north offsets are in projected
  metres; the scale factor differs from 1 by 1.7×10⁻⁵ at the ROI centre.
- The five-point horizon coverage check is not a proof for every ROI position. Each candidate is
  checked again before evaluation, and a failure gives `UNAVAILABLE`. The checks cover the
  discrete ray samples only, not the terrain between them.
- `COMPUTED_UNVERIFIED` means the workflow ran. `VALIDATED` is never assigned. Nothing here is a
  landing-safety, power or communication assessment.
- The DEM shows a steady rise of about 1.3 km across the ROI, from the north-west edge toward the
  south-east (toward the pole and the crater). It was not checked independently beyond the
  earlier point comparisons.

## Remaining work and next steps

- Run `make e2e` on a host with Edge, and add an e2e test for the Shackleton click → Evaluate
  flow.
- Optional: hover readout of the DEM elevation, and a label per marker in the 3D scene.
- For the submission:
  - refresh the README screenshots (`make screenshots`);
  - record the demo path (Shackleton ROI → two candidates → C1 → Evaluate → reload);
  - document the 4 km ROI as a study area, not a landing recommendation.
