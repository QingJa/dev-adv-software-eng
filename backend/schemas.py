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


class SubscriptionCheckoutRequest(BaseModel):
    planId: str = Field(min_length=1, max_length=40)
    channel: str = Field(default="demo-checkout", max_length=60)
    paymentMethod: str = Field(default="demo", max_length=60)
    couponCode: str | None = Field(default=None, max_length=40)

    @field_validator("planId", "channel", "paymentMethod", "couponCode")
    @classmethod
    def strip_subscription_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class DietPlanSaveRequest(BaseModel):
    planDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    period: Literal["day", "week", "month"] = "day"
    profile: dict[str, Any] = Field(default_factory=dict)
    plans: list[dict[str, Any]] = Field(default_factory=list)
    planDiscussion: dict[str, Any] = Field(default_factory=dict)
    planConstraints: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)

    @field_validator("planDate")
    @classmethod
    def validate_plan_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise ValueError("计划日期必须是 YYYY-MM-DD") from None
        return value


class DietCheckinSaveRequest(BaseModel):
    planDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: Literal["planned", "completed", "skipped"] = "completed"
    selectedPlanIndex: int = Field(default=0, ge=0, le=10)
    planName: str = Field(default="", max_length=120)
    menuSnapshot: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default="", max_length=1000)
    checkedAt: str | None = None

    @field_validator("planDate")
    @classmethod
    def validate_plan_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise ValueError("打卡日期必须是 YYYY-MM-DD") from None
        return value

    @field_validator("planName", "note")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()


class HistoryMenuSaveRequest(BaseModel):
    planDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    period: Literal["day", "week", "month"] = "day"
    selectedPlanIndex: int = Field(default=0, ge=0, le=10)
    planName: str = Field(default="", max_length=120)
    profile: dict[str, Any] = Field(default_factory=dict)
    menuSnapshot: dict[str, Any] = Field(default_factory=dict)

    @field_validator("planDate")
    @classmethod
    def validate_plan_date(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise ValueError("菜单日期必须是 YYYY-MM-DD") from None
        return value

    @field_validator("planName")
    @classmethod
    def strip_plan_name(cls, value: str) -> str:
        return value.strip()
