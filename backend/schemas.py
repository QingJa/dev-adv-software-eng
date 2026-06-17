from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiMeta(BaseModel):
    contentType: str = "application/json"
    transport: str = "http-fastapi"
    nonBlocking: bool = True


class ApiEnvelope(BaseModel):
    traceId: str = Field(default_factory=lambda: f"trace-{uuid4().hex[:16]}")
    protocol: str = "DietPlannerAPI/1.0"
    method: str = "POST"
    route: str
    source: str = "frontend"
    target: str = "api-switch"
    duplex: bool = True
    payload: dict[str, Any] = Field(default_factory=dict)
    meta: ApiMeta = Field(default_factory=ApiMeta)
    createdAt: str = Field(default_factory=utc_now)


class ApiResponse(BaseModel):
    traceId: str
    route: str
    ok: bool = True
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    responseAt: str = Field(default_factory=utc_now)
    latencyMs: int = 0


class ApiEvent(BaseModel):
    type: Literal["request", "response", "error", "provider", "data"]
    traceId: str
    route: str
    source: str
    target: str
    message: str
    at: str = Field(default_factory=utc_now)


class HealthResponse(BaseModel):
    ok: bool
    service: str
    version: str
    providerMode: str
    database: str
