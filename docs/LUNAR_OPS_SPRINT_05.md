# Sprint 05: unified exploration workspace and CLPS parity

Status (2026-11-07): the sprint is implemented and verified locally with automated tests and a
browser run. Development continues; this is not submission preparation.

## 1. Functional parity audit against upstream

Upstream is [EmanuelAbasto/CLPS-Lunar-Mission-Browser](https://github.com/EmanuelAbasto/CLPS-Lunar-Mission-Browser).
`git fetch` on 2026-11-07 showed `origin/main` still at `7f2cd27`, which is our base.

**Method**

- `git diff origin/main HEAD` and its name-status listing.
- Every upstream component checked against the current imports.
- The upstream `package.json` dependencies and Python modules checked against the current tree.
- Each README feature exercised in the running app.

**Preserved, with code unchanged or extended**

- Comparison of 2–4 sites with ranking and metrics.
- Scenario form, date range, custom sites and shareable URLs.
- Sky diagram, timeline, time control (play, step, scrub, speed), hover readout and windows table.
- CSV and PNG exports (Expert mode, as upstream).
- Assumptions & sources, Glossary, Learn panels and info tips.
- Simple/Expert modes, with Simple keeping its plain-language cards.
- Every upstream component is still imported and rendered (18 of 18).
- The frontend dependencies are a superset of upstream (Rete packages and styled-components
  added).
- All upstream Python modules exist unchanged.
- The only removed source lines are three import statements and the Sample A pin's start
  position.

**Modified on purpose**

- The Sample A 3D view also creates candidates (Sprint 01).
- The landing workspace now comes first. The original browser follows under a heading,
  "Catalog site comparison".
- The page is wider (1440 px instead of 1100 px).

**Missing or inaccessible before this sprint: data, not code**

1. *Terrain horizons and 3D views for Samples B–F.* The UI showed "FLAT ONLY", and Sample B's
   charts said "over the flat horizon" even with `horizon=terrain`.
   - Root cause: `data/terrain` held only the Sample A and Shackleton windows. Since Sprint 01 the
     stack had been started with `docker compose up --no-deps api web`, which skips the one-shot
     `data` service that runs `clps-fetch-terrain`.
   - The code falls back to the flat horizon on purpose when terrain is absent (ADR 0014), so
     this was a data gap, not a library or code loss.
2. *Pole-map relief.* The map said "Relief image not downloaded yet". Root cause: the same
   skipped `clps-fetch-basemap`.

**Regressions in our own code:** none found in the upstream features.

- We found and fixed a `styles` prop that leaked to the DOM. It came from this sprint's first
  attempt at graph node styling.
- One limitation: the e2e test `shows the local terrain in 3D` (Sample B) needs the restored data.

**How the data was restored**

`docker compose run --rm --no-deps -T api sh -c "clps-fetch-terrain; clps-fetch-basemap"`
downloaded bounded windows only. All 10 new windows contain only finite values.

| File | SHA-256 |
| --- | --- |
| sample-b near / far | `e36fe7c8…5102` / `f3ff1b73…1269` |
| sample-c near / far | `c8fb8b5f…4976` / `e30e378b…0d0f` |
| sample-d near / far | `30aec7ca…39f0` / `1e2fccef…c686` |
| sample-e near / far | `680a9bf3…5b78` / `a89c7742…1977` |
| sample-f near / far | `63f518dc…3d06` / `6a340bad…1d15` |
| `south_pole_hillshade.png` | ±200 km |

The existing Sample A and Shackleton hashes are unchanged. The data files are not committed
(`data/*` is git-ignored).

## 2. One workspace

The **Landing workspace** is a grid of three synchronized areas: terrain and inspector side by
side, the graph below. It becomes one column under 1000 px, and a 375 px phone shows no
horizontal scroll. A five-step workflow strip above it shows where the user is.

- **Terrain explorer** (`RoiTerrain3D`, `ShackletonWorkspace`)
  - The Sprint 04 continuous 4 × 4 km mesh now has a hover readout: latitude and longitude, the
    DEM elevation from the 20 m display grid, and east/north offsets.
  - A compass follows the camera's azimuth. A 1 km grid is draped on the surface, with N/E/S/W
    edge labels.
  - Explicit buttons: Reset view, Top view, zoom ±, and Centre on selected. These, and the user's
    own mouse, are the only things that move the camera.
  - Data summary chips show the DEM, resolution, coverage and horizon checks.
  - A legend shows selected and other markers. A note states that heights, exaggeration and the
    hover value are for display only.
- **Landing Graph** (`LandingGraph`, `landingGraph`)
  - The same Rete.js graph and dataflow, with nodes colour-coded by role: parameters, candidate,
    computation, results. A legend sits above the canvas.
  - One toolbar holds Create Candidate C1, Duration, Step and **Evaluate {selected revision}**.
  - The Location, Terrain, Height, Time and Candidate nodes, the typed `candidate_ref`
    → Scientific computation → Results wiring, and the memoised backend call are unchanged.
- **Inspector** (`WorkspaceInspector`), in order of importance:
  1. C0/C1 revision tabs and the selected position, raster elevation, height and time.
  2. Three separate statuses: *Data available*; *Computed / Unavailable / Failed / Not evaluated*;
     *Not independently validated*.
  3. Editable parameters for the next revision.
  4. The result, shown in the **original CLPS sky diagram, timeline, time control and hover
     readout**. They are fed from the persisted evaluation by `lib/evaluationCharts.ts`, which
     copies values and recomputes nothing.
  5. The C0/C1 comparison.
  6. Collapsible intervals, time series, horizon, provenance and CandidateRef. These are open by
     default in Expert mode.

## 3. Synchronization

There is one authoritative selection: `{rootId, revisionId}` in `App`, persisted by
`lib/workspaceSelection.ts`. It still reads the Sprint 02–04 `lunar-ops-c0` pointer.

| Action | Effect |
| --- | --- |
| Terrain click | Saves C0 from the raster, selects it, highlights the marker, opens its graph. |
| Marker or list pick | Selects that root: marker, graph and Inspector update; camera and scene are untouched. |
| Graph node pick | Candidate node: the Inspector's selected revision flashes. Computation or Results: the result section flashes. |
| Parameter edit (Inspector or graph node) | Both write the graph's Height/Time nodes; the Inspector marks "unsaved edit". Nothing is persisted. |
| Create C1 | Explicit POST `/evolve`; C1 becomes the selected revision. |
| Revision tab C0/C1 | Moves `candidate_ref`, loads that revision's parameters into the nodes, restores its stored result. |
| Evaluate | Explicit; evaluates exactly the selected revision. |
| Simple/Expert | Changes disclosure only; all areas stay mounted. |
| Reload | Restores root, revision, parameters and result through the graph's read-only restore path. |

## 4. Scientific transparency

- No change to the Python engine. Candidate elevations come from the original raster; the hover
  value is labelled as the display grid.
- Data availability, computation status and independent validation are shown as separate
  statuses. `VALIDATED` is still never assigned.
- `UNAVAILABLE` shows the coverage error, with no chart or flat-horizon substitute. The charts
  use only stored samples, horizons and intervals.

## 5. Verification

- Frontend: `pnpm -r --workspace-root test` gives **62 passed** (54 before). `lint` and
  `typecheck` pass. `pnpm --filter @clps/web build` passes with the known warning about the
  lazily loaded three.js chunk (565 kB).
- New tests cover:
  - selection persistence and legacy migration;
  - chart adapter pass-through and unavailable results;
  - the Inspector's status separation, the revision tabs, and that edits are not saved;
  - App restoring the selected revision with all areas present in both modes.
- Backend: **129 passed**, plus ruff, format and mypy. The engine is unchanged.
- The Playwright e2e suite (`make e2e`, Edge on the host) was not run.

Browser run at http://localhost:5180 (1440 × 900):

1. The hover readout and the saved candidate agree for the same point: 89.58826°S 59.74070°E
   against 89.588262°S 59.740695°E. Display DEM 435.1 m against raster 435.09 m.
2. Editing the height to 6 m in the Inspector updated the graph node and the preview. The API log
   showed no write besides the terrain click.
3. Create C1 selected C1. Evaluate C1 gave `COMPUTED_UNVERIFIED`, and the Inspector showed the
   original sky diagram and timeline. The readout gave Sun elevation 1.15° against a 17.24° terrain
   horizon in that direction.
4. Switching to C0 loaded 2 m into the graph. Evaluate C0 gave a result, and the comparison
   appeared. The camera was unchanged.
5. A reload with C1 selected restored C1, its 6 m parameter, its result and the comparison. The
   API log showed only GETs, with no evaluation POST.
6. Picking the Candidate node highlighted the Inspector's selected revision.
7. The catalog section shows relief on the pole map, no "flat only" sites, a terrain horizon for
   Sample B, and a working Sample B 3D view.
8. Profiling over 24 candidate switches:
   - JS heap went from 75 to 68 MB;
   - 2 scene builds in total (React StrictMode's dev double mount), never rebuilt by selection;
   - one WebGL canvas and one Rete root with 7 nodes.

   No optimization was needed. The evaluation-list GETs repeat on load: the history load, the
   graph restore and StrictMode in dev.

Screenshots: `docs/screenshots/sprint05-workspace.jpg`, `sprint05-landing-graph.jpg` and
`sprint05-catalog-restored.jpg`.

## 6. Remaining limitations

- The hover elevation is a bilinear display-grid value. Saved candidates use the raster sample.
- The graph shows C0 and one C1 (the selected or latest child). Older children stay in SQLite but
  are not listed.
- Every tested Shackleton point showed 0 h of sampled Sun and Earth visibility over the 24 h
  window from 2026-11-07. The terrain horizon toward the Sun is about 14–17° there. This is a
  geometric result, not validated illumination; longer windows have not been explored.
- The three.js chunk is still above 500 kB (lazy-loaded). The main chunk is 449 kB, including
  Rete.js.
- The e2e suite was not run. The upstream e2e and screenshot specs predate the new workspace and
  may need updated selectors.
