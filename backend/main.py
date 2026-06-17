from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import load_local_env
from .providers import CloudProviderClient
from .schemas import ApiEnvelope, ApiResponse, HealthResponse
from .services import build_diet_plans, build_ingredients, build_marketing, create_profile, score_plans
from .storage import Storage
from .switch import ApiSwitch


APP_VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parents[1]

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


switch.register("/api/v1/system/boot", lambda payload: {"ready": True, "received": payload})
switch.register("/api/v1/profile/create", lambda payload: _save("profile.current", create_profile(payload)))
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


@app.post("/api/v1/switch/dispatch", response_model=ApiResponse)
async def dispatch(envelope: ApiEnvelope) -> ApiResponse:
    return await switch.dispatch(envelope)


@app.post("/api/v1/{layer}/{action}", response_model=ApiResponse)
async def route_alias(layer: str, action: str, envelope: ApiEnvelope) -> ApiResponse:
    envelope.route = f"/api/v1/{layer}/{action}"
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
