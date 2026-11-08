"""Append-only completed adaptive experiment snapshots, independent of candidate retention."""

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

from clps_api import candidate_store
from clps_api.schemas import BrushExecutionOut


def save(execution: BrushExecutionOut) -> BrushExecutionOut:
    content = execution.model_dump(mode="json", exclude={"experiment_id"})
    digest = hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    record = execution.model_copy(update={"experiment_id": f"brush-{digest}"})
    payload = record.model_dump_json()
    with closing(candidate_store.connect()) as db, db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS brush_experiments "
            "(id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
        )
        db.execute(
            "INSERT OR IGNORE INTO brush_experiments VALUES (?, ?)", (record.experiment_id, payload)
        )
        row = db.execute(
            "SELECT payload FROM brush_experiments WHERE id = ?", (record.experiment_id,)
        ).fetchone()
        if row is None or BrushExecutionOut.model_validate_json(row[0]) != record:
            raise ValueError("brush experiment identity collision")
    return record


def get(experiment_id: str) -> BrushExecutionOut | None:
    path = Path(os.environ.get("CLPS_DATA_DIR", "data")) / "candidates.sqlite3"
    if not path.is_file():
        return None
    with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        if not db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='brush_experiments'"
        ).fetchone():
            return None
        row = db.execute(
            "SELECT payload FROM brush_experiments WHERE id = ?", (experiment_id,)
        ).fetchone()
    return None if row is None else BrushExecutionOut.model_validate_json(row[0])
