from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class ProviderConfig:
    id: str
    name: str
    role: str
    api_key_env: str
    api_url_env: str
    model_env: str
    default_url: str
    default_model: str
    api_style: str


PROVIDERS = [
    ProviderConfig(
        id="doubao",
        name="豆包 Doubao",
        role="生活化表达与可执行建议",
        api_key_env="DOUBAO_API_KEY",
        api_url_env="DOUBAO_API_URL",
        model_env="DOUBAO_MODEL",
        default_url="https://ark.cn-beijing.volces.com/api/v3/responses",
        default_model="doubao-seed-2-0-lite-260428",
        api_style="responses",
    ),
    ProviderConfig(
        id="qianwen",
        name="通义千问 Qianwen",
        role="结构化推理与中文语义",
        api_key_env="QIANWEN_API_KEY",
        api_url_env="QIANWEN_API_URL",
        model_env="QIANWEN_MODEL",
        default_url="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        default_model="qwen-plus",
        api_style="chat_completions",
    ),
    ProviderConfig(
        id="deepseek",
        name="DeepSeek DS",
        role="数学评分与对抗校验",
        api_key_env="DEEPSEEK_API_KEY",
        api_url_env="DEEPSEEK_API_URL",
        model_env="DEEPSEEK_MODEL",
        default_url="https://api.deepseek.com/chat/completions",
        default_model="deepseek-chat",
        api_style="chat_completions",
    ),
]


class CloudProviderClient:
    def __init__(self, timeout: float = 12.0) -> None:
        self.timeout = timeout

    def provider_mode(self) -> str:
        configured = [provider.id for provider in PROVIDERS if os.getenv(provider.api_key_env)]
        return "real:" + ",".join(configured) if configured else "mock"

    async def review_plans(self, provider_id: str, plans: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
        provider = next((item for item in PROVIDERS if item.id == provider_id), None)
        if provider is None:
            raise ValueError(f"unknown provider: {provider_id}")

        if not os.getenv(provider.api_key_env):
            return self._mock_review(provider, plans, context)

        try:
            return await self._real_review(provider, plans, context)
        except Exception as exc:
            fallback = self._mock_review(provider, plans, context)
            fallback["note"] = f"真实 Provider 调用失败，已降级为本地评审：{exc}"
            fallback["mode"] = "fallback"
            return fallback

    async def _real_review(self, provider: ProviderConfig, plans: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
        api_key = os.environ[provider.api_key_env]
        api_url = os.getenv(provider.api_url_env) or provider.default_url
        model = os.getenv(provider.model_env) or provider.default_model
        prompt = self._build_review_prompt(plans, context)
        payload = self._build_payload(provider, model, prompt)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()

        content = self._extract_text(body)
        parsed = self._parse_json_object(content)
        scores = self._parse_scores(parsed, provider, plans)
        note = parsed.get("note") if isinstance(parsed.get("note"), str) else "真实 Provider 已返回内容，后端已解析 JSON 评分。"
        return {
            "providerId": provider.id,
            "providerName": provider.name,
            "role": provider.role,
            "mode": "real",
            "raw": content,
            "scores": scores,
            "note": note,
        }

    def _build_review_prompt(self, plans: list[dict[str, Any]], context: dict[str, Any]) -> str:
        return (
            "你是健康饮食方案评审器。请只返回 JSON，不要输出 Markdown。"
            "JSON 字段必须包含 scores 和 note。"
            "scores 是数组，每项包含 idx 和 score，idx 对应输入方案下标，score 为 0-100 整数。"
            "note 用一句中文解释你倾向的方案。\n"
            f"用户上下文：{json.dumps(context, ensure_ascii=False)}\n"
            f"候选方案：{json.dumps(plans, ensure_ascii=False)}"
        )

    def _build_payload(self, provider: ProviderConfig, model: str, prompt: str) -> dict[str, Any]:
        if provider.api_style == "responses":
            return {
                "model": model,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": f"{provider.role}\n\n{prompt}",
                            }
                        ],
                    }
                ],
                "temperature": 0.2,
            }

        return {
            "model": model,
            "messages": [
                {"role": "system", "content": provider.role},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }

    def _extract_text(self, body: dict[str, Any]) -> str:
        if isinstance(body.get("output_text"), str):
            return body["output_text"]

        choices = body.get("choices")
        if isinstance(choices, list) and choices:
            content = choices[0].get("message", {}).get("content", "")
            if isinstance(content, str):
                return content

        output = body.get("output")
        if isinstance(output, list):
            texts: list[str] = []
            for item in output:
                content = item.get("content") if isinstance(item, dict) else None
                if not isinstance(content, list):
                    continue
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        texts.append(block["text"])
            if texts:
                return "\n".join(texts)

        return json.dumps(body, ensure_ascii=False)

    def _parse_json_object(self, content: str) -> dict[str, Any]:
        cleaned = content.strip()
        fenced = re.search(r"```(?:json)?\s*(.*?)```", cleaned, flags=re.IGNORECASE | re.DOTALL)
        if fenced:
            cleaned = fenced.group(1).strip()

        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass

        object_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if object_match:
            try:
                parsed = json.loads(object_match.group(0))
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}

        return {}

    def _parse_scores(self, parsed: dict[str, Any], provider: ProviderConfig, plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
        fallback = self._extract_scores_from_plans(provider, plans)
        scores = parsed.get("scores")
        if not isinstance(scores, list):
            return fallback

        normalized: dict[int, dict[str, Any]] = {}
        for item in scores:
            if not isinstance(item, dict):
                continue
            try:
                idx = int(item.get("idx", len(normalized)))
                score = float(item["score"])
            except (KeyError, TypeError, ValueError):
                continue
            if idx < 0 or idx >= len(plans):
                continue
            normalized[idx] = {
                "idx": idx,
                "planName": str(item.get("planName") or item.get("name") or plans[idx].get("name", f"方案 {idx + 1}")),
                "score": max(0, min(100, round(score))),
            }

        return [normalized.get(item["idx"], item) for item in fallback]

    def _mock_review(self, provider: ProviderConfig, plans: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
        scores = self._extract_scores_from_plans(provider, plans)
        best = max(scores, key=lambda item: item["score"]) if scores else {"planName": "无方案"}
        return {
            "providerId": provider.id,
            "providerName": provider.name,
            "role": provider.role,
            "mode": "mock",
            "scores": scores,
            "note": f"{provider.name} 基于 {provider.role} 倾向推荐「{best['planName']}」。",
        }

    def _extract_scores_from_plans(self, provider: ProviderConfig, plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for idx, plan in enumerate(plans):
            scores = plan.get("scores", {})
            macros = plan.get("macros", {})
            macro_fit = 100 - abs(macros.get("carbs", 40) - 40) * 0.7 - abs(macros.get("protein", 30) - 32) - abs(macros.get("fat", 28) - 28) * 0.6
            if provider.id == "doubao":
                score = scores.get("region", 80) * 0.34 + scores.get("season", 80) * 0.28 + macro_fit * 0.18 + scores.get("cost", 80) * 0.2
            elif provider.id == "qianwen":
                score = macro_fit * 0.38 + scores.get("region", 80) * 0.24 + scores.get("season", 80) * 0.22 + scores.get("cost", 80) * 0.16
            else:
                score = scores.get("cost", 80) * 0.32 + macro_fit * 0.3 + scores.get("season", 80) * 0.2 + scores.get("region", 80) * 0.18
            output.append(
                {
                    "idx": idx,
                    "planName": plan.get("name", f"方案 {idx + 1}"),
                    "score": max(0, min(100, round(score))),
                }
            )
        return output
