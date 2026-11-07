# Sprint 07: unified scientific exploration context

Status (2026-11-07): the sprint is implemented and verified locally with unit tests, the full
Playwright E2E suite on Chrome, and a browser check. Development continues.

## 1. Audit

| Workflow | Before | Problem |
| --- | --- | --- |
| Candidate evaluation | Shared store: `revisionId`, persisted `evaluation`, `cursorUtc` snapped to stored samples (Sprint 06). | — |
| Catalog comparison (original CLPS) | `ChartsPanel` held its own `index` and `playing` state, and the analysis had no identifier. | Two unrelated timelines with identical controls; nothing said which result a cursor or label belonged to, and the catalog cursor was lost on reload. |
| Graph read-only values | Single-line read-only `<input>`s. | Saved timestamps, statuses, the interval and the cursor were truncated. |
| Software commit | Recorded only if `CLPS_GIT_COMMIT` was set by hand at `docker compose up`. | Easy to forget, no clean/dirty rule, and a stale shell value could mislabel an image. |
| E2E | The config hard-coded `channel: "msedge"`. | The suite could not run on this host (no Edge). |

The catalog analysis is recomputed from the URL scenario on load and on **Compare sites**. This is
the unchanged upstream CLPS behaviour: it is not stored. Sprint 07 does not add any other
calculation trigger.

## 2. Unified context: one store, two named contexts

`lib/explorationStore.ts` (the Sprint 06 store, extended; no second state system) now holds:

- `context: "candidate" | "catalog"`: the active scientific context.
- The candidate state, unchanged:
  - active root and revision;
  - persisted `evaluation` (its ID);
  - `cursorUtc` snapped to the evaluation's samples;
  - `draft` and `settings`, distinct from the evaluated inputs.
- `catalog`:
  - `analysisKey`: FNV-1a over the exact `AnalysisRequest` (`lib/analysisKey.ts`). The analysis
    has no database ID, so the key identifies the scenario.
  - `label`;
  - the analysis's own `times` and `stepMinutes`;
  - `cursorUtc` snapped to those times;
  - `playing`;
  - `focus`: the active catalog site and its coordinates.

Reducer rules, covered by unit tests:

- Moving or playing a timeline makes its own context active. A candidate cursor action never
  touches the catalog cursor, and the reverse also holds.
- Only one context plays at a time. Switching context pauses both and changes neither cursor.
- Each cursor snaps to its own sample grid; different intervals and steps are never mixed, and
  nothing is interpolated.
- A new catalog request starts at its first sample. The same request, after reload, keeps its
  snapped cursor.
- Candidate results for another candidate are still rejected, as in Sprint 06.

Persistence: `lunar-ops-selection` (candidate, as before) and `lunar-ops-context`, which holds the
context, `catalogAnalysisKey` and `catalogCursorUtc`.

## 3. Consistent temporal navigation

- Both timelines use the original CLPS `TimeControl`, with the same play, step, scrub and speed
  conventions. The catalog's controls work exactly as upstream; their cursor now lives in the
  shared store.
- A sticky **Active context** bar at the top has two cards:
  - **Candidate evaluation:** revision, coordinates, height, evaluation ID and status, sample
    n/N, UTC and step, and the "unsaved draft differs from the evaluated inputs" warning.
  - **Catalog comparison:** focused site and coordinates, analysis key and label, sample n/N,
    UTC and step.

  Clicking a card switches the context and scrolls to it.
- Panel badges name the context and say whether it is active or inactive: the Inspector result
  ("Candidate evaluation") and the catalog "Sky & timeline" ("Catalog comparison"). The Shackleton
  3D time panel names the candidate evaluation it shows.
- Spatial views follow their own context only. The Shackleton terrain shows the candidate
  evaluation; the catalog's Sample 3D view follows the catalog cursor, as upstream.

## 4. Landing Graph readability

- Read-only values use `InfoControl`, a Rete control rendered through the classic preset's
  `customize.control` hook, so this is still plain Rete.js. The text wraps (no single-line
  truncation) and is styled by role:
  - *saved:* location, terrain, and "draft above · saved C1: …";
  - *status:* committed CandidateRef, computation and result status;
  - *info:* next run, evaluated interval, cursor.
- Location is shown to 6 decimals, and terrain is labelled as the LOLA raster sample.
- Editable draft inputs are unchanged Rete `InputControl`s. Nodes are 250 px wide, so full ISO
  timestamps fit.
- The E2E suite checks that no `.node-info` and no editable node input overflows at the normal
  zoom.

## 5. Software provenance

The commit now reaches the API through the image build, not by hand:

```
Makefile:      CLPS_GIT_COMMIT ?= <git rev-parse HEAD>[-dirty if `git status --porcelain` is non-empty]
compose:       build arg CLPS_GIT_COMMIT  ->  Dockerfile ENV CLPS_BUILD_COMMIT (dev and prod targets)
runtime env:   CLPS_GIT_COMMIT (fallback only)
```

- `make provenance` prints the value. `make up` builds and starts the stack with it.
- `evaluation.software_commit()` takes `CLPS_BUILD_COMMIT` first (it describes the code baked into
  the image) and the runtime variable as a fallback. It accepts only `^[0-9a-f]{7,40}(-dirty)?$`;
  malformed values are not recorded.
- New evaluations store `software_commit` and `software_commit_source` (`image build` or `runtime
  environment`).
- The manifest reports `software_commit_state` (`clean`, `dirty` or `not_recorded`), derived only
  from the recorded string. Sprint 06 records keep their stored commit, and their missing
  `software_commit_source` is listed as `not_recorded`. Older records stay `not_recorded`. Nothing
  is back-filled.
- The manifest has a new `consistency` block:
  - `inputs_sha256` of the exact stored candidate snapshot and request;
  - whether the candidate record still exists and still equals the evaluated snapshot;
  - whether the evaluation's candidate ID matches.

  A test edits a stored candidate record and checks that the manifest keeps the evaluated inputs
  and reports the mismatch.
- Recompute & compare is unchanged: it never stores a result and never sets validation.
- Limitation: under `make dev` (live file sync) the recorded commit describes the build; edits
  synced afterwards are not reflected until the next build.

## 6. E2E on this host

- `playwright.config.ts` reads `E2E_CHANNEL` (default `msedge`). This is test configuration only;
  no application code changed for the browser.
- Run: `cd frontend/web && E2E_CHANNEL=chrome ./node_modules/.bin/playwright test --project=desktop --project=phone`.
- The baseline before any Sprint 07 change: the 10 upstream tests passed on Chrome.
- The `screenshots` project was not run, because it overwrites the committed README images.
- New `e2e/workspace.spec.ts` (4 tests). It creates or reuses a fixed Shackleton candidate and a
  6 h / 60 min evaluation through the public API. The identities are content hashes, so runs reuse
  records until the software commit changes.
  1. **Contexts stay separate while navigating time.**
     - Candidate stepping updates the context card, the 3D time panel and the Results node (sample
       3/6, 02:00 UTC).
     - Catalog stepping activates the catalog (sample 2, 2026-01-01 02:00 UTC) and leaves the
       candidate cursor alone. Switching back changes no cursor.
     - Playback reaches 6/6. No API write besides the load-time `/api/analysis`, and the camera is
       unchanged.
  2. **Draft vs saved, then full reload.**
     - A 9 m Inspector draft shows "saved C0: 2 m" in the node, the unsaved chip, the context-bar
       warning and the 3D draft line, with no writes.
     - After reload: same evaluation, catalog context active, both cursors restored (candidate 2/6,
       catalog sample 2), and the graph back on the saved 2 m.
  3. **Experiment export.**
     - The downloaded JSON matches the fixture's candidate, evaluation and request.
     - Its terrain hashes equal the ROI endpoint's, and `candidate_snapshot_matches_record` is
       true.
     - `validation_status` is not_independently_validated. The commit is well-formed, or
       `not_recorded`, with a matching clean/dirty state.
  4. **Graph readability.** No overflowing info text or input; the full saved timestamp and the
     CandidateRef are visible.

## 7. Verification results

- Backend: ruff, format and mypy, plus `pytest` with **140 passed** (134 before). New tests:
  - build commit wins over runtime;
  - dirty state;
  - clean state with source;
  - malformed values are not recorded (4 cases);
  - consistency block;
  - changed candidate record detected.
- Frontend: lint, typecheck and build, plus `vitest` with **74 passed** (70 before). New:
  - three context-reducer tests;
  - `ContextBar.test.tsx`;
  - `ChartsPanel.test.tsx` now gives each render its own store, as each App does.
- E2E on Chrome: **14 passed**, the 10 upstream CLPS tests plus the 4 above, on the desktop and
  phone projects.
- Browser check at 1440 × 900:
  - the sticky context bar showed both contexts (`evaluation-8354652b…`, sample 30/72;
    `analysis-0a91a74d`, Sample B, sample 2/720);
  - the catalog badge read "active context" after catalog stepping;
  - 0 of 10 graph info fields and 0 inputs overflowed.
- Provenance of the fixture evaluation built this sprint: `software_commit
  b1de8d725a3929ae9b4fa0a050ec0e5198ea5ff5-dirty`, source `image build`. That is honest: the image
  was built from `b1de8d7` plus the uncommitted Sprint 07 work.

Screenshots: `docs/screenshots/sprint07-context-catalog.jpg` and
`sprint07-landing-graph-readable.jpg`.

## 8. Limitations

- The catalog comparison is still recomputed on load and on Compare sites (upstream design); its
  key identifies the request, not a stored result.
- The candidate and catalog spatial views are separate: the Shackleton terrain serves candidates,
  and the Sample 3D view serves catalog sites. No catalog site lies inside the Shackleton ROI.
- E2E runs write the fixed fixture candidate and evaluation into the local SQLite. A new commit
  creates one new evaluation record per commit.
- `make e2e` still calls host `pnpm`, which is not installed here; the direct Playwright command
  above works.
