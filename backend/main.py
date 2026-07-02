from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import load_local_env
from .providers import CloudProviderClient
from .schemas import (
    ApiEnvelope,
    ApiResponse,
    AuthLoginRequest,
    AuthRegisterRequest,
    DietCheckinSaveRequest,
    DietPlanSaveRequest,
    HealthResponse,
    HistoryMenuSaveRequest,
    SubscriptionCheckoutRequest,
    UserProfileUpdate,
)
from .services import build_diet_plans, build_ingredients, build_marketing, create_profile, score_plans
from .storage import Storage
from .switch import ApiSwitch


APP_VERSION = "0.3.0"
ROOT = Path(__file__).resolve().parents[1]
PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 260_000
AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14

BUSINESS_PLANS: dict[str, dict[str, Any]] = {
    "free": {
        "id": "free",
        "name": "免费体验版",
        "amountCny": 0,
        "billingCycle": "none",
        "durationDays": 0,
        "entitlement": "free",
        "description": "适合体验核心问卷和单日饮食计划。",
        "features": ["单日基础方案", "本地计划记录", "基础采购清单"],
    },
    "pro_month": {
        "id": "pro_month",
        "name": "Pro 月会员",
        "amountCny": 19.9,
        "billingCycle": "month",
        "durationDays": 31,
        "entitlement": "pro",
        "description": "适合连续执行和周期复盘。",
        "features": ["一周/一个月计划", "周期合并采购清单", "打卡历史复盘", "分享报告导出", "端侧离线方案"],
    },
    "pro_year": {
        "id": "pro_year",
        "name": "Pro 年会员",
        "amountCny": 199,
        "billingCycle": "year",
        "durationDays": 366,
        "entitlement": "pro",
        "description": "适合长期健康管理和复购服务。",
        "features": ["Pro 全部权益", "年度健康饮食档案", "商家套餐优先推荐", "长期趋势报告"],
    },
}

ENTITLEMENT_LIMITS: dict[str, dict[str, Any]] = {
    "free": {
        "planPeriods": ["day"],
        "maxRangeDays": 1,
        "rangeShopping": False,
        "historyReview": False,
        "shareExport": False,
        "edgeOffline": False,
    },
    "pro": {
        "planPeriods": ["day", "week", "month"],
        "maxRangeDays": 30,
        "rangeShopping": True,
        "historyReview": True,
        "shareExport": True,
        "edgeOffline": True,
    },
}

load_local_env()

storage = Storage(os.getenv("DIET_PLANNER_DB", "backend/diet_planner.db"))
providers = CloudProviderClient()
switch = ApiSwitch(storage)


async def provider_review(payload: dict[str, Any]) -> dict[str, Any]:
    provider_id = payload.get("provider", "deepseek")
    plans = payload.get("plans", [])
    context = payload.get("context", {})
    return await providers.review_plans(provider_id, plans, context)


async def generate_diet_plans(payload: dict[str, Any]) -> dict[str, Any]:
    value = await providers.generate_diet_plans(payload, build_diet_plans)
    return _save("diet.plans.backend", value)


async def generate_ingredients(payload: dict[str, Any]) -> dict[str, Any]:
    value = await providers.generate_ingredients(payload, build_ingredients)
    return _save("ingredients.backend", value)


async def generate_marketing(payload: dict[str, Any]) -> dict[str, Any]:
    value = await providers.generate_marketing(payload, build_marketing)
    return _save("marketing.backend", value)


def publish_package(payload: dict[str, Any]) -> dict[str, Any]:
    storage.save_record("publish.package", payload)
    return {"saved": True, "package": payload}


def record_business_checkout(payload: dict[str, Any]) -> dict[str, Any]:
    event_id = f"checkout-{uuid4().hex[:12]}"
    value = {
        "id": event_id,
        "type": "subscription",
        "status": "demo-paid",
        "payload": payload,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }

    auth_user_id = payload.get("_authUserId")
    plan_id = str(payload.get("planId") or payload.get("plan_id") or "pro_month")
    plan = BUSINESS_PLANS.get(plan_id)
    if auth_user_id and plan and plan["id"] != "free":
        now = _utc_now_dt()
        expires_at = now + timedelta(days=int(plan["durationDays"]))
        order = storage.create_subscription_order(
            order_id=f"order-{uuid4().hex[:16]}",
            user_id=str(auth_user_id),
            plan_id=plan["id"],
            plan_name=plan["name"],
            amount_cny=float(plan["amountCny"]),
            status="paid",
            channel=str(payload.get("channel") or "switch-checkout"),
            payment_method=str(payload.get("paymentMethod") or "demo"),
            payload=payload,
            paid_at=_utc_iso(now),
        )
        subscription = storage.upsert_user_subscription(
            user_id=str(auth_user_id),
            plan_id=plan["id"],
            plan_name=plan["name"],
            entitlement=plan["entitlement"],
            status="active",
            started_at=_utc_iso(now),
            expires_at=_utc_iso(expires_at),
            source_order_id=order["id"],
        )
        value["order"] = order
        value["subscription"] = subscription

    storage.save_record(f"business.checkout.{event_id}", value)
    return value


def record_business_lead(payload: dict[str, Any]) -> dict[str, Any]:
    event_id = str(payload.get("id") or f"lead-{uuid4().hex[:12]}")
    value = {
        "id": event_id,
        "type": "merchant-lead",
        "status": "new",
        "payload": payload,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }
    storage.save_record(f"business.lead.{event_id}", value)
    return value


def record_app_install_event(payload: dict[str, Any]) -> dict[str, Any]:
    event_id = f"app-event-{uuid4().hex[:12]}"
    value = {
        "id": event_id,
        "type": "app-install-runtime",
        "payload": payload,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }
    storage.save_record(f"app.install.{event_id}", value)
    return value


async def create_or_update_user_profile(payload: dict[str, Any]) -> dict[str, Any]:
    auth_user_id = payload.get("_authUserId")
    profile_payload = {key: value for key, value in payload.items() if not key.startswith("_auth")}
    value = await providers.generate_profile(profile_payload, create_profile)
    storage.save_record("profile.current", value)
    if auth_user_id:
        storage.update_user_profile(str(auth_user_id), profile_payload)
        storage.save_record(f"user.{auth_user_id}.profile.current", value)
    return value


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "$".join(
        [
            PASSWORD_SCHEME,
            str(PASSWORD_ITERATIONS),
            _base64url_encode(salt),
            _base64url_encode(digest),
        ]
    )


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iterations_raw, salt_raw, digest_raw = stored_hash.split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        iterations = int(iterations_raw)
        salt = _base64url_decode(salt_raw)
        expected = _base64url_decode(digest_raw)
    except (ValueError, TypeError, binascii.Error):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _auth_secret() -> bytes:
    return os.getenv("AUTH_SECRET", "dev-only-diet-planner-auth-secret").encode("utf-8")


def _issue_token(user: dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "exp": int(time.time()) + AUTH_TOKEN_TTL_SECONDS,
    }
    body = _base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_auth_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_base64url_encode(signature)}"


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="请先登录")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="无效登录凭证")
    return token.strip()


def _decode_token(token: str) -> dict[str, Any]:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(_auth_secret(), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_base64url_decode(signature), expected):
            raise ValueError("invalid signature")
        payload = json.loads(_base64url_decode(body))
    except (ValueError, json.JSONDecodeError, binascii.Error):
        raise HTTPException(status_code=401, detail="登录凭证已失效") from None

    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")

    user = storage.get_user_by_id(str(payload.get("sub", "")))
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在，请重新登录")
    return user


def _current_user(authorization: str | None) -> dict[str, Any]:
    return _decode_token(_extract_bearer_token(authorization))


def _public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["displayName"],
        "profile": user.get("profile") or {},
        "createdAt": user["createdAt"],
        "updatedAt": user["updatedAt"],
        "lastLoginAt": user["lastLoginAt"],
    }


def _utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _public_business_plans() -> list[dict[str, Any]]:
    return [dict(plan) for plan in BUSINESS_PLANS.values()]


def _active_subscription_for_user(user_id: str) -> dict[str, Any] | None:
    subscription = storage.get_user_subscription(user_id)
    if subscription is None:
        return None

    expires_at = _utc_datetime(subscription.get("expiresAt"))
    if subscription.get("status") == "active" and expires_at and expires_at <= _utc_now_dt():
        subscription = storage.update_user_subscription_status(user_id, "expired") or subscription

    if subscription.get("status") != "active":
        return None
    return subscription


def _subscription_payload(user_id: str) -> dict[str, Any]:
    subscription = _active_subscription_for_user(user_id)
    entitlement = subscription.get("entitlement") if subscription else "free"
    if entitlement not in ENTITLEMENT_LIMITS:
        entitlement = "free"
    return {
        "entitlement": entitlement,
        "subscription": subscription,
        "limits": ENTITLEMENT_LIMITS[entitlement],
        "orders": storage.list_subscription_orders(user_id, 10),
        "plans": _public_business_plans(),
    }


def _validate_plan_date(value: str, label: str = "计划日期") -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label}必须是 YYYY-MM-DD") from None
    return value


def _today_iso() -> str:
    return datetime.now().date().isoformat()


def _ensure_not_future_date(value: str, label: str = "日期") -> None:
    if value > _today_iso():
        raise HTTPException(status_code=422, detail=f"{label}不能晚于当天")


def _attach_auth_user(envelope: ApiEnvelope, authorization: str | None) -> None:
    if not authorization:
        return
    try:
        user = _current_user(authorization)
    except HTTPException:
        return
    envelope.payload = {
        **envelope.payload,
        "_authUserId": user["id"],
        "_authEmail": user["email"],
    }


switch.register("/api/v1/system/boot", lambda payload: {"ready": True, "received": payload})
switch.register("/api/v1/profile/create", create_or_update_user_profile)
switch.register("/api/v1/diet/plans", generate_diet_plans)
switch.register("/api/v1/ingredients/list", generate_ingredients)
switch.register("/api/v1/evaluation/score", lambda payload: _save("evaluation.backend", score_plans(payload)))
switch.register("/api/v1/cloud/providers/review", provider_review)
switch.register("/api/v1/marketing/content", generate_marketing)
switch.register("/api/v1/publish/package", publish_package)
switch.register("/api/v1/business/checkout", record_business_checkout)
switch.register("/api/v1/business/lead", record_business_lead)
switch.register("/api/v1/app/install-event", record_app_install_event)


def _save(key: str, value: dict[str, Any]) -> dict[str, Any]:
    storage.save_record(key, value)
    return value


app = FastAPI(
    title="Seven Layer Diet Planner API",
    version=APP_VERSION,
    description="FastAPI backend for the seven-layer multi-agent diet planner.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        service="seven-layer-diet-planner",
        version=APP_VERSION,
        providerMode=providers.provider_mode(),
        database=str(storage.db_path),
    )


@app.get("/api/v1/switch/stats")
async def switch_stats() -> dict[str, Any]:
    return switch.stats()


@app.get("/api/v1/events")
async def list_events(limit: int = 50) -> dict[str, Any]:
    return {"events": storage.list_events(limit)}


@app.get("/api/v1/events/stream")
async def stream_events() -> StreamingResponse:
    async def event_generator():
        seen: set[str] = set()
        while True:
            events = storage.list_events(20)
            for event in reversed(events):
                key = f"{event['trace_id']}:{event['type']}:{event['at']}"
                if key not in seen:
                    seen.add(key)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/v1/auth/register")
async def register_user(payload: AuthRegisterRequest) -> dict[str, Any]:
    if storage.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="该邮箱已注册")

    user = storage.create_user(
        user_id=f"user-{uuid4().hex[:16]}",
        email=payload.email,
        display_name=payload.displayName,
        password_hash=_hash_password(payload.password),
        profile=payload.profile,
    )
    storage.mark_user_login(user["id"])
    user = storage.get_user_by_id(user["id"]) or user
    return {"token": _issue_token(user), "user": _public_user(user)}


@app.post("/api/v1/auth/login")
async def login_user(payload: AuthLoginRequest) -> dict[str, Any]:
    user = storage.get_user_by_email(payload.email)
    if user is None or not _verify_password(payload.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    storage.mark_user_login(user["id"])
    user = storage.get_user_by_id(user["id"]) or user
    return {"token": _issue_token(user), "user": _public_user(user)}


@app.get("/api/v1/auth/me")
async def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    return {"user": _public_user(_current_user(authorization))}


@app.get("/api/v1/business/plans")
async def list_business_plans() -> dict[str, Any]:
    return {
        "plans": _public_business_plans(),
        "entitlements": ENTITLEMENT_LIMITS,
    }


@app.get("/api/v1/business/subscription/me")
async def get_current_subscription(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = _current_user(authorization)
    return _subscription_payload(user["id"])


@app.post("/api/v1/business/orders/checkout")
async def checkout_subscription_order(
    payload: SubscriptionCheckoutRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    plan = BUSINESS_PLANS.get(payload.planId)
    if plan is None or plan["id"] == "free":
        raise HTTPException(status_code=422, detail="请选择可购买的会员套餐")

    now = _utc_now_dt()
    expires_at = now + timedelta(days=int(plan["durationDays"]))
    order_id = f"order-{uuid4().hex[:16]}"
    order = storage.create_subscription_order(
        order_id=order_id,
        user_id=user["id"],
        plan_id=plan["id"],
        plan_name=plan["name"],
        amount_cny=float(plan["amountCny"]),
        status="paid",
        channel=payload.channel or "demo-checkout",
        payment_method=payload.paymentMethod or "demo",
        payload={
            "couponCode": payload.couponCode,
            "checkoutMode": "demo-paid",
            "plan": plan,
        },
        paid_at=_utc_iso(now),
    )
    subscription = storage.upsert_user_subscription(
        user_id=user["id"],
        plan_id=plan["id"],
        plan_name=plan["name"],
        entitlement=plan["entitlement"],
        status="active",
        started_at=_utc_iso(now),
        expires_at=_utc_iso(expires_at),
        source_order_id=order["id"],
    )
    storage.save_record(f"business.checkout.{order['id']}", {
        "order": order,
        "subscription": subscription,
    })
    return {
        "order": order,
        **_subscription_payload(user["id"]),
    }


@app.put("/api/v1/auth/me/profile")
async def update_current_user_profile(
    payload: UserProfileUpdate,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    updated_user = storage.update_user_profile(user["id"], payload.profile, payload.displayName)
    if updated_user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    storage.save_record(f"user.{user['id']}.profile.current", create_profile(payload.profile))
    return {"user": _public_user(updated_user)}


@app.get("/api/v1/diet/plans/saved")
async def list_saved_diet_plans(
    startDate: str,
    endDate: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    start_date = _validate_plan_date(startDate, "开始日期")
    end_date = _validate_plan_date(endDate or startDate, "结束日期")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="结束日期不能早于开始日期")
    return {"plans": storage.list_diet_plans(user["id"], start_date, end_date)}


@app.get("/api/v1/diet/plans/saved/{plan_date}")
async def get_saved_diet_plan(
    plan_date: str,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    checked_date = _validate_plan_date(plan_date)
    return {"plan": storage.get_diet_plan(user["id"], checked_date)}


@app.post("/api/v1/diet/plans/saved")
async def save_diet_plan(
    payload: DietPlanSaveRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    if not payload.plans:
        raise HTTPException(status_code=422, detail="饮食方案不能为空")

    plan = storage.save_diet_plan(
        user_id=user["id"],
        plan_date=payload.planDate,
        period=payload.period,
        profile=payload.profile,
        plans=payload.plans,
        plan_discussion=payload.planDiscussion,
        plan_constraints=payload.planConstraints,
        metrics=payload.metrics,
    )
    return {"plan": plan}


@app.get("/api/v1/diet/checkins")
async def list_diet_checkins(
    startDate: str,
    endDate: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    start_date = _validate_plan_date(startDate, "开始日期")
    end_date = _validate_plan_date(endDate or startDate, "结束日期")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="结束日期不能早于开始日期")
    return {"checkins": storage.list_diet_checkins(user["id"], start_date, end_date)}


@app.post("/api/v1/diet/checkins")
async def save_diet_checkin(
    payload: DietCheckinSaveRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    checked_date = _validate_plan_date(payload.planDate, "打卡日期")
    _ensure_not_future_date(checked_date, "打卡日期")
    checkin = storage.save_diet_checkin(
        user_id=user["id"],
        plan_date=checked_date,
        status=payload.status,
        selected_plan_index=payload.selectedPlanIndex,
        plan_name=payload.planName,
        menu_snapshot=payload.menuSnapshot,
        note=payload.note,
        checked_at=payload.checkedAt,
    )
    return {"checkin": checkin}


@app.get("/api/v1/diet/history-menus")
async def list_history_menus(
    startDate: str,
    endDate: str | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    start_date = _validate_plan_date(startDate, "开始日期")
    end_date = _validate_plan_date(endDate or startDate, "结束日期")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="结束日期不能早于开始日期")
    return {"menus": storage.list_history_menus(user["id"], start_date, end_date)}


@app.post("/api/v1/diet/history-menus")
async def save_history_menu(
    payload: HistoryMenuSaveRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user = _current_user(authorization)
    menu_date = _validate_plan_date(payload.planDate, "菜单日期")
    _ensure_not_future_date(menu_date, "菜单日期")
    menu = storage.save_history_menu(
        user_id=user["id"],
        plan_date=menu_date,
        period=payload.period,
        selected_plan_index=payload.selectedPlanIndex,
        plan_name=payload.planName,
        profile=payload.profile,
        menu_snapshot=payload.menuSnapshot,
    )
    return {"menu": menu}


@app.post("/api/v1/switch/dispatch", response_model=ApiResponse)
async def dispatch(envelope: ApiEnvelope, authorization: str | None = Header(default=None)) -> ApiResponse:
    _attach_auth_user(envelope, authorization)
    return await switch.dispatch(envelope)


@app.post("/api/v1/{layer}/{action}", response_model=ApiResponse)
async def route_alias(
    layer: str,
    action: str,
    envelope: ApiEnvelope,
    authorization: str | None = Header(default=None),
) -> ApiResponse:
    envelope.route = f"/api/v1/{layer}/{action}"
    _attach_auth_user(envelope, authorization)
    return await switch.dispatch(envelope)


if (ROOT / "index.html").exists():
    app.mount("/static", StaticFiles(directory=str(ROOT)), name="static")


@app.get("/")
async def frontend() -> FileResponse:
    return FileResponse(ROOT / "index.html")


@app.get("/style.css")
async def stylesheet() -> FileResponse:
    return FileResponse(ROOT / "style.css")


@app.get("/app.js")
async def javascript() -> FileResponse:
    return FileResponse(ROOT / "app.js")


@app.get("/edge-model.js")
async def edge_model_javascript() -> FileResponse:
    return FileResponse(ROOT / "edge-model.js")


@app.get("/launch.js")
async def launch_javascript() -> FileResponse:
    return FileResponse(ROOT / "launch.js")


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(ROOT / "sw.js", media_type="application/javascript")


@app.get("/manifest.webmanifest")
async def web_manifest() -> FileResponse:
    return FileResponse(ROOT / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/assets/app-icon.svg")
async def app_icon() -> FileResponse:
    return FileResponse(ROOT / "assets" / "app-icon.svg", media_type="image/svg+xml")
