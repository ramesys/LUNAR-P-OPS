from datetime import UTC, datetime, timedelta
from itertools import pairwise

import numpy as np
import pytest
from lunar_core.analysis import (
    Scenario,
    ScenarioResult,
    SiteAnalysis,
    SiteMetrics,
    analyze,
    rank,
)
from lunar_core.horizon import HorizonMask
from lunar_core.sites import Site, load_catalog

T0 = datetime(2026, 1, 1, tzinfo=UTC)
CATALOG = load_catalog()
A, B, C, D, E = CATALOG[:5]


def test_catalog_contains_only_marked_sample_sites():
    assert len(CATALOG) >= 4
    assert all(site.origin == "sample" for site in CATALOG)


def test_site_rejects_west_longitude():
    with pytest.raises(ValueError, match="east longitude"):
        Site("x", "X", -89.0, -10.0, "sample", "")


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"sites": (A,)}, "between 2 and 4"),
        ({"sites": (A, B, C, D, E)}, "between 2 and 4"),
        ({"sites": (A, A)}, "must not repeat"),
        ({"end": T0}, "after start"),
        ({"end": T0 + timedelta(days=367)}, "at most one year"),
        ({"start": datetime(2026, 1, 1), "end": datetime(2026, 1, 2)}, "timezone-aware"),
        ({"step": timedelta(seconds=30)}, "at least 1 minute"),
        ({"step": timedelta(minutes=10), "end": T0 + timedelta(days=90)}, "too many samples"),
        ({"observer_height_m": -1.0}, ">= 0"),
    ],
)
def test_scenario_validation(kwargs: dict[str, object], message: str):
    base: dict[str, object] = {"sites": (A, B), "start": T0, "end": T0 + timedelta(days=1)}
    with pytest.raises(ValueError, match=message):
        Scenario(**{**base, **kwargs})  # type: ignore[arg-type]


def test_sample_times_cover_half_open_range_with_partial_last_step():
    scenario = Scenario(sites=(A, B), start=T0, end=T0 + timedelta(hours=2, minutes=30))

    assert scenario.sample_times() == [T0, T0 + timedelta(hours=1), T0 + timedelta(hours=2)]


def fake_analysis(site: Site, sun_fraction: float) -> SiteAnalysis:
    metrics = SiteMetrics(sun_fraction, 0.0, None, None)
    return SiteAnalysis(site, None, [], [], [], [], [], [], metrics)


def test_rank_orders_by_sun_fraction_and_keeps_catalog_order_on_ties():
    ranked = rank([fake_analysis(A, 0.5), fake_analysis(B, 0.9), fake_analysis(C, 0.5)])

    assert [a.site.id for a in ranked] == [B.id, A.id, C.id]


@pytest.mark.usefixtures("kernels_loaded")
def test_analyze_produces_consistent_windows_and_metrics():
    scenario = Scenario(sites=(A, CATALOG[-1]), start=T0, end=T0 + timedelta(days=30))

    result: ScenarioResult = analyze(scenario)

    assert len(result.times) == 30 * 24
    for analysis in result.ranked:
        assert len(analysis.sun) == len(analysis.earth) == len(result.times)
        for windows in (analysis.sun_windows, analysis.earth_windows):
            assert windows[0].start == scenario.start
            assert windows[-1].end == scenario.end
            assert all(a.end == b.start for a, b in pairwise(windows))
        lit = sum((w.duration for w in analysis.sun_windows if w.visible), timedelta())
        assert lit / (scenario.end - scenario.start) == pytest.approx(analysis.metrics.sun_fraction)
        assert 0.0 <= analysis.metrics.earth_fraction <= 1.0
    fractions = [a.metrics.sun_fraction for a in result.ranked]
    assert fractions == sorted(fractions, reverse=True)


def uniform_mask(elevation_deg: float) -> HorizonMask:
    return HorizonMask(
        azimuths_deg=np.arange(0.0, 360.0, 90.0), elevations_deg=np.full(4, elevation_deg)
    )


def two_week_scenario(**overrides: object) -> Scenario:
    base: dict[str, object] = {"sites": (A, B), "start": T0, "end": T0 + timedelta(days=14)}
    return Scenario(**{**base, **overrides})  # type: ignore[arg-type]


def by_id(result: ScenarioResult) -> dict[str, SiteAnalysis]:
    return {a.site.id: a for a in result.ranked}


@pytest.mark.usefixtures("kernels_loaded")
def test_terrain_masks_block_or_clear_the_sky_and_missing_masks_fall_back_to_flat():
    flat = by_id(analyze(two_week_scenario(horizon_model="flat")))
    result = by_id(analyze(two_week_scenario(), {A.id: uniform_mask(45.0)}))

    walled = result[A.id]
    assert walled.horizon_mask is not None
    assert walled.metrics.sun_fraction == 0.0
    assert walled.metrics.earth_fraction == 0.0
    assert walled.sun_horizon_deg == [45.0] * len(walled.sun)
    fallback = result[B.id]
    assert fallback.horizon_mask is None
    assert fallback.metrics == flat[B.id].metrics
    assert set(fallback.earth_horizon_deg) == {0.0}

    open_sky = by_id(analyze(two_week_scenario(), {A.id: uniform_mask(-5.0)}))[A.id]
    assert open_sky.metrics.sun_fraction >= flat[A.id].metrics.sun_fraction
    assert open_sky.metrics.earth_fraction >= flat[A.id].metrics.earth_fraction


@pytest.mark.usefixtures("kernels_loaded")
def test_flat_model_ignores_masks_and_earth_clearance_reduces_dte():
    ignored = by_id(analyze(two_week_scenario(horizon_model="flat"), {A.id: uniform_mask(45.0)}))
    assert ignored[A.id].horizon_mask is None
    assert ignored[A.id].metrics.sun_fraction > 0.0

    base = by_id(analyze(two_week_scenario(horizon_model="flat")))[A.id]
    strict = by_id(analyze(two_week_scenario(horizon_model="flat", earth_min_clearance_deg=3.0)))[
        A.id
    ]
    assert strict.metrics.earth_fraction < base.metrics.earth_fraction
    assert strict.metrics.sun_fraction == base.metrics.sun_fraction


def test_earth_clearance_is_validated():
    with pytest.raises(ValueError, match="Earth clearance"):
        two_week_scenario(earth_min_clearance_deg=11.0)
