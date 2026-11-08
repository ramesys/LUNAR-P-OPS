# Verification, reproducibility and limitations

Status: consolidated on 2026-11-08 for the release state of branch `feat/terrain-aware-brush`
(Experiment B and the n8n integration on top of `7cdbb8c`). This is the current verification record. [STATUS.md](STATUS.md) keeps
the dated development log, which these results come from.

**What "verified" means here.** A result is "tested" when an automated test passes, and a
"verified run" when a recorded execution demonstrates it. Neither means *scientifically
validated*. No LUNA-P/OPS result has been independently validated.

## 1. Scientific status labels

| Label | Where | Meaning |
| --- | --- | --- |
| `COMPUTED_UNVERIFIED` | evaluations, terrain screens | Numerically computed by the Python engine; not independently validated. Every stored evaluation carries this or `UNAVAILABLE`. |
| `UNAVAILABLE` | evaluations, brush results | Required DEM or horizon coverage missing; no substitute was used |
| `VALIDATED` | schema only | Never assigned |
| `PASS` / `FAIL` / `NOT_ASSESSED` | brush verdicts, terrain screens | Outcome of configured thresholds on computed values; `NOT_ASSESSED` is never treated as passing |
| `COMPUTED_EVIDENCE` / `AI_INTERPRETATION` / `UNVERIFIED_SUGGESTION` | n8n AI review | Stored Python values / model reasoning / proposals that were not executed |

## 2. Verification levels

| Level | Status | Evidence |
| --- | --- | --- |
| 1. Implemented computation | yes | [SCIENTIFIC_METHODOLOGY.md](SCIENTIFIC_METHODOLOGY.md) §2–§9 |
| 2. Automated software verification | yes | §3 below |
| 3. Numerical comparison with independent reference data | partly | §4 below |
| 4. Independent scientific validation | **no** | No comparison with an independent illumination or Earth-visibility product at the Shackleton Rim B points; no external review |

## 3. Automated tests

### 3.1 Inventory

| Suite | Files | Covers |
| --- | --- | --- |
| `backend/lunar-core/tests` | `test_geometry`, `test_horizon`, `test_horizons_golden`, `test_visibility`, `test_windows`, `test_landing_terrain`, `test_analysis`, `test_custom_sites`, `test_pole_map`, `test_terrain_patch`, `test_version` | Projection round trips and axes; bilinear sampling with NaN outside the grid; flat-Moon dip; an isolated synthetic mountain blocking only its azimuth; mask interpolation across north; Sun/Earth rules; windows; offline JPL Horizons golden comparison; exact slope of tilted planes, detrended roughness, missing nodes never passing, verdict and margin rules, vectorized = single-point |
| `backend/api/tests` | `test_candidate`, `test_candidate_evaluation`, `test_candidate_evolution`, `test_experiment`, `test_brush`, `test_adaptive_brush`, `test_terrain_screen`, `test_roi`, `test_terrain`, `test_health`, `test_analysis`, `test_custom_sites`, `test_pole_map` | Candidate identity and dataset-hash checks; `UNAVAILABLE` on near/far nodata; manifest and recompute; polygon validation, deterministic sampling, inclusive thresholds, preview isolation (no database created), idempotent retry; adaptive determinism and equal budgets; A unchanged by terrain limits; B never evaluating terrain-failing points; missing DEM → `NOT_ASSESSED`; read-only terrain endpoint; regional grid checked node by node against a synthetic plane |
| `backend/pipelines/tests` | `test_projection` | Projection vs `pyproj` with the LOLA stereographic CRS |
| Frontend unit (Vitest) | 25 files under `frontend/web/src` (for example `explorationStore`, `sceneGeometry`, `roiFrame`, `terrainPicking`, `landingGraph`, `ConstraintBrush`, `RegionLineage`, `TerrainScreenCard`, `SpaceTime`) | Shared-state lifecycle and stale-response guards; sky-path directions equal stored az/el; horizon ring closure; frame vs backend corners; Rete node memoization; no API writes from selection |
| Browser (Playwright) | `frontend/web/e2e/app`, `workspace`, `spatial`, `brush`, `terrain` (+ `screenshots`, not part of the suite) | End-to-end against the isolated stack: hover coordinates vs an independent projection (1e-9°); drawn Sun/Earth directions vs stored samples (0.002°); region lifecycle without DELETE requests; reload restoration; no writes on selection; Experiment B preview, execution and terrain node |

The backend suites use the real Shackleton Rim B windows and SPICE kernels when they are present.

### 3.2 Recorded results

| Date | Code | Backend (pytest) | Frontend unit | Browser | Lint, types, build |
| --- | --- | ---: | ---: | ---: | --- |
| 2026-11-07 | `06bda7c` (review) | 148 passed | 80 passed | 19 passed | pass |
| 2026-11-07 | `feat/spatial-workspace` | 148 passed | 90 passed | 23 passed | pass |
| 2026-11-08 | Experiment B working tree (development record) | 172 passed | 107 passed | 26 passed | pass (three.js chunk-size warning) |
| **2026-11-08, 12:08–12:11 UTC** | **Release check of the exact committed code (executed, not historical)** | **172 passed** | **107 passed (25 files)** | **26 passed** | **pass**; OpenAPI regeneration byte-identical; three.js chunk-size warning |

Environment of these runs:
- macOS host (Darwin 25.6.0), Docker Desktop 29.8.0;
- backend in the API dev image (Python 3.12), frontend in the web dev image (Node 24);
- Playwright 1.63 with Chrome, desktop and phone projects;
- isolated stack: kernels and terrain read-only, SQLite in `tmpfs`.

Only the **release check** row was executed for this release; the other rows are historical
records from [STATUS.md](STATUS.md). The release check ran on the code that was then committed:

- backend: the isolated `docker run` command below (Python 3.12.16) ran `ruff`, the format check,
  `mypy` (38 source files) and `pytest`;
- frontend: the compose command below (Node 24.22.2) ran Vitest, ESLint, `tsc` and the Vite
  build;
- browser: Playwright 1.63.0 with Chrome on the rebuilt isolated stack, desktop and phone projects;
- contract: `make openapi` reproduced `openapi.json` and `schema.d.ts` byte for byte.

The SHA-256 of `data/candidates.sqlite3` was identical before and after (43 candidates, 41
evaluations). No paid AI request was made. The n8n workflow is verified separately by recorded executions
([AI_N8N_INTEGRATION.md](AI_N8N_INTEGRATION.md#10-case-study-verified-executions-2026-11-08)).

### 3.3 Commands

All backend and frontend tasks run in the development containers ([Makefile](../Makefile)).

| Command | Purpose |
| --- | --- |
| `make up` / `make dev` / `make down` | Start (detached, rebuilds images) / start with hot reload / stop the dev stack |
| `make lint` | `ruff`, `ruff format --check`, `mypy --strict`; ESLint and `tsc --noEmit` |
| `make test-web` | Vitest unit tests |
| `make openapi` / `make check-openapi` | Regenerate the TypeScript client / fail on contract drift |
| `make fetch-data` · `fetch-terrain` · `fetch-basemap` | Re-download kernels, catalog terrain, relief |
| `make e2e-up` / `make e2e-stop` | Start / stop the isolated browser-test stack on port 15180 |
| `make n8n-up` / `make n8n-down` / `make n8n-import` | Local n8n stack and workflow import |

**Backend tests with an isolated database.** Run them with read-only scientific inputs and a
throw-away `/data`, so nothing can write to real candidates:

```bash
docker run --rm --tmpfs /data -v "$PWD/backend:/workspace" -v "$PWD/data/kernels:/data/kernels:ro" -v "$PWD/data/terrain:/data/terrain:ro" -v "$PWD/data/basemap:/data/basemap:ro" clps-lunar-mission-browser-api:dev sh -c "ruff check . && ruff format --check . && mypy && pytest -q -p no:cacheprovider"
```

**Frontend checks and production build:**

```bash
docker compose run --rm --no-deps -T --build -v ./frontend/web/src:/workspace/web/src -v ./frontend/api-client/src:/workspace/api-client/src -v ./frontend/api-client/openapi.json:/workspace/api-client/openapi.json web sh -c "pnpm -r --workspace-root test && pnpm -r --workspace-root lint && pnpm -r --workspace-root typecheck && pnpm --filter @clps/web build"
```

**Browser tests** run only against the isolated stack. A guard file makes the suite refuse any
other server.

```bash
make e2e-up
```

```bash
cd frontend/web && E2E_CHANNEL=chrome ./node_modules/.bin/playwright test --project=desktop --project=phone
```

The host `node_modules` must exist (`pnpm install` in `frontend/`). Do not run the `screenshots`
project unless you intend to overwrite the historical README images.

## 4. Numerical comparisons with independent reference data

| Comparison | Scope | Result | Where |
| --- | --- | --- | --- |
| SPICE Sun/Earth apparent az/el vs **JPL Horizons** (airless, apparent) | 4 points (89.5°S 0°E, 85°S 45°E, 88°S 222°E, 0°N 0°E), daily over 2026 | Max error 0.05″ measured upstream (ADR 0005); the offline test uses a 1″ tolerance and passes | `backend/lunar-core/tests/test_horizons_golden.py` |
| Projection vs **pyproj** (LOLA stereographic CRS) | Round-trip points | Passes | `backend/pipelines/tests/test_projection.py` |
| Cached 20 m window vs the remote GeoTIFF read independently (rasterio/pyproj) | Sample A window, 5 points | Coordinates < 1e-12°, elevations < 0.1 mm | [lola_independent_comparison.json](lola_independent_comparison.json), `backend/scripts/check_lola_source.py` |
| Terrain horizons vs the **NASA LOLA PSR map** | 50 random pixels around the catalog sites, 18.6-year cycle | 100 % agreement (upstream spike, ADR 0009); **not rerun** | `make spike-terrain` |

None of these covers the Shackleton Rim B windows or brush-generated candidates directly. The
Horizons comparison tests geometry, not terrain horizons.

## 5. Reproducibility and data integrity

- **Content-addressed records.**
  - Candidates, evaluations, brush experiment snapshots and terrain screens have SHA-256-based
    identities.
  - Saving an identical record is a no-op; a different payload under an existing ID is rejected.
  - The application never updates or deletes records.
- **Input integrity.**
  - Every evaluation re-hashes the DEM windows and refuses to run on a near-field hash mismatch.
  - The API refuses to evaluate if kernel files change while it runs.
- **Provenance.** Algorithm, parameters, dataset and kernel hashes, library versions and the
  software commit (`-dirty` if uncommitted). Build the API image with `make up` so that the commit
  is recorded. Under `make dev` live sync, the recorded commit describes the image build, not
  later edits.
- **Manifest and recompute.**
  - `GET /api/evaluations/{id}/manifest` exports the stored record with `not_recorded` gaps and
    consistency checks.
  - `POST /api/evaluations/{id}/recompute` reruns it without storing anything and reports
    `reproduced`, `differs` or `inputs_changed`.
  - Agreement shows repeatability, not validation.
- **Determinism.** Brush sampling and both refinement policies are deterministic. A repeated
  Experiment A run reproduced the same sequence ([report](TERRAIN_AWARE_BRUSH_COMPARISON.md)).
  Candidate IDs depend on bit-exact floating-point results; cross-platform identity is untested.
- **Backup.**
  - `data/` (database, kernels, DEM windows, relief) is git-ignored; never commit it.
  - Back up as follows: stop the stack; run `sqlite3 data/candidates.sqlite3 ".backup '/path/outside/repo/candidates.sqlite3'"`;
    check the copy with `PRAGMA integrity_check`; record SHA-256 hashes of `data/terrain` and
    `data/kernels`.
  - A re-downloaded window with different bytes makes existing candidates fail their identity
    check, by design.
- **Database integrity during the n8n runs.** The checksum of `data/candidates.sqlite3` was
  identical before and after every AI execution, and the record counts stayed at 43 candidates
  and 41 evaluations ([details](AI_N8N_INTEGRATION.md#8-read-only-behaviour-and-database-integrity)).
- **Git remotes.**
  - `backup` = `ramesys/LUNAR-OPS`, the project repository.
  - `origin` = `EmanuelAbasto/CLPS-Lunar-Mission-Browser`, the upstream author, kept for
    attribution only. Never push to it.

## 6. Known issues and limitations

### 6.1 Scientific

| Limitation | Consequence |
| --- | --- |
| No independent validation at Shackleton Rim B | All results remain `COMPUTED_UNVERIFIED` |
| Geometric visibility only | Not power, thermal or communications performance |
| Point observer; coarse 20 m DEM terrain screen | No lander footprint, rocks or sub-resolution hazards (features ≲ 40 m), no DEM uncertainty; slopes are relative to the reference sphere; not landing safety |
| Horizon sampling: 0.5° azimuth, 20 m / 240 m radial, 200 km limit, bilinear interpolation | Narrow peaks between samples, or beyond 200 km, can be missed |
| Earth centre (disc ignored), Sun upper limb | Partial Earth disc counts as not visible |
| Discrete time; windows ≤ 168 h | Transitions uncertain by up to one step; seasonal behaviour needs repeated windows |
| ROI-local "east/north" is the centre frame | Local north rotates up to about ±9° across the 4 km square (handled in code; labels refer to the centre) |
| Exploration evidence is bounded | The controlled comparisons cover one region, two epochs and one budget each (A/B), or synthetic fields; no general superiority is shown |
| Terrain limits in experiments are illustrative | 12° slope and 1.5 m RMS are not mission requirements |

### 6.2 Software and reliability

| Issue | Status |
| --- | --- |
| The dev `data` service does not download the Shackleton Rim B windows | A manual `python -m clps_pipelines.fetch_roi` is needed; documented in the README |
| Brush execution is one synchronous request (≤ 64 attempts) with no progress, cancel or server-side abort | Retry is safe (deterministic IDs, idempotent inserts) |
| Each attempt re-reads and re-hashes DEM windows and kernels | Correct but slow; bounded caches mitigate repeats |
| Region verdict lists are session state; grid runs are not stored as a record | Exported JSON is the recovery path; completed adaptive runs are stored as snapshots |
| An adaptive run interrupted before completion leaves candidates and evaluations without a snapshot | Known |
| The three.js chunk triggers a bundle-size warning | Known |
| An API image built from an older commit serves an older API | The image used for the n8n runs (`02c13f3`) lacks `terrain-screen` and `brush-experiments`; rebuild with `make up` |

### 6.3 User interface

- **Expand graph** enlarges the Rete canvas without zooming the nodes to fit.
- In *passing only* mode, a FAIL point whose C0 already exists is reported as "not saved".
- There are no region-level executable graph nodes, and no LROC imagery.
- The 40 km and 4 km terrains are separate meshes, switched rather than blended.

### 6.4 AI integration

| Issue | Evidence |
| --- | --- |
| The model can miscount or quote the wrong extreme from correct values | Execution 6: "8" Sun-visible evaluations vs 11 actual. Execution 5: 1.755° vs 1.765°, 14.22° vs 14.13°. |
| Automatic checks cannot detect those errors | A number that exists somewhere in the pack passes |
| Overcautious safety wording ("not safe" instead of "not assessed") | Execution 6 |
| Candidate discovery is limited to ROI roots, their children and explicit ids | `sample-a` candidates need `candidate_ids` |
| External service | Prompts go to OpenRouter; about 32 k prompt tokens per 25-evaluation run |
| Two archived temporary test workflows remain in n8n | `TempOrTestOk0001`, `TempOrTestErr001`; delete in the UI |

### 6.5 Repository state

- Experiment B terrain work, the n8n integration and this documentation are committed on
  `feat/terrain-aware-brush` after `7cdbb8c`. They are published to `backup` (`ramesys/LUNAR-OPS`)
  and proposed to `main` through a pull request. `main` does not contain them until that pull
  request is merged.
- The local `main` (`06bda7c`) is behind `backup/main` (`e964570`). `feat/adaptive-region-brush`
  and `feat/terrain-aware-brush` both point at `7cdbb8c`.
- Older screenshots (`docs/screenshots/01-…09-…`, `sprint0x-…`) and the sprint and handover
  reports are historical.

## 7. Not run or not verified

- `make spike-terrain` (PSR comparison; needs network) and `make golden` (Horizons refresh) were
  not rerun.
- The production stack and a clean-machine first start were not checked in the latest cycle.
- The webhook trigger of the n8n workflow was tested with a mock-AI copy before the credential
  existed. It has not been run with the real model, because the workflow is not published.
- The development API container (`clps-lunar-mission-browser-api-1`) was still running image
  `02c13f3` at release time. Rebuild it with `make up` before a demonstration.
- The n8n AI review has not been re-run on the release commit. Its last recorded runs
  (executions 5 and 6) predate the commits but used the same workflow definition.

## 8. Recommended next steps

1. Review and merge the release pull request, then rebuild the API image (`make up`) so that
   recorded commits and available routes match the code.
2. Add `fetch_roi` to the `data` service.
3. Run brush execution as a background job with progress and cancel. Hash inputs once per run.
   Persist grid runs as records.
4. Begin independent comparison of horizon masks or illumination at a few Shackleton Rim B points,
   against a published LOLA-based product. Record the outcome separately from
   `COMPUTED_UNVERIFIED`.
5. For the AI review, have the formatter compute counts and extrema in advance (for example, the
   number of Sun-visible evaluations and the overall min/max) so that the model can quote rather
   than count. Refine the safety wording to "not assessed".
