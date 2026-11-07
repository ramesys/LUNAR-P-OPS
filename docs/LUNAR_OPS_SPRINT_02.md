# LUNAR-OPS Sprint 02: graph and scientific evidence

The Sample A click still queries the original near-field window. Its returned Candidate C0 is stored as an immutable JSON snapshot in SQLite at `data/candidates.sqlite3`. The Landing Graph routes location, terrain, observer height, and UTC time through the Rete.js v2 dataflow engine. Its preview assembles parameters only; it does **not** compute sunlight, visibility, safety, or other scientific outputs. The server creates C1 with an explicit parent and preserves all unchanged C0 fields. A repeated identical evolution is idempotent. The browser stores the most recent C0 identifier in local storage; reopening the Sample A 3D view fetches C0 and its latest saved child from SQLite. Clearing browser local storage removes this convenience pointer, not the stored snapshots. Sprint 01 candidates held only in browser memory were not saved and must be selected again once after upgrading. SQLite is local, with no multiuser or authentication features.

Every graph node declares input/output types, units, reference frame, data sources, algorithm identifier, execution status, validation status, errors and warnings. These are viewable under **Scientific node contracts**. A successful graph execution does not imply scientific validation; inputs are explicitly marked unverified. Incomplete or invalid graph inputs cause the Candidate node to fail and disable commit. Earlier asynchronous selection/graph responses are guarded against replacing newer state. C1 is a parameter snapshot; no C0 scientific result is relabeled as newly calculated for C1.

## Actual downloaded windows

SHA-256 hashes below identify the exact locally downloaded compressed NPZ windows, **not** full NASA source GeoTIFFs:

- `sample-a_near.npz`, LDEM_80S_20MPP_ADJ, 20 m: `753de3fead9a9f18da9ca6366835b5677a97570d73b0dce6a34cf560420faa76`.
- `sample-a_far.npz`, LDEM_60S_240MPP_ADJ, 240 m: `9f5821219eb1cb59c1381050d67dca1f8300c4486d41e8e7ca7e59205f36dec9`.

The C0 API returns the actual near-window hash, source URL, resolution, source nodata representation (NaN for the verified near-field product), and the window's pixel-centre coverage bounds `[xmin, ymin, xmax, ymax]` in the upstream lunar south-polar stereographic metres. Selection is additionally limited to the displayed ±6 km patch. Out-of-window and NaN samples are rejected. The raster pipeline stores sampled arrays in NPZ and does not include an independent nodata mask; the current downloaded near window was checked for NaNs, and the independent source comparison reads a masked source raster. The full NASA source GeoTIFF was accessed by range, so a full-source checksum is unavailable.

## Finite independent comparison

`lola_independent_comparison.json` contains four deterministic Sample A local offsets and the actual browser-selected C0. `backend/scripts/check_lola_source.py` compares the app's spherical stereographic transform against pyproj and compares its NPZ sampler against an independent Rasterio read of the original NASA source pixels with bilinear interpolation. Tolerances are `1e-9` degrees for coordinates and `0.001 m` for elevations. All five comparisons passed; maxima are recorded in the JSON. This checks selected points and the present local window only, not every DEM sample, instrument accuracy, lunar reference-frame realization, or physical landing suitability. Candidate validation status remains `not_independently_validated`.

Repeat with Docker and network access:

```sh
docker compose run --rm --no-deps -T -v ./backend:/workspace api python /workspace/scripts/check_lola_source.py
```

For a local run with downloaded kernels and Sample A terrain: `docker compose build api web` then `docker compose up -d --no-deps api web`. Use Sample A → 3D view → select a point → edit the graph → Create Candidate C1. The upstream repository and Rete.js packages are MIT-licensed; retain their license notices and the NASA data attribution.
