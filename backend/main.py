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
    HealthResponse,
    UserProfileUpdate,
)
from .services import build_diet_plans, build_ingredients, build_marketing, create_profile, score_plans
from .storage import Storage
from .switch import ApiSwitch


APP_VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parents[1]
PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 260_000
AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14

load_local_env()

storage = Storage(os.getenv("DIET_PLANNER_DB", "backend/diet_planner.db"))
providers = CloudProviderClient()
switch = ApiSwitch(storage)


async def provider_review(payload: dict[str, Any]) -> dict[str, Any]:
    provider_id = payload.get("provider", "deepseek")
    plans = payload.get("plans", [])
    context = payload.get("context", {})
    return await providers.review_plans(provider_id, plans, context)


def publish_package(payload: dict[str, Any]) -> dict[str, Any]:
    storage.save_record("publish.package", payload)
    return {"saved": True, "package": payload}


def create_or_update_user_profile(payload: dict[str, Any]) -> dict[str, Any]:
    auth_user_id = payload.get("_authUserId")
    profile_payload = {key: value for key, value in payload.items() if not key.startswith("_auth")}
    value = create_profile(profile_payload)
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
switch.register("/api/v1/diet/plans", lambda payload: _save("diet.plans.backend", build_diet_plans(payload)))
switch.register("/api/v1/ingredients/list", lambda payload: _save("ingredients.backend", build_ingredients(payload)))
switch.register("/api/v1/evaluation/score", lambda payload: _save("evaluation.backend", score_plans(payload)))
switch.register("/api/v1/cloud/providers/review", provider_review)
switch.register("/api/v1/marketing/content", lambda payload: _save("marketing.backend", build_marketing(payload)))
switch.register("/api/v1/publish/package", publish_package)


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
