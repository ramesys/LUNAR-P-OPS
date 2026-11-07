# Sprint 04: verified work and remaining integration

Sprint 04 is **not complete**. The landing workspace has been moved outside the
remounting comparison panel. The Shackleton windows below are research inputs;
they are not yet exposed by the application. The existing Sample A viewer and
scientific evaluation remain the working path.

## Shackleton Rim B research input

The proposed ROI is a 4 km × 4 km square in local east/north coordinates,
centered at planetocentric latitude −89.5244°, east longitude 56.30993°.
NASA's [Lunar Surface Data Book, table A2.1-1](https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf)
identifies this point as Shackleton Rim B. The Moon ME/DE421 coordinate
convention is described by [NASA](https://svs.gsfc.nasa.gov/4969/). The ROI
is a proposed bounded area around that point, not an official landing site or
a surveyed rim boundary.

On 2026-11-07 the existing `read_window` function read the official NASA
[LOLA south polar DEMs](https://pgda.gsfc.nasa.gov/products/90). Both cached
NPZ files below are local data and are not committed. The bounding coordinates
are pixel edges in south polar stereographic meters, with +y toward 0°E.

| Window | Dataset | Shape | Bounds x, y (m) | SHA-256 of local NPZ |
| --- | --- | --- | --- | --- |
| `shackleton-rim-b_near.npz` | `LDEM_80S_20MPP_ADJ.TIF`, 20 m/pixel | 1200 × 1200 | x [0, 24000], y [−4000, 20000] | `99be1952c9c4c542c786e59102110b4d9c1c744b971702c1e0d9e4377ba73b5f` |
| `shackleton-rim-b_far.npz` | `LDEM_60S_240MPP_ADJ.TIF`, 240 m/pixel | 1708 × 1708 | x [−193200, 216720], y [−196800, 213120] | `e1f348b1a942ddd8430158d2ab68ab5e7056b146a2d0b679dae3762e7b61e6b7` |

These hashes identify the extracted windows, not the complete NASA source
files. Both windows contained only finite values in this download; the source
20 m raster reports NaN nodata. At projected pixel center (11990, 7990) m,
independent Rasterio sampling of the source and the cached grid both returned
−25.660717010498047 m above the 1737.4 km reference sphere (difference 0 m).
An independent pyproj stereographic transformation at the ROI center differed
from `polar_stereographic_south` by about 1.82×10⁻¹² m on each axis.

The existing `verify_coverage` function passed its discrete near- and far-field
ray checks at the center and four ROI corners with these windows. An earlier
10.5 km near-field half-width failed at one corner (555 of 287280 near-ray
samples missing), so the final near-field half-width is 12 km. Five points do
not prove coverage for all points in the ROI; each candidate must still be
checked, including nodata and dataset identity. None of these checks validates
illumination results, terrain accuracy, or landing safety.

Recreate the windows with the existing `clps_pipelines.fetch_terrain.read_window`
function, center `polar_stereographic_south(-89.5244, 56.30993)`, near half-width
12000 m and far half-width 205000 m. Save as the names above. Source data may
change, so recheck hashes and nodata rather than assuming these results persist.

## Remaining work

The continuous Shackleton viewer, multiple synchronized candidate markers,
CandidateRef output and connected scientific Rete dataflow have not been
implemented or verified. The existing science graph still uses its separate
saved-candidate node. Complete those pieces in the requested order and verify
them end-to-end before describing Sprint 04 as complete.
