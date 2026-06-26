from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Callable

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
    def __init__(self, timeout: float | None = None) -> None:
        configured_timeout = os.getenv("LLM_TIMEOUT_SECONDS")
        if timeout is not None:
            self.timeout = timeout
        elif configured_timeout:
            self.timeout = max(8.0, float(configured_timeout))
        else:
            self.timeout = 45.0

    def provider_mode(self) -> str:
        configured = [provider.id for provider in PROVIDERS if os.getenv(provider.api_key_env)]
        return "real:" + ",".join(configured) if configured else "mock"

    async def generate_profile(
        self,
        payload: dict[str, Any],
        fallback_builder: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        fallback = fallback_builder(payload)
        provider = self._select_provider(payload.get("provider"))
        if provider is None:
            return {**fallback, "mode": "mock", "agentEngine": "local-fallback"}

        try:
            prompt = self._build_profile_prompt(payload)
            parsed = await self._real_json(provider, prompt)
            computed = fallback.get("computed") if isinstance(fallback.get("computed"), dict) else {}
            parsed_computed = parsed.get("computed") if isinstance(parsed.get("computed"), dict) else {}
            agent_profile = parsed.get("agentProfile") if isinstance(parsed.get("agentProfile"), dict) else {}
            return {
                **fallback,
                "mode": "real",
                "providerId": provider.id,
                "providerName": provider.name,
                "agentEngine": "llm-customer-manager",
                "computed": {**computed, **parsed_computed},
                "agentProfile": {
                    "summary": str(agent_profile.get("summary") or parsed.get("summary") or fallback.get("agentProfile", {}).get("summary", "")),
                    "tags": agent_profile.get("tags") if isinstance(agent_profile.get("tags"), list) else fallback.get("agentProfile", {}).get("tags", []),
                    "focus": agent_profile.get("focus") if isinstance(agent_profile.get("focus"), list) else fallback.get("agentProfile", {}).get("focus", []),
                    "constraints": agent_profile.get("constraints") if isinstance(agent_profile.get("constraints"), list) else [],
                },
            }
        except Exception as exc:
            return {
                **fallback,
                "mode": "fallback",
                "agentEngine": "local-fallback",
                "note": f"真实大模型画像生成失败，已降级为本地画像：{self._describe_exception(exc)}",
            }

    async def generate_diet_plans(
        self,
        payload: dict[str, Any],
        fallback_builder: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        fallback = fallback_builder(payload)
        provider = self._select_provider(payload.get("provider"))
        if provider is None:
            return {**fallback, "mode": "mock", "agentEngine": "local-fallback"}

        try:
            prompt = self._build_generation_prompt(payload)
            parsed = await self._real_json(provider, prompt)
            generated = self._normalize_generation_result(parsed, fallback)
            return {
                **generated,
                "mode": "real",
                "providerId": provider.id,
                "providerName": provider.name,
                "agentEngine": "llm-multi-agent",
            }
        except Exception as exc:
            return {
                **fallback,
                "mode": "fallback",
                "agentEngine": "local-fallback",
                "note": f"真实大模型方案生成失败，已降级为本地方案：{self._describe_exception(exc)}",
            }

    async def generate_ingredients(
        self,
        payload: dict[str, Any],
        fallback_builder: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        fallback = fallback_builder(payload)
        provider = self._select_provider(payload.get("provider"))
        if provider is None:
            return {**fallback, "mode": "mock", "agentEngine": "local-fallback"}

        try:
            prompt = self._build_ingredients_prompt(payload)
            parsed = await self._real_json(provider, prompt)
            ingredients = parsed.get("ingredients")
            if not isinstance(ingredients, dict):
                raise ValueError("LLM 未返回 ingredients 对象")
            return {
                **fallback,
                "mode": "real",
                "providerId": provider.id,
                "providerName": provider.name,
                "agentEngine": "llm-ingredient-agent",
                "planName": parsed.get("planName") or fallback.get("planName"),
                "ingredients": self._normalize_ingredients(ingredients, fallback.get("ingredients") or {}),
                "note": parsed.get("note") or "大模型已根据最终方案生成采购清单。",
            }
        except Exception as exc:
            return {
                **fallback,
                "mode": "fallback",
                "agentEngine": "local-fallback",
                "note": f"真实大模型食材清单生成失败，已降级为本地清单：{self._describe_exception(exc)}",
            }

    async def generate_marketing(
        self,
        payload: dict[str, Any],
        fallback_builder: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> dict[str, Any]:
        fallback = fallback_builder(payload)
        provider = self._select_provider(payload.get("provider"))
        if provider is None:
            return {**fallback, "mode": "mock", "agentEngine": "local-fallback"}

        try:
            prompt = self._build_marketing_prompt(payload)
            parsed = await self._real_json(provider, prompt)
            return {
                **fallback,
                "mode": "real",
                "providerId": provider.id,
                "providerName": provider.name,
                "agentEngine": "llm-sharing-agent",
                "xhsText": str(parsed.get("xhsText") or fallback.get("xhsText") or ""),
                "videoText": str(parsed.get("videoText") or fallback.get("videoText") or ""),
                "gzhText": str(parsed.get("gzhText") or fallback.get("gzhText") or ""),
                "promoText": str(parsed.get("promoText") or fallback.get("promoText") or ""),
                "note": parsed.get("note") or "大模型已生成用户分享与商家推广内容。",
            }
        except Exception as exc:
            return {
                **fallback,
                "mode": "fallback",
                "agentEngine": "local-fallback",
                "note": f"真实大模型文案生成失败，已降级为本地模板：{self._describe_exception(exc)}",
            }

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
            fallback["note"] = f"真实 Provider 调用失败，已降级为本地评审：{self._describe_exception(exc)}"
            fallback["mode"] = "fallback"
            return fallback

    def _select_provider(self, requested: str | None = None) -> ProviderConfig | None:
        preferred = requested or os.getenv("LLM_PRIMARY_PROVIDER") or ""
        if preferred:
            match = next((item for item in PROVIDERS if item.id == preferred and os.getenv(item.api_key_env)), None)
            if match:
                return match
        return next((item for item in PROVIDERS if os.getenv(item.api_key_env)), None)

    def _describe_exception(self, exc: Exception) -> str:
        message = str(exc).strip()
        if message:
            return f"{exc.__class__.__name__}: {message}"
        if isinstance(exc, httpx.TimeoutException):
            return f"{exc.__class__.__name__}: request exceeded {self.timeout:.0f}s timeout"
        return exc.__class__.__name__

    async def _real_json(self, provider: ProviderConfig, prompt: str) -> dict[str, Any]:
        api_key = os.environ[provider.api_key_env]
        api_url = os.getenv(provider.api_url_env) or provider.default_url
        model = os.getenv(provider.model_env) or provider.default_model
        payload = self._build_payload(provider, model, prompt)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()

        content = self._extract_text(body)
        parsed = self._parse_json_object(content)
        if not parsed:
            raise ValueError("LLM 未返回可解析 JSON")
        return parsed

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

    def _build_profile_prompt(self, payload: dict[str, Any]) -> str:
        return (
            "你是客户经理 Agent，负责把健康问卷整理成可供后续饮食规划 Agent 使用的用户画像。"
            "请只返回 JSON，不要输出 Markdown。"
            "JSON 必须包含 agentProfile 和 computed。"
            "agentProfile 包含 summary、tags、focus、constraints；tags/focus/constraints 都是字符串数组。"
            "computed 可包含 bmi、bmiStatus、targetIntent。"
            "不要编造疾病诊断，不要给医疗结论，只整理饮食规划相关偏好、目标、忌口、地域和执行难度信息。\n"
            f"输入：{json.dumps(payload, ensure_ascii=False)}"
        )

    def _build_generation_prompt(self, payload: dict[str, Any]) -> str:
        date_context = payload.get("dateContext") or {}
        return (
            "你是多智能体健康饮食规划编排器。请模拟 3 个 Agent 协作："
            "营养约束 Agent、偏好体验 Agent、成本季节 Agent。"
            "请只返回 JSON，不要输出 Markdown。"
            "JSON 必须包含 bmr、tdee、targetCalories、plans、planDiscussion。"
            "plans 必须正好 3 个，每个包含 name、sub、calories、macros(carbs/protein/fat)、"
            "meals(早餐/午餐/晚餐/加餐，含 name/icon/food/cals)、"
            "ingredients(meat/veggies/grains/seasonings，每项 name/qty)、"
            "scores(cost/season/region)、agentScore、agentNotes。"
            "三个 plans 的顺序必须代表三个不同角度："
            "第 1 个是营养稳态/高蛋白/热量控制角度；"
            "第 2 个是饱腹体验/高纤慢糖/执行便利角度；"
            "第 3 个是时令地域/采购可得/轻负担角度。"
            "scores 必须体现三种角度的取舍，不允许同一个方案在 cost、season、region 三项都最高；"
            "通常第 2 个方案 cost 更高，第 3 个方案 season 更高，第 1 个方案 region 或营养稳态匹配更高。"
            "name 必须是具体角度名称，例如“营养稳态高蛋白餐”“高纤慢糖饱腹餐”“时令地域轻负担餐”；"
            "name 不要包含“方案A/方案 B/方案C”，三个 name 不要使用同一个前缀再加 A/B/C。"
            "macros 必须是三大营养素热量占比百分数，三项合计约 100，不要填写克数。"
            "scores.cost/scores.season/scores.region 和 agentScore 必须是 0-100 的整数百分制，不要使用 1-10 分制。"
            "planDiscussion 包含 agents(name/role/opinion) 和 consensus。"
            "必须遵守过敏/忌口和用户删除菜品约束，不要推荐禁忌食材。"
            "输入 dateContext 表示当前周期第几天、周几、今日轮换重点和最近几天已生成餐单。"
            "必须让同一周期相邻日期的三套方案在主蛋白、主食、蔬菜和烹饪方式上明显不同。"
            "不得复用 dateContext.previousPlanSummaries 中已有的完整 meal food；"
            "除用户固定菜品外，同一方案连续 7 天不要重复同一早餐/午餐/晚餐主菜。"
            "请优先围绕 dateContext.varietyFocus 设计当天餐单。"
            "请保持 JSON 紧凑，food/agentNotes/opinion 字段用短句，避免长篇解释。\n"
            f"dateContext：{json.dumps(date_context, ensure_ascii=False)}\n"
            f"输入：{json.dumps(payload, ensure_ascii=False)}"
        )

    def _build_ingredients_prompt(self, payload: dict[str, Any]) -> str:
        return (
            "你是食材采购清单 Agent。请只返回 JSON，不要输出 Markdown。"
            "JSON 包含 planName、ingredients、note。"
            "ingredients 必须包含 meat、veggies、grains、seasonings 四类，"
            "每类是数组，每项包含 name 和 qty。请根据最终方案餐单折算采购量，避免过敏食材。\n"
            f"输入：{json.dumps(payload, ensure_ascii=False)}"
        )

    def _build_marketing_prompt(self, payload: dict[str, Any]) -> str:
        return (
            "你是健康饮食计划内容 Agent。请只返回 JSON，不要输出 Markdown。"
            "JSON 包含 xhsText、videoText、gzhText、promoText、note。"
            "xhsText/videoText/gzhText 面向用户个人记录和分享。"
            "promoText 面向商家推广，只能基于最终方案名称、餐单、营养结构和采购清单生成，"
            "不得包含姓名、年龄、身高、体重、联系方式、疾病史等个人健康隐私；"
            "必须提示正式推广需授权和脱敏。\n"
            f"输入：{json.dumps(payload, ensure_ascii=False)}"
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
                score = self._score_or(item["score"], fallback[idx]["score"] if idx < len(fallback) else 80)
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

    def _normalize_generation_result(self, parsed: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        plans = parsed.get("plans")
        if not isinstance(plans, list) or len(plans) < 3:
            raise ValueError("LLM 未返回 3 个方案")

        fallback_plans = fallback.get("plans", [])
        normalized_plans = []
        for idx, plan in enumerate(plans[:3]):
            if not isinstance(plan, dict):
                raise ValueError("方案格式错误")
            base = fallback_plans[idx] if idx < len(fallback_plans) and isinstance(fallback_plans[idx], dict) else {}
            normalized_plans.append(self._normalize_plan(plan, base, idx))
        normalized_plans = self._calibrate_plan_scores_by_angle(self._ensure_plan_names_use_angles(normalized_plans))

        return {
            **fallback,
            "bmr": self._number_or(parsed.get("bmr"), fallback.get("bmr")),
            "tdee": self._number_or(parsed.get("tdee"), fallback.get("tdee")),
            "targetCalories": self._number_or(parsed.get("targetCalories"), fallback.get("targetCalories")),
            "plans": normalized_plans,
            "planDiscussion": self._normalize_discussion(parsed.get("planDiscussion"), fallback.get("planDiscussion") or {}),
        }

    def _normalize_plan(self, plan: dict[str, Any], fallback: dict[str, Any], idx: int) -> dict[str, Any]:
        return {
            **fallback,
            "name": self._clean_plan_name(plan.get("name") or fallback.get("name") or self._default_plan_name(idx)),
            "sub": str(plan.get("sub") or fallback.get("sub") or "大模型 Agent 生成"),
            "calories": self._number_or(plan.get("calories"), fallback.get("calories", 1500)),
            "macros": self._normalize_macros(plan.get("macros"), fallback.get("macros") or {}),
            "meals": self._normalize_meals(plan.get("meals"), fallback.get("meals") or []),
            "ingredients": self._normalize_ingredients(plan.get("ingredients"), fallback.get("ingredients") or {}),
            "scores": self._normalize_scores(plan.get("scores"), fallback.get("scores") or {}),
            "agentScore": self._score_or(plan.get("agentScore"), fallback.get("agentScore", 82)),
            "agentNotes": str(plan.get("agentNotes") or fallback.get("agentNotes") or "大模型多 Agent 生成。"),
        }

    def _normalize_macros(self, value: Any, fallback: dict[str, Any]) -> dict[str, int]:
        source = value if isinstance(value, dict) else {}
        return self._normalize_macro_distribution(
            self._number_or(source.get("carbs"), fallback.get("carbs", 40)),
            self._number_or(source.get("protein"), fallback.get("protein", 32)),
            self._number_or(source.get("fat"), fallback.get("fat", 28)),
        )

    def _normalize_scores(self, value: Any, fallback: dict[str, Any]) -> dict[str, int]:
        source = value if isinstance(value, dict) else {}
        return {
            "cost": self._score_or(source.get("cost"), fallback.get("cost", 80)),
            "season": self._score_or(source.get("season"), fallback.get("season", 80)),
            "region": self._score_or(source.get("region"), fallback.get("region", 80)),
        }

    def _default_plan_name(self, idx: int) -> str:
        defaults = ["营养稳态高蛋白餐", "高纤慢糖饱腹餐", "时令地域轻负担餐"]
        return defaults[idx] if 0 <= idx < len(defaults) else f"综合平衡餐 {idx + 1}"

    def _clean_plan_name(self, value: Any) -> str:
        name = str(value or "").strip()
        name = re.sub(r"^方案\s*[ABCＡＢＣ]\s*[:：\-｜|]?\s*", "", name, flags=re.I)
        name = re.sub(r"\s*方案\s*[ABCＡＢＣ]\s*$", "", name, flags=re.I)
        name = re.sub(r"\s*[ABCＡＢＣ]\s*方案\s*$", "", name, flags=re.I)
        name = re.sub(r"(?<=[\u4e00-\u9fa5])\s*[ABCＡＢＣ]\s*$", "", name, flags=re.I)
        return name.strip()

    def _plan_name_base(self, value: str) -> str:
        name = self._clean_plan_name(value)
        return re.sub(r"(餐|食谱|膳食|轻食)$", "", name).strip()

    def _ensure_plan_names_use_angles(self, plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
        cleaned = [{**plan, "name": self._clean_plan_name(plan.get("name")) or self._default_plan_name(idx)} for idx, plan in enumerate(plans)]
        base_counts: dict[str, int] = {}
        exact_counts: dict[str, int] = {}
        for plan in cleaned:
            base = self._plan_name_base(plan.get("name", ""))
            exact = re.sub(r"\s+", "", plan.get("name", "")).lower()
            base_counts[base] = base_counts.get(base, 0) + 1
            exact_counts[exact] = exact_counts.get(exact, 0) + 1
        output: list[dict[str, Any]] = []
        for idx, plan in enumerate(cleaned):
            base = self._plan_name_base(plan.get("name", ""))
            exact = re.sub(r"\s+", "", plan.get("name", "")).lower()
            if base_counts.get(base, 0) > 1 or exact_counts.get(exact, 0) > 1:
                plan = {**plan, "name": self._default_plan_name(idx)}
            output.append(plan)
        return output

    def _angle_score_profile(self, idx: int) -> dict[str, int]:
        profiles = [
            {"cost": 80, "season": 84, "region": 94},
            {"cost": 94, "season": 82, "region": 78},
            {"cost": 76, "season": 96, "region": 88},
        ]
        return profiles[idx] if 0 <= idx < len(profiles) else {"cost": 84, "season": 84, "region": 84}

    def _shift_score_by_model(self, anchor: int, value: Any) -> int:
        model_score = self._score_or(value, anchor)
        delta = max(-3, min(3, round((model_score - 80) / 6)))
        return max(0, min(100, round(anchor + delta)))

    def _calibrate_plan_scores_by_angle(self, plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for idx, plan in enumerate(plans):
            anchor = self._angle_score_profile(idx)
            model_scores = self._normalize_scores(plan.get("scores"), {})
            output.append(
                {
                    **plan,
                    "scores": {
                        "cost": self._shift_score_by_model(anchor["cost"], model_scores.get("cost")),
                        "season": self._shift_score_by_model(anchor["season"], model_scores.get("season")),
                        "region": self._shift_score_by_model(anchor["region"], model_scores.get("region")),
                    },
                }
            )

        if len(output) >= 3:
            output[1]["scores"]["cost"] = min(100, max(output[1]["scores"]["cost"], output[0]["scores"]["cost"] + 4, output[2]["scores"]["cost"] + 4))
            output[2]["scores"]["season"] = min(100, max(output[2]["scores"]["season"], output[0]["scores"]["season"] + 4, output[1]["scores"]["season"] + 4))
            output[0]["scores"]["region"] = min(100, max(output[0]["scores"]["region"], output[1]["scores"]["region"] + 4, output[2]["scores"]["region"] + 4))
        return output

    def _normalize_meals(self, value: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
        source = value if isinstance(value, list) else []
        defaults = fallback or [
            {"name": "早餐", "icon": "🌅", "food": "均衡早餐", "cals": "350 kcal"},
            {"name": "午餐", "icon": "☀️", "food": "高蛋白午餐", "cals": "550 kcal"},
            {"name": "晚餐", "icon": "🌙", "food": "清淡晚餐", "cals": "420 kcal"},
            {"name": "加餐", "icon": "🍎", "food": "低糖加餐", "cals": "150 kcal"},
        ]
        output = []
        for idx, default in enumerate(defaults[:4]):
            item = source[idx] if idx < len(source) and isinstance(source[idx], dict) else {}
            output.append(
                {
                    "name": str(item.get("name") or default.get("name")),
                    "icon": str(item.get("icon") or default.get("icon", "")),
                    "food": str(item.get("food") or default.get("food", "")),
                    "cals": str(item.get("cals") or default.get("cals", "")),
                }
            )
        return output

    def _normalize_ingredients(self, value: Any, fallback: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
        source = value if isinstance(value, dict) else {}
        output: dict[str, list[dict[str, str]]] = {}
        for key in ("meat", "veggies", "grains", "seasonings"):
            items = source.get(key)
            fallback_items = fallback.get(key) if isinstance(fallback, dict) else []
            if not isinstance(items, list):
                items = fallback_items if isinstance(fallback_items, list) else []
            output[key] = [
                {"name": str(item.get("name", "食材")), "qty": str(item.get("qty", "适量"))}
                for item in items
                if isinstance(item, dict)
            ][:6]
            if not output[key]:
                output[key] = [{"name": "按餐单采购", "qty": "适量"}]
        return output

    def _normalize_discussion(self, value: Any, fallback: dict[str, Any]) -> dict[str, Any]:
        source = value if isinstance(value, dict) else {}
        agents = source.get("agents")
        if not isinstance(agents, list):
            agents = fallback.get("agents", [])
        return {
            "agents": [
                {
                    "name": str(item.get("name", "Agent")),
                    "role": str(item.get("role", "方案生成")),
                    "opinion": str(item.get("opinion", "")),
                }
                for item in agents
                if isinstance(item, dict)
            ],
            "consensus": str(source.get("consensus") or fallback.get("consensus") or "多 Agent 已生成方案。"),
            "revision": fallback.get("revision", 0),
        }

    def _number_or(self, value: Any, fallback: Any) -> int:
        return round(self._float_or(value, fallback, default=0))

    def _float_or(self, value: Any, fallback: Any = 0, default: float = 0) -> float:
        for item in (value, fallback):
            if isinstance(item, (int, float)):
                return float(item)
            if isinstance(item, str):
                match = re.search(r"-?\d+(?:\.\d+)?", item.replace(",", ""))
                if match:
                    return float(match.group(0))
        return default

    def _score_or(self, value: Any, fallback: Any = 80) -> int:
        numeric = self._float_or(value, fallback, default=80)
        if numeric <= 0:
            numeric = self._float_or(fallback, 80, default=80)
        if numeric <= 1:
            numeric *= 100
        elif numeric <= 10:
            numeric *= 10
        return max(0, min(100, round(numeric)))

    def _normalize_macro_distribution(self, carbs: int, protein: int, fat: int) -> dict[str, int]:
        values = [float(carbs), float(protein), float(fat)]
        if any(value <= 0 for value in values):
            return {"carbs": 40, "protein": 32, "fat": 28}

        total = sum(values)
        if total > 110:
            macro_calories = values[0] * 4 + values[1] * 4 + values[2] * 9
            if macro_calories <= 0:
                return {"carbs": 40, "protein": 32, "fat": 28}
            values = [
                values[0] * 4 / macro_calories * 100,
                values[1] * 4 / macro_calories * 100,
                values[2] * 9 / macro_calories * 100,
            ]
        elif abs(total - 100) > 3:
            values = [value / total * 100 for value in values]

        carbs_pct = max(0, min(100, round(values[0])))
        protein_pct = max(0, min(100, round(values[1])))
        fat_pct = max(0, min(100, 100 - carbs_pct - protein_pct))
        return {"carbs": carbs_pct, "protein": protein_pct, "fat": fat_pct}

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
            scores = self._normalize_scores(plan.get("scores", {}), {})
            macros = self._normalize_macros(plan.get("macros", {}), {})
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
