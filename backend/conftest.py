"""Test defaults for running pytest from backend/: shared data lives in the repository's data/."""

import os
from pathlib import Path

os.environ.setdefault("CLPS_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))
