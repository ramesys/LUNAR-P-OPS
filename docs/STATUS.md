# LUNA-P/OPS current status and handover

Status date: 2026-11-07. Reviewed code: `main` at `06bda7cf6bb7249544960427d8fc68b1b6f03474`
(plus the documentation and branding changes on the branch that added this file). Section 6
records the spatial workspace sprint built on top of that review.

This file supersedes [LUNAR_OPS_SESSION_HANDOVER.md](LUNAR_OPS_SESSION_HANDOVER.md) (the
Sprint 07 checkpoint) as the current handover. The sprint reports `LUNAR_OPS_SPRINT_0*.md` are
historical.

## 1. What works

- Shackleton Rim B workspace: 40 km regional and 4 km detailed LOLA terrain in one Three.js scene,
  candidate creation inside the 4 km study area, markers, hover readout, compass, Sun/Earth rays
  and horizon guides driven by the stored evaluation.
- Landing Graph (Rete.js): C0 parameters → Candidate → Scientific computation → Results; C1
  derivation; evaluation only on Evaluate; C0/C1 evaluation history selection.
- Strict evaluation with LOLA + SPICE, coverage checks, provenance and content-hash identity.
- Shared state across terrain, graph, Inspector and Timeline; selection, evaluation and cursor
  restored after reload, including a reload in the same task as a Timeline action.
- Experiment manifest export; Recompute & compare (never stores).
- Constraint Brush: draw/edit polygon, preview (read-only), confirmed execution, verdict markers,
  C0 reuse, inspection in graph/Inspector/Timeline, experiment JSON export.
- Original catalog comparison (sky diagram, timeline, CSV/PNG export, pole map, Simple/Expert).

## 2. Verification record (this review)

Environment: macOS host (Darwin 25.6.0), Docker Desktop 29.8.0, Docker Compose v5.5.1. Backend in
the `clps-lunar-mission-browser-api:dev` image (Python 3.12.16); frontend in the
`clps-lunar-mission-browser-web:dev` image (Node 24.22.2); browser tests from the host with
Playwright 1.63.0 and Google Chrome 156. Code: `06bda7c`. The frontend checks and the full
browser suite were run on `06bda7c` and again after the branding changes (same results); the
backend has no changes on this branch.

| Check | Command (summary) | Result |
| --- | --- | --- |
| Backend lint and types | `ruff check`, `ruff format --check`, `mypy` (strict) | pass |
| Backend tests | `pytest -q`, with `/data` as `tmpfs` and kernels/terrain/basemap mounted read-only | **148 passed**, 0 skipped (real Shackleton windows and kernels used) |
| Frontend unit tests | `pnpm -r test` (Vitest) | **80 passed** (23 files) |
| Frontend lint and types | ESLint, `tsc --noEmit` (web and api-client) | pass |
| Production build | `pnpm --filter @clps/web build` | pass; warning: `terrainPicking` chunk 565 kB (three.js) |
| Browser tests | Playwright, desktop + phone projects, Chrome, isolated stack | **19 passed** |
| Reload race | brush and reload tests repeated 5× | 10/10 passed |
| Reload race, negative control | same brush test with the `pagehide` flush suppressed | fails as expected (cursor stays at sample 2/2) |
| Real database untouched | SHA-256 of `data/candidates.sqlite3` before and after all checks | unchanged |

Not run in this review: `make spike-terrain` (PSR comparison, needs network), `make golden`
(Horizons refresh, network), the Playwright `screenshots` project (overwrites historical images),
the production stack, and a clean-machine first start.

The WIP commit `06bda7c` (flush pending Timeline/selection state on `pagehide`, plus extra brush
and reload tests) is therefore verified for Chrome desktop reloads. `pagehide` is not guaranteed
when a browser process is killed; at most the last 300 ms of display state (cursor) is then lost.
Scientific records are unaffected because they are written only by explicit API calls.

## 3. Review findings

Classification as requested by the handover brief. No critical defect was found.

| # | Class | Finding | Action |
| --- | --- | --- | --- |
| 1 | Reliability risk | The dev `data` service does not download the Shackleton Rim B windows. On a clean clone the main workspace has no terrain until `python -m clps_pipelines.fetch_roi` is run. | Documented in README. Recommended fix: add `fetch_roi` (optional, like terrain) to the `data` service. |
| 2 | Reliability risk | Brush execution is one synchronous request (up to 64 points). No progress, cancel or server-side abort if the client disconnects; the server finishes and persists. Retry is safe: IDs are deterministic and inserts idempotent. | Documented. |
| 3 | Reliability risk | Each brush point re-reads and re-hashes the DEM windows and kernels (about 100 MB per point). Correct but slow for large batches. | Future optimisation. |
| 4 | Scientific risk | Candidate IDs depend on bit-exact floating-point results; cross-platform identity is untested. | Documented in methodology. |
| 5 | Scientific risk | ROI-local "east/north" is the centre frame; near the pole local north rotates up to ~±9° across the 4 km square. Code handles azimuths correctly; the wording could mislead. | Documented in methodology. |
| 6 | Scientific risk | No independent validation of horizons or visibility at the Shackleton Rim B points. | Status kept as `COMPUTED_UNVERIFIED`. |
| 7 | UX limitation | Brush run state (polygon, verdicts) is React component state; lost on reload. Exported JSON is the recovery path; persisted candidates and evaluations remain in SQLite. | Confirmed, documented. |
| 8 | UX limitation | In "passing only" mode, a FAIL point whose C0 already exists is reported as "not saved" although its C0 is in the database (the UI explains this). | Documented. |
| 9 | UX limitation | **Expand graph** enlarges the Rete canvas but does not zoom the nodes to fit; they stay small. | Future fix. |
| 10 | UX limitation | Bundle-size warning for the three.js chunk. | Known. |
| 11 | Documentation-only | README described the upstream CLPS browser, cloned the upstream repository and omitted the ROI data step; `data/README.md` was stale; the Sprint 07 handover read as current. | Corrected. |
| 12 | Documentation-only | Product name inconsistent (`CLPS Lunar Mission Browser` page title, `LUNAR·OPS` header). | Now `LUNA-P/OPS` in the page title, header and chart credit. Technical names unchanged. |

Known limitations reported at the previous checkpoint, checked against the code:

| Reported limitation | Confirmed? |
| --- | --- |
| Regional and detailed terrain are separate DEM meshes, not a blended surface | Yes: the grid is swapped in one scene (`RoiTerrain3D`); 240 m vs 20 m DEMs. |
| Optional 40 km regional view not implemented | Was true at `06bda7c`; implemented in the spatial workspace sprint (§6). |
| LROC imagery not integrated | Yes: no LROC code or data. |
| Brush batch evaluation is synchronous | Yes (finding 2). |
| Regional experiment state is transient; exported JSON is the recovery mechanism | Yes at `06bda7c` (finding 7). Since §6, region definitions are restored after reload; previews and verdict lists are still session state. |
| Persisted candidates remain in SQLite separately | Yes. |
| Region-level executable Rete nodes not implemented | Yes: graph nodes are per candidate only. |
| Timeline reload fix was unverified WIP | Now verified (§2). |
| Large three.js bundle warning | Yes. |

## 4. Data, backup and recovery

- Scientific inputs and the database live in `data/` (git-ignored, bind-mounted at `/data`):
  `candidates.sqlite3`, `terrain/*.npz` (Shackleton Rim B and sample sites A–F, near and far),
  `kernels/` (5 NAIF files), `basemap/`.
- At this review the live database had 40 candidates and 40 evaluations and passed
  `PRAGMA integrity_check`. An emergency backup made on 2026-11-07 (`emergency_20261107_211859`,
  in the local backup folder outside the repository) passed `integrity_check` and has identical
  rows. The earlier full backup (database, data archive, repository archive, per-file hashes) is
  described in the historical handover, §9 and §13.
- Back up before any persistence change: stop the stack, use SQLite's `.backup`, run
  `PRAGMA integrity_check`, record SHA-256. Never delete, reset or migrate the real database in
  place; test persistence code only with a temporary `CLPS_DATA_DIR` or the isolated E2E stack.
- Re-download data: `make fetch-data fetch-terrain fetch-basemap` and
  `docker compose run --rm --no-deps api python -m clps_pipelines.fetch_roi`. Compare hashes with
  the backup's `data_files.sha256`: a different near-field window hash breaks existing candidate
  identity by design.
- Git: publish to the `backup` remote (`ramesys/LUNAR-OPS`). `origin` is the upstream author's
  repository; never push to it.

## 5. Recommended next technical milestone

Make the Constraint Brush run a first-class, recoverable experiment without adding a second
engine:

1. Add the ROI download to the `data` service (finding 1).
2. Persist each brush run (definition, preview token, per-point candidate/evaluation IDs, verdicts)
   as an append-only record, so a run survives reloads and can be reopened.
3. Run execution as a background job with progress and cancel, reusing `evaluation.compute`, and
   hash DEM windows and kernels once per run instead of per point.
4. Then begin independent comparison of horizon masks at a few Shackleton Rim B points against a
   published LOLA horizon or illumination product, and record the result separately from
   `COMPUTED_UNVERIFIED`.

## 6. Spatial workspace sprint (2026-11-07, branch `feat/spatial-workspace`)

Built on the reviewed code above; no change to the scientific engine, the candidate and
evaluation records or the database schema.

| Item | Implemented |
| --- | --- |
| 40 km terrain | `GET /api/rois/{id}/regional-terrain` returns 161 × 161 nodes at 250 m (±20 km) from the real 240 m LOLA window, plus corner coordinates. The 4 km study boundary is drawn on it, and the south pole, which lies inside the 40 km square (local 0 m E, −14.42 km N), is marked SP. |
| Sun/Earth geometry | Whole-interval paths of every stored Sun and Earth sample, a trail up to the Timeline cursor, the cursor ray and body, the stored horizon silhouette, the local horizontal, a clearance arc and the candidate's local north, all on a symbolic dome (2.6 km / 12 km radius) labelled as not to scale. Built only from the stored evaluation; the cursor never computes. |
| Region Brush dock | A compact horizontal dock fixed directly below the Timeline in the candidate context (inline in the catalog context), with a short drawer for parameters, preview/run and a horizontal results strip. |
| Region management | Several regions with create, select, edit (drag, undo, remove vertex), clear and delete; clear and delete require confirmation; deleting removes only the drawing. Region definitions persist in `localStorage`. |
| Desktop page order | Workspace (Landing Graph, terrain, Inspector) → catalog Sky & timeline → Catalog site comparison → Learn more → Saved candidates in this ROI (multi-column list at the page bottom; selecting one scrolls back to the terrain) → Assumptions & sources and Glossary. Header links reach each section. |
| Synchronization and guards | Regions, active region, drawing mode and inspected result are in the shared store. Stale preview/execution responses are dropped by region revision. Selecting any candidate moves or clears the inspected brush result. Candidates are created only on the 4 km detail grid, never from the regional view or during a region evaluation. |

Verification (isolated stack: kernels/terrain read-only, SQLite in `tmpfs`; Chrome 156):

| Check | Result |
| --- | --- |
| Backend: ruff, format, mypy strict, pytest | pass; **148 passed**. The regional tests now check every node of the 161 × 161 grid against an exact synthetic plane (row/column order, axes, spacing), the 4 km corners on the regional lattice, the corner coordinates and the pole position, and the real Shackleton far window at five nodes. |
| Frontend unit tests (Vitest) | **90 passed**: sky-path directions equal the stored azimuth/elevation (after the azimuth rotation) for every sample; horizon ring closure; frontend frame vs backend corner coordinates; store region lifecycle, stale-response guards and selection following; dock lifecycle with confirmation and no API writes. |
| Lint, type checks, production build | pass; the three.js chunk warning remains. |
| Browser tests (desktop + phone) | **23 passed**, plus the new spatial and brush specs 3× (18/18). New: hover coordinates on the 40 km view equal an independent projection of the API frame to 1e-9° and the displayed elevation equals the API grid to 0.01 m; drawn Sun/Earth directions equal the stored samples (to 0.002°) at three Timeline steps and on both scales; regions created, edited, executed, inspected, deselected, deleted (cancel then confirm) with the candidate list unchanged and no DELETE request; region definitions restored after reload; regional clicks refused without any write; on a phone the Timeline sits directly on the dock and moves up with its drawer, without horizontal scroll. |

Remaining limitations after the sprint: region results are not persisted as one record; brush
execution is still synchronous; the expanded Rete graph still does not zoom to fit; sky paths
join stored samples with straight segments (no interpolation); the two terrain scales remain
separate meshes. Item 2 of the milestone in §5 is therefore only partly addressed.

