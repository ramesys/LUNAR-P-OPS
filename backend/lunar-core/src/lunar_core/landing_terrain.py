"""Coarse terrain screening of landing locations on a gridded LOLA DEM.

Four pieces, all deterministic and computed in projected south polar stereographic metres:

* `SurfaceSlope`: local slope from Horn's 3x3 finite differences at the point, the maximum of
  that local slope over the neighbourhood, and the slope of a least-squares plane fitted to the
  whole neighbourhood.
* `TerrainRoughness`: elevation variation after removing that plane (RMS and range of the
  residuals) and the raw elevation range.
* `TerrainQuality`: how many of the DEM nodes needed were available, the DEM and sampling
  resolution, and what the DEM cannot tell us.
* `LandingZoneScreen`: configurable slope, roughness and coverage limits applied to the above.

The 20 m LOLA product is an interpolated grid between laser tracks. Features smaller than about
two pixels (boulders, small craters) are not resolved, and no vertical uncertainty layer is
available here. Those aspects are reported as `NOT_ASSESSED`, never as passing. A `PASS` means
"passes this coarse DEM screen", not certified landing safety.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from numpy.typing import NDArray

from lunar_core.terrain import FloatArray, TerrainGrid

ALGORITHM: str = "landing-terrain-screen-v1"
MAX_NEIGHBORHOOD_RADIUS_M: float = 500.0
_CHUNK_NODES: int = 4_000_000
"""Upper bound on DEM samples held in memory at once."""

Status = Literal["PASS", "FAIL", "NOT_ASSESSED"]

NOT_ASSESSED_ALWAYS: tuple[str, ...] = (
    "DEM vertical uncertainty: no uncertainty layer is available for this DEM window",
    "Hazards below DEM resolution (boulders, small craters < ~2 pixels): not resolved by the DEM",
    "LOLA track density / interpolation distance at this location: not available",
    "Surface bearing strength, regolith properties and dust: not modelled",
)


@dataclass(frozen=True)
class SurfaceSlope:
    local_slope_deg: float | None
    """Horn 3x3 slope at the point; None if any of the nine nodes is missing."""
    max_local_slope_deg: float | None
    """Largest Horn slope over neighbourhood nodes whose 3x3 stencil is complete."""
    neighborhood_slope_deg: float | None
    """Slope of the least-squares plane through the neighbourhood nodes."""
    local_baseline_m: float
    neighborhood_radius_m: float


@dataclass(frozen=True)
class TerrainRoughness:
    rms_residual_m: float | None
    """RMS elevation residual after removing the neighbourhood plane (detrended)."""
    residual_relief_m: float | None
    """Max - min of the detrended residuals."""
    raw_relief_m: float | None
    """Max - min of the elevations, without detrending."""
    neighborhood_radius_m: float
    detrending: str = "least-squares plane z = a + b*east + c*north"


@dataclass(frozen=True)
class TerrainQuality:
    dem_resolution_m: float
    sample_spacing_m: float
    interpolation: str
    neighborhood_node_count: int
    valid_node_count: int
    coverage_fraction: float
    local_stencil_complete: bool
    vertical_uncertainty: Literal["NOT_ASSESSED"] = "NOT_ASSESSED"
    sub_resolution_hazards: Literal["NOT_ASSESSED"] = "NOT_ASSESSED"


@dataclass(frozen=True)
class TerrainMetrics:
    slope: SurfaceSlope
    roughness: TerrainRoughness
    quality: TerrainQuality


@dataclass(frozen=True)
class LandingZoneConstraints:
    max_local_slope_deg: float | None = None
    max_neighborhood_slope_deg: float | None = None
    max_roughness_rms_m: float | None = None
    max_relief_m: float | None = None
    """Applied to the detrended residual relief."""
    min_coverage_fraction: float = 1.0


@dataclass(frozen=True)
class ConstraintCheck:
    name: str
    value: float | None
    limit: float
    comparison: Literal["<=", ">="]
    unit: str
    status: Status
    margin: float | None
    """Normalized distance to the limit; positive means inside it."""
    reason: str


@dataclass(frozen=True)
class LandingZoneScreen:
    verdict: Status
    checks: tuple[ConstraintCheck, ...]
    not_assessed: tuple[str, ...] = field(default=NOT_ASSESSED_ALWAYS)

    def margin(self) -> float | None:
        """Smallest assessed terrain-metric margin, or None when nothing was assessed.

        Data coverage is a quality requirement, not a terrain gradient, so it is excluded.
        """
        values = [
            c.margin for c in self.checks if c.margin is not None and c.name != "coverage_fraction"
        ]
        return min(values) if values else None


def _offsets(radius_m: float, spacing_m: float) -> tuple[int, NDArray[np.bool_]]:
    """Half-width (nodes) of the sampled square and the disc mask of the neighbourhood."""
    m: int = math.floor(radius_m / spacing_m + 1e-9)
    k: NDArray[np.int64] = np.arange(-m, m + 1)
    i, j = np.meshgrid(k, k, indexing="ij")
    disc: NDArray[np.bool_] = (i**2 + j**2) * spacing_m**2 <= radius_m**2 + 1e-9
    return m, disc


def terrain_metrics(
    grid: TerrainGrid,
    x_m: Sequence[float] | FloatArray,
    y_m: Sequence[float] | FloatArray,
    longitude_deg: Sequence[float] | FloatArray,
    scale_factor: Sequence[float] | FloatArray,
    *,
    neighborhood_radius_m: float = 100.0,
) -> list[TerrainMetrics]:
    """Slope, roughness and coverage at projected points (vectorized, chunked).

    Nodes are laid out on each point's local east/north axes at the DEM pixel spacing on the
    ground; map offsets are multiplied by the projection scale factor so spacing is in ground
    metres. Heights are bilinear samples of the DEM (heights above the reference sphere, so the
    sphere is the local horizontal; curvature over 500 m is under 0.08 m).
    """
    if not 0 < neighborhood_radius_m <= MAX_NEIGHBORHOOD_RADIUS_M:
        raise ValueError(f"neighbourhood radius must be in (0, {MAX_NEIGHBORHOOD_RADIUS_M:g}] m")
    spacing: float = grid.pixel_size_m
    if neighborhood_radius_m < 2 * spacing:
        raise ValueError("neighbourhood radius must cover at least two DEM pixels for a plane fit")
    xs: FloatArray = np.asarray(x_m, dtype=np.float64)
    ys: FloatArray = np.asarray(y_m, dtype=np.float64)
    lon: FloatArray = np.radians(np.asarray(longitude_deg, dtype=np.float64))
    kf: FloatArray = np.asarray(scale_factor, dtype=np.float64)
    if not xs.shape == ys.shape == lon.shape == kf.shape or xs.ndim != 1:
        raise ValueError("point arrays must be one-dimensional and the same length")
    m, disc = _offsets(neighborhood_radius_m, spacing)
    # Sample one extra ring so Horn's stencil exists for every neighbourhood node.
    ring: NDArray[np.int64] = np.arange(-m - 1, m + 2)
    ni, ej = np.meshgrid(ring, ring, indexing="ij")  # i: north index, j: east index
    north_off: FloatArray = (ni * spacing).astype(np.float64).ravel()
    east_off: FloatArray = (ej * spacing).astype(np.float64).ravel()
    size: int = ring.size
    chunk: int = max(1, _CHUNK_NODES // (size * size))
    out: list[TerrainMetrics] = []
    for start in range(0, xs.size, chunk):
        sl = slice(start, start + chunk)
        ex, ey = np.cos(lon[sl]), -np.sin(lon[sl])
        nx, ny = np.sin(lon[sl]), np.cos(lon[sl])
        k = kf[sl][:, np.newaxis]
        px = xs[sl][:, np.newaxis] + k * (
            east_off * ex[:, np.newaxis] + north_off * nx[:, np.newaxis]
        )
        py = ys[sl][:, np.newaxis] + k * (
            east_off * ey[:, np.newaxis] + north_off * ny[:, np.newaxis]
        )
        heights = grid.sample(px, py).reshape(-1, size, size)
        out.extend(_metrics_for(heights, disc, m, spacing, neighborhood_radius_m))
    return out


def _metrics_for(
    z: FloatArray, disc: NDArray[np.bool_], m: int, spacing: float, radius: float
) -> list[TerrainMetrics]:
    count = z.shape[0]
    # Horn (1981) gradient at interior nodes; index i grows northward, j eastward.
    d_east = (
        (z[:, :-2, 2:] + 2 * z[:, 1:-1, 2:] + z[:, 2:, 2:])
        - (z[:, :-2, :-2] + 2 * z[:, 1:-1, :-2] + z[:, 2:, :-2])
    ) / (8 * spacing)
    d_north = (
        (z[:, 2:, :-2] + 2 * z[:, 2:, 1:-1] + z[:, 2:, 2:])
        - (z[:, :-2, :-2] + 2 * z[:, :-2, 1:-1] + z[:, :-2, 2:])
    ) / (8 * spacing)
    horn = np.degrees(np.arctan(np.hypot(d_east, d_north)))  # shape (count, 2m+1, 2m+1)
    inner = z[:, 1:-1, 1:-1]
    valid = np.isfinite(inner) & disc[np.newaxis]
    w = valid.astype(np.float64)
    k = np.arange(-m, m + 1, dtype=np.float64) * spacing
    nn, ee = np.meshgrid(k, k, indexing="ij")
    zz = np.where(valid, inner, 0.0)
    s0 = w.sum(axis=(1, 2))
    se, sn = (w * ee).sum(axis=(1, 2)), (w * nn).sum(axis=(1, 2))
    see, snn, sen = (
        (w * ee * ee).sum(axis=(1, 2)),
        (w * nn * nn).sum(axis=(1, 2)),
        (w * ee * nn).sum(axis=(1, 2)),
    )
    sz, sez, snz = zz.sum(axis=(1, 2)), (zz * ee).sum(axis=(1, 2)), (zz * nn).sum(axis=(1, 2))
    normal = np.stack(
        [np.stack([s0, se, sn], -1), np.stack([se, see, sen], -1), np.stack([sn, sen, snn], -1)],
        -2,
    )
    rhs = np.stack([sz, sez, snz], -1)
    det = np.linalg.det(normal)
    solvable = (s0 >= 3) & (
        np.abs(det) > 1e-9 * np.maximum(1.0, np.abs(normal).max(axis=(1, 2))) ** 3
    )
    safe = np.where(solvable[:, None, None], normal, np.eye(3)[np.newaxis])
    coef = np.linalg.solve(safe, np.where(solvable[:, None], rhs, 0.0)[..., np.newaxis])[..., 0]
    plane = coef[:, 0, None, None] + coef[:, 1, None, None] * ee + coef[:, 2, None, None] * nn
    residual = np.where(valid, inner - plane, np.nan)
    disc_nodes = int(disc.sum())
    horn_valid = np.isfinite(horn) & disc[np.newaxis]
    results: list[TerrainMetrics] = []
    for p in range(count):
        n_valid = int(valid[p].sum())
        centre_ok = bool(np.isfinite(horn[p, m, m]))
        fitted = bool(solvable[p])
        res = residual[p][valid[p]]
        heights = inner[p][valid[p]]
        slope = SurfaceSlope(
            local_slope_deg=float(horn[p, m, m]) if centre_ok else None,
            max_local_slope_deg=float(horn[p][horn_valid[p]].max())
            if horn_valid[p].any()
            else None,
            neighborhood_slope_deg=float(
                math.degrees(math.atan(math.hypot(coef[p, 1], coef[p, 2])))
            )
            if fitted
            else None,
            local_baseline_m=2 * spacing,
            neighborhood_radius_m=radius,
        )
        roughness = TerrainRoughness(
            rms_residual_m=float(np.sqrt(np.mean(res**2))) if fitted else None,
            residual_relief_m=float(res.max() - res.min()) if fitted else None,
            raw_relief_m=float(heights.max() - heights.min()) if n_valid else None,
            neighborhood_radius_m=radius,
        )
        quality = TerrainQuality(
            dem_resolution_m=spacing,
            sample_spacing_m=spacing,
            interpolation="bilinear at DEM pixel spacing on local east/north axes",
            neighborhood_node_count=disc_nodes,
            valid_node_count=n_valid,
            coverage_fraction=n_valid / disc_nodes,
            local_stencil_complete=centre_ok,
        )
        results.append(TerrainMetrics(slope, roughness, quality))
    return results


def _check_max(
    name: str, value: float | None, limit: float, unit: str, data_ok: bool
) -> ConstraintCheck:
    if value is None or not data_ok:
        return ConstraintCheck(
            name,
            value,
            limit,
            "<=",
            unit,
            "NOT_ASSESSED",
            None,
            "insufficient DEM coverage for this metric"
            if value is not None
            else "metric unavailable",
        )
    margin = (limit - value) / limit if limit > 0 else -value
    ok = value <= limit
    return ConstraintCheck(
        name,
        value,
        limit,
        "<=",
        unit,
        "PASS" if ok else "FAIL",
        margin,
        f"{value:.3g} {unit} {'≤' if ok else '>'} {limit:g} {unit}",
    )


def landing_zone_screen(
    metrics: TerrainMetrics, constraints: LandingZoneConstraints
) -> LandingZoneScreen:
    """Apply the configured limits; unconfigured limits are not checks and do not pass."""
    q = metrics.quality
    coverage_ok = q.coverage_fraction >= constraints.min_coverage_fraction
    checks: list[ConstraintCheck] = [
        ConstraintCheck(
            "coverage_fraction",
            q.coverage_fraction,
            constraints.min_coverage_fraction,
            ">=",
            "fraction",
            "PASS" if coverage_ok else "FAIL",
            q.coverage_fraction - constraints.min_coverage_fraction,
            f"{q.valid_node_count}/{q.neighborhood_node_count} DEM nodes available",
        )
    ]
    for name, value, limit, unit in (
        ("local_slope_deg", metrics.slope.local_slope_deg, constraints.max_local_slope_deg, "deg"),
        (
            "neighborhood_slope_deg",
            metrics.slope.neighborhood_slope_deg,
            constraints.max_neighborhood_slope_deg,
            "deg",
        ),
        ("roughness_rms_m", metrics.roughness.rms_residual_m, constraints.max_roughness_rms_m, "m"),
        ("residual_relief_m", metrics.roughness.residual_relief_m, constraints.max_relief_m, "m"),
    ):
        if limit is not None:
            checks.append(_check_max(name, value, limit, unit, coverage_ok))
    statuses = {c.status for c in checks}
    verdict: Status
    if len(checks) == 1:
        verdict = "NOT_ASSESSED"  # only data coverage was configured: no terrain criterion
    elif "FAIL" in statuses:
        verdict = "FAIL"
    elif "NOT_ASSESSED" in statuses:
        verdict = "NOT_ASSESSED"
    else:
        verdict = "PASS"
    return LandingZoneScreen(verdict, tuple(checks))
