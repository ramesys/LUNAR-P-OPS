"""Fetch reference azimuth/elevation from JPL Horizons and store them as test fixtures."""

import json
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

HORIZONS_API: str = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODY_COMMANDS: dict[str, str] = {"SUN": "10", "EARTH": "399"}

# Arbitrary test coordinates, NOT CLPS landing sites: chosen to cover the pole, the polar
# region at several longitudes and the equator (Earth near zenith) as a frame sanity check.
TEST_POINTS: dict[str, tuple[float, float]] = {
    "pole_89.5S_0E": (-89.5, 0.0),
    "polar_85S_45E": (-85.0, 45.0),
    "polar_88S_222E": (-88.0, 222.0),
    "equator_0N_0E": (0.0, 0.0),
}
START: str = "2026-01-01 00:00"
STOP: str = "2027-01-01 00:00"
STEP: str = "1 d"


class GoldenRow(TypedDict):
    utc: str
    azimuth_deg: float
    elevation_deg: float
    daylight: bool


class GoldenCase(TypedDict):
    point: str
    latitude_deg: float
    longitude_deg: float
    body: str
    horizons_header: list[str]
    rows: list[GoldenRow]


def _query(command: str, latitude: float, longitude: float) -> str:
    params: dict[str, str] = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{longitude},{latitude},0'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "TIME_TYPE": "'UT'",
        "EXTRA_PREC": "'YES'",
        "CSV_FORMAT": "'YES'",
        "APPARENT": "'AIRLESS'",
    }
    url: str = f"{HORIZONS_API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=120) as response:
        text: str = response.read().decode("utf-8")
    return text


def _parse(text: str) -> tuple[list[str], list[GoldenRow]]:
    if "$$SOE" not in text:
        raise RuntimeError(f"Unexpected Horizons response:\n{text[:2000]}")
    header: list[str] = [
        line.strip()
        for line in text.splitlines()
        if line.startswith(
            ("Target body name", "Center body name", "Center pole/equ", "Center radii")
        )
    ]
    body: str = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows: list[GoldenRow] = []
    for line in body.strip().splitlines():
        fields: list[str] = [f.strip() for f in line.split(",")]
        timestamp: datetime = datetime.strptime(fields[0], "%Y-%b-%d %H:%M").replace(tzinfo=UTC)
        rows.append(
            GoldenRow(
                utc=timestamp.isoformat(),
                azimuth_deg=float(fields[3]),
                elevation_deg=float(fields[4]),
                # Horizons solar-presence flag: '*' = Sun's upper limb on/above the horizon.
                daylight=fields[1] == "*",
            )
        )
    return header, rows


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: clps-fetch-horizons-golden <output.json>")
    cases: list[GoldenCase] = []
    for point_name, (latitude, longitude) in TEST_POINTS.items():
        for body_name, command in BODY_COMMANDS.items():
            print(f"querying Horizons: {body_name} from {point_name}")
            header, rows = _parse(_query(command, latitude, longitude))
            cases.append(
                GoldenCase(
                    point=point_name,
                    latitude_deg=latitude,
                    longitude_deg=longitude,
                    body=body_name,
                    horizons_header=header,
                    rows=rows,
                )
            )
    document: dict[str, object] = {
        "source": HORIZONS_API,
        "retrieved_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "settings": "OBSERVER, QUANTITIES=4 (apparent az/el), APPARENT=AIRLESS, TIME_TYPE=UT",
        "cases": cases,
    }
    output: Path = Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
