from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any

from .schemas import ApiEvent, utc_now


class Storage:
    def __init__(self, db_path: str | Path = "backend/diet_planner.db") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS records (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS api_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    type TEXT NOT NULL,
                    trace_id TEXT NOT NULL,
                    route TEXT NOT NULL,
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    message TEXT NOT NULL,
                    at TEXT NOT NULL
                )
                """
            )

    def save_record(self, key: str, value: dict[str, Any]) -> None:
        encoded = json.dumps(value, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO records(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, encoded, utc_now()),
            )

    def get_record(self, key: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM records WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def record_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM records").fetchone()
        return int(row["count"])

    def save_event(self, event: ApiEvent) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO api_events(type, trace_id, route, source, target, message, at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (event.type, event.traceId, event.route, event.source, event.target, event.message, event.at),
            )

    def list_events(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT type, trace_id, route, source, target, message, at
                FROM api_events
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
