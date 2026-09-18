"""Golden test: SPICE az/el vs. JPL Horizons (fixture from clps-fetch-horizons-golden)."""

import json
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
        angular_separation_deg(got, HorizontalPosition(row["azimuth_deg"], row["elevation_deg"]))
        for got, row in zip(computed, case["rows"], strict=True)
    ]
    assert len(errors) > 300
    assert max(errors) < TOLERANCE_DEG
