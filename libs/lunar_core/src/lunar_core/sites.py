import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal, cast

SiteOrigin = Literal["sample", "official"]


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
        if self.origin not in ("sample", "official"):
            raise ValueError(f"{self.id}: unknown origin {self.origin!r}")


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
