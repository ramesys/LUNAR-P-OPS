from dataclasses import dataclass
from pathlib import Path

import spiceypy as spice

NAIF_GENERIC_KERNELS: str = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"


@dataclass(frozen=True)
class KernelFile:
    filename: str
    url: str
    md5: str | None
    purpose: str


# MOON_ME is taken from the DE421 lunar frame kernels because the LOLA DEMs are referenced to it.
KERNELS: tuple[KernelFile, ...] = (
    KernelFile(
        filename="naif0012.tls",
        url=f"{NAIF_GENERIC_KERNELS}/lsk/naif0012.tls",
        md5=None,
        purpose="Leap seconds (UTC <-> TDB)",
    ),
    KernelFile(
        filename="pck00011.tpc",
        url=f"{NAIF_GENERIC_KERNELS}/pck/pck00011.tpc",
        md5=None,
        purpose="Body constants (lunar radius)",
    ),
    KernelFile(
        filename="moon_pa_de421_1900-2050.bpc",
        url=f"{NAIF_GENERIC_KERNELS}/pck/moon_pa_de421_1900-2050.bpc",
        md5=None,
        purpose="Lunar orientation (DE421 principal axes)",
    ),
    KernelFile(
        filename="moon_080317.tf",
        url=f"{NAIF_GENERIC_KERNELS}/fk/satellites/moon_080317.tf",
        md5=None,
        purpose="Lunar frames MOON_PA / MOON_ME (DE421)",
    ),
    KernelFile(
        filename="de440s.bsp",
        url=f"{NAIF_GENERIC_KERNELS}/spk/planets/de440s.bsp",
        md5="3917ee56769db332790c751e2168843d",
        purpose="Planetary ephemeris DE440 (Sun, Earth, Moon positions)",
    ),
)


def missing_kernels(kernel_dir: Path) -> list[str]:
    return [k.filename for k in KERNELS if not (kernel_dir / k.filename).is_file()]


def load_kernels(kernel_dir: Path) -> None:
    missing: list[str] = missing_kernels(kernel_dir)
    if missing:
        raise FileNotFoundError(
            f"Missing SPICE kernels in {kernel_dir}: {', '.join(missing)}. Run `make fetch-data`."
        )
    spice.kclear()
    for kernel in KERNELS:
        spice.furnsh(str(kernel_dir / kernel.filename))
