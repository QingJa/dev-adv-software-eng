from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from .schemas import ApiEnvelope, ApiEvent, ApiResponse
from .storage import Storage


Handler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]] | dict[str, Any]]


class ApiSwitch:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage
        self.routes: dict[str, Handler] = {}
        self.total_requests = 0
        self.total_responses = 0
        self.total_errors = 0
        self.queue_depth = 0

    def register(self, route: str, handler: Handler) -> None:
        self.routes[route] = handler

    async def dispatch(self, envelope: ApiEnvelope) -> ApiResponse:
        started = time.perf_counter()
        self.total_requests += 1
        self.queue_depth += 1
        self._event("request", envelope, f"request accepted: {envelope.route}")

        try:
            handler = self.routes.get(envelope.route)
            if handler is None:
                raise ValueError(f"route not found: {envelope.route}")

            result = handler(envelope.payload)
            if hasattr(result, "__await__"):
                result = await result  # type: ignore[assignment]

            self.total_responses += 1
            response = ApiResponse(
                traceId=envelope.traceId,
                route=envelope.route,
                ok=True,
                data=result,  # type: ignore[arg-type]
                latencyMs=round((time.perf_counter() - started) * 1000),
            )
            self._event("response", envelope, f"response ready: {envelope.route}")
            return response
        except Exception as exc:
            self.total_errors += 1
            self._event("error", envelope, str(exc))
            return ApiResponse(
                traceId=envelope.traceId,
                route=envelope.route,
                ok=False,
                error=str(exc),
                latencyMs=round((time.perf_counter() - started) * 1000),
            )
        finally:
            self.queue_depth = max(0, self.queue_depth - 1)

    def stats(self) -> dict[str, Any]:
        return {
            "queueDepth": self.queue_depth,
            "totalRequests": self.total_requests,
            "totalResponses": self.total_responses,
            "totalErrors": self.total_errors,
            "recordCount": self.storage.record_count(),
        }

    def _event(self, event_type: str, envelope: ApiEnvelope, message: str) -> None:
        event = ApiEvent(
            type=event_type,  # type: ignore[arg-type]
            traceId=envelope.traceId,
            route=envelope.route,
            source=envelope.source,
            target=envelope.target,
            message=message,
        )
        self.storage.save_event(event)
