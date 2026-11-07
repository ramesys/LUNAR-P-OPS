"""Append-only SQLite storage of candidate snapshots and their ancestry."""

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import UTC
from pathlib import Path

from clps_api.schemas import CandidateEvolutionRequest, CandidateOut


def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("CLPS_DATA_DIR", "data")) / "candidates.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS candidates "
        "(id TEXT PRIMARY KEY, parent TEXT, payload TEXT NOT NULL)"
    )
    return connection


def save(candidate: CandidateOut) -> CandidateOut:
    payload = candidate.model_dump_json()
    with closing(connect()) as db, db:
        db.execute(
            "INSERT OR IGNORE INTO candidates (id, parent, payload) VALUES (?, ?, ?)",
            (candidate.candidate_id, candidate.parent_candidate_id, payload),
        )
        row = db.execute(
            "SELECT payload FROM candidates WHERE id = ?", (candidate.candidate_id,)
        ).fetchone()
        if row is None or CandidateOut.model_validate_json(row[0]) != candidate:
            raise ValueError("candidate identity collision")
    return candidate


def get(candidate_id: str) -> CandidateOut | None:
    with closing(connect()) as db:
        row = db.execute("SELECT payload FROM candidates WHERE id = ?", (candidate_id,)).fetchone()
    return None if row is None else CandidateOut.model_validate_json(row[0])


def children(candidate_id: str) -> list[CandidateOut]:
    with closing(connect()) as db:
        rows = db.execute(
            "SELECT payload FROM candidates WHERE parent = ? ORDER BY rowid", (candidate_id,)
        ).fetchall()
    return [CandidateOut.model_validate_json(row[0]) for row in rows]


def evolve(parent: CandidateOut, request: CandidateEvolutionRequest) -> CandidateOut:
    instant = request.selected_time_utc.astimezone(UTC)
    signature = json.dumps(
        {
            "parent_candidate_id": parent.candidate_id,
            "observer_height_m": request.observer_height_m,
            "selected_time_utc": instant.isoformat(),
        },
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    identifier = hashlib.sha256(signature.encode()).hexdigest()
    return save(
        parent.model_copy(
            update={
                "candidate_id": f"candidate-{identifier}",
                "parent_candidate_id": parent.candidate_id,
                "observer_height_m": request.observer_height_m,
                "selected_time_utc": instant,
            }
        )
    )
