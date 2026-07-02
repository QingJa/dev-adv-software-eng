/**
 * EdgeDietModel
 * Browser-side rule model used by the Web wrapper and PWA offline mode.
 * It intentionally keeps inference deterministic so it can run without cloud keys.
 */
(function attachEdgeDietModel(global) {
  "use strict";

  const VERSION = "edge-rules-1.0.0";
  const DEFAULT_PROFILE = {
    gender: "female",
    age: 28,
    height: 165,
    weight: 56,
    activity: "light",
    goal: "lose-fat",
    dietHabit: "balanced",
    region: "south",
    allergies: []
  };

  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    heavy: 1.725
  };

  const goalLabels = {
    "lose-fat": "减脂控糖",
    "gain-muscle": "增肌塑形",
    balanced: "均衡维持",
    maintain: "均衡维持",
    "low-gi": "低 GI 控糖"
  };

  const regionLabels = {
    south: "南方清爽家常",
    north: "北方杂粮鲜味",
    sichuan: "少油椒麻风味",
    western: "西式轻食风味"
  };

  const allergyMap = {
    seafood: ["鱼", "虾", "贝", "海鲜"],
    dairy: ["牛奶", "酸奶", "奶酪", "乳清"],
    nuts: ["坚果", "花生", "核桃", "杏仁"],
    gluten: ["面包", "小麦", "麸质"],
    "beef-pork": ["牛肉", "猪肉", "红肉"]
  };

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeProfile(profile) {
    const merged = { ...DEFAULT_PROFILE, ...(profile || {}) };
    const allergies = Array.isArray(merged.allergies)
      ? merged.allergies.filter(Boolean)
      : String(merged.allergies || "").split(",").map(item => item.trim()).filter(Boolean);
    return {
      ...merged,
      age: toNumber(merged.age, DEFAULT_PROFILE.age),
      height: toNumber(merged.height, DEFAULT_PROFILE.height),
      weight: toNumber(merged.weight, DEFAULT_PROFILE.weight),
      allergies
    };
  }

  function estimateProfile(profile) {
    const data = normalizeProfile(profile);
    const heightMeters = Math.max(data.height / 100, 0.1);
    const bmi = data.weight / (heightMeters * heightMeters);
    const bmr = data.gender === "male"
      ? 10 * data.weight + 6.25 * data.height - 5 * data.age + 5
      : 10 * data.weight + 6.25 * data.height - 5 * data.age - 161;
    const tdee = Math.round(bmr * (activityMultipliers[data.activity] || activityMultipliers.light));
    const targetCalories = data.goal === "gain-muscle"
      ? tdee + 320
      : data.goal === "low-gi"
        ? Math.max(1300, tdee - 180)
        : data.goal === "lose-fat"
          ? Math.max(1200, tdee - 420)
          : Math.max(1300, tdee - 80);

    return {
      profile: data,
      bmi: Number(bmi.toFixed(1)),
      bmiStatus: bmi < 18.5 ? "偏低" : bmi < 24 ? "标准" : bmi < 28 ? "偏高" : "需重点关注",
      bmr: Math.round(bmr),
      tdee,
      targetCalories: Math.round(targetCalories),
      goalLabel: goalLabels[data.goal] || "健康饮食",
      regionLabel: regionLabels[data.region] || "家常低负担"
    };
  }

  function normalizeMacros(macros) {
    const total = macros.carbs + macros.protein + macros.fat;
    if (!total) return { carbs: 42, protein: 32, fat: 26 };
    return {
      carbs: Math.round(macros.carbs * 100 / total),
      protein: Math.round(macros.protein * 100 / total),
      fat: Math.max(0, 100 - Math.round(macros.carbs * 100 / total) - Math.round(macros.protein * 100 / total))
    };
  }

  function applyGoalMacros(profile, angle) {
    if (profile.goal === "gain-muscle") {
      return normalizeMacros(angle === 0
        ? { carbs: 38, protein: 40, fat: 22 }
        : angle === 1
          ? { carbs: 44, protein: 34, fat: 22 }
          : { carbs: 34, protein: 36, fat: 30 });
    }
    if (profile.goal === "low-gi") {
      return normalizeMacros(angle === 0
        ? { carbs: 30, protein: 38, fat: 32 }
        : angle === 1
          ? { carbs: 36, protein: 34, fat: 30 }
          : { carbs: 28, protein: 36, fat: 36 });
    }
    return normalizeMacros(angle === 0
      ? { carbs: 36, protein: 36, fat: 28 }
      : angle === 1
        ? { carbs: 46, protein: 30, fat: 24 }
        : { carbs: 38, protein: 30, fat: 32 });
  }

  function avoidFood(profile, text, replacement) {
    const blockedWords = profile.allergies
      .flatMap(key => allergyMap[key] || [])
      .filter(Boolean);
    return blockedWords.some(word => text.includes(word)) ? replacement : text;
  }

  function makeMeal(profile, angle, calories, mealName, baseFood, fallbackFood, ratio) {
    const food = avoidFood(profile, baseFood, fallbackFood);
    return {
      name: mealName,
      icon: mealName === "早餐" ? "早" : mealName === "午餐" ? "午" : mealName === "晚餐" ? "晚" : "加",
      food,
      cals: `${Math.round(calories * ratio)} kcal`
    };
  }

  function ingredientsFor(profile, angle) {
    const fishProtein = profile.allergies.includes("seafood") ? "鸡胸肉" : "鱼片";
    const dairyProtein = profile.allergies.includes("dairy") ? "无糖豆浆" : "低脂酸奶";
    const redProtein = profile.allergies.includes("beef-pork") ? "鸡腿肉" : "牛肉";
    const grain = profile.allergies.includes("gluten") ? "糙米" : "全麦面包";
    const snack = profile.allergies.includes("nuts") ? "蓝莓" : "坚果";

    if (angle === 1) {
      return {
        meat: [{ name: redProtein, qty: "120g" }, { name: "北豆腐", qty: "150g" }],
        veggies: [{ name: "番茄", qty: "150g" }, { name: "黄瓜", qty: "150g" }, { name: "生菜", qty: "150g" }],
        grains: [{ name: "红薯", qty: "150g" }, { name: "杂粮饭", qty: "80g" }],
        seasonings: [{ name: "生抽", qty: "少量" }, { name: "香醋", qty: "少量" }]
      };
    }
    if (angle === 2) {
      return {
        meat: [{ name: fishProtein, qty: "150g" }, { name: "鸡胸肉", qty: "100g" }, { name: dairyProtein, qty: "150g" }],
        veggies: [{ name: "芦笋", qty: "120g" }, { name: "圣女果", qty: "150g" }, { name: "牛油果", qty: "半个" }],
        grains: [{ name: grain, qty: "1份" }, { name: "藜麦", qty: "40g" }],
        seasonings: [{ name: "橄榄油", qty: "15ml" }, { name: "黑胡椒", qty: "少量" }]
      };
    }
    return {
      meat: [{ name: "鸡胸肉", qty: "120g" }, { name: "鸡蛋", qty: "1个" }, { name: fishProtein, qty: "100g" }],
      veggies: [{ name: "西兰花", qty: "150g" }, { name: "菜心", qty: "200g" }, { name: "小番茄", qty: "100g" }],
      grains: [{ name: "燕麦", qty: "40g" }, { name: "糙米", qty: "80g" }],
      seasonings: [{ name: "橄榄油", qty: "10ml" }, { name: "低钠盐", qty: "少量" }]
    };
  }

  function generatePlans(profile, options) {
    const estimated = estimateProfile(profile);
    const data = estimated.profile;
    const region = estimated.regionLabel;
    const calories = estimated.targetCalories;
    const plans = [
      {
        name: "端侧稳态高蛋白餐",
        sub: `${region} · 离线规则模型推荐`,
        calories,
        angleLabel: "端侧稳态角度",
        macros: applyGoalMacros(data, 0),
        scores: { cost: 84, season: 84, region: 90 },
        agentScore: 86,
        agentNotes: "端侧模型优先保证蛋白质和执行稳定性，适合后端不可用时继续使用。",
        meals: [
          makeMeal(data, 0, calories, "早餐", "水煮蛋1个 + 无糖豆浆1杯 + 燕麦蓝莓碗", "无糖豆浆1杯 + 玉米半根 + 蓝莓", 0.25),
          makeMeal(data, 0, calories, "午餐", "香煎鸡胸肉120g + 西兰花150g + 糙米饭80g", "鸡胸肉120g + 西兰花150g + 糙米饭80g", 0.4),
          makeMeal(data, 0, calories, "晚餐", "番茄豆腐鱼片汤 + 白灼菜心200g", "番茄豆腐鸡肉汤 + 白灼菜心200g", 0.25),
          makeMeal(data, 0, calories, "加餐", "无糖酸奶1杯 + 小番茄100g", "无糖豆浆半杯 + 小番茄100g", 0.1)
        ],
        ingredients: ingredientsFor(data, 0)
      },
      {
        name: "端侧高纤慢糖餐",
        sub: `${region} · 离线饱腹模型推荐`,
        calories: calories + 60,
        angleLabel: "端侧饱腹角度",
        macros: applyGoalMacros(data, 1),
        scores: { cost: 94, season: 82, region: 80 },
        agentScore: 84,
        agentNotes: "端侧模型提高慢糖主食和膳食纤维比例，适合控制饥饿感。",
        meals: [
          makeMeal(data, 1, calories + 60, "早餐", "蒸红薯1根 + 无糖豆浆1杯 + 水煮蛋1个", "蒸红薯1根 + 无糖豆浆1杯 + 鹰嘴豆", 0.25),
          makeMeal(data, 1, calories + 60, "午餐", "番茄牛肉杂粮碗 + 凉拌黄瓜", "番茄鸡肉杂粮碗 + 凉拌黄瓜", 0.4),
          makeMeal(data, 1, calories + 60, "晚餐", "菌菇豆腐汤 + 清炒生菜150g", "菌菇豆腐汤 + 清炒生菜150g", 0.25),
          makeMeal(data, 1, calories + 60, "加餐", "苹果半个 + 无糖茶1杯", "苹果半个 + 无糖茶1杯", 0.1)
        ],
        ingredients: ingredientsFor(data, 1)
      },
      {
        name: "端侧轻负担优脂餐",
        sub: `${region} · 离线时令模型推荐`,
        calories: calories + 100,
        angleLabel: "端侧时令角度",
        macros: applyGoalMacros(data, 2),
        scores: { cost: 78, season: 96, region: 88 },
        agentScore: 82,
        agentNotes: "端侧模型加强时令蔬果和优质脂肪，成本略高但适合提升口感。",
        meals: [
          makeMeal(data, 2, calories + 100, "早餐", "全麦面包1片 + 圣女果8个 + 低脂酸奶", "糙米饭团 + 圣女果8个 + 无糖豆浆", 0.25),
          makeMeal(data, 2, calories + 100, "午餐", "柠檬香草鱼排 + 藜麦饭40g + 蒜蓉芦笋", "柠檬鸡胸肉 + 藜麦饭40g + 蒜蓉芦笋", 0.4),
          makeMeal(data, 2, calories + 100, "晚餐", "鸡肉牛油果沙拉 + 番茄豆腐汤", "鸡肉牛油果沙拉 + 番茄豆腐汤", 0.25),
          makeMeal(data, 2, calories + 100, "加餐", `蓝莓50g + ${data.allergies.includes("nuts") ? "南瓜籽少量" : "坚果少量"}`, "蓝莓50g + 南瓜籽少量", 0.1)
        ],
        ingredients: ingredientsFor(data, 2)
      }
    ];

    return {
      mode: "edge",
      modelVersion: VERSION,
      generatedAt: new Date().toISOString(),
      planDate: options?.planDate || new Date().toISOString().slice(0, 10),
      bmr: estimated.bmr,
      tdee: estimated.tdee,
      targetCalories: estimated.targetCalories,
      bmi: estimated.bmi,
      bmiStatus: estimated.bmiStatus,
      plans,
      planDiscussion: {
        agents: [
          { name: "端侧代谢规则", role: "BMI/BMR/TDEE", opinion: `BMI ${estimated.bmi}，状态：${estimated.bmiStatus}。` },
          { name: "端侧忌口过滤", role: "隐私与过敏安全", opinion: data.allergies.length ? "已按过敏/禁忌词进行本地替换。" : "未检测到明确忌口。" },
          { name: "端侧商业可用性", role: "离线稳定性", opinion: "后端或云端模型不可用时仍可生成基础方案。" }
        ],
        consensus: "端侧规则模型已完成离线基础规划，可作为 Web 套壳 APP 的核心原生价值能力。",
        revision: 0
      }
    };
  }

  function sanitizeShareText(text) {
    return String(text || "")
      .replace(/1[3-9]\d{9}/g, "[已脱敏电话]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已脱敏邮箱]")
      .replace(/(姓名|电话|联系方式|疾病史|身份证)[：:][^\n，。；;]+/g, "$1：[已脱敏]");
  }

  function run(profile, options) {
    const startedAt = global.performance?.now ? global.performance.now() : Date.now();
    const result = generatePlans(profile, options || {});
    const endedAt = global.performance?.now ? global.performance.now() : Date.now();
    return {
      ...result,
      runtimeMs: Math.max(1, Math.round(endedAt - startedAt)),
      capability: ["offline-plan", "macro-target", "allergy-filter", "privacy-sanitize"]
    };
  }

  global.EdgeDietModel = {
    VERSION,
    estimateProfile,
    generatePlans,
    run,
    sanitizeShareText
  };
})(window);
