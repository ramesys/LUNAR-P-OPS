# LUNAR-OPS session handover (self-contained)

> **Historical record — superseded.** This is the Sprint 07 checkpoint of 2026-11-07, kept
> unchanged below. Later work (multiscale terrain, Constraint Brush, the reload fix) and the
> current status, test results and findings are in [STATUS.md](STATUS.md). The project is now
> named **LUNA-P/OPS**. In particular: the GitHub backup in §12 has since been completed
> (`backup` = `ramesys/LUNAR-OPS`), and the test counts in §6 and the database counts in §9 are
> out of date.

Written 2026-11-07 at the end of Sprint 07, as a safe-shutdown checkpoint. No Sprint 08 work
exists: the working tree was clean at `9e49636` when this checkpoint started.

## 1. Vision and main goal

LUNAR-OPS is *"Google Moon × Grasshopper × n8n — with scientific reproducibility"*. It is one
spatial–temporal parametric environment for exploring lunar landing-site candidates near the south
pole:

- **3D lunar terrain:** the geographic state.
- **Rete.js Landing Graph:** parameters, dependencies and computation.
- **Timeline:** the temporal evolution of a stored evaluation.
- **Inspector:** the selected object's parameters, evidence, results and provenance.

All four are coordinated views of one shared, authoritative state. The Python scientific engine
(NASA LOLA DEMs and NASA/NAIF SPICE) is the only source of scientific values.

It is built on the MIT-licensed upstream
[EmanuelAbasto/CLPS-Lunar-Mission-Browser](https://github.com/EmanuelAbasto/CLPS-Lunar-Mission-Browser).
Keep `LICENSE` and the upstream attribution.

## 2. Location, branch, commits

- Repository: `/Users/rafailkonstantinidis/Desktop/nasaHackathlon/CLPS-Lunar-Mission-Browser`
- Branch: `main`. Upstream remote `origin` = `https://github.com/EmanuelAbasto/CLPS-Lunar-Mission-Browser.git`.
  **Never push to origin.**
- Personal backup remote `backup`: see §12.
- History, newest first:
  - `9e49636` docs (Sprint 07 provenance check);
  - `9dc8ba3` Sprint 07;
  - `b1de8d7` Sprint 06;
  - `88d68ee` Sprint 05;
  - `275e3c2` Sprint 04;
  - `cb5b2a1` and older: Sprints 01–03 and upstream;
  - plus this handover commit.
- Per-sprint documents: `docs/LUNAR_OPS_SPRINT_01.md` … `docs/LUNAR_OPS_SPRINT_07.md`. Sprint 04
  is `LUNAR_OPS_SPRINT_04_PROGRESS.md`.

## 3. Sprint status and completed features

| Sprint | Delivered |
| --- | --- |
| 01 | Click the Sample A LOLA terrain to create Candidate C0. Elevation is sampled from the original DEM; typed API contracts. |
| 02 | Rete.js Landing Graph (Location/Terrain/Height/Time → Candidate). Immutable C1 via `/evolve`; SQLite persistence. |
| 03 | Candidate-specific SPICE + LOLA horizon evaluation. Strict ray-coverage check (`UNAVAILABLE`, never a flat horizon); persisted results with dataset and kernel hashes. |
| 04 | Shackleton Rim B 4 × 4 km ROI API and one continuous Three.js mesh with multiple markers. Per-candidate terrain window; `CandidateRef` → Scientific computation → Results dataflow. |
| 05 | Upstream parity audit (data, not code, was missing; restored). Unified workspace grid of terrain, Inspector and graph; hover readout, compass, 1 km grid. Inspector reuses the original CLPS sky diagram and timeline. |
| 06 | Shared space–time store. The timeline cursor drives the 3D Sun/Earth rays, the graph Results node and the Inspector. Experiment manifest export; Recompute & compare (never stored, never validates). |
| 07 | Explicit context (candidate evaluation vs catalog comparison) with a sticky context bar. Readable graph (wrapping `InfoControl`); build-time Git commit provenance (clean/dirty); E2E runnable on Chrome. |
| 08 | **Not started.** |

## 4. Architecture

- **Backend** (`backend/`, a uv workspace; Python 3.12):
  - `lunar-core`: geometry, SPICE, horizon and terrain science. `roi.py` holds the Shackleton ROI.
  - `api` (FastAPI, `clps_api`):
    - `candidate.py`, `candidate_store.py`: SQLite;
    - `evaluation.py`: `compute()` and `evaluate()`, coverage checks, provenance;
    - `experiment.py`: manifest and recompute;
    - `roi_terrain.py`; `main.py`: routes.
  - `pipelines`: `clps-fetch-kernels`, `clps-fetch-terrain`, `clps-fetch-basemap`, and
    `python -m clps_pipelines.fetch_roi`.
- **Frontend** (`frontend/`, pnpm; React 19, TypeScript, Vite, Three.js, Rete.js v2):
  - `api-client`: the generated OpenAPI types.
  - `web/src/lib/explorationStore.ts`: the single shared state, using `useSyncExternalStore`.
    - Fields: `context`, `rootId`, `revisionId`, `evaluation`, `cursorUtc`, `draft`, `settings`,
      `playing`, and `catalog{analysisKey, times, cursorUtc, playing, focus}`.
    - The interaction contract is in its header comment: display, draft, persisted and evaluation
      state each have a fixed set of actions that may change them.
  - Map: `components/RoiTerrain3D.tsx` and `ShackletonWorkspace.tsx`.
  - Graph: `components/LandingGraph.tsx` and `landingGraph.ts`.
    - Nodes: Location, Terrain, Observer Height, Time → Candidate, whose outputs are `preview` and
      `candidate_ref`.
    - Candidate → `ScientificComputationNode` (memoised; runs only on explicit Evaluate) →
      `ResultsNode`.
  - Inspector: `components/WorkspaceInspector.tsx` and `ExperimentPanel.tsx`.
  - Context bar: `components/ContextBar.tsx`.
  - The original CLPS catalog UI is intact (`ChartsPanel`, `SkyChart`, `Timeline`, `PoleMap`, and
    so on).
- Rules that must hold:
  - Only **Create Candidate C1** or a terrain click persists a candidate.
  - Only **Evaluate** computes and stores. Recompute & compare computes without storing.
  - Cursor, camera and selection never compute.

## 5. Running

Docker is required; the host has no `uv` or `pnpm`. Host `node_modules` are Linux-built, so
`vitest` cannot run on the host, but Playwright can.

```bash
cd /Users/rafailkonstantinidis/Desktop/nasaHackathlon/CLPS-Lunar-Mission-Browser
make provenance          # prints the CLPS_GIT_COMMIT that will be baked into the API image
make up                  # build and start data (one-shot, idempotent) + api (:8000) + web (:5180)
open http://localhost:5180
docker compose stop      # graceful stop; data lives in ./data (bind mount, no named volumes)
```

- Never run `docker compose down -v`. A plain `down` is harmless because the data is a bind
  mount, but `stop` is preferred.
- After code edits, run `make up` again to rebuild: the images bake in the sources.

## 6. Tests (last results, at `9dc8ba3`)

```bash
docker compose run --rm --no-deps -T -v ./backend:/workspace api sh -c "ruff check . && ruff format --check . && mypy && pytest -q -p no:cacheprovider"   # 140 passed
docker compose run --rm --no-deps -T -v ./frontend/web/src:/workspace/web/src -v ./frontend/api-client/src:/workspace/api-client/src -v ./frontend/api-client/openapi.json:/workspace/api-client/openapi.json web sh -c "pnpm -r --workspace-root test && pnpm -r --workspace-root lint && pnpm -r --workspace-root typecheck && pnpm --filter @clps/web build"   # 74 passed
cd frontend/web && E2E_CHANNEL=chrome ./node_modules/.bin/playwright test --project=desktop --project=phone   # 14 passed (needs `make up` first)
```

- The build warns that the lazy three.js chunk is over 500 kB (known).
- The Playwright `screenshots` project was never run, because it overwrites the README images.
- `make e2e` needs host pnpm; use the direct command above instead.

## 7. Data, DEM and SPICE paths

All under `data/`, which is git-ignored and bind-mounted to `/data` in the containers:

- `data/candidates.sqlite3`: the candidates and evaluations tables (JSON payloads). Delete
  journal mode, no WAL.
- `data/terrain/*.npz`: extracted LOLA windows.
  - Near-field: `LDEM_80S_20MPP_ADJ.TIF` (20 m/px).
  - Far-field: `LDEM_60S_240MPP_ADJ.TIF` (240 m/px).
  - Both from <https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/>.
  - Windows: `shackleton-rim-b_{near,far}` and `sample-{a..f}_{near,far}`.
  - Key hashes:
    - Shackleton near `99be1952c9c4c542c786e59102110b4d9c1c744b971702c1e0d9e4377ba73b5f`;
    - Shackleton far `e1f348b1a942ddd8430158d2ab68ab5e7056b146a2d0b679dae3762e7b61e6b7`;
    - Sample A near `753de3fe…`, far `9f582121…`.
  - Every file hash is in the backup's `data_files.sha256` (§13).
- `data/kernels/`: `naif0012.tls`, `pck00011.tpc`, `moon_pa_de421_1900-2050.bpc`,
  `moon_080317.tf`, `de440s.bsp` (NASA/NAIF).
- `data/basemap/south_pole_hillshade.{png,json}`: LOLA hillshade, ±200 km.
- Re-download if lost:
  - `make fetch-data fetch-terrain fetch-basemap` and `python -m clps_pipelines.fetch_roi`, run in
    the api container.
  - Remote files may change, so compare the result with `data_files.sha256`. A changed near-field
    hash breaks the identity of existing candidates by design.

## 8. Scientific status and limitations

- Every result is `COMPUTED_UNVERIFIED` or `UNAVAILABLE`; nothing is `VALIDATED`. Recompute &
  compare shows repeatability, not validation.
- Sample sites A–F are placeholders. Shackleton Rim B (−89.5244°, 56.30993°E, from the NASA Lunar
  Surface Data Book, table A2.1-1) is a study area, not a landing site.
- The horizon uses 0.5° azimuth rays with discrete samples; coverage is checked per candidate.
  Sun visibility is by upper limb, Earth by centre. Results hold only at the sample times; there is
  no interpolation.
- Every Shackleton point tested showed 0 h of sampled Sun and Earth visibility in the tested
  November 2026 windows. The terrain horizon toward the Sun is about 14–17°. This is a geometric
  result, not a bug.
- The 3D shading and shadows cover the 4 km mesh only; visibility comes from the stored 200 km
  horizon.

## 9. SQLite backup and restore

- Backup copy: `~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/candidates.sqlite3`, made with
  SQLite's online backup API, `integrity_check` ok.
- Contents:
  - **20 candidates:** 14 C0, 6 C1. By terrain window: 13 Shackleton, 2 Sample A, and 5 legacy
    Sample A records without the window field.
  - **19 evaluations:** 17 `COMPUTED_UNVERIFIED`, 2 `UNAVAILABLE`.

Restore, with the stack stopped:

```bash
docker compose stop
cp data/candidates.sqlite3 data/candidates.sqlite3.before-restore   # keep the current file
cp ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/candidates.sqlite3 data/candidates.sqlite3
python3 -c "import sqlite3;c=sqlite3.connect('data/candidates.sqlite3');print(c.execute('PRAGMA integrity_check').fetchone(), c.execute('select count(*) from candidates').fetchone(), c.execute('select count(*) from evaluations').fetchone())"
make up
```

Restore the data files (terrain, kernels, basemap):

```bash
tar -xzf ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/lunar-ops-data.tar.gz -C /path/to/repo
(cd data && shasum -a 256 -c ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/data_files.sha256)
```

Restore the code and full Git history without GitHub. The archive contains the repository with
`.git`, excluding `node_modules`, `data`, `dist` and test output:

```bash
mkdir -p ~/restore && tar -xzf ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/lunar-ops-repo-with-git.tar.gz -C ~/restore
git -C ~/restore/CLPS-Lunar-Mission-Browser log --oneline -3
```

`git bundle create` hung twice on this machine, with only its lock file written, so a tar of the
repository is the history backup. Leftover files `lunar-ops-repo.bundle.lock` and
`lunar-ops-history.bundle.lock` in the backup folder are those failed attempts. They are not
backups and can be removed by the user.

## 10. Outstanding bugs and priorities

1. **GitHub backup:** see §12. If the push is still pending, do it first.
2. **Known limitations:**
   - The catalog comparison is recomputed on load (upstream design) and identified by a request
     key.
   - The graph shows C0 and one C1; older children are not listed.
   - Under `make dev` live sync, the recorded commit describes the build, not later synced edits.
3. **Candidates for Sprint 08** (not started):
   - list multiple revisions per C0;
   - keyboard access for the 3D picking;
   - a longer-window (168 h) demo exploration;
   - refresh the README screenshots through the Playwright `screenshots` project, which needs
     reviewing because it overwrites committed images;
   - code-split the three.js chunk.

## 11. First steps for the next session

1. `cd` to the repo. Run `git status`, `git log --oneline -5` and `git remote -v`. Confirm
   `backup` exists and `git ls-remote backup main` equals `git rev-parse HEAD`.
2. Check the data: `(cd data && shasum -a 256 -c ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/data_files.sha256)`.
3. Run `make up`, then open <http://localhost:5180> and check that the context bar shows the saved
   candidate.
4. Run the three test commands in §6 and expect 140, 74 and 14.
5. Read `docs/LUNAR_OPS_SPRINT_07.md` and agree the Sprint 08 scope with the user before coding.

## 12. GitHub backup (status at checkpoint time)

- `origin` is the upstream author's repository and was left unchanged.
- On 2026-11-07 the GitHub CLI was not installed, no SSH key existed, and no global Git credential
  helper was configured. The private repository could therefore not be created automatically.
  Git's author e-mail suggests the GitHub user is `ramesys`.
- **No push to a personal GitHub repository has been verified yet.**

To finish it, the user creates an **empty private** repository named `LUNAR-OPS` on github.com:
no README, no licence, no .gitignore. Then:

```bash
cd /Users/rafailkonstantinidis/Desktop/nasaHackathlon/CLPS-Lunar-Mission-Browser
git remote add backup https://github.com/<your-user>/LUNAR-OPS.git
git push backup main          # HTTPS asks for a GitHub personal access token as the password
git ls-remote backup refs/heads/main ; git rev-parse HEAD   # the two SHAs must be equal
```

The upstream `LICENSE` (MIT, Emanuel Abasto) and the README attribution are part of the pushed
history.

## 13. Local backups (verified)

Folder: `~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z/` (outside the Git working tree).

| File | SHA-256 |
| --- | --- |
| `candidates.sqlite3` (SQLite backup API; `integrity_check` ok; 20 candidates, 19 evaluations) | `e2244dd47e491714354703bbd56e5c858a83d9b77d08f4a314df4d1e7201baa1` |
| `lunar-ops-data.tar.gz` (all of `data/` except the live DB: 14 terrain windows, 5 SPICE kernels, basemap) | `1df2072628bc61f1aafef15fd07bd768ea3b935db0dee98fd4d4f9bfe52e79bf` |
| `lunar-ops-repo-with-git.tar.gz` (source and full `.git`, HEAD `9e49636`; `git fsck` clean) | `7556510d5869b986ab7c37cebea81fa786be2a622f5d42d65d64de2abddc5cd3` |
| `data_files.sha256` (per-file hashes of the 22 data files) | `c0799d6a4112123d36fcf1628b9cc8866a2575ee0add7d7e33213337ea36b33a` |

- Verify with `cd ~/Desktop/LUNAR_OPS_BACKUPS/20261107T132446Z && shasum -a 256 -c SHA256SUMS`.
- The data archive was extracted into `verify/`, and 22 of 22 files matched `data_files.sha256`.
- `verify/` also holds an extracted copy of the repository archive.
- The repository archive above predates this handover commit. The handover itself is in Git and
  in the folder.
- Docker has no named volumes. The only persistent state is the `data/` bind mount, which is fully
  covered above.
- The NASA data is public (PGDA LOLA, NAIF SPICE) and stays out of Git (`data/*` is ignored).
