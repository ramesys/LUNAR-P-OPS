# LUNA-P/OPS scientific methodology

Status: describes the implementation at commit `06bda7c` (reviewed 2026-11-07). Code references
are to `backend/lunar-core/src/lunar_core` and `backend/api/src/clps_api`.

This document states what is computed and how, and keeps four levels apart:
**implemented computation**, **automated software verification**, **numerical comparison with
independent reference data**, and **independent scientific validation**
([§8](#8-verification-levels)). Only the first three exist today.

## 1. Data products

| Product | Resolution | Window used | Role |
| --- | --- | --- | --- |
| LOLA `LDEM_80S_20MPP_ADJ.TIF` (PGDA) | 20 m/px | ±12 km around the ROI centre (`shackleton-rim-b_near.npz`) | candidate elevation, near-field horizon, 4 km display grid |
| LOLA `LDEM_60S_240MPP_ADJ.TIF` (PGDA) | 240 m/px | ±205 km around the ROI centre (`shackleton-rim-b_far.npz`) | far-field horizon, 40 km display grid |
| NAIF `de440s.bsp` | — | — | Sun, Earth, Moon ephemerides |
| NAIF `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf` | — | — | lunar orientation; `MOON_ME` (DE421 mean Earth / polar axis) frame |
| NAIF `pck00011.tpc`, `naif0012.tls` | — | — | lunar radii (spherical, 1737.4 km), leap seconds |

Both DEMs are heights in metres above the 1737.4 km reference sphere, in a south polar
stereographic projection. The windows are read with HTTP range requests from the cloud-optimized
GeoTIFFs and stored as `.npz` (float32 heights, origin, pixel size, source URL). The cached files
have no separate nodata mask; NaN in the source remains NaN.

Every evaluation re-hashes the windows, checks the source URLs and resolutions (20 m and 240 m)
and refuses to run if the candidate's stored near-field window hash differs from the current file.

## 2. Coordinate systems

- **Geographic:** planetocentric latitude and east longitude in [0, 360), frame `MOON_ME`. This is
  the frame of the LOLA products, so no frame transformation is applied between terrain and SPICE.
- **Projected:** spherical south polar stereographic on R = 1737.4 km,
  ρ = 2R·tan(π/4 + φ/2), x = ρ·sin λ, y = ρ·cos λ (`terrain.polar_stereographic_south`).
  Origin at the pole, +y toward 0°E. The point scale factor is 2/(1 + sin|φ|), true at the pole;
  at the ROI centre (−89.5244°) it is about 1.00002.
- **ROI-local east/north:** offsets in projected metres along the *ROI centre's* east and north
  axes (`roi.local_frame`): east = (cos λ₀, −sin λ₀), north = (sin λ₀, cos λ₀), λ₀ = 56.30993°.
  Brush polygons, grid sampling and 3D picking use this frame.
  - It is a plane frame, not local geodetic east/north at each point. The ROI centre is only
    ~14.4 km from the pole, so the local meridian direction rotates across the 4 km square up
    to about ±9° (at the corners nearest the pole) relative to the centre axes. Spacing in metres is accurate (scale factor ≈ 1);
    the labels "east" and "north" refer to the centre frame.
  - Azimuths reported by SPICE and by the horizon mask are local true-north azimuths at each
    candidate. The 3D view rotates them into the centre frame for display
    (`sceneGeometry.roiAzimuth`: az + λ_candidate − λ₀).
- **Candidate position:** the local offset is mapped to projected (x, y), converted to latitude and
  longitude by the inverse projection, and the elevation is bilinearly sampled from the 20 m grid at
  that exact (x, y). Display-grid heights are never used.

## 3. Terrain horizon (`horizon.horizon_mask`)

- 720 azimuths (0.5° step), clockwise from local north.
- Rays follow great circles on the 1737.4 km sphere (`_destination`).
- Near field: samples every 20 m from 20 m to < 8 km on the 20 m DEM. Far field: every 240 m from
  8 km to < 200 km on the 240 m DEM. Heights are bilinear samples.
- Observer radius = 1737.4 km + DEM elevation at the observer + observer height.
- Elevation angle of each sample, with exact spherical geometry (curvature included):
  `atan2(r_t·cos θ − r_o, r_t·sin θ)`, θ = d / R. The horizon at an azimuth is the maximum over
  its samples.
- Between azimuths the mask is linearly interpolated.
- **Coverage requirement** (`evaluation.verify_point_coverage`): before computing, every one of the
  near and far ray samples must be finite. Any missing sample makes the evaluation `UNAVAILABLE`.
  A flat horizon is never substituted.
- The 200 km limit follows the method of Barker et al. (2023). Terrain beyond it, and relief
  between samples, is not represented.

## 4. Ephemerides and apparent positions (`geometry.horizontal_positions`)

- SPICE `azlcpo` with aberration correction `LT+S` (light time and stellar aberration), azimuth
  clockwise from north, elevation positive up, no refraction (airless body).
- The observer position is computed with `georec` on the SPICE Moon radii. The API checks that the
  radii equal the DEM reference sphere (1737.4 km) to 1 mm, so the local vertical is radial and
  consistent with the horizon geometry.
- Times are UTC, converted with the leap-second kernel. DE421 lunar orientation covers 1900–2050.

## 5. Visibility rules (`visibility.py`)

- **Sun:** visible when the **upper limb** is above the terrain horizon at the Sun's azimuth:
  elevation + apparent semidiameter > horizon. The semidiameter uses R☉ = 695,700 km and the
  instantaneous distance.
- **Earth:** visible when the **centre** is above the terrain horizon at the Earth's azimuth
  (0° clearance in candidate evaluations). The Earth's apparent radius (~0.95°) is ignored, so
  partial-disc visibility counts as not visible.
- **Simultaneous:** both true at the same sample.

These are geometric line-of-sight tests at a single point. They do not model illumination of
surfaces, solar-panel orientation, power, antenna patterns, link budgets or multipath.

## 6. Temporal discretization and metrics

- Sample times: t₀ + k·step for k = 0 … ⌈duration/step⌉ − 1 over the half-open interval
  [t₀, t₀ + duration). Each sample represents the state until the next sample.
- Duration ≤ 168 h; step 1–360 min.
- **Intervals** (`windows.build_windows`): runs of equal visibility; the last interval ends at the
  interval end and is marked `truncated` if it touches either edge. Transition times are uncertain
  by up to one step.
- **Brush metrics:** fractions are counts of visible samples / all samples (a partial final step
  counts as a full sample). Longest darkness and longest Earth gap are the longest non-visible
  sampled intervals, in hours.
- The Timeline cursor moves only between stored samples. There is no interpolation between them.

## 7. Constraint Brush sampling (`clps_api/brush.py`)

- Polygon: 3–64 vertices within ±2000 m, no duplicate adjacent vertices, no self-intersecting
  edges, non-zero area.
- Grid: points at integer multiples of the spacing (≥ 20 m) in ROI-local east/north, aligned to
  the ROI origin, ordered south to north and west to east. Points on an edge or vertex
  (tolerance 1e-7 m) are inside. At most `max_points` (≤ 64) points, and at most 8,192
  location-time samples in total.
- Each point becomes a candidate with the same rules as a terrain click, and is evaluated with
  the same `evaluation.compute` as a single candidate. There is no separate brush engine.
- Verdicts: `PASS` if every constraint holds (thresholds are inclusive), `FAIL` otherwise;
  `UNAVAILABLE` for missing DEM or horizon coverage; `ERROR` for any other failure.

## 8. Verification levels

### 8.1 Implemented computation

Sections 1–7. Every stored result is labelled `COMPUTED_UNVERIFIED` or `UNAVAILABLE` and carries
the warning that independent validation has not been established. The `VALIDATED` status exists
in the schema but is never assigned.

### 8.2 Automated software verification

The backend test suite (148 tests at `06bda7c`) checks, among others: projection round trips and
axis conventions; bilinear sampling and NaN outside the grid; the flat-Moon geometric dip; an
isolated synthetic mountain blocking only its azimuth; mask interpolation across north;
visibility rules and windows; `UNAVAILABLE` on near- or far-field nodata and missing windows;
candidate identity and dataset-hash checks; brush polygon validation, deterministic sampling,
inclusive thresholds, preview isolation (no database created) and idempotent retry, using the
real Shackleton Rim B windows and SPICE kernels when present. These tests show the code does
what it is designed to do. They do not show the design is scientifically correct.

### 8.3 Numerical comparison with independent reference data

| Comparison | Scope | Result | Where |
| --- | --- | --- | --- |
| SPICE Sun/Earth apparent az/el vs **JPL Horizons** (airless, apparent) | 4 points (89.5°S 0°E, 85°S 45°E, 88°S 222°E, 0°N 0°E), daily over 2026 | Measured max error 0.05″ (upstream ADR 0005); the test runs offline in the suite with a 1″ tolerance and passed at `06bda7c` | `lunar-core/tests/test_horizons_golden.py` |
| Projection vs **pyproj** using the LOLA stereographic CRS | Round-trip points | Passes in the suite | `pipelines/tests/test_projection.py` |
| Cached 20 m window vs the remote source GeoTIFF read independently with rasterio/pyproj | Sample A window, 5 points | Coordinates agree to < 1e-12°, elevations to < 0.1 mm | `docs/lola_independent_comparison.json`, `backend/scripts/check_lola_source.py` |
| Terrain horizons vs **NASA LOLA PSR map** | 50 random pixels around the catalog sites, 18.6-year cycle | 100 % agreement (upstream spike, ADR 0009); **not rerun in this review** | `make spike-terrain` |

None of these comparisons covers the Shackleton Rim B windows or brush-generated candidates
directly. The Horizons points do not include the Shackleton Rim B coordinates, and the Horizons
comparison tests geometry only, not terrain horizons.

### 8.4 Independent scientific validation

**None.** No result has been compared with an independent illumination or Earth-visibility
product (for example published LOLA-based illumination maps or horizon-mask products) at the
Shackleton Rim B points, and no external review has been carried out. Recompute & compare shows
repeatability with the same inputs and code; it is not validation.

## 9. Explicit limitations

- Point observer; no lander footprint, slope, rock or hazard modelling. Results say nothing about
  landing safety.
- Horizon resolution limited to 0.5° in azimuth, 20 m / 240 m radial sampling and bilinear DEM
  interpolation; narrow peaks between samples can be missed.
- No terrain beyond 200 km; no DEM uncertainty propagation.
- Earth treated as a point at its centre; Sun disc reduced to the upper-limb test.
- Discrete time sampling; fractions and gaps are sampled estimates.
- Candidate IDs depend on bit-exact floating-point results (projection, bilinear interpolation).
  Running on a different platform or library version could, in principle, produce different IDs
  for the same nominal point; this has not been tested.
- The 3D viewer shows at most a 40 km area. It does not render the 200 km horizon; distant terrain
  that blocks the Sun or Earth appears only through the stored horizon guides and results.
- Sun/Earth paths, rays and the horizon silhouette in the 3D view are drawn on a symbolic dome
  (2.6 km radius at 4 km scale, 12 km at 40 km). Only their directions come from the stored
  SPICE samples and horizon mask; their distance from the observer has no physical meaning. Paths
  connect stored samples with straight segments; nothing between samples is computed.
- The 40 km and 4 km views are separate meshes from different DEMs and are switched, not blended.
- No orbital imagery (for example LROC) is shown; its registration to the DEM has not been checked.
- Shackleton Rim B is a published study point, not an official landing site; the ±2 km square is a
  proposed study area.

## References

- Barker, M. K., et al. (2023), LOLA south-pole elevation products,
  *Planetary Science Journal*. [doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1)
- NASA/JPL NAIF SPICE toolkit and generic kernels: https://naif.jpl.nasa.gov/
- NASA GSFC PGDA, LOLA products: https://pgda.gsfc.nasa.gov/products/90
- Upstream ADRs 0005, 0006, 0009 and 0010 (`docs/adr/`, Spanish).
