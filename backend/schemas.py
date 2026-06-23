from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


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


class AuthRegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=6, max_length=128)
    displayName: str = Field(min_length=1, max_length=80)
    profile: dict[str, Any] = Field(default_factory=dict)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
            raise ValueError("请输入有效邮箱地址")
        return email

    @field_validator("displayName")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        display_name = value.strip()
        if not display_name:
            raise ValueError("请输入昵称")
        return display_name


class AuthLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class UserProfileUpdate(BaseModel):
    profile: dict[str, Any] = Field(default_factory=dict)
    displayName: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("displayName")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        display_name = value.strip()
        if not display_name:
            raise ValueError("请输入昵称")
        return display_name
