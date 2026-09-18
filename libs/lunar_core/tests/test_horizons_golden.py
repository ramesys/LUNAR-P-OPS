"""Golden test: SPICE az/el vs. JPL Horizons (fixture from clps-fetch-horizons-golden)."""

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from lunar_core.geometry import (
    Body,
    HorizontalPosition,
    SurfacePoint,
    angular_separation_deg,
    horizontal_positions,
)
from lunar_core.visibility import (
    SUN_RADIUS_KM,
    apparent_semidiameter_deg,
    sun_upper_limb_visible,
)

GOLDEN_FILE: Path = Path(__file__).parent / "golden" / "horizons_2026.json"
# Measured max error was 0.05 arcsec (ADR 0005); 1 arcsec still catches any frame/time mistake.
TOLERANCE_DEG: float = 1.0 / 3600.0

CASES: list[dict[str, Any]] = json.loads(GOLDEN_FILE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.usefixtures("kernels_loaded")
@pytest.mark.parametrize("case", CASES, ids=[f"{c['point']}-{c['body']}" for c in CASES])
def test_matches_horizons(case: dict[str, Any]):
    point = SurfacePoint(latitude_deg=case["latitude_deg"], longitude_deg=case["longitude_deg"])
    times = [datetime.fromisoformat(row["utc"]) for row in case["rows"]]

    computed = horizontal_positions(Body(case["body"]), point, times)

    errors = [
        angular_separation_deg(
            got, HorizontalPosition(row["azimuth_deg"], row["elevation_deg"], math.nan)
        )
        for got, row in zip(computed, case["rows"], strict=True)
    ]
    assert len(errors) > 300
    assert max(errors) < TOLERANCE_DEG


SUN_CASES: list[dict[str, Any]] = [c for c in CASES if c["body"] == "SUN"]


@pytest.mark.usefixtures("kernels_loaded")
@pytest.mark.parametrize("case", SUN_CASES, ids=[c["point"] for c in SUN_CASES])
def test_sun_rule_matches_horizons_daylight_flag(case: dict[str, Any]):
    point = SurfacePoint(latitude_deg=case["latitude_deg"], longitude_deg=case["longitude_deg"])
    times = [datetime.fromisoformat(row["utc"]) for row in case["rows"]]

    computed = horizontal_positions(Body.SUN, point, times)

    mismatches = [
        (row["utc"], position.elevation_deg)
        for position, row in zip(computed, case["rows"], strict=True)
        if sun_upper_limb_visible(position) != row["daylight"]
        # A sample sitting exactly on the threshold may flip within the geometric error.
        and abs(
            position.elevation_deg + apparent_semidiameter_deg(SUN_RADIUS_KM, position.distance_km)
        )
        > 1e-3
    ]
    assert mismatches == []
