import os
from pathlib import Path

import pytest
from lunar_core.kernels import load_kernels

REPO_ROOT: Path = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def kernels_loaded() -> None:
    data_dir: Path = Path(os.environ.get("CLPS_DATA_DIR", REPO_ROOT / "data"))
    load_kernels(data_dir / "kernels")
