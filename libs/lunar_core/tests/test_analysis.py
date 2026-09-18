from datetime import UTC, datetime, timedelta
from itertools import pairwise

import pytest
from lunar_core.analysis import (
    Scenario,
    ScenarioResult,
    SiteAnalysis,
    SiteMetrics,
    analyze,
    rank,
)
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
    return SiteAnalysis(site, [], [], [], [], metrics)


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
