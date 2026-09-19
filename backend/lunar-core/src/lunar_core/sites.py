import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal, cast

SiteOrigin = Literal["sample", "official", "custom"]

CUSTOM_PREFIX: str = "custom:"
CUSTOM_SEPARATOR: str = ":"
"""Not a comma: shared links list site ids separated by commas."""
CUSTOM_MAX_LATITUDE_DEG: float = -60.0
"""Custom sites are limited to the south polar region the app is built for (LOLA 60°S coverage)."""
CUSTOM_DECIMALS: int = 4
"""~3 m on the lunar surface: enough precision, and a stable id for caching and shared links."""


@dataclass(frozen=True)
class Site:
    """Candidate landing site. `sample` sites are placeholders, never presented as NASA data."""

    id: str
    name: str
    latitude_deg: float
    longitude_deg: float
    origin: SiteOrigin
    note: str

    def __post_init__(self) -> None:
        if not -90.0 <= self.latitude_deg <= 90.0:
            raise ValueError(f"{self.id}: latitude_deg out of range [-90, 90]")
        if not 0.0 <= self.longitude_deg < 360.0:
            raise ValueError(f"{self.id}: longitude_deg must be east longitude in [0, 360)")
        if self.origin not in ("sample", "official", "custom"):
            raise ValueError(f"{self.id}: unknown origin {self.origin!r}")


def custom_site(latitude_deg: float, longitude_deg: float) -> Site:
    """User-defined site (RF-17): canonical id from rounded coordinates, east longitude [0, 360)."""
    if not -90.0 <= latitude_deg <= CUSTOM_MAX_LATITUDE_DEG:
        raise ValueError(
            f"custom sites must be in the south polar region "
            f"(latitude between -90° and {CUSTOM_MAX_LATITUDE_DEG:g}°)"
        )
    if not -180.0 <= longitude_deg <= 360.0:
        raise ValueError("longitude must be between -180° and 360°")
    latitude: float = round(latitude_deg, CUSTOM_DECIMALS)
    longitude: float = round(longitude_deg % 360.0, CUSTOM_DECIMALS) % 360.0
    return Site(
        id=f"{CUSTOM_PREFIX}{latitude:g}{CUSTOM_SEPARATOR}{longitude:g}",
        name=f"Custom {abs(latitude):.2f}°S {longitude:.2f}°E",
        latitude_deg=latitude,
        longitude_deg=longitude,
        origin="custom",
        note="User-defined coordinates; flat horizon only (terrain is for catalog sites).",
    )


def parse_custom_site_id(site_id: str) -> Site:
    """Inverse of `custom_site(...).id`; raises ValueError for malformed ids or coordinates."""
    if not site_id.startswith(CUSTOM_PREFIX):
        raise ValueError(f"not a custom site id: {site_id}")
    parts: list[str] = site_id.removeprefix(CUSTOM_PREFIX).split(CUSTOM_SEPARATOR)
    if len(parts) != 2:
        raise ValueError(f"malformed custom site id: {site_id}")
    try:
        latitude: float = float(parts[0])
        longitude: float = float(parts[1])
    except ValueError as error:
        raise ValueError(f"malformed custom site id: {site_id}") from error
    return custom_site(latitude, longitude)


def load_catalog() -> tuple[Site, ...]:
    raw: str = files("lunar_core").joinpath("catalog", "sites.json").read_text(encoding="utf-8")
    entries: list[dict[str, object]] = json.loads(raw)["sites"]
    sites: tuple[Site, ...] = tuple(
        Site(
            id=str(e["id"]),
            name=str(e["name"]),
            latitude_deg=float(cast(float, e["latitude_deg"])),
            longitude_deg=float(cast(float, e["longitude_deg"])),
            origin=cast(SiteOrigin, e["origin"]),
            note=str(e["note"]),
        )
        for e in entries
    )
    ids: list[str] = [s.id for s in sites]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate site ids in catalog")
    return sites
