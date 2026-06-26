from __future__ import annotations

from typing import Any


def create_profile(payload: dict[str, Any]) -> dict[str, Any]:
    height_m = max(float(payload.get("height", 165)) / 100, 0.1)
    weight = float(payload.get("weight", 56))
    bmi = round(weight / (height_m * height_m), 1)
    extra_profile = payload.get("extraProfile") if isinstance(payload.get("extraProfile"), dict) else {}
    goal_map = {
        "lose-fat": "减脂控糖",
        "gain-muscle": "增肌塑形",
        "maintain": "均衡维持",
    }
    profile_tags = [
        goal_map.get(payload.get("goal"), "健康饮食"),
        "偏好已采集" if payload.get("dietHabit") else "偏好待细化",
        "存在忌口约束" if payload.get("allergies") or extra_profile.get("avoids") else "无明显忌口",
    ]
    return {
        "mode": "mock",
        "agentEngine": "local-fallback",
        "profile": payload,
        "computed": {
            "bmi": bmi,
            "bmiStatus": "标准" if 18.5 <= bmi < 24 else "需关注",
        },
        "agentProfile": {
            "summary": f"用户画像已形成：BMI {bmi}，目标偏向{profile_tags[0]}，后续方案需结合地域口味、忌口和执行难度。",
            "tags": profile_tags,
            "focus": ["能量目标", "营养比例", "饮食偏好", "食材可得性"],
        },
    }


def build_diet_plans(payload: dict[str, Any]) -> dict[str, Any]:
    profile = payload.get("profile", payload)
    age = int(profile.get("age", 28))
    height = int(profile.get("height", 165))
    weight = int(profile.get("weight", 56))
    gender = profile.get("gender", "female")
    region = profile.get("region", "south")
    goal = profile.get("goal", "lose-fat")
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if gender == "male" else -161)
    tdee = round(bmr * 1.375)
    calories = max(1200, tdee - 350 if goal == "lose-fat" else tdee + 250 if goal == "gain-muscle" else tdee - 120)
    flavor = {
        "south": "清爽江浙粤风味",
        "north": "北方杂粮鲜味",
        "sichuan": "少油椒麻风味",
        "western": "西式轻食风味",
    }.get(region, "均衡家常风味")
    plans = [
        {
            "name": "营养稳态高蛋白餐",
            "sub": f"{flavor} · 营养约束 Agent 推荐",
            "calories": calories,
            "macros": {"carbs": 36, "protein": 36, "fat": 28},
            "meals": [
                {"name": "早餐", "icon": "🌅", "food": "水煮蛋1个 + 无糖豆浆1杯 + 燕麦蓝莓碗", "cals": f"{round(calories * 0.25)} kcal"},
                {"name": "午餐", "icon": "☀️", "food": "香煎鸡胸肉120g + 西兰花150g + 糙米饭80g", "cals": f"{round(calories * 0.40)} kcal"},
                {"name": "晚餐", "icon": "🌙", "food": "番茄豆腐鱼片汤 + 白灼菜心200g", "cals": f"{round(calories * 0.25)} kcal"},
                {"name": "加餐", "icon": "🍎", "food": "无糖酸奶1杯 + 小番茄100g", "cals": f"{round(calories * 0.10)} kcal"},
            ],
            "ingredients": {
                "meat": [{"name": "鸡胸肉", "qty": "120g"}, {"name": "鸡蛋", "qty": "1个"}, {"name": "鱼片", "qty": "100g"}],
                "veggies": [{"name": "西兰花", "qty": "150g"}, {"name": "菜心", "qty": "200g"}, {"name": "小番茄", "qty": "100g"}],
                "grains": [{"name": "燕麦", "qty": "40g"}, {"name": "糙米", "qty": "80g"}],
                "seasonings": [{"name": "橄榄油", "qty": "10ml"}, {"name": "低钠盐", "qty": "少量"}],
            },
            "scores": {"cost": 80, "season": 84, "region": 94},
            "agentScore": 88,
            "agentNotes": "蛋白充足，执行难度低，适合作为默认推荐。",
        },
        {
            "name": "高纤慢糖饱腹餐",
            "sub": f"{flavor} · 偏好体验 Agent 推荐",
            "calories": calories + 80,
            "macros": {"carbs": 48, "protein": 30, "fat": 22},
            "meals": [
                {"name": "早餐", "icon": "🌅", "food": "蒸红薯1根 + 无糖豆浆1杯 + 水煮蛋1个", "cals": f"{round((calories + 80) * 0.25)} kcal"},
                {"name": "午餐", "icon": "☀️", "food": "番茄牛肉杂粮碗 + 凉拌黄瓜", "cals": f"{round((calories + 80) * 0.40)} kcal"},
                {"name": "晚餐", "icon": "🌙", "food": "菌菇豆腐汤 + 清炒生菜150g", "cals": f"{round((calories + 80) * 0.25)} kcal"},
                {"name": "加餐", "icon": "🍎", "food": "苹果半个 + 无糖茶1杯", "cals": f"{round((calories + 80) * 0.10)} kcal"},
            ],
            "ingredients": {
                "meat": [{"name": "牛肉", "qty": "120g"}, {"name": "北豆腐", "qty": "150g"}],
                "veggies": [{"name": "番茄", "qty": "150g"}, {"name": "黄瓜", "qty": "150g"}, {"name": "生菜", "qty": "150g"}],
                "grains": [{"name": "红薯", "qty": "150g"}, {"name": "杂粮饭", "qty": "80g"}],
                "seasonings": [{"name": "生抽", "qty": "少量"}, {"name": "香醋", "qty": "少量"}],
            },
            "scores": {"cost": 94, "season": 82, "region": 78},
            "agentScore": 84,
            "agentNotes": "膳食纤维和慢糖主食更突出，饱腹感更强。",
        },
        {
            "name": "时令优脂轻负担餐",
            "sub": f"{flavor} · 成本季节 Agent 推荐",
            "calories": calories + 120,
            "macros": {"carbs": 38, "protein": 30, "fat": 32},
            "meals": [
                {"name": "早餐", "icon": "🌅", "food": "全麦面包1片 + 圣女果8个 + 低脂酸奶", "cals": f"{round((calories + 120) * 0.25)} kcal"},
                {"name": "午餐", "icon": "☀️", "food": "柠檬香草鱼排 + 藜麦饭40g + 蒜蓉芦笋", "cals": f"{round((calories + 120) * 0.40)} kcal"},
                {"name": "晚餐", "icon": "🌙", "food": "鸡肉牛油果沙拉 + 番茄豆腐汤", "cals": f"{round((calories + 120) * 0.25)} kcal"},
                {"name": "加餐", "icon": "🍎", "food": "蓝莓50g + 坚果少量", "cals": f"{round((calories + 120) * 0.10)} kcal"},
            ],
            "ingredients": {
                "meat": [{"name": "鱼排", "qty": "150g"}, {"name": "鸡胸肉", "qty": "100g"}, {"name": "低脂酸奶", "qty": "150g"}],
                "veggies": [{"name": "芦笋", "qty": "120g"}, {"name": "圣女果", "qty": "150g"}, {"name": "牛油果", "qty": "半个"}],
                "grains": [{"name": "全麦面包", "qty": "1片"}, {"name": "藜麦", "qty": "40g"}],
                "seasonings": [{"name": "橄榄油", "qty": "15ml"}, {"name": "黑胡椒", "qty": "少量"}],
            },
            "scores": {"cost": 76, "season": 96, "region": 88},
            "agentScore": 80,
            "agentNotes": "优质脂肪和时令蔬果较强，成本略高。",
        },
    ]
    return {
        "mode": "mock",
        "agentEngine": "local-fallback",
        "bmr": round(bmr),
        "tdee": tdee,
        "targetCalories": calories,
        "plans": plans,
        "planDiscussion": {
            "agents": [
                {"name": "营养约束 Agent", "role": "热量、宏量营养、过敏安全", "opinion": "先计算能量目标，再约束蛋白、碳水、脂肪比例。"},
                {"name": "偏好体验 Agent", "role": "饮食偏好、地域风味、执行难度", "opinion": "让餐单更接近日常可执行，而不是只追求理论最优。"},
                {"name": "成本季节 Agent", "role": "采购成本、时令食材、地域可得性", "opinion": "优先选择容易买到、成本稳定、季节适宜的食材。"},
            ],
            "consensus": "本地 fallback 已生成 3 套可执行方案；接入大模型后将由云端多 Agent 生成和讨论。",
            "revision": int(payload.get("planConstraints", {}).get("revision", 0)),
        },
    }


def build_ingredients(payload: dict[str, Any]) -> dict[str, Any]:
    plans = payload.get("plans", [])
    active_index = int(payload.get("activePlanIndex", 0) or 0)
    selected = plans[active_index] if 0 <= active_index < len(plans) else (plans[0] if plans else {})
    return {
        "mode": "mock",
        "planName": selected.get("name", "方案"),
        "ingredients": selected.get("ingredients") or {},
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


def _score_value(value: Any, fallback: int = 80) -> int:
    try:
        numeric = float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        numeric = float(fallback)
    if numeric <= 0:
      numeric = float(fallback)
    if numeric <= 1:
      numeric *= 100
    elif numeric <= 10:
      numeric *= 10
    return max(0, min(100, round(numeric)))


def score_plans(payload: dict[str, Any]) -> dict[str, Any]:
    weights = payload.get("weights", {"cost": 33, "season": 33, "region": 34})
    plans = payload.get("plans", [])
    scored = []
    for idx, plan in enumerate(plans):
        scores = plan.get("scores", {})
        final = round(
            _score_value(scores.get("cost", 80)) * weights.get("cost", 0) / 100
            + _score_value(scores.get("season", 80)) * weights.get("season", 0) / 100
            + _score_value(scores.get("region", 80)) * weights.get("region", 0) / 100
        )
        scored.append({"idx": idx, "name": plan.get("name", f"方案 {idx + 1}"), "score": final})
    winner = max(scored, key=lambda item: item["score"]) if scored else None
    return {"scores": scored, "winner": winner}


def build_marketing(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("selectedPlan") or payload.get("plan") or {}
    if not isinstance(plan, dict):
        plan = {}
    name = plan.get("name", "智能健康餐")
    calories = plan.get("calories", "--")
    macros = plan.get("macros", {})
    meals = plan.get("meals", [])
    if isinstance(meals, dict):
        labels = {
            "breakfast": "早餐",
            "lunch": "午餐",
            "dinner": "晚餐",
            "snack": "加餐",
        }
        meal_items = [{"name": labels.get(key, key), "food": value} for key, value in meals.items()]
    elif isinstance(meals, list):
        meal_items = meals
    else:
        meal_items = []
    meal_text = "；".join(
        f"{item.get('name', '餐次')}：{item.get('food', '')}"
        for item in meal_items
        if isinstance(item, dict)
    )
    meal_lines = "\n".join(
        f"- {item.get('name', '餐次')}：{item.get('food', '')}"
        for item in meal_items
        if isinstance(item, dict)
    ) or "- 餐单已按最终方案生成。"
    ingredients = plan.get("ingredients", {})
    ingredient_names: list[str] = []
    if isinstance(ingredients, dict):
        for items in ingredients.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict):
                    ingredient_names.append(str(item.get("name") or item.get("food") or "").strip())
                elif isinstance(item, str):
                    ingredient_names.append(item.strip())
    ingredient_highlights = "、".join([item for item in ingredient_names if item][:6]) or "优质蛋白、时令蔬果、基础谷物和低负担调味"
    xhs_text = f"""📌 我的专属健康饮食计划：【{name}】✨

今天系统根据我的健康目标、活动量、饮食偏好和地域口味，生成了一套可以执行的饮食计划。
这份内容更适合作为个人健康管理记录：方案、热量、营养比例和采购清单都已经整理好，后续可以直接复盘和打卡。

📊 每日能量与营养结构：
- 每日预算：{calories} kcal
- 三大营养素比例：碳水 {macros.get('carbs', '--')}% | 蛋白质 {macros.get('protein', '--')}% | 脂肪 {macros.get('fat', '--')}%

🍽 一日餐单：
{meal_lines}

🛒 采购重点：
{ingredient_highlights}

这次计划的重点不是追求极端控制，而是把“能坚持、买得到、吃得舒服”放在一起考虑。
接下来准备按这个方案执行几天，观察饱腹感、备餐难度和身体状态，再继续微调。

#健康饮食记录 #饮食计划打卡 #科学备餐 #AI饮食规划"""
    video_text = f"""🎬 短视频打卡脚本：《我的一日健康饮食计划》

【视频时长】30 秒左右
【内容定位】真实记录、自律日常、健康管理

画面 1：打开健康饮食规划页面，镜头扫过最终推荐方案。
旁白：今天给自己生成了一套更适合当前目标的饮食计划。

画面 2：展示方案名称和能量预算。
旁白：最终选择的是【{name}】，全天约 {calories} kcal，营养比例是碳水 {macros.get('carbs', '--')}%、蛋白质 {macros.get('protein', '--')}%、脂肪 {macros.get('fat', '--')}%。

画面 3：切到三餐或备餐画面。
旁白：今天的餐单安排是：
{meal_lines}

画面 4：展示采购清单或食材。
旁白：采购清单也已经按分类整理好，重点食材包括 {ingredient_highlights}。

画面 5：展示完成的餐食或计划截图。
旁白：先按这个计划执行几天，再回来复盘真实感受。"""
    gzh_text = f"""标题：我的健康饮食计划记录：【{name}】

一、计划背景
这是一份面向个人执行和复盘的健康饮食计划。系统先整理基础画像，再生成多套方案，最后结合成本、季节和地域适配度选出当前推荐方案。

二、最终方案
本次选择的是【{name}】。
- 每日能量预算：{calories} kcal
- 营养结构：碳水 {macros.get('carbs', '--')}% | 蛋白质 {macros.get('protein', '--')}% | 脂肪 {macros.get('fat', '--')}%

三、餐单安排
{meal_lines}

四、采购与执行
本次采购重点包括 {ingredient_highlights}。采购清单已经按类别整理，适合直接用于超市采购、备餐准备和后续复盘。

五、复盘方向
后续执行时重点观察三个问题：是否容易坚持、餐后饱腹感是否稳定、采购和烹饪成本是否合适。饮食计划不是一次生成后就固定不变，而是根据真实反馈继续调整。"""
    promo_text = f"""【商家推广文案｜最终方案脱敏版】

推广主题：{name} 健康餐组合

本推广内容只基于最终餐单、营养结构和采购清单生成，不包含姓名、年龄、身高、体重、联系方式、疾病史等个人健康隐私。

方案卖点：
- 每日能量规划约 {calories} kcal，可作为健康餐套餐或营养搭配案例。
- 营养结构清晰：碳水 {macros.get('carbs', '--')}% | 蛋白质 {macros.get('protein', '--')}% | 脂肪 {macros.get('fat', '--')}%。
- 餐单完整：{meal_text or '已生成早餐、午餐、晚餐和加餐安排'}。
- 采购清单可落地：重点食材包括 {ingredient_highlights}。

推荐发布文案：
今天推荐一套可直接落地的健康饮食组合：【{name}】。它把三餐、热量预算和采购清单一起整理好，既方便用户照着执行，也方便商家做健康餐套餐、食材组合包或营养咨询展示。

合规提示：正式推广时请使用脱敏案例和商家自有菜品图片；如引用真实用户计划，应先获得授权。"""
    return {
        "mode": "mock",
        "xhsText": xhs_text,
        "videoText": video_text,
        "gzhText": gzh_text,
        "promoText": promo_text,
    }
