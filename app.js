/**
 * 多智能体健康饮食规划系统 - app.js
 * 负责状态控制、智能体模拟算法、动态数据渲染、以及可视化的权重评估运算
 */

// 全局状态管理
const state = {
  currentStep: 1,
  formData: {},
  plans: [],
  activePlanIndex: 0,
  weights: {
    cost: 33,
    season: 33,
    region: 34
  },
  selectedPlanIndex: 0,
  logsQueue: [],
  isLogTyping: false
};

// 页面 DOM 加载完毕后执行初始化
document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  initWeightSliders();
  addSystemLog("system", "系统初始化完成。多智能体协作总线正处于待命状态。");
  addSystemLog("client", "您好！我是您的客户经理。请填写左侧的基础健康问卷，我将为您建立数字画像。");
});

// 初始化事件监听
function initEventListeners() {
  // 提交问卷按钮
  const submitBtn = document.getElementById("submitFormBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", handleFormSubmit);
  }

  // 导航按钮（上一步/下一步）
  document.querySelectorAll(".prev-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const prevStep = parseInt(btn.getAttribute("data-prev"));
      goToStep(prevStep);
    });
  });

  document.querySelectorAll(".next-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const nextStep = parseInt(btn.getAttribute("data-next"));
      triggerStepTransition(nextStep);
    });
  });

  // 营销推广 Tab 切换
  document.querySelectorAll(".marketing-tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const platform = e.target.getAttribute("data-platform");
      document.querySelectorAll(".marketing-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".marketing-panel").forEach(p => p.classList.remove("active"));
      
      e.target.classList.add("active");
      document.getElementById(`market-${platform}`).classList.add("active");
      addSystemLog("market", `已切换到【${e.target.innerText}】生成面板。`);
    });
  });

  // 一键复制功能
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const textToCopy = document.getElementById(targetId).innerText;
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        const origText = btn.innerHTML;
        btn.innerHTML = `<span>✓</span> <span>已复制成功！</span>`;
        btn.classList.add("copied");
        addSystemLog("system", `已将生成的内容成功复制到剪贴板。`);
        
        setTimeout(() => {
          btn.innerHTML = origText;
          btn.classList.remove("copied");
        }, 2000);
      }).catch(err => {
        console.error("复制失败: ", err);
        alert("复制失败，请手动选择复制。");
      });
    });
  });

  // 重新开始按钮
  const restartBtn = document.getElementById("restartBtn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      state.currentStep = 1;
      document.getElementById("healthForm").reset();
      document.getElementById("ageVal").innerText = "28";
      document.getElementById("heightVal").innerText = "165";
      document.getElementById("weightVal").innerText = "56";
      
      // 重置权重
      state.weights = { cost: 33, season: 33, region: 34 };
      document.getElementById("weightCost").value = 33;
      document.getElementById("weightSeason").value = 33;
      document.getElementById("weightRegion").value = 34;
      updateWeightTextDisplays();

      goToStep(1);
      
      // 清空部分日志并提示
      const consoleLogs = document.getElementById("consoleLogs");
      consoleLogs.innerHTML = "";
      addSystemLog("system", "系统状态已重置，准备开启新的健康规划流程。");
      addSystemLog("client", "您好！我是您的客户经理。请重新填写健康问卷。");
    });
  }

  // 宣传视频生成按钮
  const genVideoBtn = document.getElementById("generateVideoBtn");
  if (genVideoBtn) {
    genVideoBtn.addEventListener("click", startVideoRecording);
  }

  // 描述包下载按钮
  const downloadPackBtn = document.getElementById("downloadPublishPackBtn");
  if (downloadPackBtn) {
    downloadPackBtn.addEventListener("click", downloadPublishPackage);
  }

  // 机器人指南弹窗
  const openDialogBtn = document.getElementById("openPublishDialogBtn");
  if (openDialogBtn) {
    openDialogBtn.addEventListener("click", () => {
      document.getElementById("publishDialog").showModal();
    });
  }
}

// 权重滑块联动调节机制
function initWeightSliders() {
  const sliders = {
    cost: document.getElementById("weightCost"),
    season: document.getElementById("weightSeason"),
    region: document.getElementById("weightRegion")
  };

  const keys = ["cost", "season", "region"];

  keys.forEach(key => {
    sliders[key].addEventListener("input", (e) => {
      const changedKey = key;
      const newVal = parseInt(e.target.value);
      
      // 当前发生变化的滑块固定其新值
      state.weights[changedKey] = newVal;
      
      // 计算剩下的额度，分配给其他两个滑块
      const remaining = 100 - newVal;
      const otherKeys = keys.filter(k => k !== changedKey);
      
      const val1 = parseInt(sliders[otherKeys[0]].value);
      const val2 = parseInt(sliders[otherKeys[1]].value);
      const sumOthers = val1 + val2;
      
      if (sumOthers === 0) {
        // 如果其他两个原本都是0，则平分剩余值
        state.weights[otherKeys[0]] = Math.floor(remaining / 2);
        state.weights[otherKeys[1]] = Math.ceil(remaining / 2);
      } else {
        // 否则按原本的比例瓜分剩余值
        const ratio1 = val1 / sumOthers;
        const newVal1 = Math.round(remaining * ratio1);
        const newVal2 = remaining - newVal1;
        
        state.weights[otherKeys[0]] = newVal1;
        state.weights[otherKeys[1]] = newVal2;
      }

      // 将计算后的数值更新回 DOM 元素
      sliders[otherKeys[0]].value = state.weights[otherKeys[0]];
      sliders[otherKeys[1]].value = state.weights[otherKeys[1]];

      updateWeightTextDisplays();
      
      // 触发评估助理的实时评分更新
      if (state.currentStep === 4) {
        evaluatePlansRealtime();
      }
    });
  });
}

// 更新权重显示的文本数值
function updateWeightTextDisplays() {
  document.getElementById("weightCostText").innerText = `${state.weights.cost}%`;
  document.getElementById("weightSeasonText").innerText = `${state.weights.season}%`;
  document.getElementById("weightRegionText").innerText = `${state.weights.region}%`;
}

// 切换到具体步骤 (静态页面显示控制)
function goToStep(step) {
  state.currentStep = step;
  
  // 切换所有 View 的显示状态
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  document.getElementById(`step-${step}`).classList.add("active");

  // 更新进度条和高亮标题
  const progressPercent = step * 20;
  document.getElementById("progressBar").style.width = `${progressPercent}%`;
  
  const stepNames = [
    "客户经理 - 问卷收集",
    "饮食助理 - 方案定制",
    "食材助理 - 清单规划",
    "评估助理 - 方案评估",
    "营销助理 - 软文推广"
  ];
  document.getElementById("current-step-name").innerText = stepNames[step - 1];

  // 侧边栏智能体高亮控制
  document.querySelectorAll(".agent-card").forEach(card => {
    card.classList.remove("active");
  });

  const agentMapping = ["client", "diet", "ingredient", "eval", "market"];
  const currentAgent = agentMapping[step - 1];
  document.getElementById(`agent-${currentAgent}`).classList.add("active");
}

// 带加载动画和日志的智能体步骤流转
function triggerStepTransition(targetStep) {
  // 显示加载遮罩
  const loadingView = document.getElementById("step-loading");
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  loadingView.classList.add("active");

  const processingText = document.getElementById("processingText");
  
  // 注入不同步骤的智能体日志流
  if (targetStep === 2) {
    processingText.innerText = "饮食助理正在根据画像为您设计膳食规划...";
    
    enqueueLog("client", "问卷收集完成，正在处理过滤字段、排查过敏源...");
    enqueueLog("system", "用户健康画像序列化打包完成。正通过消息队列发送至 [饮食助理]。");
    enqueueLog("diet", "收到用户健康画像！");
    enqueueLog("diet", `目标：${translateGoal(state.formData.goal)} | 饮食风格：${translateHabit(state.formData.dietHabit)}`);
    enqueueLog("diet", `过敏排除食材：${state.formData.allergies.length > 0 ? state.formData.allergies.map(translateAllergy).join('、') : '无'}`);
    enqueueLog("diet", "基于 Mifflin-St Jeor 公式计算能量代谢...");
    
    // 计算并生成饮食数据
    calculateAndGenerateDietData();

    enqueueLog("diet", `计算完成。基础代谢(BMR) ≈ ${state.bmr} kcal，日消耗(TDEE) ≈ ${state.tdee} kcal。每日饮食热量靶点设定。`);
    enqueueLog("diet", "已成功为您定制了3套侧重点不同的健康饮食方案：\n1️⃣ 方案 A (低碳水/核心诉求)\n2️⃣ 方案 B (高蛋白/高纤膳食)\n3️⃣ 方案 C (地中海温和食谱)");
    enqueueLog("diet", "已将膳食数据流发送给 [食材助理] 进行采购量核查。");
    
    setTimeout(() => {
      goToStep(2);
      renderDietPlans();
    }, 2800);

  } else if (targetStep === 3) {
    processingText.innerText = "食材助理正在拆解膳食结构，生成食材采购清单...";
    
    enqueueLog("ingredient", "收到饮食方案包。开始进行食材拆解与用量折算...");
    enqueueLog("ingredient", `分析配菜风格为：${translateRegion(state.formData.region)}...`);
    
    const allergiesStr = state.formData.allergies.map(translateAllergy).join('、');
    if (state.formData.allergies.length > 0) {
      enqueueLog("ingredient", `⚠️ 检测到避忌食材：[${allergiesStr}]。已开启食材替换算法，使用安全蛋白与主食替代。`);
    }

    enqueueLog("ingredient", "已对3套方案分别计算出：生鲜肉蛋奶类、时令蔬菜水果类、膳食粗粮谷物类以及调味耗材的具体用量。");
    enqueueLog("ingredient", "食材清单规划完成。加入了高温储鲜与保水防潮建议。发送给 [评估助理] 进行可行性打分。");

    setTimeout(() => {
      goToStep(3);
      renderIngredients();
    }, 2400);

  } else if (targetStep === 4) {
    processingText.innerText = "评估助理正在基于成本、地域、夏季时令进行多维评分...";
    
    enqueueLog("eval", "接管数据流。启动综合推荐评分模型...");
    enqueueLog("eval", `引入约束条件：[夏季生鲜时令指数]、[${translateRegion(state.formData.region)}食材物价指数]、[营养均衡比例评估]。`);
    enqueueLog("eval", `当前推荐权重设为 -> 成本控制: ${state.weights.cost}% | 季节适宜: ${state.weights.season}% | 地域匹配: ${state.weights.region}%`);
    enqueueLog("eval", "正在使用归一化加权公式实时计算 3 个方案的最终健康推荐评分。");

    setTimeout(() => {
      goToStep(4);
      evaluatePlansRealtime();
      enqueueLog("eval", `打分已就绪！当前判定综合得分最高的是：【${state.plans[state.selectedPlanIndex].name}】。`);
      enqueueLog("eval", "用户可手动调节权重滑块重新评估。确定最终方案后将发送给 [营销助理] 生成文案。");
    }, 2500);

  } else if (targetStep === 5) {
    processingText.innerText = "营销助理正在提取膳食精髓，撰写多渠道宣传推广内容...";
    
    enqueueLog("market", `收到最终选定食谱：【${state.plans[state.selectedPlanIndex].name}】。`);
    enqueueLog("market", "开始提取核心亮点：低热量、营养均衡、风味特色...");
    enqueueLog("market", "✍️ 正在撰写小红书种草软文：结合流行表情符号及健康标签...");
    enqueueLog("market", "🎬 正在编写抖音短视频分镜头脚本：设计画面运镜、旁白、BGM卡点...");
    enqueueLog("market", "📰 正在排版微信公众号科普长文：解析人体能量代谢与膳食配比原理...");
    
    setTimeout(() => {
      goToStep(5);
      generateMarketingTexts();
      enqueueLog("market", "✅ 所有平台的自媒体推广文案与视频脚本生成完毕！支持一键复制，助力健康分享！");
    }, 2800);
  }
}

// 提交表单处理
function handleFormSubmit() {
  const form = document.getElementById("healthForm");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  // 抓取表单数据
  const allergies = [];
  document.querySelectorAll("input[name='allergies']:checked").forEach(cb => {
    allergies.push(cb.value);
  });

  state.formData = {
    gender: document.getElementById("gender").value,
    age: parseInt(document.getElementById("age").value),
    height: parseInt(document.getElementById("height").value),
    weight: parseInt(document.getElementById("weight").value),
    goal: document.getElementById("goal").value,
    activity: document.getElementById("activity").value,
    dietHabit: document.querySelector("input[name='dietHabit']:checked").value,
    region: document.getElementById("region").value,
    allergies: allergies
  };

  // 开启多智能体流转动画，流转到步骤 2 (饮食助理)
  triggerStepTransition(2);
}

// 计算代谢消耗并产生模拟的饮食方案数据 (与用户输入深度动态关联)
function calculateAndGenerateDietData() {
  const f = state.formData;
  
  // 1. 代谢计算 (BMR & TDEE)
  let bmr = 0;
  if (f.gender === "male") {
    bmr = 10 * f.weight + 6.25 * f.height - 5 * f.age + 5;
  } else {
    bmr = 10 * f.weight + 6.25 * f.height - 5 * f.age - 161;
  }
  
  let activityMultiplier = 1.2;
  switch (f.activity) {
    case "light": activityMultiplier = 1.375; break;
    case "moderate": activityMultiplier = 1.55; break;
    case "heavy": activityMultiplier = 1.725; break;
  }
  
  const tdee = Math.round(bmr * activityMultiplier);
  
  // 根据健康诉求确定目标热量摄入
  let targetCalories = tdee;
  if (f.goal === "lose-fat") {
    targetCalories = Math.max(1200, tdee - 450); // 至少维持1200大卡安全底线
  } else if (f.goal === "gain-muscle") {
    targetCalories = tdee + 400;
  } else if (f.goal === "low-gi") {
    targetCalories = Math.max(1300, tdee - 200);
  }

  state.bmr = Math.round(bmr);
  state.tdee = tdee;
  state.targetCalories = targetCalories;

  // 2. 生成食谱与食材内容
  
  // 处理地域菜品名称与过敏源替换
  const localDishes = getLocalDishes(f.region, f.allergies);
  const proteins = getProteins(f.allergies);
  const carbSource = getCarbs(f.allergies);
  const snackOption = getSnacks(f.allergies);

  // 方案 A：针对用户习惯/目标的定制食谱 (如低碳减脂)
  const planA_Cals = Math.round(targetCalories * 0.95);
  // 方案 B：高蛋白/高膳食纤维均衡食谱
  const planB_Cals = Math.round(targetCalories);
  // 方案 C：地中海健康油脂轻生活食谱
  const planC_Cals = Math.round(targetCalories * 1.05);

  state.plans = [
    {
      name: "方案 A：轻盈减脂低碳膳食",
      sub: "专注控制升糖与胰岛素，适合减碳需求",
      calories: planA_Cals,
      macros: { carbs: 25, protein: 45, fat: 30 },
      meals: [
        { name: "早餐", icon: "🌅", food: `水煮蛋1个 + 无糖豆浆1杯 + ${carbSource.morning}`, cals: `${Math.round(planA_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchA} + 水煮西兰花150g`, cals: `${Math.round(planA_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerA} + 白灼菜心200g`, cals: `${Math.round(planA_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackA}`, cals: `${Math.round(planA_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinA, qty: "180g" },
          { name: "柴鸡蛋", qty: "1个" }
        ],
        veggies: [
          { name: "西兰花", qty: "150g" },
          { name: "广东菜心", qty: "200g" },
          { name: snackOption.ingA, qty: "100g" }
        ],
        grains: [
          { name: carbSource.ingA, qty: "50g" }
        ],
        seasonings: [
          { name: "冷榨亚麻籽油", qty: "10ml" },
          { name: "低钠盐/鲜鸡汁", qty: "5g" }
        ]
      },
      // 评估基础分 (Cost, Season, Region)
      scores: {
        cost: 88, // 便宜，主要鸡肉蛋类
        season: 95, // 蔬菜多为夏令菜
        region: f.region === "western" ? 75 : 92 // 符合中式多区域风格
      }
    },
    {
      name: "方案 B：黄金膳食纤维能量餐",
      sub: "以复合谷物与高膳食纤维为主，饱腹感强",
      calories: planB_Cals,
      macros: { carbs: 50, protein: 30, fat: 20 },
      meals: [
        { name: "早餐", icon: "🌅", food: `蒸红薯1根 + 无糖燕麦奶 + 水煮蛋1个`, cals: `${Math.round(planB_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchB} + 醋溜黄瓜`, cals: `${Math.round(planB_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerB} + 凉拌木耳100g`, cals: `${Math.round(planB_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackB}`, cals: `${Math.round(planB_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinB, qty: "150g" },
          { name: "柴鸡蛋", qty: "1个" }
        ],
        veggies: [
          { name: "水果黄瓜", qty: "200g" },
          { name: "黑木耳", qty: "30g" },
          { name: "青椒/彩椒", qty: "100g" }
        ],
        grains: [
          { name: "红薯", qty: "150g" },
          { name: carbSource.ingB, qty: "80g" }
        ],
        seasonings: [
          { name: "初榨玉米油", qty: "12ml" },
          { name: "生抽酱油/香醋", qty: "8g" }
        ]
      },
      scores: {
        cost: 78, // 中等成本 (牛肉/优质海鲜替代)
        season: 88, // 菌菇类一年四季都有
        region: (f.region === "north" || f.region === "sichuan") ? 95 : 82
      }
    },
    {
      name: "方案 C：地中海慢享低脂食谱",
      sub: "以富含单不饱和脂肪酸与抗氧化食材为特色",
      calories: planC_Cals,
      macros: { carbs: 35, protein: 30, fat: 35 },
      meals: [
        { name: "早餐", icon: "🌅", food: `全麦切片面包2片 + 圣女果8个 + 低脂酸奶`, cals: `${Math.round(planC_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchC} + 蒜蓉芦笋`, cals: `${Math.round(planC_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerC} + 鲜香菇番茄豆腐汤`, cals: `${Math.round(planC_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackC}`, cals: `${Math.round(planC_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinC, qty: "160g" },
          { name: "低脂无糖酸奶", qty: "150g" }
        ],
        veggies: [
          { name: "芦笋", qty: "120g" },
          { name: "樱桃番茄", qty: "150g" },
          { name: "牛油果", qty: "半个" },
          { name: "鲜香菇", qty: "80g" }
        ],
        grains: [
          { name: "全麦面包", qty: "60g" },
          { name: "藜麦米", qty: "40g" }
        ],
        seasonings: [
          { name: "特级初榨橄榄油", qty: "20ml" },
          { name: "玫瑰海盐/黑胡椒", qty: "4g" }
        ]
      },
      scores: {
        cost: 58, // 较贵 (橄榄油、牛油果、三文鱼等)
        season: 92, // 夏季时令番茄、芦笋匹配度极佳
        region: f.region === "western" ? 96 : 70 // 西式特征强
      }
    }
  ];
}

// 辅助函数：根据地域和避忌食材确定菜品
function getLocalDishes(region, allergies) {
  const avoidSeafood = allergies.includes("seafood");
  const avoidBeefPork = allergies.includes("beef-pork");

  const fishLunch = avoidSeafood ? "黑椒嫩煎鸡胸肉 (150g)" : "清蒸时令鲈鱼 (150g)";
  const fishDinner = avoidSeafood ? "鸡肉炒芦笋" : "白灼鲜虾仁 (100g)";
  const porkLunch = avoidBeefPork ? "五彩香煎鸡丁" : "小炒蒜香猪里脊 (120g)";
  const beefLunch = avoidBeefPork ? "鸡肉丸子滑时蔬" : "杭椒炒牛肉 (120g)";

  switch (region) {
    case "south": // 清淡养生
      return {
        lunchA: fishLunch,
        dinnerA: "手撕蒸鸡(去皮) 120g",
        lunchB: porkLunch,
        dinnerB: "荷塘小炒 (莲藕/木耳/百合)",
        lunchC: "清炖香菇鸡 150g",
        dinnerC: "白灼豆腐生菜"
      };
    case "north": // 杂粮咸鲜
      return {
        lunchA: avoidBeefPork ? "香菇蒸鸡" : "葱爆牛肉片 (120g)",
        dinnerA: "木须肉 (鸡蛋/木耳/黄瓜)",
        lunchB: "酱牛肉切片 100g 配蒸玉米",
        dinnerB: "凉拌金针菇黄瓜丝",
        lunchC: "番茄炖牛腩 150g",
        dinnerC: "素炒西葫芦"
      };
    case "sichuan": // 少油辣/开胃
      return {
        lunchA: avoidBeefPork ? "少油干煸鸡丝" : "少油小炒牛肉 (120g)",
        dinnerA: "凉拌椒麻鸡丝 100g",
        lunchB: "鲜椒爆炒鸡丁 (少油)",
        dinnerB: "麻婆豆腐 (少油免肉末)",
        lunchC: avoidSeafood ? "鲜椒嫩烤鸡胸" : "水煮双脆 (虾仁/豆腐，少油版)",
        dinnerC: "凉拌爽口木耳"
      };
    case "western": // 西式轻食
    default:
      return {
        lunchA: "煎鸡胸肉配柠檬汁 (150g)",
        dinnerA: "番茄牛油果鸡肉沙拉",
        lunchB: avoidBeefPork ? "香草烤鸡排" : "黑椒煎牛排 (150g)",
        dinnerB: "羽衣甘蓝金枪鱼沙拉",
        lunchC: avoidSeafood ? "香煎豆腐排" : "柠檬煎三文鱼 (150g)",
        dinnerC: "意式番茄水牛奶酪沙拉"
      };
  }
}

// 辅助函数：核心蛋白质替换
function getProteins(allergies) {
  const avoidSeafood = allergies.includes("seafood");
  const avoidBeefPork = allergies.includes("beef-pork");
  const avoidDairy = allergies.includes("dairy");

  return {
    proteinA: "去皮胸鸡肉",
    proteinB: avoidBeefPork ? "鸡肉丸子" : "新鲜酱牛肉",
    proteinC: avoidSeafood ? "北豆腐" : "大西洋三文鱼"
  };
}

// 辅助函数：碳水来源替换
function getCarbs(allergies) {
  const avoidGluten = allergies.includes("gluten");
  return {
    morning: avoidGluten ? "蒸紫薯1个" : "全麦面包1片",
    ingA: avoidGluten ? "荞麦米/藜麦" : "免洗燕麦片",
    ingB: avoidGluten ? "糙米/玉米" : "全麦面条"
  };
}

// 辅助函数：加餐及原料替换
function getSnacks(allergies) {
  const avoidNuts = allergies.includes("nuts");
  const avoidDairy = allergies.includes("dairy");
  return {
    snackA: avoidNuts ? "小番茄8个" : "扁桃仁5颗",
    snackB: "苹果半个",
    snackC: avoidDairy ? "无糖椰子酸奶" : "希腊酸奶1杯",
    ingA: avoidNuts ? "樱桃番茄" : "熟无盐坚果",
    ingC: avoidDairy ? "椰子奶" : "低脂酸奶"
  };
}

// 翻译工具函数
function translateGoal(goal) {
  const map = {
    "lose-fat": "健康减脂",
    "gain-muscle": "增肌塑形",
    "balanced": "日常均衡",
    "low-gi": "控糖控糖"
  };
  return map[goal] || goal;
}

function translateHabit(habit) {
  const map = {
    "balanced": "均衡杂食",
    "low-carb": "低碳饮食",
    "mediterranean": "地中海膳食",
    "vegan": "纯素食轻食"
  };
  return map[habit] || habit;
}

function translateAllergy(allergy) {
  const map = {
    "seafood": "海鲜贝类",
    "dairy": "乳制品",
    "nuts": "坚果",
    "gluten": "麸质小麦",
    "beef-pork": "红肉"
  };
  return map[allergy] || allergy;
}

function translateRegion(region) {
  const map = {
    "south": "江浙粤风味",
    "north": "北方咸鲜风味",
    "sichuan": "川湘开胃风味",
    "western": "西式简餐风味"
  };
  return map[region] || region;
}

// 步骤 2：渲染饮食方案
function renderDietPlans() {
  const container = document.getElementById("plansSelectorTabs");
  container.innerHTML = "";
  
  state.plans.forEach((plan, idx) => {
    const tab = document.createElement("div");
    tab.className = `plan-tab ${idx === state.activePlanIndex ? "active" : ""}`;
    tab.innerHTML = `
      <div class="plan-tab-title">${plan.name}</div>
      <div class="plan-tab-sub">${plan.calories} kcal | ${plan.sub}</div>
    `;
    tab.addEventListener("click", () => {
      state.activePlanIndex = idx;
      // 刷新 Tab 高亮
      document.querySelectorAll(".plan-tab").forEach((t, i) => {
        if (i === idx) t.classList.add("active");
        else t.classList.remove("active");
      });
      showPlanDetails(idx);
      addSystemLog("diet", `用户切换查看【${plan.name}】的详细三餐构成。`);
    });
    container.appendChild(tab);
  });

  showPlanDetails(state.activePlanIndex);
}

// 显示所选方案的三餐与营养配比图表
function showPlanDetails(idx) {
  const plan = state.plans[idx];
  
  // 1. 三餐渲染
  const mealsContainer = document.getElementById("mealsListContainer");
  mealsContainer.innerHTML = "";
  
  plan.meals.forEach(meal => {
    const card = document.createElement("div");
    card.className = "meal-card";
    card.innerHTML = `
      <div class="meal-icon">${meal.icon}</div>
      <div class="meal-details">
        <div class="meal-name">${meal.name}</div>
        <div class="meal-food">${meal.food}</div>
      </div>
      <div class="meal-cals">${meal.cals}</div>
    `;
    mealsContainer.appendChild(card);
  });

  // 2. 更新能量总值
  document.getElementById("totalKcalVal").innerText = plan.calories;

  // 3. SVG 饼图扇形计算绘制
  const carbsPct = plan.macros.carbs;
  const protPct = plan.macros.protein;
  const fatPct = plan.macros.fat;

  // 极坐标周长 2 * PI * r = 2 * 3.14159 * 40 ≈ 251.3
  const circumference = 251.3;
  const strokeCarbs = (carbsPct / 100) * circumference;
  const strokeProt = (protPct / 100) * circumference;
  const strokeFat = (fatPct / 100) * circumference;

  const chartSvg = document.getElementById("macroPieChart");
  chartSvg.innerHTML = `
    <!-- 底轨 -->
    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#1f2937" stroke-width="12"></circle>
    
    <!-- 碳水 (蓝色) -->
    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#3B82F6" stroke-width="12"
      stroke-dasharray="${strokeCarbs} ${circumference}"
      stroke-dashoffset="0"
      transform="rotate(-90 50 50)"
      style="transition: var(--transition-smooth);"></circle>
      
    <!-- 蛋白质 (粉色) -->
    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#EC4899" stroke-width="12"
      stroke-dasharray="${strokeProt} ${circumference}"
      stroke-dashoffset="-${strokeCarbs}"
      transform="rotate(-90 50 50)"
      style="transition: var(--transition-smooth);"></circle>
      
    <!-- 脂肪 (黄色) -->
    <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F59E0B" stroke-width="12"
      stroke-dasharray="${strokeFat} ${circumference}"
      stroke-dashoffset="-${strokeCarbs + strokeProt}"
      transform="rotate(-90 50 50)"
      style="transition: var(--transition-smooth);"></circle>
  `;

  // 4. 更新右侧营养指标图例
  const legend = document.getElementById("macroLegend");
  legend.innerHTML = `
    <div class="macro-item" data-macro="carbs">
      <div><span class="macro-color"></span>碳水化合物 (${carbsPct}%)</div>
      <div style="font-weight:600;">${Math.round(plan.calories * carbsPct / 400)}g</div>
    </div>
    <div class="macro-item" data-macro="protein">
      <div><span class="macro-color"></span>优质蛋白质 (${protPct}%)</div>
      <div style="font-weight:600;">${Math.round(plan.calories * protPct / 400)}g</div>
    </div>
    <div class="macro-item" data-macro="fat">
      <div><span class="macro-color"></span>必需膳食脂肪 (${fatPct}%)</div>
      <div style="font-weight:600;">${Math.round(plan.calories * fatPct / 900)}g</div>
    </div>
  `;
}

// 步骤 3：渲染食材清单 (带勾选和折叠交互)
function renderIngredients() {
  const activePlan = state.plans[state.activePlanIndex];
  const container = document.getElementById("ingredientsAccordion");
  container.innerHTML = "";

  document.getElementById("ingredientTipText").innerText = 
    `以下是食材助理为方案【${activePlan.name}】规划的食材清单（已自动替换过敏食材并在适宜的夏季时令期）：`;

  const categoryHeaders = {
    meat: "🥩 肉蛋奶类 (蛋白质源)",
    veggies: "🥦 时令果蔬类 (微量元素 & 纤维素)",
    grains: "🌾 主食谷物类 (慢糖/碳水源)",
    seasonings: "🧂 优质油脂与调味料"
  };

  Object.keys(activePlan.ingredients).forEach((catKey, idx) => {
    const items = activePlan.ingredients[catKey];
    const catGroup = document.createElement("div");
    catGroup.className = `category-group ${idx === 0 ? "open" : ""}`; // 默认展开第一个分类

    // 拼装手风琴头部
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <div class="category-title">${categoryHeaders[catKey]}</div>
      <div class="category-toggle-icon">▼</div>
    `;
    
    // 展开折叠点击事件
    header.addEventListener("click", () => {
      catGroup.classList.toggle("open");
    });

    // 拼装清单内容
    const content = document.createElement("div");
    content.className = "category-content";

    const listDiv = document.createElement("div");
    listDiv.className = "ingredient-items-list";

    items.forEach((item, itemIdx) => {
      const label = document.createElement("label");
      label.className = "ingredient-item";
      
      const uniqueId = `ing-${catKey}-${itemIdx}`;
      label.innerHTML = `
        <input type="checkbox" id="${uniqueId}">
        <span class="ing-name">${item.name}</span>
        <span class="ing-qty">${item.qty}</span>
      `;

      // 复选框勾选逻辑（改变底色与文字贯穿线）
      const checkbox = label.querySelector('input[type="checkbox"]');
      checkbox.addEventListener("change", (e) => {
        if (e.target.checked) {
          label.classList.add("checked");
          addSystemLog("ingredient", `用户勾选了已备食材：[${item.name} ${item.qty}]。`);
        } else {
          label.classList.remove("checked");
        }
      });

      listDiv.appendChild(label);
    });

    content.appendChild(listDiv);
    catGroup.appendChild(header);
    catGroup.appendChild(content);
    container.appendChild(catGroup);
  });
}

// 步骤 4：实时加权打分与胜出方案推荐 (评估助理的核心功能)
function evaluatePlansRealtime() {
  const costWeight = state.weights.cost / 100;
  const seasonWeight = state.weights.season / 100;
  const regionWeight = state.weights.region / 100;

  let maxScore = -1;
  let winnerIndex = 0;
  
  const scoresOutput = [];

  state.plans.forEach((plan, idx) => {
    // 归一化综合评分
    const finalScore = Math.round(
      (plan.scores.cost * costWeight) +
      (plan.scores.season * seasonWeight) +
      (plan.scores.region * regionWeight)
    );

    scoresOutput.push({ idx, name: plan.name, score: finalScore });

    if (finalScore > maxScore) {
      maxScore = finalScore;
      winnerIndex = idx;
    }
  });

  state.selectedPlanIndex = winnerIndex;

  // 渲染对比面板
  const listContainer = document.getElementById("scoresComparisonContainer");
  listContainer.innerHTML = "";

  scoresOutput.forEach(item => {
    const isWinner = item.idx === winnerIndex;
    const scoreRow = document.createElement("div");
    scoreRow.className = `score-row ${isWinner ? "winner" : ""}`;
    scoreRow.innerHTML = `
      <div class="score-row-header">
        <div class="score-row-title">
          <span>${isWinner ? "👑" : "⚪"}</span>
          <span>${item.name}</span>
        </div>
        <div class="score-row-num">${item.score} 分</div>
      </div>
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width: ${item.score}%;"></div>
      </div>
    `;
    listContainer.appendChild(scoreRow);
  });

  // 渲染最终推荐横幅
  const winnerBanner = document.getElementById("winnerBannerContainer");
  const winnerPlan = state.plans[winnerIndex];
  winnerBanner.innerHTML = `
    <div class="winner-banner-icon">🏆</div>
    <div>
      <div style="font-weight: 700; color: #10B981; margin-bottom: 0.15rem;">评估助理自动选定方案：${winnerPlan.name}</div>
      <div style="color: var(--text-secondary); line-height: 1.4;">
        在您当前的评估指标下，该方案表现最优。时令匹配度为 ${winnerPlan.scores.season}%，
        地域风味匹配度为 ${winnerPlan.scores.region}%，能够最大程度满足预算与适宜性。
      </div>
    </div>
  `;
}

// 步骤 5：营销文案生成引擎 (自适应用户指标和方案结果)
function generateMarketingTexts() {
  const winnerPlan = state.plans[state.selectedPlanIndex];
  const f = state.formData;

  const templateParams = {
    PlanName: winnerPlan.name,
    Calories: winnerPlan.calories,
    Carbs: winnerPlan.macros.carbs,
    Protein: winnerPlan.macros.protein,
    Fat: winnerPlan.macros.fat,
    Breakfast: winnerPlan.meals[0].food,
    Lunch: winnerPlan.meals[1].food,
    Dinner: winnerPlan.meals[2].food,
    Snack: winnerPlan.meals[3].food,
    Region: translateRegion(f.region)
  };

  // 1. 小红书软文
  const xhsText = `🔥 夏季狂掉秤！多智能体帮我制定的【${templateParams.PlanName}】真的绝了！✨

姐妹们！夏天已经到了，想穿漂亮衣服又管不住嘴？赶紧看过来！
我刚才用一款【多智能体协同健康饮食规划系统】测试了一下，五个 AI 智能体（客户经理、饮食助理、食材助理、评估助理、营销助理）协同帮我定制了一套【${templateParams.PlanName}】，简直是减脂届的“天花板”！

📊 每日科学能量配比：
- 每日预算：${templateParams.Calories} kcal
- 三大营养素比例：碳水 ${templateParams.Carbs}% | 蛋白质 ${templateParams.Protein}% | 脂肪 ${templateParams.Fat}%

🍽 一日三餐食谱公开：
🌅 早餐：${templateParams.Breakfast}
☀️ 午餐：${templateParams.Lunch}
🌙 晚餐：${templateParams.Dinner}
🍎 加餐：${templateParams.Snack}

🛒 连食材采购清单都帮我规划好了，根本不用自己动脑折算！
这次评估助理还特意帮我筛选了【${templateParams.Region}】口味的当季食材，精打细算既省钱又新鲜，太智能了！

别再盲目节食了，科学饮食才能瘦得漂亮！快来Pick你的专属食谱吧！
#健康减脂 #小红书爆款食谱 #AI智能体 #控糖低卡 #夏季瘦身 #自律打卡 #我的健康生活`;

  // 2. 抖音脚本
  const videoText = `🎬 抖音短视频脚本：《AI多智能体帮我吃出好身材》

【BGM】：轻快、动感、充满活力的卡点音乐
【视频时长】：30秒
【适合调性】：时尚健康、自律日常、科技改变生活

---
🎥 【画面 1】
- 画面：主角站在穿衣镜前，露出平坦的马甲线/身形，随后转头看向镜头，面带自信笑容。
- 视觉提示：屏幕中央浮现花字：“减脂真的不需要挨饿！”
- 旁白（声调上扬）：夏天要露肉？你还在每天靠水煮菜、啃黄瓜熬着吗？

🎥 【画面 2】
- 画面：切入手机，特写健康饮食规划仪表盘。多智能体节点脉冲闪烁，底部控制台日志流水般滑过，科技感拉满。
- 视觉提示：特写显示[饮食助理]和[食材助理]完成数据流传递。
- 旁白：今天带大家看看我的秘密武器——AI智能体协同帮我制定的【${templateParams.PlanName}】！

🎥 【画面 3】
- 画面：快速卡点切入三餐美食特写（香气扑鼻的少油主菜、翠绿的沙拉、五彩谷物饭）。
- 视觉提示：屏幕左侧打上能量卡片：${templateParams.Calories} kcal，营养比例均衡。
- 旁白：早餐吃【${templateParams.Breakfast}】，午餐是饱腹感极强的【${templateParams.Lunch}】，晚餐只要吃【${templateParams.Dinner}】！热量控制在 ${templateParams.Calories} 大卡，越吃越瘦，根本不用饿肚子！

🎥 【画面 4】
- 画面：主角拿着手机食材清单，在超市里开心地挑选新鲜果蔬。
- 旁白：连食材采购量都帮我自动折算好了。评估助理还针对夏季时令进行成本核算，太懂打工人的钱包了！

🎥 【画面 5】
- 画面：主角微笑，点赞屏幕，屏幕弹出评论区引导。
- 视觉提示：花字：“评论区留下【画像】，测试你的专属食谱！”
- 旁白：想要同款低卡食谱？关注我，在评论区留下你的身高体重，AI马上帮你算！`;

  // 3. 微信公众号
  const gzhText = `标题：AI智能体协同规划：如何利用【${templateParams.PlanName}】实现科学健康管理？

引言：
在健康管理日益个性化的今天，单一的“万能食谱”已无法满足现代人对口味、预算及季节性采购的复杂需求。本文将为您详细拆解由多智能体协同系统生成的【${templateParams.PlanName}】。该方案结合了营养科学、时令食材供应以及地域风味，提供了一套切实可行的膳食改善路径。

一、 画像分析与能量代谢指标
我们的多智能体系统首先通过客户经理收集了您的身体指标，饮食助理基于经典生理学公式为您的活动水平定制了能量摄入。
- 每日能量预算：${templateParams.Calories} kcal
- 三大宏量营养素配比：碳水 ${templateParams.Carbs}% | 蛋白质 ${templateParams.Protein}% | 脂肪 ${templateParams.Fat}%
该比例旨在维持基础代谢的同时，通过营养素配比提高食物热效应。

二、 膳食排期与一日三餐细则
为了确保全天血糖平稳并避免暴饮暴食，食谱进行了少食多餐的四餐制设计：
1. 早餐 (Morning)：${templateParams.Breakfast}
   富含膳食纤维与优质蛋白，开启一天的高效代谢。
2. 午餐 (Noon)：${templateParams.Lunch}
   高饱腹感复合碳水配合低脂肉类，提供持久稳定的脑力与体力支持。
3. 晚餐 (Evening)：${templateParams.Dinner}
   清淡易消化，减轻夜间肠胃负担。
4. 加餐 (Snack)：${templateParams.Snack}
   补充微量元素，抑制餐间饥饿感。

三、 食材助理的采购与存储建议
食材助理根据方案生成了分类食材清单，并给出了针对夏季的高温防霉、储鲜防潮指南，确保食材新鲜度的同时也减少了食物浪费。

结语：
科学饮食不是折磨，而是一场身体的重塑。通过多智能体协同，我们能让繁琐的营养计算、食材采购和成本评估变得触手可及。欢迎转发分享这套食谱给有需要的朋友！`;

  // 填入 DOM 中
  document.getElementById("copyBoxXhs").innerText = xhsText;
  document.getElementById("copyBoxVideo").innerText = videoText;
  document.getElementById("copyBoxGzh").innerText = gzhText;
}

// 模拟实时协同控制台日志输出 (增加异步和排队打印功能，更具动感)
function addSystemLog(tag, message) {
  const consoleLogs = document.getElementById("consoleLogs");
  if (!consoleLogs) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  
  let tagClass = "system";
  let tagLabel = "系统";

  switch (tag) {
    case "client": tagClass = "client"; tagLabel = "客户经理"; break;
    case "diet": tagClass = "diet"; tagLabel = "饮食助理"; break;
    case "ingredient": tagClass = "ingredient"; tagLabel = "食材助理"; break;
    case "eval": tagClass = "eval"; tagLabel = "评估助理"; break;
    case "market": tagClass = "market"; tagLabel = "营销助理"; break;
  }

  entry.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-tag ${tagClass}">${tagLabel}</span>
    <span class="log-message">${message}</span>
  `;

  consoleLogs.appendChild(entry);
  
  // 保持滚动在底部
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// 智能体队列打印调度器
function enqueueLog(tag, message) {
  state.logsQueue.push({ tag, message });
  processLogsQueue();
}

function processLogsQueue() {
  if (state.isLogTyping) return;
  if (state.logsQueue.length === 0) return;

  state.isLogTyping = true;
  const current = state.logsQueue.shift();

  // 添加稍微的打字延迟效果
  setTimeout(() => {
    addSystemLog(current.tag, current.message);
    state.isLogTyping = false;
    processLogsQueue();
  }, 400); // 400毫秒延迟打印下一行
}

// --- 视频录制与数据包导出模块 ---

let recordingCanvas = null;
let canvasCtx = null;
let mediaRecorder = null;
let recordedChunks = [];
let animId = null;

// 启动宣传视频录制生成流程
function startVideoRecording() {
  const btn = document.getElementById("generateVideoBtn");
  const progressContainer = document.getElementById("videoProgressContainer");
  const progressBar = document.getElementById("videoProgressBar");
  const progressText = document.getElementById("videoProgressText");

  recordingCanvas = document.getElementById("videoCanvas");
  canvasCtx = recordingCanvas.getContext("2d");

  btn.disabled = true;
  btn.innerText = "🎬 视频生成录制中...";
  progressContainer.style.display = "flex";
  progressBar.style.width = "0%";
  progressText.innerText = "0%";

  addSystemLog("market", "正在构建离屏 Canvas 视频画幅，初始化 MediaRecorder 录像轨道...");

  recordedChunks = [];
  
  // 捕获 canvas 30fps 数据流
  const stream = recordingCanvas.captureStream(30);
  
  // 检查浏览器支持的 mimeTypes
  let options = { mimeType: 'video/webm;codecs=vp9' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm;codecs=vp8' };
  }
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm' };
  }

  mediaRecorder = new MediaRecorder(stream, options);
  
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    cancelAnimationFrame(animId);
    
    // 生成视频 Blob 并触发下载
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoURL = URL.createObjectURL(blob);
    
    const downloadLink = document.createElement("a");
    downloadLink.href = videoURL;
    downloadLink.download = "promo_video.webm";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    addSystemLog("market", "🎬 宣传短视频已成功生成并自动触发浏览器下载：[promo_video.webm]。");
    
    // 解禁后续按钮
    document.getElementById("downloadPublishPackBtn").disabled = false;
    document.getElementById("openPublishDialogBtn").disabled = false;

    btn.innerText = "✓ 宣传视频已生成";
    progressContainer.style.display = "none";
  };

  // 开始录制
  mediaRecorder.start();

  // 启动 Canvas 渲染器
  const startTime = Date.now();
  const duration = 5000; // 录制 5 秒
  
  function drawFrame() {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(elapsed / duration, 1);
    
    // 渲染进度百分比
    progressBar.style.width = `${Math.round(pct * 100)}%`;
    progressText.innerText = `${Math.round(pct * 100)}%`;

    // 绘制视频背景 (渐变)
    const grad = canvasCtx.createLinearGradient(0, 0, 600, 400);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E293B');
    canvasCtx.fillStyle = grad;
    canvasCtx.fillRect(0, 0, 600, 400);

    // 绘制动效装饰环 (旋转)
    const rotation = (elapsed / 1000) * Math.PI * 0.25; // 0.25 圈/秒
    canvasCtx.save();
    canvasCtx.translate(300, 200);
    canvasCtx.rotate(rotation);
    canvasCtx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
    canvasCtx.lineWidth = 4;
    canvasCtx.strokeRect(-180, -130, 360, 260);
    canvasCtx.restore();

    // 绘制装饰性光圈气泡 (向上漂浮)
    for (let i = 0; i < 6; i++) {
      const bubbleY = 450 - ((elapsed * (0.8 + i * 0.15) + i * 60) % 500);
      const bubbleX = 100 + i * 80 + Math.sin(elapsed / 400 + i) * 15;
      const radius = 10 + (i % 3) * 6;
      canvasCtx.beginPath();
      canvasCtx.arc(bubbleX, bubbleY, radius, 0, Math.PI * 2);
      canvasCtx.fillStyle = 'rgba(16, 185, 129, 0.08)';
      canvasCtx.fill();
    }

    // 获取当前选定的饮食方案
    const activePlan = state.plans[state.selectedPlanIndex];

    // 绘制正文卡片背景 (毛玻璃模拟)
    canvasCtx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    canvasCtx.strokeStyle = 'rgba(236, 72, 153, 0.3)';
    canvasCtx.lineWidth = 2;
    drawRoundRect(canvasCtx, 80, 50, 440, 300, 16);
    canvasCtx.fill();
    canvasCtx.stroke();

    // 绘制卡片头部
    canvasCtx.fillStyle = '#EC4899';
    canvasCtx.font = 'bold 20px Outfit, "Microsoft YaHei"';
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText('AI智能体协同健康饮食推荐', 300, 95);

    // 绘制方案名称
    canvasCtx.fillStyle = '#F3F4F6';
    canvasCtx.font = 'bold 22px Outfit, "Microsoft YaHei"';
    canvasCtx.fillText(activePlan.name, 300, 150);

    // 绘制卡路里标签
    canvasCtx.fillStyle = '#10B981';
    canvasCtx.font = 'bold 28px Outfit';
    canvasCtx.fillText(`${activePlan.calories} kcal / 天`, 300, 205);

    // 绘制三大营养素比例信息
    canvasCtx.fillStyle = '#9CA3AF';
    canvasCtx.font = '14px Outfit, "Microsoft YaHei"';
    const macrosText = `碳水 ${activePlan.macros.carbs}% | 蛋白质 ${activePlan.macros.protein}% | 脂肪 ${activePlan.macros.fat}%`;
    canvasCtx.fillText(macrosText, 300, 240);

    // 绘制推荐文字跑马灯 (浮动特效)
    canvasCtx.fillStyle = '#F59E0B';
    canvasCtx.font = 'bold 16px Outfit, "Microsoft YaHei"';
    const scale = 1 + Math.sin(elapsed / 150) * 0.04;
    canvasCtx.save();
    canvasCtx.translate(300, 300);
    canvasCtx.scale(scale, scale);
    canvasCtx.fillText('🔥 扫码定制您的夏日专属健康食谱 🔥', 0, 0);
    canvasCtx.restore();

    if (elapsed < duration) {
      animId = requestAnimationFrame(drawFrame);
    } else {
      mediaRecorder.stop();
    }
  }

  // 启动渲染循环
  animId = requestAnimationFrame(drawFrame);
}

// 辅助函数：绘制圆角矩形
function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// 生成并下载本地机器人发布所需的 publish_data.json
function downloadPublishPackage() {
  const activePlan = state.plans[state.selectedPlanIndex];
  
  // 生成抖音定制文案
  const dyText = `🎬 多智能体协同定制的【${activePlan.name}】公开！每日摄入 ${activePlan.calories} 千卡，营养素配比精细，非常科学！#健康减脂 #小红书爆款食谱 #AI智能体 #控糖低卡 #夏季瘦身 #自律打卡`;
  
  const data = {
    plan_name: activePlan.name,
    calories: activePlan.calories,
    xhs_text: document.getElementById("copyBoxXhs").innerText,
    video_desc: dyText
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = "publish_data.json";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  addSystemLog("market", "📦 发布包配置数据已导出为 [publish_data.json] 并开始下载。请将此文件与 WebM 视频放在同一目录。");
}
