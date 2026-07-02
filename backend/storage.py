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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_orders (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    plan_name TEXT NOT NULL,
                    amount_cny REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    channel TEXT NOT NULL DEFAULT 'demo-checkout',
                    payment_method TEXT NOT NULL DEFAULT 'demo',
                    payload TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    paid_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_subscriptions (
                    user_id TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    plan_name TEXT NOT NULL,
                    entitlement TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    expires_at TEXT,
                    source_order_id TEXT,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(source_order_id) REFERENCES subscription_orders(id) ON DELETE SET NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS diet_plans (
                    user_id TEXT NOT NULL,
                    plan_date TEXT NOT NULL,
                    period TEXT NOT NULL,
                    profile TEXT NOT NULL,
                    plans TEXT NOT NULL,
                    plan_discussion TEXT NOT NULL DEFAULT '{}',
                    plan_constraints TEXT NOT NULL DEFAULT '{}',
                    metrics TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, plan_date),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS diet_checkins (
                    user_id TEXT NOT NULL,
                    plan_date TEXT NOT NULL,
                    status TEXT NOT NULL,
                    selected_plan_index INTEGER NOT NULL DEFAULT 0,
                    plan_name TEXT NOT NULL DEFAULT '',
                    menu_snapshot TEXT NOT NULL DEFAULT '{}',
                    note TEXT NOT NULL DEFAULT '',
                    checked_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, plan_date),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS history_menus (
                    user_id TEXT NOT NULL,
                    plan_date TEXT NOT NULL,
                    period TEXT NOT NULL,
                    selected_plan_index INTEGER NOT NULL DEFAULT 0,
                    plan_name TEXT NOT NULL DEFAULT '',
                    profile TEXT NOT NULL DEFAULT '{}',
                    menu_snapshot TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, plan_date),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )

    def _decode_user(self, row: sqlite3.Row) -> dict[str, Any]:
        profile = self._decode_json(row["profile"], {})

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

    def _decode_subscription_order(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "userId": row["user_id"],
            "planId": row["plan_id"],
            "planName": row["plan_name"],
            "amountCny": row["amount_cny"],
            "status": row["status"],
            "channel": row["channel"],
            "paymentMethod": row["payment_method"],
            "payload": self._decode_json(row["payload"], {}),
            "createdAt": row["created_at"],
            "paidAt": row["paid_at"],
        }

    def _decode_user_subscription(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "userId": row["user_id"],
            "planId": row["plan_id"],
            "planName": row["plan_name"],
            "entitlement": row["entitlement"],
            "status": row["status"],
            "startedAt": row["started_at"],
            "expiresAt": row["expires_at"],
            "sourceOrderId": row["source_order_id"],
            "updatedAt": row["updated_at"],
        }

    def _decode_json(self, raw_value: str | None, fallback: Any) -> Any:
        try:
            return json.loads(raw_value or "")
        except json.JSONDecodeError:
            if isinstance(fallback, dict):
                return dict(fallback)
            if isinstance(fallback, list):
                return list(fallback)
            return fallback

    def _decode_diet_plan(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "userId": row["user_id"],
            "planDate": row["plan_date"],
            "period": row["period"],
            "profile": self._decode_json(row["profile"], {}),
            "plans": self._decode_json(row["plans"], []),
            "planDiscussion": self._decode_json(row["plan_discussion"], {}),
            "planConstraints": self._decode_json(row["plan_constraints"], {}),
            "metrics": self._decode_json(row["metrics"], {}),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _decode_diet_checkin(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "userId": row["user_id"],
            "planDate": row["plan_date"],
            "status": row["status"],
            "selectedPlanIndex": row["selected_plan_index"],
            "planName": row["plan_name"],
            "menuSnapshot": self._decode_json(row["menu_snapshot"], {}),
            "note": row["note"],
            "checkedAt": row["checked_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def _decode_history_menu(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "userId": row["user_id"],
            "planDate": row["plan_date"],
            "period": row["period"],
            "selectedPlanIndex": row["selected_plan_index"],
            "planName": row["plan_name"],
            "profile": self._decode_json(row["profile"], {}),
            "menuSnapshot": self._decode_json(row["menu_snapshot"], {}),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
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

    def create_subscription_order(
        self,
        order_id: str,
        user_id: str,
        plan_id: str,
        plan_name: str,
        amount_cny: float,
        status: str = "paid",
        channel: str = "demo-checkout",
        payment_method: str = "demo",
        payload: dict[str, Any] | None = None,
        paid_at: str | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        encoded_payload = json.dumps(payload or {}, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO subscription_orders(
                    id, user_id, plan_id, plan_name, amount_cny, status, channel,
                    payment_method, payload, created_at, paid_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    user_id,
                    plan_id,
                    plan_name,
                    amount_cny,
                    status,
                    channel,
                    payment_method,
                    encoded_payload,
                    now,
                    paid_at or now,
                ),
            )
        order = self.get_subscription_order(user_id, order_id)
        if order is None:
            raise RuntimeError("created subscription order could not be loaded")
        return order

    def get_subscription_order(self, user_id: str, order_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, user_id, plan_id, plan_name, amount_cny, status, channel,
                       payment_method, payload, created_at, paid_at
                FROM subscription_orders
                WHERE user_id = ? AND id = ?
                """,
                (user_id, order_id),
            ).fetchone()
        return self._decode_subscription_order(row) if row else None

    def list_subscription_orders(self, user_id: str, limit: int = 10) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, user_id, plan_id, plan_name, amount_cny, status, channel,
                       payment_method, payload, created_at, paid_at
                FROM subscription_orders
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [self._decode_subscription_order(row) for row in rows]

    def upsert_user_subscription(
        self,
        user_id: str,
        plan_id: str,
        plan_name: str,
        entitlement: str,
        status: str,
        started_at: str,
        expires_at: str | None,
        source_order_id: str | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO user_subscriptions(
                    user_id, plan_id, plan_name, entitlement, status, started_at,
                    expires_at, source_order_id, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    plan_id = excluded.plan_id,
                    plan_name = excluded.plan_name,
                    entitlement = excluded.entitlement,
                    status = excluded.status,
                    started_at = excluded.started_at,
                    expires_at = excluded.expires_at,
                    source_order_id = excluded.source_order_id,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    plan_id,
                    plan_name,
                    entitlement,
                    status,
                    started_at,
                    expires_at,
                    source_order_id,
                    now,
                ),
            )
        subscription = self.get_user_subscription(user_id)
        if subscription is None:
            raise RuntimeError("saved user subscription could not be loaded")
        return subscription

    def get_user_subscription(self, user_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT user_id, plan_id, plan_name, entitlement, status, started_at,
                       expires_at, source_order_id, updated_at
                FROM user_subscriptions
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        return self._decode_user_subscription(row) if row else None

    def update_user_subscription_status(self, user_id: str, status: str) -> dict[str, Any] | None:
        now = utc_now()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE user_subscriptions
                SET status = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (status, now, user_id),
            )
        return self.get_user_subscription(user_id)

    def save_diet_plan(
        self,
        user_id: str,
        plan_date: str,
        period: str,
        profile: dict[str, Any],
        plans: list[dict[str, Any]],
        plan_discussion: dict[str, Any] | None = None,
        plan_constraints: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        encoded_profile = json.dumps(profile, ensure_ascii=False)
        encoded_plans = json.dumps(plans, ensure_ascii=False)
        encoded_discussion = json.dumps(plan_discussion or {}, ensure_ascii=False)
        encoded_constraints = json.dumps(plan_constraints or {}, ensure_ascii=False)
        encoded_metrics = json.dumps(metrics or {}, ensure_ascii=False)

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO diet_plans(
                    user_id, plan_date, period, profile, plans, plan_discussion,
                    plan_constraints, metrics, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, plan_date) DO UPDATE SET
                    period = excluded.period,
                    profile = excluded.profile,
                    plans = excluded.plans,
                    plan_discussion = excluded.plan_discussion,
                    plan_constraints = excluded.plan_constraints,
                    metrics = excluded.metrics,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    plan_date,
                    period,
                    encoded_profile,
                    encoded_plans,
                    encoded_discussion,
                    encoded_constraints,
                    encoded_metrics,
                    now,
                    now,
                ),
            )

        saved = self.get_diet_plan(user_id, plan_date)
        if saved is None:
            raise RuntimeError("saved diet plan could not be loaded")
        return saved

    def get_diet_plan(self, user_id: str, plan_date: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT user_id, plan_date, period, profile, plans, plan_discussion,
                       plan_constraints, metrics, created_at, updated_at
                FROM diet_plans
                WHERE user_id = ? AND plan_date = ?
                """,
                (user_id, plan_date),
            ).fetchone()
        return self._decode_diet_plan(row) if row else None

    def list_diet_plans(self, user_id: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT user_id, plan_date, period, profile, plans, plan_discussion,
                       plan_constraints, metrics, created_at, updated_at
                FROM diet_plans
                WHERE user_id = ? AND plan_date >= ? AND plan_date <= ?
                ORDER BY plan_date ASC
                """,
                (user_id, start_date, end_date),
            ).fetchall()
        return [self._decode_diet_plan(row) for row in rows]

    def save_diet_checkin(
        self,
        user_id: str,
        plan_date: str,
        status: str,
        selected_plan_index: int,
        plan_name: str,
        menu_snapshot: dict[str, Any],
        note: str = "",
        checked_at: str | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        encoded_menu = json.dumps(menu_snapshot or {}, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO diet_checkins(
                    user_id, plan_date, status, selected_plan_index, plan_name,
                    menu_snapshot, note, checked_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, plan_date) DO UPDATE SET
                    status = excluded.status,
                    selected_plan_index = excluded.selected_plan_index,
                    plan_name = excluded.plan_name,
                    menu_snapshot = excluded.menu_snapshot,
                    note = excluded.note,
                    checked_at = excluded.checked_at,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    plan_date,
                    status,
                    selected_plan_index,
                    plan_name,
                    encoded_menu,
                    note,
                    checked_at or now,
                    now,
                    now,
                ),
            )

        saved = self.get_diet_checkin(user_id, plan_date)
        if saved is None:
            raise RuntimeError("saved diet checkin could not be loaded")
        return saved

    def get_diet_checkin(self, user_id: str, plan_date: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT user_id, plan_date, status, selected_plan_index, plan_name,
                       menu_snapshot, note, checked_at, created_at, updated_at
                FROM diet_checkins
                WHERE user_id = ? AND plan_date = ?
                """,
                (user_id, plan_date),
            ).fetchone()
        return self._decode_diet_checkin(row) if row else None

    def list_diet_checkins(self, user_id: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT user_id, plan_date, status, selected_plan_index, plan_name,
                       menu_snapshot, note, checked_at, created_at, updated_at
                FROM diet_checkins
                WHERE user_id = ? AND plan_date >= ? AND plan_date <= ?
                ORDER BY plan_date ASC
                """,
                (user_id, start_date, end_date),
            ).fetchall()
        return [self._decode_diet_checkin(row) for row in rows]

    def save_history_menu(
        self,
        user_id: str,
        plan_date: str,
        period: str,
        selected_plan_index: int,
        plan_name: str,
        profile: dict[str, Any],
        menu_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        now = utc_now()
        encoded_profile = json.dumps(profile or {}, ensure_ascii=False)
        encoded_menu = json.dumps(menu_snapshot or {}, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO history_menus(
                    user_id, plan_date, period, selected_plan_index, plan_name,
                    profile, menu_snapshot, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, plan_date) DO UPDATE SET
                    period = excluded.period,
                    selected_plan_index = excluded.selected_plan_index,
                    plan_name = excluded.plan_name,
                    profile = excluded.profile,
                    menu_snapshot = excluded.menu_snapshot,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    plan_date,
                    period,
                    selected_plan_index,
                    plan_name,
                    encoded_profile,
                    encoded_menu,
                    now,
                    now,
                ),
            )

        saved = self.get_history_menu(user_id, plan_date)
        if saved is None:
            raise RuntimeError("saved history menu could not be loaded")
        return saved

    def get_history_menu(self, user_id: str, plan_date: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT user_id, plan_date, period, selected_plan_index, plan_name,
                       profile, menu_snapshot, created_at, updated_at
                FROM history_menus
                WHERE user_id = ? AND plan_date = ?
                """,
                (user_id, plan_date),
            ).fetchone()
        return self._decode_history_menu(row) if row else None

    def list_history_menus(self, user_id: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT user_id, plan_date, period, selected_plan_index, plan_name,
                       profile, menu_snapshot, created_at, updated_at
                FROM history_menus
                WHERE user_id = ? AND plan_date >= ? AND plan_date <= ?
                ORDER BY plan_date ASC
                """,
                (user_id, start_date, end_date),
            ).fetchall()
        return [self._decode_history_menu(row) for row in rows]

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
