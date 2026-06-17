from __future__ import annotations

from typing import Any


def create_profile(payload: dict[str, Any]) -> dict[str, Any]:
    height_m = max(float(payload.get("height", 165)) / 100, 0.1)
    weight = float(payload.get("weight", 56))
    bmi = round(weight / (height_m * height_m), 1)
    return {
        "profile": payload,
        "computed": {
            "bmi": bmi,
            "bmiStatus": "标准" if 18.5 <= bmi < 24 else "需关注",
        },
    }


def build_diet_plans(payload: dict[str, Any]) -> dict[str, Any]:
    profile = payload.get("profile", payload)
    age = int(profile.get("age", 28))
    height = int(profile.get("height", 165))
    weight = int(profile.get("weight", 56))
    gender = profile.get("gender", "female")
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if gender == "male" else -161)
    tdee = round(bmr * 1.375)
    calories = max(1200, tdee - 350)
    plans = [
        {
            "name": "后端方案 A：稳态高蛋白餐",
            "calories": calories,
            "macros": {"carbs": 36, "protein": 36, "fat": 28},
            "scores": {"cost": 86, "season": 90, "region": 88},
        },
        {
            "name": "后端方案 B：高纤慢糖餐",
            "calories": calories + 80,
            "macros": {"carbs": 48, "protein": 30, "fat": 22},
            "scores": {"cost": 82, "season": 86, "region": 85},
        },
        {
            "name": "后端方案 C：地中海优脂餐",
            "calories": calories + 120,
            "macros": {"carbs": 38, "protein": 30, "fat": 32},
            "scores": {"cost": 68, "season": 92, "region": 76},
        },
    ]
    return {"bmr": round(bmr), "tdee": tdee, "plans": plans}


def build_ingredients(payload: dict[str, Any]) -> dict[str, Any]:
    plans = payload.get("plans", [])
    return {
        "lists": [
            {
                "planName": plan.get("name", "方案"),
                "items": [
                    {"name": "优质蛋白", "qty": "180g"},
                    {"name": "时令蔬菜", "qty": "350g"},
                    {"name": "低 GI 主食", "qty": "80g"},
                ],
            }
            for plan in plans
        ]
    }


def score_plans(payload: dict[str, Any]) -> dict[str, Any]:
    weights = payload.get("weights", {"cost": 33, "season": 33, "region": 34})
    plans = payload.get("plans", [])
    scored = []
    for idx, plan in enumerate(plans):
        scores = plan.get("scores", {})
        final = round(
            scores.get("cost", 0) * weights.get("cost", 0) / 100
            + scores.get("season", 0) * weights.get("season", 0) / 100
            + scores.get("region", 0) * weights.get("region", 0) / 100
        )
        scored.append({"idx": idx, "name": plan.get("name", f"方案 {idx + 1}"), "score": final})
    winner = max(scored, key=lambda item: item["score"]) if scored else None
    return {"scores": scored, "winner": winner}


def build_marketing(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("selectedPlan") or {}
    name = plan.get("name", "智能健康餐")
    calories = plan.get("calories", "--")
    return {
        "xhsText": f"AI 多智能体推荐「{name}」，每日约 {calories} kcal，适合持续健康管理。",
        "videoText": f"30 秒短视频脚本：展示 {name} 的早餐、午餐、晚餐和采购清单。",
        "gzhText": f"公众号文章：从用户画像、营养结构和成本评估拆解 {name}。",
    }
