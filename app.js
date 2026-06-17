/**
 * 个性化健康饮食规划系统 - app.js
 * 负责状态控制、业务流程、动态数据渲染、以及权重评估运算
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
  isLogTyping: false,
  theme: "dark",
  apiSwitch: {
    queueDepth: 0,
    totalRequests: 0,
    totalResponses: 0,
    totalErrors: 0,
    lastRoute: "/api/v1/system/boot",
    activeChannels: []
  },
  dataLayer: {
    cacheHits: 0,
    cacheWrites: 0,
    persistenceReads: 0,
    persistenceWrites: 0,
    lastKey: "system.boot"
  },
  edgeCompute: {
    location: "本地待命",
    bmi: "--",
    bmr: "--",
    tdee: "--",
    runtimeMs: 0,
    cacheState: "cold"
  },
  aiDebate: {
    reviews: [],
    consensus: []
  },
  backend: {
    enabled: true,
    online: false,
    baseUrl: "http://127.0.0.1:8000",
    lastError: "未检测",
    eventStream: "idle"
  },
  apiEvents: []
};

const STORAGE_KEYS = {
  records: "dietPlannerSevenLayerRecordsV1",
  apiEvents: "dietPlannerApiEventsV1"
};

const memoryCache = new Map();
let persistentRecords = {};
let backendEventSource = null;
let backendStreamAnnounced = false;

const serviceRegistry = {
  cloudProviders: [
    {
      id: "doubao",
      name: "豆包 Doubao",
      displayName: "可执行性复核",
      shortName: "豆",
      role: "生活化表达与可执行建议",
      displayRole: "口味适配、采购便利性、执行难度",
      latency: 96,
      cost: "低",
      specialty: "口味适配"
    },
    {
      id: "qianwen",
      name: "通义千问 Qianwen",
      displayName: "营养结构复核",
      shortName: "千",
      role: "结构化推理与中文语义",
      displayRole: "宏量营养比例、饮食目标一致性",
      latency: 112,
      cost: "中",
      specialty: "方案解释"
    },
    {
      id: "deepseek",
      name: "DeepSeek DS",
      displayName: "量化约束复核",
      shortName: "DS",
      role: "数学评分与对抗校验",
      displayRole: "成本、时令、地域约束稳定性",
      latency: 128,
      cost: "低",
      specialty: "量化评审"
    }
  ],
  businessContainers: [
    { id: "client", name: "customer-manager", api: "/api/v1/profile/create" },
    { id: "diet", name: "diet-planner", api: "/api/v1/diet/plans" },
    { id: "ingredient", name: "ingredient-planner", api: "/api/v1/ingredients/list" },
    { id: "eval", name: "evaluation-engine", api: "/api/v1/evaluation/score" },
    { id: "market", name: "marketing-writer", api: "/api/v1/marketing/content" }
  ],
  apiRoutes: [
    { route: "/api/v1/system/boot", method: "POST", owner: "switch", latency: 48 },
    { route: "/api/v1/profile/create", method: "POST", owner: "client", latency: 72 },
    { route: "/api/v1/diet/plans", method: "POST", owner: "diet", latency: 110 },
    { route: "/api/v1/ingredients/list", method: "POST", owner: "ingredient", latency: 96 },
    { route: "/api/v1/evaluation/score", method: "POST", owner: "eval", latency: 120 },
    { route: "/api/v1/cloud/providers/review", method: "POST", owner: "cloud", latency: 140 },
    { route: "/api/v1/marketing/content", method: "POST", owner: "market", latency: 100 },
    { route: "/api/v1/publish/package", method: "POST", owner: "market", latency: 80 }
  ]
};

const apiSwitch = {
  request(route, payload = {}, options = {}) {
    const routeConfig = serviceRegistry.apiRoutes.find(item => item.route === route);
    const envelope = createApiEnvelope(route, payload, {
      method: options.method || routeConfig?.method || "POST",
      source: options.source || "ui-controller",
      target: options.target || routeConfig?.owner || "switch",
      duplex: options.duplex !== false
    });
    const latency = options.latency || routeConfig?.latency || 90;
    const channel = `${envelope.source}->${envelope.target}`;

    state.apiSwitch.queueDepth += 1;
    state.apiSwitch.totalRequests += 1;
    state.apiSwitch.lastRoute = route;
    state.apiSwitch.activeChannels = Array.from(new Set([...state.apiSwitch.activeChannels, channel]));
    registerApiEvent("request", envelope);
    renderApiSwitchMetrics();

    const resolveLocal = (fallbackReason = "") => new Promise((resolve) => {
      setTimeout(() => {
        state.apiSwitch.queueDepth = Math.max(0, state.apiSwitch.queueDepth - 1);
        state.apiSwitch.totalResponses += 1;
        state.apiSwitch.activeChannels = state.apiSwitch.activeChannels.filter(item => item !== channel);
        if (fallbackReason) {
          state.backend.online = false;
          state.backend.lastError = fallbackReason;
          stopBackendEventStream("fallback local");
        }

        const response = {
          ...envelope,
          responseAt: new Date().toISOString(),
          latency,
          ok: true,
          data: {
            accepted: true,
            route,
            traceId: envelope.traceId
          }
        };

        registerApiEvent("response", response);
        renderApiSwitchMetrics();
        resolve(response);
      }, latency);
    });

    if (!state.backend.enabled) {
      return resolveLocal();
    }

    return sendBackendEnvelope(envelope)
      .then(response => {
        state.apiSwitch.queueDepth = Math.max(0, state.apiSwitch.queueDepth - 1);
        state.apiSwitch.totalResponses += 1;
        state.apiSwitch.activeChannels = state.apiSwitch.activeChannels.filter(item => item !== channel);
        state.backend.online = true;
        state.backend.lastError = "";
        registerApiEvent("response", { ...envelope, route, traceId: response.traceId || envelope.traceId });
        renderApiSwitchMetrics();
        return {
          ...envelope,
          responseAt: response.responseAt || new Date().toISOString(),
          latency: response.latencyMs || 0,
          ok: response.ok,
          data: response.data || {},
          error: response.error || null
        };
      })
      .catch(err => {
        state.apiSwitch.totalErrors += 1;
        return resolveLocal(err.message || "backend unavailable");
      });
  }
};

// 页面 DOM 加载完毕后执行初始化
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initArchitectureRuntime();
  initEventListeners();
  initWeightSliders();
  addSystemLog("system", "系统初始化完成，已准备生成个性化饮食方案。");
  addSystemLog("switch", "正在检查后端服务连接；若服务不可用，将自动使用本地计算流程。");
  addSystemLog("client", "请填写基础健康问卷，系统将生成结构化用户画像。");
});

function initTheme() {
  const storedTheme = localStorage.getItem("dietPlannerTheme");
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(storedTheme || (prefersLight ? "light" : "dark"));
}

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;

  const icon = document.getElementById("themeToggleIcon");
  if (icon) {
    icon.innerText = state.theme === "light" ? "☾" : "☀";
  }

  localStorage.setItem("dietPlannerTheme", state.theme);
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();

    try {
      const copied = document.execCommand("copy");
      document.body.removeChild(textArea);
      copied ? resolve() : reject(new Error("execCommand copy failed"));
    } catch (err) {
      document.body.removeChild(textArea);
      reject(err);
    }
  });
}

function initArchitectureRuntime() {
  persistentRecords = loadPersistentRecords();
  state.dataLayer.persistenceReads += 1;
  saveDataRecord("system.boot", {
    bootAt: new Date().toISOString(),
    layers: 7,
    providers: serviceRegistry.cloudProviders.map(provider => provider.displayName)
  });
  renderRuntimeViews();
  renderAiDebate();
  probeBackend();
  apiSwitch.request("/api/v1/system/boot", { status: "ready" }, {
    source: "ui-controller",
    target: "api-switch",
    latency: 48
  });
}

function loadPersistentRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.records);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("读取持久化数据失败", err);
    return {};
  }
}

function persistRecords() {
  try {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(persistentRecords));
    state.dataLayer.persistenceWrites += 1;
  } catch (err) {
    console.warn("写入持久化数据失败", err);
  }
}

function saveDataRecord(key, value) {
  const record = {
    key,
    value,
    updatedAt: new Date().toISOString()
  };

  memoryCache.set(key, record);
  persistentRecords[key] = record;
  state.dataLayer.cacheWrites += 1;
  state.dataLayer.lastKey = key;
  persistRecords();
  renderDataLayerStatus();
  return record;
}

function readDataRecord(key) {
  if (memoryCache.has(key)) {
    state.dataLayer.cacheHits += 1;
    state.dataLayer.lastKey = key;
    renderDataLayerStatus();
    return memoryCache.get(key);
  }

  if (persistentRecords[key]) {
    memoryCache.set(key, persistentRecords[key]);
    state.dataLayer.persistenceReads += 1;
    state.dataLayer.lastKey = key;
    renderDataLayerStatus();
    return persistentRecords[key];
  }

  renderDataLayerStatus();
  return null;
}

function createApiEnvelope(route, payload, meta = {}) {
  return {
    traceId: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    protocol: "DietPlannerAPI/1.0",
    method: meta.method || "POST",
    route,
    source: meta.source || "ui-controller",
    target: meta.target || "api-switch",
    duplex: meta.duplex !== false,
    payload,
    meta: {
      contentType: "application/json",
      transport: "in-browser-fastapi-style",
      nonBlocking: true
    },
    createdAt: new Date().toISOString()
  };
}

function registerApiEvent(type, envelope) {
  const event = {
    type,
    traceId: envelope.traceId,
    route: envelope.route,
    source: envelope.source,
    target: envelope.target,
    message: envelope.message || "",
    at: envelope.at || new Date().toISOString()
  };

  state.apiEvents.unshift(event);
  state.apiEvents = state.apiEvents.slice(0, 20);

  try {
    localStorage.setItem(STORAGE_KEYS.apiEvents, JSON.stringify(state.apiEvents));
  } catch (err) {
    console.warn("写入 API 事件失败", err);
  }
}

function registerBackendApiEvent(event) {
  if (!event || !event.trace_id) return;

  const normalized = {
    type: event.type,
    traceId: event.trace_id,
    route: event.route,
    source: event.source,
    target: event.target,
    message: event.message,
    at: event.at,
    backend: true
  };
  const duplicate = state.apiEvents.some(item => (
    item.traceId === normalized.traceId
    && item.type === normalized.type
    && item.at === normalized.at
  ));
  if (duplicate) return;

  state.apiEvents.unshift(normalized);
  state.apiEvents = state.apiEvents.slice(0, 20);

  try {
    localStorage.setItem(STORAGE_KEYS.apiEvents, JSON.stringify(state.apiEvents));
  } catch (err) {
    console.warn("写入后端 API 事件失败", err);
  }

  if (event.type === "error") {
    addSystemLog("switch", `服务处理异常：${event.message}`);
  }
}

function getBackendBaseUrl() {
  const configured = localStorage.getItem("dietPlannerBackendUrl");
  return configured || state.backend.baseUrl;
}

async function sendBackendEnvelope(envelope) {
  const baseUrl = getBackendBaseUrl();
  state.backend.baseUrl = baseUrl;

  const response = await fetch(`${baseUrl}/api/v1/switch/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope)
  });

  if (!response.ok) {
    throw new Error(`backend HTTP ${response.status}`);
  }

  startBackendEventStream();
  return response.json();
}

async function probeBackend() {
  const baseUrl = getBackendBaseUrl();
  state.backend.baseUrl = baseUrl;

  try {
    const response = await fetch(`${baseUrl}/api/v1/health`, { method: "GET" });
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    const data = await response.json();
    state.backend.online = true;
    state.backend.lastError = `${data.service} ${data.version} · ${data.providerMode}`;
    startBackendEventStream();
  } catch (err) {
    state.backend.online = false;
    state.backend.lastError = err.message || "backend unavailable";
    stopBackendEventStream("offline");
  }

  renderApiSwitchMetrics();
}

function startBackendEventStream() {
  if (!window.EventSource || backendEventSource) return;

  const baseUrl = getBackendBaseUrl();
  state.backend.eventStream = "connecting";
  backendEventSource = new EventSource(`${baseUrl}/api/v1/events/stream`);

  backendEventSource.onopen = () => {
    state.backend.eventStream = "streaming";
    if (!backendStreamAnnounced) {
      backendStreamAnnounced = true;
      addSystemLog("switch", "已连接实时处理进度服务。");
    }
    renderApiSwitchMetrics();
  };

  backendEventSource.onmessage = (event) => {
    try {
      registerBackendApiEvent(JSON.parse(event.data));
      renderApiSwitchMetrics();
    } catch (err) {
      console.warn("解析后端 SSE 事件失败", err);
    }
  };

  backendEventSource.onerror = () => {
    state.backend.eventStream = "retrying";
    renderApiSwitchMetrics();
  };
}

function stopBackendEventStream(status = "closed") {
  if (backendEventSource) {
    backendEventSource.close();
    backendEventSource = null;
  }
  state.backend.eventStream = status;
}

function renderRuntimeViews() {
  renderAiDebate();
}

function renderLayerStatusList() {
  return;
}

function renderCloudProviders() {
  return;
}

function renderApiSwitchMetrics() {
  return;
}

function renderDataLayerStatus() {
  return;
}

function renderEdgeComputeStatus() {
  return;
}

function computeEdgeProfile(formData) {
  const startedAt = performance.now();
  const bmi = formData.weight / Math.pow(formData.height / 100, 2);
  const bmr = formData.gender === "male"
    ? 10 * formData.weight + 6.25 * formData.height - 5 * formData.age + 5
    : 10 * formData.weight + 6.25 * formData.height - 5 * formData.age - 161;
  const activityMap = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    heavy: 1.725
  };
  const tdee = Math.round(bmr * (activityMap[formData.activity] || 1.2));
  const cacheKey = `edge.profile.${formData.gender}.${formData.age}.${formData.height}.${formData.weight}.${formData.activity}`;
  const cached = readDataRecord(cacheKey);
  const runtimeMs = Math.max(1, Math.round(performance.now() - startedAt));

  state.edgeCompute = {
    location: "本地浏览器计算",
    bmi: bmi.toFixed(1),
    bmr: `${Math.round(bmr)} kcal`,
    tdee: `${tdee} kcal`,
    runtimeMs,
    cacheState: cached ? "warm cache" : "new compute"
  };

  if (!cached) {
    saveDataRecord(cacheKey, state.edgeCompute);
  }

  renderEdgeComputeStatus();
  return state.edgeCompute;
}

// 初始化事件监听
function initEventListeners() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      setTheme(nextTheme);
      addSystemLog("system", `界面主题已切换为${nextTheme === "light" ? "浅色" : "深色"}模式。`);
    });
  }

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
      const tabButton = e.currentTarget;
      const platform = tabButton.getAttribute("data-platform");
      document.querySelectorAll(".marketing-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".marketing-panel").forEach(p => p.classList.remove("active"));
      
      tabButton.classList.add("active");
      document.getElementById(`market-${platform}`).classList.add("active");
      addSystemLog("market", `已切换到【${tabButton.innerText}】生成面板。`);
    });
  });

  // 一键复制功能
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const textToCopy = document.getElementById(targetId).innerText;
      
      copyTextToClipboard(textToCopy).then(() => {
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
      state.formData = {};
      state.plans = [];
      state.activePlanIndex = 0;
      state.selectedPlanIndex = 0;
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
      state.edgeCompute = {
        location: "本地待命",
        bmi: "--",
        bmr: "--",
        tdee: "--",
        runtimeMs: 0,
        cacheState: "cold"
      };
      state.aiDebate = { reviews: [], consensus: [] };
      saveDataRecord("session.reset", { resetAt: new Date().toISOString() });
      renderRuntimeViews();
      renderAiDebate();

      goToStep(1);
      
      // 清空部分日志并提示
      const consoleLogs = document.getElementById("consoleLogs");
      consoleLogs.innerHTML = "";
      addSystemLog("system", "系统状态已重置，准备开启新的健康规划流程。");
      addSystemLog("client", "请重新填写基础健康问卷。");
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
      const dialog = document.getElementById("publishDialog");
      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        alert("当前浏览器不支持原生弹窗，请查看页面中的发布助手说明。");
      }
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
  if (keys.some(key => !sliders[key])) return;

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
      
      // 触发评估结果实时更新
      if (state.currentStep === 4) {
        evaluatePlansRealtime();
      }
    });
  });
}

// 更新权重显示的文本数值
function updateWeightTextDisplays() {
  const costText = document.getElementById("weightCostText");
  const seasonText = document.getElementById("weightSeasonText");
  const regionText = document.getElementById("weightRegionText");

  if (!costText || !seasonText || !regionText) return;

  costText.innerText = `${state.weights.cost}%`;
  seasonText.innerText = `${state.weights.season}%`;
  regionText.innerText = `${state.weights.region}%`;
}

// 切换到具体步骤 (静态页面显示控制)
function goToStep(step) {
  const targetView = document.getElementById(`step-${step}`);
  if (!targetView) return;

  state.currentStep = step;
  
  // 切换所有 View 的显示状态
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  targetView.classList.add("active");

  // 更新进度条和高亮标题
  const progressPercent = step * 20;
  document.getElementById("progressBar").style.width = `${progressPercent}%`;
  
  const stepNames = [
    "基础健康问卷",
    "个性化膳食方案",
    "分类食材采购清单",
    "方案量化评估",
    "多平台推广文案"
  ];
  document.getElementById("current-step-name").innerText = stepNames[step - 1];

}

// 带加载动画和日志的步骤流转
function triggerStepTransition(targetStep) {
  // 显示加载遮罩
  const loadingView = document.getElementById("step-loading");
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  loadingView.classList.add("active");

  const processingText = document.getElementById("processingText");
  
  // 注入不同步骤的处理进度
  if (targetStep === 2) {
    processingText.innerText = "正在根据画像设计膳食规划...";

    apiSwitch.request("/api/v1/diet/plans", {
      profile: state.formData,
      edgeCompute: state.edgeCompute
    }, {
      source: "customer-manager",
      target: "diet-planner"
    });
    
    enqueueLog("client", "问卷收集完成，正在整理画像字段并排查过敏源。");
    enqueueLog("switch", "用户健康画像已提交，正在生成膳食方案。");
    enqueueLog("diet", "用户画像已生成。");
    enqueueLog("diet", `目标：${translateGoal(state.formData.goal)} | 饮食风格：${translateHabit(state.formData.dietHabit)}`);
    enqueueLog("diet", `过敏排除食材：${state.formData.allergies.length > 0 ? state.formData.allergies.map(translateAllergy).join('、') : '无'}`);
    enqueueLog("diet", "基于 Mifflin-St Jeor 公式计算能量代谢...");
    
    // 计算并生成饮食数据
    calculateAndGenerateDietData();

    enqueueLog("diet", `计算完成。基础代谢(BMR) ≈ ${state.bmr} kcal，日消耗(TDEE) ≈ ${state.tdee} kcal。每日饮食热量靶点设定。`);
    enqueueLog("diet", `已成功为您定制了3套侧重点不同的健康饮食方案：\n1. ${state.plans[0].name}\n2. ${state.plans[1].name}\n3. ${state.plans[2].name}`);
    enqueueLog("diet", "膳食方案已生成，下一步将拆解为采购清单。");
    saveDataRecord("diet.plans.current", state.plans);
    
    setTimeout(() => {
      goToStep(2);
      renderDietPlans();
    }, 2800);

  } else if (targetStep === 3) {
    processingText.innerText = "正在拆解膳食结构，生成食材采购清单...";

    apiSwitch.request("/api/v1/ingredients/list", {
      activePlanIndex: state.activePlanIndex,
      plans: state.plans.map(plan => ({ name: plan.name, meals: plan.meals }))
    }, {
      source: "diet-planner",
      target: "ingredient-planner"
    });
    
    enqueueLog("ingredient", "正在按方案拆解食材并折算用量。");
    enqueueLog("ingredient", `分析配菜风格为：${translateRegion(state.formData.region)}...`);
    
    const allergiesStr = state.formData.allergies.map(translateAllergy).join('、');
    if (state.formData.allergies.length > 0) {
      enqueueLog("ingredient", `⚠️ 检测到避忌食材：[${allergiesStr}]。已开启食材替换算法，使用安全蛋白与主食替代。`);
    }

    enqueueLog("ingredient", "已对3套方案分别计算出：生鲜肉蛋奶类、时令蔬菜水果类、膳食粗粮谷物类以及调味耗材的具体用量。");
    enqueueLog("switch", "食材清单已生成，准备进入方案评估。");
    enqueueLog("ingredient", "食材清单规划完成，并加入高温储鲜与保水防潮建议。");
    saveDataRecord("ingredients.current", state.plans.map(plan => ({
      name: plan.name,
      ingredients: plan.ingredients
    })));

    setTimeout(() => {
      goToStep(3);
      renderIngredients();
    }, 2400);

  } else if (targetStep === 4) {
    processingText.innerText = "正在基于成本、地域和夏季时令进行多维评分...";

    apiSwitch.request("/api/v1/evaluation/score", {
      weights: state.weights,
      plans: state.plans.map(plan => ({ name: plan.name, scores: plan.scores }))
    }, {
      source: "ingredient-planner",
      target: "evaluation-engine"
    });
    
    enqueueLog("eval", "启动综合推荐评分模型。");
    enqueueLog("eval", `引入约束条件：[夏季生鲜时令指数]、[${translateRegion(state.formData.region)}食材物价指数]、[营养均衡比例评估]。`);
    enqueueLog("eval", `当前推荐权重设为 -> 成本控制: ${state.weights.cost}% | 季节适宜: ${state.weights.season}% | 地域匹配: ${state.weights.region}%`);
    enqueueLog("eval", "正在使用归一化加权公式实时计算 3 个方案的最终健康推荐评分。");
    enqueueLog("switch", "正在从可执行性、营养结构和量化约束三个角度进行独立复核。");

    setTimeout(() => {
      goToStep(4);
      evaluatePlansRealtime();
      runAiDebateForPlans();
      enqueueLog("eval", `打分已就绪！当前判定综合得分最高的是：【${state.plans[state.selectedPlanIndex].name}】。`);
      enqueueLog("eval", "用户可手动调节权重滑块重新评估。确定最终方案后将生成多平台文案。");
    }, 2500);

  } else if (targetStep === 5) {
    processingText.innerText = "正在提取膳食亮点，撰写多渠道宣传推广内容...";

    apiSwitch.request("/api/v1/marketing/content", {
      selectedPlanIndex: state.selectedPlanIndex,
      selectedPlan: state.plans[state.selectedPlanIndex]
    }, {
      source: "evaluation-engine",
      target: "marketing-writer"
    });
    
    enqueueLog("market", `最终选定食谱：【${state.plans[state.selectedPlanIndex].name}】。`);
    enqueueLog("market", "开始提取核心亮点：低热量、营养均衡、风味特色...");
    enqueueLog("market", "✍️ 正在撰写小红书种草软文：结合流行表情符号及健康标签...");
    enqueueLog("market", "🎬 正在编写抖音短视频分镜头脚本：设计画面运镜、旁白、BGM卡点...");
    enqueueLog("market", "📰 正在排版微信公众号科普长文：解析人体能量代谢与膳食配比原理...");
    
    setTimeout(() => {
      goToStep(5);
      generateMarketingTexts();
      enqueueLog("market", "所有平台的推广文案与视频脚本生成完毕，支持一键复制。");
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

  computeEdgeProfile(state.formData);
  saveDataRecord("profile.current", state.formData);
  apiSwitch.request("/api/v1/profile/create", state.formData, {
    source: "ui-controller",
    target: "customer-manager"
  });
  enqueueLog("data", "用户画像已保存，后续步骤可继续复用。");
  enqueueLog("switch", "画像创建请求已进入处理队列。");

  // 开启流转动画，进入膳食方案生成
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
  state.edgeCompute = {
    ...state.edgeCompute,
    location: "本地计算 + 云端复核",
    bmr: `${state.bmr} kcal`,
    tdee: `${state.tdee} kcal`
  };
  renderEdgeComputeStatus();

  // 2. 生成食谱与食材内容
  
  // 处理地域菜品名称与过敏源替换
  const localDishes = getLocalDishes(f.region, f.allergies, f.dietHabit);
  const proteins = getProteins(f.allergies, f.dietHabit);
  const carbSource = getCarbs(f.allergies);
  const snackOption = getSnacks(f.allergies, f.dietHabit);
  const blueprints = getPlanBlueprints(f.goal, f.dietHabit);
  const isVegan = f.dietHabit === "vegan";
  const avoidDairy = f.allergies.includes("dairy");
  const avoidGluten = f.allergies.includes("gluten");
  const eggItem = isVegan ? "卤水豆腐80g" : "水煮蛋1个";
  const eggIngredient = isVegan ? { name: "北豆腐", qty: "80g" } : { name: "柴鸡蛋", qty: "1个" };
  const breakfastDrink = avoidDairy || isVegan ? "无糖豆浆" : "无糖燕麦奶";
  const yogurtItem = avoidDairy || isVegan ? "无糖椰子酸奶" : "低脂酸奶";
  const breadItem = avoidGluten ? "藜麦饭团80g" : "全麦切片面包2片";

  const planA_Cals = Math.round(targetCalories * blueprints[0].calorieFactor);
  const planB_Cals = Math.round(targetCalories * blueprints[1].calorieFactor);
  const planC_Cals = Math.round(targetCalories * blueprints[2].calorieFactor);

  state.plans = [
    {
      name: blueprints[0].name,
      sub: blueprints[0].sub,
      calories: planA_Cals,
      macros: blueprints[0].macros,
      meals: [
        { name: "早餐", icon: "🌅", food: `${eggItem} + 无糖豆浆1杯 + ${carbSource.morning}`, cals: `${Math.round(planA_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchA} + 水煮西兰花150g`, cals: `${Math.round(planA_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerA} + 白灼菜心200g`, cals: `${Math.round(planA_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackA}`, cals: `${Math.round(planA_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinA, qty: "180g" },
          eggIngredient
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
      name: blueprints[1].name,
      sub: blueprints[1].sub,
      calories: planB_Cals,
      macros: blueprints[1].macros,
      meals: [
        { name: "早餐", icon: "🌅", food: `蒸红薯1根 + ${breakfastDrink}1杯 + ${eggItem}`, cals: `${Math.round(planB_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchB} + 醋溜黄瓜`, cals: `${Math.round(planB_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerB} + 凉拌木耳100g`, cals: `${Math.round(planB_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackB}`, cals: `${Math.round(planB_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinB, qty: "150g" },
          eggIngredient
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
      name: blueprints[2].name,
      sub: blueprints[2].sub,
      calories: planC_Cals,
      macros: blueprints[2].macros,
      meals: [
        { name: "早餐", icon: "🌅", food: `${breadItem} + 圣女果8个 + ${yogurtItem}`, cals: `${Math.round(planC_Cals * 0.25)} kcal` },
        { name: "午餐", icon: "☀️", food: `${localDishes.lunchC} + 蒜蓉芦笋`, cals: `${Math.round(planC_Cals * 0.4)} kcal` },
        { name: "晚餐", icon: "🌙", food: `${localDishes.dinnerC} + 鲜香菇番茄豆腐汤`, cals: `${Math.round(planC_Cals * 0.25)} kcal` },
        { name: "加餐", icon: "🍎", food: `${snackOption.snackC}`, cals: `${Math.round(planC_Cals * 0.1)} kcal` }
      ],
      ingredients: {
        meat: [
          { name: proteins.proteinC, qty: "160g" },
          { name: yogurtItem, qty: "150g" }
        ],
        veggies: [
          { name: "芦笋", qty: "120g" },
          { name: "樱桃番茄", qty: "150g" },
          { name: "牛油果", qty: "半个" },
          { name: "鲜香菇", qty: "80g" }
        ],
        grains: [
          { name: avoidGluten ? "藜麦饭团" : "全麦面包", qty: "60g" },
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

function getPlanBlueprints(goal, dietHabit) {
  if (dietHabit === "vegan") {
    return [
      {
        name: "方案 A：植物蛋白轻盈膳食",
        sub: "以豆制品、菌菇和低 GI 主食构成的清爽纯素方案",
        calorieFactor: goal === "gain-muscle" ? 1.02 : 0.95,
        macros: { carbs: 38, protein: 32, fat: 30 }
      },
      {
        name: "方案 B：高纤谷豆能量餐",
        sub: "谷物、豆类与时令蔬菜组合，强调饱腹和稳定能量",
        calorieFactor: 1,
        macros: { carbs: 52, protein: 24, fat: 24 }
      },
      {
        name: "方案 C：地中海纯素优脂餐",
        sub: "橄榄油、坚果替代和番茄类食材提升抗氧化摄入",
        calorieFactor: 1.04,
        macros: { carbs: 42, protein: 24, fat: 34 }
      }
    ];
  }

  if (goal === "gain-muscle") {
    return [
      {
        name: "方案 A：高蛋白增肌训练餐",
        sub: "提高优质蛋白摄入，适合训练日肌肉修复",
        calorieFactor: 1.05,
        macros: { carbs: 40, protein: 35, fat: 25 }
      },
      {
        name: "方案 B：复合碳水恢复餐",
        sub: "用慢糖谷物和高纤蔬菜支持训练后的糖原恢复",
        calorieFactor: 1,
        macros: { carbs: 48, protein: 32, fat: 20 }
      },
      {
        name: "方案 C：地中海优脂增肌餐",
        sub: "用优质脂肪和高密度蛋白提升热量质量",
        calorieFactor: 1.1,
        macros: { carbs: 35, protein: 33, fat: 32 }
      }
    ];
  }

  if (goal === "low-gi" || dietHabit === "low-carb") {
    return [
      {
        name: "方案 A：低 GI 稳糖低碳餐",
        sub: "控制精制碳水，用蛋白和优质脂肪稳定餐后血糖",
        calorieFactor: 0.95,
        macros: { carbs: 28, protein: 38, fat: 34 }
      },
      {
        name: "方案 B：高纤慢糖平衡餐",
        sub: "保留必要复合碳水，提升膳食纤维和饱腹感",
        calorieFactor: 1,
        macros: { carbs: 42, protein: 32, fat: 26 }
      },
      {
        name: "方案 C：地中海稳糖轻食",
        sub: "以番茄、橄榄油和低加工主食构建温和控糖餐",
        calorieFactor: 1.02,
        macros: { carbs: 35, protein: 30, fat: 35 }
      }
    ];
  }

  if (dietHabit === "mediterranean") {
    return [
      {
        name: "方案 A：清爽控脂地中海餐",
        sub: "在热量可控前提下提高鱼禽和蔬菜占比",
        calorieFactor: 0.96,
        macros: { carbs: 35, protein: 35, fat: 30 }
      },
      {
        name: "方案 B：高纤谷物地中海餐",
        sub: "用全谷物和时令果蔬提供稳定饱腹感",
        calorieFactor: 1,
        macros: { carbs: 48, protein: 28, fat: 24 }
      },
      {
        name: "方案 C：经典地中海优脂餐",
        sub: "突出橄榄油、番茄、鱼类和坚果的抗氧化优势",
        calorieFactor: 1.04,
        macros: { carbs: 38, protein: 28, fat: 34 }
      }
    ];
  }

  return [
    {
      name: "方案 A：轻盈减脂低碳膳食",
      sub: "专注控制升糖与胰岛素，适合减碳需求",
      calorieFactor: 0.95,
      macros: { carbs: 25, protein: 45, fat: 30 }
    },
    {
      name: "方案 B：黄金膳食纤维能量餐",
      sub: "以复合谷物与高膳食纤维为主，饱腹感强",
      calorieFactor: 1,
      macros: { carbs: 50, protein: 30, fat: 20 }
    },
    {
      name: "方案 C：地中海慢享低脂食谱",
      sub: "以富含单不饱和脂肪酸与抗氧化食材为特色",
      calorieFactor: 1.05,
      macros: { carbs: 35, protein: 30, fat: 35 }
    }
  ];
}

// 辅助函数：根据地域和避忌食材确定菜品
function getLocalDishes(region, allergies, dietHabit = "balanced") {
  if (dietHabit === "vegan") {
    switch (region) {
      case "south":
        return {
          lunchA: "香菇豆腐蒸时蔬",
          dinnerA: "荷塘小炒配鹰嘴豆",
          lunchB: "百合莲藕炒毛豆",
          dinnerB: "冬瓜海带豆腐汤",
          lunchC: "清炖番茄菌菇豆腐",
          dinnerC: "白灼生菜配藜麦"
        };
      case "north":
        return {
          lunchA: "孜然杏鲍菇配豆腐",
          dinnerA: "木耳黄瓜炒素鸡",
          lunchB: "杂粮饭配番茄鹰嘴豆",
          dinnerB: "凉拌金针菇黄瓜丝",
          lunchC: "番茄炖豆腐泡",
          dinnerC: "素炒西葫芦"
        };
      case "sichuan":
        return {
          lunchA: "少油干煸杏鲍菇",
          dinnerA: "椒麻凉拌豆腐丝",
          lunchB: "鲜椒爆炒素鸡丁",
          dinnerB: "麻婆豆腐 (少油纯素版)",
          lunchC: "鲜椒烤豆腐排",
          dinnerC: "凉拌爽口木耳"
        };
      case "western":
      default:
        return {
          lunchA: "柠檬香草煎豆腐排",
          dinnerA: "番茄牛油果鹰嘴豆沙拉",
          lunchB: "香草烤菌菇豆排",
          dinnerB: "羽衣甘蓝藜麦沙拉",
          lunchC: "香煎豆腐排",
          dinnerC: "意式番茄豆腐沙拉"
        };
    }
  }

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
function getProteins(allergies, dietHabit = "balanced") {
  if (dietHabit === "vegan") {
    return {
      proteinA: "北豆腐/素鸡",
      proteinB: "鹰嘴豆/毛豆",
      proteinC: "香煎豆腐排"
    };
  }

  const avoidSeafood = allergies.includes("seafood");
  const avoidBeefPork = allergies.includes("beef-pork");

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
function getSnacks(allergies, dietHabit = "balanced") {
  const avoidNuts = allergies.includes("nuts");
  const avoidDairy = allergies.includes("dairy");
  const veganOrDairyFree = avoidDairy || dietHabit === "vegan";

  return {
    snackA: avoidNuts ? "小番茄8个" : "扁桃仁5颗",
    snackB: "苹果半个",
    snackC: veganOrDairyFree ? "无糖椰子酸奶" : "希腊酸奶1杯",
    ingA: avoidNuts ? "樱桃番茄" : "熟无盐坚果",
    ingC: veganOrDairyFree ? "椰子奶" : "低脂酸奶"
  };
}

// 翻译工具函数
function translateGoal(goal) {
  const map = {
    "lose-fat": "健康减脂",
    "gain-muscle": "增肌塑形",
    "balanced": "日常均衡",
    "low-gi": "低 GI 控糖"
  };
  return map[goal] || goal;
}

function translateActivity(activity) {
  const map = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度运动",
    "heavy": "高强度活动"
  };
  return map[activity] || activity;
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

function getBmiStatus(bmi) {
  if (bmi < 18.5) return "偏轻";
  if (bmi < 24) return "标准";
  if (bmi < 28) return "超重";
  return "肥胖风险";
}

function renderProfileSummary() {
  const container = document.getElementById("profileSummary");
  if (!container || !state.formData.age) return;

  const f = state.formData;
  const bmi = f.weight / Math.pow(f.height / 100, 2);
  const allergyText = f.allergies.length > 0
    ? f.allergies.map(translateAllergy).join("、")
    : "无";

  const profileItems = [
    {
      label: "用户画像",
      value: `${f.age}岁 / ${f.gender === "male" ? "男" : "女"} / BMI ${bmi.toFixed(1)}`,
      meta: `体型评估：${getBmiStatus(bmi)}`
    },
    {
      label: "能量模型",
      value: `${state.targetCalories} kcal`,
      meta: `BMR ${state.bmr} kcal / TDEE ${state.tdee} kcal`
    },
    {
      label: "目标与活动",
      value: translateGoal(f.goal),
      meta: `${translateActivity(f.activity)} / ${translateHabit(f.dietHabit)}`
    },
    {
      label: "偏好约束",
      value: translateRegion(f.region),
      meta: `避忌：${allergyText}`
    }
  ];

  container.innerHTML = profileItems.map(item => `
    <article class="profile-summary-card">
      <span class="profile-summary-label">${item.label}</span>
      <strong>${item.value}</strong>
      <small>${item.meta}</small>
    </article>
  `).join("");
}

// 步骤 2：渲染饮食方案
function renderDietPlans() {
  renderProfileSummary();

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
  if (!plan) return;
  
  // 1. 三餐渲染
  const mealsContainer = document.getElementById("mealsListContainer");
  const totalKcal = document.getElementById("totalKcalVal");
  const chartSvg = document.getElementById("macroPieChart");
  const legend = document.getElementById("macroLegend");
  if (!mealsContainer || !totalKcal || !chartSvg || !legend) return;

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
  totalKcal.innerText = plan.calories;

  // 3. SVG 饼图扇形计算绘制
  const carbsPct = plan.macros.carbs;
  const protPct = plan.macros.protein;
  const fatPct = plan.macros.fat;

  // 极坐标周长 2 * PI * r = 2 * 3.14159 * 40 ≈ 251.3
  const circumference = 251.3;
  const strokeCarbs = (carbsPct / 100) * circumference;
  const strokeProt = (protPct / 100) * circumference;
  const strokeFat = (fatPct / 100) * circumference;

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
  if (!activePlan || !container) return;

  container.innerHTML = "";

  const tipText = document.getElementById("ingredientTipText");
  if (tipText) {
    tipText.innerText = `以下是方案【${activePlan.name}】对应的采购食材清单（已自动替换过敏食材并优先选择适宜的夏季时令食材）：`;
  }

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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildProviderReview(provider) {
  const goal = state.formData.goal || "balanced";
  const idealMacros = goal === "gain-muscle"
    ? { carbs: 42, protein: 34, fat: 24 }
    : goal === "low-gi"
      ? { carbs: 32, protein: 36, fat: 32 }
      : { carbs: 42, protein: 32, fat: 26 };

  const planScores = state.plans.map((plan, idx) => {
    const macroFit = clampScore(
      100
      - Math.abs(plan.macros.carbs - idealMacros.carbs) * 0.8
      - Math.abs(plan.macros.protein - idealMacros.protein) * 1.1
      - Math.abs(plan.macros.fat - idealMacros.fat) * 0.7
    );
    const executionFit = clampScore((plan.scores.cost * 0.45) + (plan.scores.season * 0.35) + (plan.scores.region * 0.2));

    let score = 0;
    if (provider.id === "doubao") {
      score = (plan.scores.region * 0.32) + (plan.scores.season * 0.26) + (executionFit * 0.24) + (macroFit * 0.18);
    } else if (provider.id === "qianwen") {
      score = (macroFit * 0.36) + (plan.scores.region * 0.24) + (plan.scores.season * 0.22) + (plan.scores.cost * 0.18);
    } else {
      score = (plan.scores.cost * 0.3) + (macroFit * 0.3) + (plan.scores.season * 0.22) + (plan.scores.region * 0.18);
    }

    return {
      idx,
      planName: plan.name,
      score: clampScore(score),
      macroFit,
      executionFit
    };
  });

  const best = planScores.reduce((winner, current) => current.score > winner.score ? current : winner, planScores[0]);
  const noteMap = {
    doubao: `更偏向用户可执行性和地域口味，倾向推荐「${best.planName}」。`,
    qianwen: `更重视宏量营养结构和中文解释一致性，倾向推荐「${best.planName}」。`,
    deepseek: `更偏向量化约束、成本和分数稳定性，倾向推荐「${best.planName}」。`
  };

  return {
    providerId: provider.id,
    providerName: provider.displayName || provider.name,
    role: provider.displayRole || provider.role,
    latency: provider.latency,
    planScores,
    note: noteMap[provider.id]
  };
}

function runAiDebateForPlans() {
  if (!state.plans.length) return;

  renderAiDebate(true);

  const reviewCalls = serviceRegistry.cloudProviders.map(provider => {
    return apiSwitch.request("/api/v1/cloud/providers/review", {
      provider: provider.id,
      plans: state.plans.map(plan => ({
        name: plan.name,
        macros: plan.macros,
        scores: plan.scores
      }))
    }, {
      source: "evaluation-engine",
      target: `cloud-${provider.id}`,
      latency: provider.latency
    }).then(response => {
      if (response.ok && response.data && response.data.providerId) {
        return normalizeBackendProviderReview(response.data, provider);
      }
      return buildProviderReview(provider);
    });
  });

  Promise.all(reviewCalls).then(reviews => {
    state.aiDebate.reviews = reviews;
    state.aiDebate.consensus = state.plans.map((plan, idx) => {
      const score = reviews.reduce((sum, review) => {
        return sum + (review.planScores.find(item => item.idx === idx)?.score || 0);
      }, 0) / reviews.length;

      return {
        idx,
        name: plan.name,
        score: clampScore(score)
      };
    });

    saveDataRecord("evaluation.aiDebate", state.aiDebate);
    renderAiDebate();
    evaluatePlansRealtime();
    enqueueLog("eval", "多角度智能复核完成，已汇总共识分并更新评估结果。");
  });
}

function normalizeBackendProviderReview(data, provider) {
  return {
    providerId: data.providerId || provider.id,
    providerName: provider.displayName || provider.name,
    role: provider.displayRole || provider.role,
    latency: provider.latency,
    planScores: (data.scores || []).map(item => ({
      idx: item.idx,
      planName: item.planName,
      score: item.score,
      macroFit: item.score,
      executionFit: item.score
    })),
    note: data.note || "复核完成。"
  };
}

function renderAiDebate(isLoading = false) {
  const container = document.getElementById("aiDebateContainer");
  if (!container) return;

  if (isLoading) {
    container.innerHTML = serviceRegistry.cloudProviders.map(provider => `
      <article class="ai-review-card">
        <div class="ai-review-head">
          <div>
            <div class="ai-review-name">${provider.displayName}</div>
            <div class="ai-review-role">${provider.displayRole}</div>
          </div>
          <div class="ai-review-latency">pending</div>
        </div>
        <div class="ai-review-note">正在进行独立复核...</div>
      </article>
    `).join("");
    return;
  }

  if (!state.aiDebate.reviews.length) {
    container.innerHTML = `
      <article class="ai-review-card">
        <div class="ai-review-name">等待评估阶段</div>
        <div class="ai-review-note">进入方案评估后，系统会从不同角度复核方案并汇总共识分。</div>
      </article>
    `;
    return;
  }

  container.innerHTML = state.aiDebate.reviews.map(review => `
    <article class="ai-review-card">
      <div class="ai-review-head">
        <div>
          <div class="ai-review-name">${review.providerName}</div>
          <div class="ai-review-role">${review.role}</div>
        </div>
        <div class="ai-review-latency">${review.latency}ms</div>
      </div>
      <div class="debate-plan-list">
        ${review.planScores.map(item => `
          <div class="debate-plan-row">
            <span>${item.planName}</span>
            <span class="debate-score">${item.score}</span>
            <div class="debate-bar-bg">
              <div class="debate-bar-fill" style="width: ${item.score}%;"></div>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="ai-review-note">${review.note}</div>
    </article>
  `).join("");
}

function getConsensusScoreForPlan(idx) {
  const consensus = state.aiDebate.consensus.find(item => item.idx === idx);
  return consensus ? consensus.score : null;
}

// 步骤 4：实时加权打分与胜出方案推荐
function evaluatePlansRealtime() {
  if (!state.plans.length) return;

  const costWeight = state.weights.cost / 100;
  const seasonWeight = state.weights.season / 100;
  const regionWeight = state.weights.region / 100;

  let maxScore = -1;
  let winnerIndex = 0;
  
  const scoresOutput = [];

  state.plans.forEach((plan, idx) => {
    // 归一化综合评分
    const ruleScore = Math.round(
      (plan.scores.cost * costWeight) +
      (plan.scores.season * seasonWeight) +
      (plan.scores.region * regionWeight)
    );
    const consensusScore = getConsensusScoreForPlan(idx);
    const finalScore = consensusScore === null
      ? ruleScore
      : Math.round((ruleScore * 0.86) + (consensusScore * 0.14));

    scoresOutput.push({ idx, name: plan.name, score: finalScore, ruleScore, consensusScore });

    if (finalScore > maxScore) {
      maxScore = finalScore;
      winnerIndex = idx;
    }
  });

  state.selectedPlanIndex = winnerIndex;

  // 渲染对比面板
  const listContainer = document.getElementById("scoresComparisonContainer");
  const winnerBanner = document.getElementById("winnerBannerContainer");
  if (!listContainer || !winnerBanner) return;

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
      <div class="metric-value">
        规则分 ${item.ruleScore} ${item.consensusScore === null ? "· 等待 AI 对抗分" : `· AI 共识分 ${item.consensusScore}`}
      </div>
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width: ${item.score}%;"></div>
      </div>
    `;
    listContainer.appendChild(scoreRow);
  });

  // 渲染最终推荐横幅
  const winnerPlan = state.plans[winnerIndex];
  const winnerConsensus = getConsensusScoreForPlan(winnerIndex);
  winnerBanner.innerHTML = `
    <div class="winner-banner-icon">🏆</div>
    <div>
      <div style="font-weight: 700; color: #10B981; margin-bottom: 0.15rem;">推荐方案：${winnerPlan.name}</div>
      <div style="color: var(--text-secondary); line-height: 1.4;">
        在您当前的评估指标下，该方案表现最优。时令匹配度为 ${winnerPlan.scores.season}%，
        地域风味匹配度为 ${winnerPlan.scores.region}%${winnerConsensus === null ? "" : `，多 AI 共识分为 ${winnerConsensus} 分`}，能够最大程度满足预算与适宜性。
      </div>
    </div>
  `;

  saveDataRecord("evaluation.current", {
    weights: state.weights,
    selectedPlanIndex: state.selectedPlanIndex,
    selectedPlanName: winnerPlan.name,
    scores: scoresOutput
  });
}

// 步骤 5：营销文案生成引擎 (自适应用户指标和方案结果)
function generateMarketingTexts() {
  const winnerPlan = state.plans[state.selectedPlanIndex];
  const f = state.formData;
  if (!winnerPlan || !f.age) return;

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
  const xhsText = `🔥 夏季清爽健康餐【${templateParams.PlanName}】真的很适合坚持！✨

姐妹们！夏天已经到了，想穿漂亮衣服又管不住嘴？赶紧看过来！
我刚才根据自己的身高、体重、活动量、饮食禁忌和地域口味，定制了一套【${templateParams.PlanName}】，热量、营养比例和采购清单都安排好了，执行起来很省心！

📊 每日科学能量配比：
- 每日预算：${templateParams.Calories} kcal
- 三大营养素比例：碳水 ${templateParams.Carbs}% | 蛋白质 ${templateParams.Protein}% | 脂肪 ${templateParams.Fat}%

🍽 一日三餐食谱公开：
🌅 早餐：${templateParams.Breakfast}
☀️ 午餐：${templateParams.Lunch}
🌙 晚餐：${templateParams.Dinner}
🍎 加餐：${templateParams.Snack}

🛒 连食材采购清单都帮我规划好了，根本不用自己动脑折算！
这次还特意筛选了【${templateParams.Region}】口味的当季食材，精打细算既省钱又新鲜，日常备餐更容易坚持！

别再盲目节食了，科学饮食才能瘦得漂亮！快来Pick你的专属食谱吧！
#健康减脂 #小红书爆款食谱 #控糖低卡 #夏季瘦身 #自律打卡 #我的健康生活`;

  // 2. 抖音脚本
  const videoText = `🎬 抖音短视频脚本：《一套能坚持的夏季健康餐》

【BGM】：轻快、动感、充满活力的卡点音乐
【视频时长】：30秒
【适合调性】：时尚健康、自律日常、科技改变生活

---
🎥 【画面 1】
- 画面：主角站在穿衣镜前，露出平坦的马甲线/身形，随后转头看向镜头，面带自信笑容。
- 视觉提示：屏幕中央浮现花字：“减脂真的不需要挨饿！”
- 旁白（声调上扬）：夏天要露肉？你还在每天靠水煮菜、啃黄瓜熬着吗？

🎥 【画面 2】
- 画面：切入手机，特写健康饮食规划页面，展示个人画像、热量预算和三餐安排。
- 视觉提示：显示“已生成专属方案”和“采购清单已就绪”。
- 旁白：今天带大家看看我的秘密武器——根据个人画像定制的【${templateParams.PlanName}】！

🎥 【画面 3】
- 画面：快速卡点切入三餐美食特写（香气扑鼻的少油主菜、翠绿的沙拉、五彩谷物饭）。
- 视觉提示：屏幕左侧打上能量卡片：${templateParams.Calories} kcal，营养比例均衡。
- 旁白：早餐吃【${templateParams.Breakfast}】，午餐是饱腹感极强的【${templateParams.Lunch}】，晚餐只要吃【${templateParams.Dinner}】！热量控制在 ${templateParams.Calories} 大卡，越吃越瘦，根本不用饿肚子！

🎥 【画面 4】
- 画面：主角拿着手机食材清单，在超市里开心地挑选新鲜果蔬。
- 旁白：连食材采购量都自动折算好了，还针对夏季时令和预算做了评估，太懂打工人的钱包了！

🎥 【画面 5】
- 画面：主角微笑，点赞屏幕，屏幕弹出评论区引导。
- 视觉提示：花字：“评论区留下【画像】，测试你的专属食谱！”
- 旁白：想要同款低卡食谱？关注我，在评论区留下你的身高体重，AI马上帮你算！`;

  // 3. 微信公众号
  const gzhText = `标题：如何利用【${templateParams.PlanName}】实现科学健康管理？

引言：
在健康管理日益个性化的今天，单一的“万能食谱”已无法满足现代人对口味、预算及季节性采购的复杂需求。本文将为您详细拆解【${templateParams.PlanName}】。该方案结合了营养科学、时令食材供应以及地域风味，提供了一套切实可行的膳食改善路径。

一、 画像分析与能量代谢指标
系统首先根据身体指标、活动水平和健康目标估算能量摄入，并形成个性化营养结构。
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

三、 采购与存储建议
系统根据方案生成了分类食材清单，并给出了针对夏季的高温防霉、储鲜防潮指南，确保食材新鲜度的同时也减少了食物浪费。

结语：
  科学饮食不是折磨，而是一场身体的重塑。通过个性化规划，我们能让繁琐的营养计算、食材采购和成本评估变得触手可及。欢迎转发分享这套食谱给有需要的朋友！`;

  // 填入 DOM 中
  const xhsBox = document.getElementById("copyBoxXhs");
  const videoBox = document.getElementById("copyBoxVideo");
  const gzhBox = document.getElementById("copyBoxGzh");

  if (xhsBox) xhsBox.innerText = xhsText;
  if (videoBox) videoBox.innerText = videoText;
  if (gzhBox) gzhBox.innerText = gzhText;

  saveDataRecord("marketing.current", {
    selectedPlan: winnerPlan.name,
    xhsText,
    videoText,
    gzhText
  });
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
    case "client": tagClass = "client"; tagLabel = "画像"; break;
    case "diet": tagClass = "diet"; tagLabel = "方案"; break;
    case "ingredient": tagClass = "ingredient"; tagLabel = "清单"; break;
    case "eval": tagClass = "eval"; tagLabel = "评估"; break;
    case "market": tagClass = "market"; tagLabel = "文案"; break;
    case "switch": tagClass = "switch"; tagLabel = "服务"; break;
    case "data": tagClass = "data"; tagLabel = "保存"; break;
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

// 处理进度队列打印调度器
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
  const selectedPlan = state.plans[state.selectedPlanIndex];

  if (!btn || !progressContainer || !progressBar || !progressText) return;
  if (!selectedPlan) {
    addSystemLog("market", "未找到最终方案，无法生成宣传视频。请先完成方案评估。");
    return;
  }

  recordingCanvas = document.getElementById("videoCanvas");
  if (!recordingCanvas || !recordingCanvas.getContext || !recordingCanvas.captureStream || typeof MediaRecorder === "undefined") {
    addSystemLog("market", "当前浏览器不支持 Canvas 录制或 MediaRecorder，无法生成 WebM 视频。");
    alert("当前浏览器不支持视频录制，请使用最新版 Chrome、Edge 或 Safari 重试。");
    return;
  }

  canvasCtx = recordingCanvas.getContext("2d");
  if (!canvasCtx) {
    addSystemLog("market", "Canvas 2D 上下文初始化失败，已取消视频生成。");
    return;
  }

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

  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (err) {
    btn.disabled = false;
    btn.innerText = "🎬 1. 生成并录制宣传视频";
    progressContainer.style.display = "none";
    addSystemLog("market", `视频录制初始化失败：${err.message}`);
    return;
  }
  
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
    const activePlan = selectedPlan;

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
    canvasCtx.fillText('个性化健康饮食推荐', 300, 95);

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
  if (!activePlan) {
    addSystemLog("market", "未找到最终方案，无法导出发布包。");
    return;
  }
  
  // 生成抖音定制文案
  const dyText = `🎬 个性化定制的【${activePlan.name}】公开！每日摄入 ${activePlan.calories} 千卡，营养素配比精细，非常科学！#健康减脂 #小红书爆款食谱 #控糖低卡 #夏季瘦身 #自律打卡`;
  
  const xhsBox = document.getElementById("copyBoxXhs");
  const data = {
    plan_name: activePlan.name,
    calories: activePlan.calories,
    xhs_text: xhsBox ? xhsBox.innerText : "",
    video_desc: dyText
  };

  apiSwitch.request("/api/v1/publish/package", data, {
    source: "marketing-writer",
    target: "publish-bot"
  });
  saveDataRecord("publish.package", data);

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
