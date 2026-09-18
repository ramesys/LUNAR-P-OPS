"""Human-readable calculation assumptions and data sources, shown in the UI (RF-09)."""

from dataclasses import dataclass

from lunar_core.analysis import ScenarioResult
from lunar_core.kernels import KERNELS

LOLA_PRODUCT_URL: str = "https://pgda.gsfc.nasa.gov/products/90"


@dataclass(frozen=True)
class Assumption:
    key: str
    label: str
    value: str


@dataclass(frozen=True)
class DataSource:
    name: str
    description: str
    url: str


def _format_step(minutes: int) -> str:
    return f"{minutes // 60} h" if minutes % 60 == 0 else f"{minutes} min"


def _horizon_text(result: ScenarioResult) -> str:
    if result.scenario.horizon_model == "flat":
        return "Flat local horizon (terrain ignored, as requested)"
    with_terrain: int = sum(1 for a in result.ranked if a.horizon_mask is not None)
    total: int = len(result.ranked)
    terrain: str = (
        "LOLA terrain horizon: 20 m/px within 8 km, 240 m/px out to 200 km, 0.5° azimuth steps"
    )
    if with_terrain == total:
        return terrain
    if with_terrain == 0:
        return "Flat local horizon: terrain data is not available for these sites"
    return f"{terrain} for {with_terrain} of {total} sites; flat horizon for the rest"


def assumptions_for(result: ScenarioResult) -> list[Assumption]:
    scenario = result.scenario
    step: str = _format_step(int(scenario.step.total_seconds() // 60))
    clearance: float = scenario.earth_min_clearance_deg
    earth_rule: str = (
        "Earth center above the horizon"
        if clearance == 0.0
        else f"Earth center at least {clearance:g}° above the horizon"
    )
    return [
        Assumption("horizon", "Horizon model", _horizon_text(result)),
        Assumption(
            "sun_rule",
            "Sunlight",
            "Sun counts as visible when its upper limb is above the horizon",
        ),
        Assumption("earth_rule", "Direct-to-Earth", earth_rule),
        Assumption("refraction", "Refraction", "None (the Moon has no atmosphere)"),
        Assumption("time_scale", "Time", "All times in UTC"),
        Assumption("step", "Sampling step", step),
        Assumption("window_precision", "Window precision", f"Window edges are accurate to ±{step}"),
        Assumption(
            "observer_height",
            "Observer height",
            f"{scenario.observer_height_m:g} m above the ground (raises the viewpoint over "
            "nearby terrain)",
        ),
        Assumption(
            "frame",
            "Lunar frame",
            "MOON_ME (DE421), mean radius 1737.4 km, apparent positions (light time + aberration)",
        ),
    ]


def data_sources(result: ScenarioResult) -> list[DataSource]:
    sources: list[DataSource] = [
        DataSource(
            name=f"NASA/JPL NAIF — {kernel.filename}", description=kernel.purpose, url=kernel.url
        )
        for kernel in KERNELS
    ]
    if any(a.horizon_mask is not None for a in result.ranked):
        sources.append(
            DataSource(
                name="NASA GSFC PGDA — LOLA south pole DEMs",
                description=(
                    "LDEM_80S_20MPP_ADJ and LDEM_60S_240MPP_ADJ (Barker et al. 2023), "
                    "used for the terrain horizon"
                ),
                url=LOLA_PRODUCT_URL,
            )
        )
    sources.append(
        DataSource(
            name="NASA/JPL Horizons",
            description="Reference used to validate the geometry (max error 0.05 arcsec)",
            url="https://ssd.jpl.nasa.gov/horizons/",
        )
    )
    return sources
