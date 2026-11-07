# Sprint 06: shared space–time state and reproducible experiments

Status (2026-11-07): the sprint is implemented and verified locally with automated tests and a
browser run of the full Definition-of-Done sequence. Development continues.

## 1. Audit of the Sprint 05 interaction model

| Finding | Effect | Resolution |
| --- | --- | --- |
| The timeline cursor was local state inside the Inspector chart (`useState` index), and it remounted per evaluation. | The 3D view and the graph could not follow time; a new evaluation reset the cursor. | `cursorUtc` lives in the shared store and snaps to stored samples. |
| The active evaluation was known only to `LandingGraph` (`c0Result`/`c1Result`). | The terrain could not show time-dependent geometry. | The graph publishes the selected revision's persisted evaluation as `evaluation`. |
| Duration and step were toolbar-local state that did not appear in the graph. | The next run's settings were invisible in the dataflow. | `settings` is in the store; the Scientific computation node shows "next run". |
| The Time and Height nodes showed only the draft. | A draft could look as if it belonged to the persisted result. | Each node has a read-only "saved C0/C1: …" field; the Results node shows the evaluated interval and the inspected sample. |
| A history pick bypassed the graph (Inspector state only). | The graph's Results node and the Inspector could disagree. | A history pick calls `ScientificComputationNode.prefer()` and flows through the Rete dataflow. |
| Reload restored only the C0/C1 selection. | The inspected evaluation and time were lost. | `{rootId, revisionId, evaluationId, cursorUtc}` is persisted, debounced. |
| 3D lighting was fixed. | Time had no spatial meaning. | Stored SPICE Sun and Earth directions at the cursor, plus an optional Sun-direction light. |
| The orange colour meant both "Sun" and "selected". | Colour meaning was ambiguous. | Sun is orange, Earth is blue, and the active selection is gold, in the map, graph and Inspector. |

The candidate settings for the next terrain click ("Settings for the next terrain click") are kept
separate on purpose. They describe a new C0 and are not a draft of the selected candidate.

## 2. Interaction contract

`frontend/web/src/lib/explorationStore.ts` is the single authoritative exploration state. It uses
React's `useSyncExternalStore`, with no new framework. Subscribers re-render only for the slice
they select, so playback does not re-render the application.

| State | Fields | Changed by | Never changed by |
| --- | --- | --- | --- |
| Display | `cursorUtc`, `playing`, camera (local to the 3D view), panel focus | Scrub, play, step, chart click, camera controls, node pick | — |
| Draft | `draft` (height, start time in the graph nodes), `settings` (duration, step) | Graph node edits, Inspector parameter fields, toolbar | Cursor, camera, selection of stored results |
| Persisted candidate | SQLite candidates | Terrain click (new C0); **Create Candidate C1** | Drafts, cursor, camera, Evaluate |
| Evaluation | SQLite evaluations | **Evaluate** (POST) | Cursor, playback, camera, resize, selecting candidates or evaluations, reload, **Recompute & compare** (never stored) |

Selection state is `rootId` (marker and graph) and `revisionId` (the `candidate_ref` output). The
reducer enforces three rules:

- An evaluation for any other candidate is ignored, so no stale result can appear under the wrong
  candidate.
- The cursor always snaps to an actual stored sample (nearest; ties go to the earlier sample). It
  is kept across C0/C1 switches at the same location, and reset for another location.
- A cursor move cannot touch the candidate, the evaluation, the draft or the settings.

## 3. Synchronized behaviour

- **Timeline → map:** scrub, step or play in the Inspector's original CLPS time control.
  - The 3D view draws the stored Sun and Earth directions from the evaluated candidate: solid
    line and filled ball when visible over the stored terrain horizon, dashed line and open ball
    when blocked.
  - A time panel shows the sample time, its index and step, Sun/Earth elevation against the
    horizon, and the visibility verdict.
  - The optional directional light uses the stored Sun vector. The caption states that local
    shadows cover the 4 km mesh only, and that visibility comes from the stored 200 km horizon
    result.
  - The camera and the scene are not rebuilt.
- **Timeline → graph:** the Results node shows `cursor n/N: UTC · Sun … · Earth …` and the
  evaluated interval.
- **Timeline → Inspector:** sample index, time and readout. Values are taken at the nearest stored
  sample, never interpolated.
- **Graph ↔ Inspector:** Height/Time edits in either place write the same Rete nodes. The draft is
  shown in the 3D time panel ("result above is for 2 m").
- **Map ↔ graph:** a terrain click creates and activates C0. A marker or list pick activates that
  candidate. A revision tab or commit moves `candidate_ref`, the parameter nodes, the Inspector and
  the result.

## 4. Scientific clarity

- The evaluated interval, sample count, step and resulting temporal precision are stated. A
  zero-visibility result is explained from the stored samples as the closest approach to the
  terrain horizon (for example, "Sun never cleared the terrain horizon… closest approach
  −11.87°"), with directions for exploring another date range.
- The C0/C1 comparison lists every scientific input that differs: location, height, start time,
  duration, step, DEM and kernel hashes, algorithm. It calls the comparison controlled only when
  exactly one input differs. Otherwise it says the difference cannot be attributed to any single
  input.

## 5. Reproducibility

- `GET /api/evaluations/{id}/manifest` returns `lunar-ops-experiment/1`, built only from stored
  records:
  - candidate, CandidateRef and parent;
  - UTC interval and step;
  - near/far DEM sources, SHA-256, resolution and nodata;
  - SPICE kernel hashes and configuration;
  - method settings;
  - software versions and commit;
  - execution and validation status, errors and warnings;
  - all outputs with an `output_sha256`.

  Fields an older evaluation did not record are set to `not_recorded` and listed in
  `not_recorded`. Pre-Sprint-06 evaluations lack `clps_api_version` and `software_commit`.
- New evaluations record `clps_api_version`, and `software_commit` when the deployment sets
  `CLPS_GIT_COMMIT`. The commit is passed through `infrastructure/docker-compose.yml`, for example
  `CLPS_GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d api`. As in Sprint 04, adding
  provenance fields changes the IDs of new evaluations relative to older runs with the same inputs.
- `POST /api/evaluations/{id}/recompute`:
  - re-runs the stored inputs (`evaluation.compute`, which is not saved);
  - checks the current near/far DEM hashes, kernel hashes, algorithm and lunar-core version
    directly from the files;
  - compares all sampled angles (tolerance 1e-9°), visibility flags and sample times (exact),
    intervals (1e-6 s) and the horizon;
  - reports `reproduced`, `differs` or `inputs_changed`.

  The original record is untouched and the validation status is not changed.
- The Inspector's **Export experiment (JSON)** button downloads the manifest. **Recompute &
  compare** shows the report.

## 6. Verification

**Automated**

- Backend: `ruff check`, `ruff format --check`, `mypy` and `pytest` give **134 passed** (129
  before). The new `api/tests/test_experiment.py` covers:
  - manifest fields equal to the stored records and file hashes;
  - the commit recorded only when provided;
  - legacy records with missing provenance marked `not_recorded`;
  - recompute reproducing without storing;
  - changed far-field data reported as `inputs_changed` with an `UNAVAILABLE` recomputation, while
    the original is preserved.
- Frontend: `test`, `lint`, `typecheck` and `build` give **70 passed** (62 before). New tests:
  - `explorationStore.test.ts`: snapping, stale results, revision vs root cursor rules,
    notification only on change.
  - `SpaceTime.test.tsx`: the shared cursor drives the terrain scene, scrubbing makes no API
    request, playback walks stored samples with no request and stops at the end, and another
    terrain window's result is not drawn in the Shackleton scene.
  - `ExperimentPanel.test.tsx`: the export downloads the stored manifest and names unrecorded
    fields; the recompute report never claims validation.
  - `ScientificResults.test.tsx`: identical, single-variable and multi-variable comparisons.
- The build still warns about the lazily loaded three.js chunk (565 kB). The main chunk is 462 kB.
- `make e2e` was not run, because it needs Edge on the host.

**Browser run** at http://localhost:5180 (1440 × 900), with the API started with
`CLPS_GIT_COMMIT=88d68ee-dirty`:

1. A Shackleton terrain click created C0 (89.553569°S, 61.878271°E, 291.20 m).
2. Evaluate C0 (72 h at 60 min) through the graph gave `COMPUTED_UNVERIFIED`. Graph, 3D time panel
   and Inspector all showed sample 1/72.
3. Dragging the slider to sample 43/72 updated the Inspector, the 3D time panel ("Sun 1.26° vs
   horizon 15.29° → blocked") and the Results node together. The camera and scene builds were
   unchanged, and the cursor was persisted.
4. Play ran through the stored samples to 72/72 and stopped. The API log since the scrub began
   shows only container `/api/health` checks: zero application requests during scrubbing and
   playback.
5. Height 10 m typed in the graph node reached the Inspector field and the 3D draft line. The node
   showed "saved C0: 2 m", and the terrain elevation and `candidate_ref` were unchanged.
6. Create C1 then Evaluate C1 gave `COMPUTED_UNVERIFIED`. The comparison was labelled
   *Controlled: only observer height differs (2 → 10)*. Sampled visibility was 0 h for both; the
   horizon toward the Sun at the first sample was 15.72° against 16.01°.
7. The export (`lunar-ops-experiment_8354652b26c0.json`, 66 kB) carried the C1 and parent IDs,
   exact coordinates, the 72 h interval, near `99be1952…` and far `e1f348b1…` hashes, five kernel
   hashes, software versions with commit `88d68ee-dirty`, the status, and 72 samples, with an
   empty `not_recorded` list. The download was intercepted in the page, so no file was written.
   A pre-Sprint-06 evaluation's manifest listed `clps_api_version` and `software_commit` as not
   recorded.
8. Recompute & compare was **reproduced**: all input checks matched, every difference was 0, the
   record was not stored, and the stored evaluation count was unchanged (1).
9. A reload at sample 30/72 restored C1, evaluation `8354652b…`, cursor 30/72 in all three panels,
   the parameters and the marker. Switching C0 → C1 kept 30/72, and the camera was unchanged.
10. Two defects were found and fixed during the run:
    - an obsolete "lighting is fixed" caption appeared in Sun mode;
    - the live preview went missing after reload, because a cancelled Rete fetch was swallowed.

Screenshots: `docs/screenshots/sprint06-spacetime-workspace.jpg` and
`sprint06-landing-graph-cursor.jpg`.

## 7. Limitations

- The cursor uses the nearest stored sample. The displayed geometry is the sampled state, and
  transitions between samples are uncertain by up to one step.
- Local shading and shadows use only the 4 km mesh and the Sun direction. They are not the
  far-field occlusion test.
- The Inspector timeline is the only cursor control; the terrain and the graph display it.
- The catalog comparison's own time control (`ChartsPanel`) remains independent; it plays the
  catalog analysis, not candidate evaluations.
- `software_commit` depends on the deployment setting `CLPS_GIT_COMMIT`. The demo value
  `88d68ee-dirty` described uncommitted code at the time.
- The node "saved …" fields can truncate long timestamps at the default graph zoom.
