"""Human-readable calculation assumptions and data sources, shown in the UI (RF-09)."""

from dataclasses import dataclass

from lunar_core.analysis import Scenario
from lunar_core.kernels import KERNELS


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


def _format_step(scenario: Scenario) -> str:
    minutes: int = int(scenario.step.total_seconds() // 60)
    return f"{minutes // 60} h" if minutes % 60 == 0 else f"{minutes} min"


def assumptions_for(scenario: Scenario) -> list[Assumption]:
    step: str = _format_step(scenario)
    return [
        Assumption("horizon", "Horizon model", "Flat local horizon (terrain not modeled yet)"),
        Assumption(
            "sun_rule",
            "Sunlight",
            "Sun counts as visible when its upper limb is above the horizon",
        ),
        Assumption("earth_rule", "Direct-to-Earth", "Earth center above 0° elevation"),
        Assumption("refraction", "Refraction", "None (the Moon has no atmosphere)"),
        Assumption("time_scale", "Time", "All times in UTC"),
        Assumption("step", "Sampling step", step),
        Assumption("window_precision", "Window precision", f"Window edges are accurate to ±{step}"),
        Assumption(
            "observer_height",
            "Observer height",
            f"{scenario.observer_height_m:g} m (negligible effect on a flat horizon)",
        ),
        Assumption(
            "frame",
            "Lunar frame",
            "MOON_ME (DE421), mean radius 1737.4 km, apparent positions (light time + aberration)",
        ),
    ]


def data_sources() -> list[DataSource]:
    sources: list[DataSource] = [
        DataSource(
            name=f"NASA/JPL NAIF — {kernel.filename}", description=kernel.purpose, url=kernel.url
        )
        for kernel in KERNELS
    ]
    sources.append(
        DataSource(
            name="NASA/JPL Horizons",
            description="Reference used to validate the geometry (max error 0.05 arcsec)",
            url="https://ssd.jpl.nasa.gov/horizons/",
        )
    )
    return sources
