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
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    profile TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
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

    def _decode_user(self, row: sqlite3.Row) -> dict[str, Any]:
        raw_profile = row["profile"] or "{}"
        try:
            profile = json.loads(raw_profile)
        except json.JSONDecodeError:
            profile = {}

        return {
            "id": row["id"],
            "email": row["email"],
            "displayName": row["display_name"],
            "passwordHash": row["password_hash"],
            "profile": profile,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "lastLoginAt": row["last_login_at"],
        }

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

    def create_user(
        self,
        user_id: str,
        email: str,
        display_name: str,
        password_hash: str,
        profile: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        encoded_profile = json.dumps(profile or {}, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO users(id, email, display_name, password_hash, profile, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, display_name, password_hash, encoded_profile, now, now),
            )
        user = self.get_user_by_id(user_id)
        if user is None:
            raise RuntimeError("created user could not be loaded")
        return user

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, email, display_name, password_hash, profile, created_at, updated_at, last_login_at
                FROM users
                WHERE lower(email) = lower(?)
                """,
                (email,),
            ).fetchone()
        return self._decode_user(row) if row else None

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, email, display_name, password_hash, profile, created_at, updated_at, last_login_at
                FROM users
                WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
        return self._decode_user(row) if row else None

    def mark_user_login(self, user_id: str) -> None:
        now = utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE users
                SET last_login_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (now, now, user_id),
            )

    def update_user_profile(
        self,
        user_id: str,
        profile: dict[str, Any],
        display_name: str | None = None,
    ) -> dict[str, Any] | None:
        encoded_profile = json.dumps(profile, ensure_ascii=False)
        now = utc_now()
        with self._lock, self._connect() as conn:
            if display_name:
                conn.execute(
                    """
                    UPDATE users
                    SET profile = ?, display_name = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (encoded_profile, display_name, now, user_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE users
                    SET profile = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (encoded_profile, now, user_id),
                )
        return self.get_user_by_id(user_id)

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
