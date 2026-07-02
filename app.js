/**
 * 个性化健康饮食规划系统 - app.js
 * 负责状态控制、业务流程、动态数据渲染、以及权重评估运算
 */

// 全局状态管理
const state = {
  currentStep: 5,
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
  planConstraints: {
    pinnedDishes: [],
    deletedDishes: [],
    revision: 0
  },
  planDiscussion: {
    agents: [],
    consensus: "",
    revision: 0
  },
  dietCalendar: {
    period: "day",
    startDate: "",
    selectedDate: "",
    visibleDate: "",
    savedDates: {},
    generationStatus: {},
    backgroundQueueRunning: false,
    backgroundQueue: [],
    loading: false,
    lastSource: "new"
  },
  checkins: {},
  historyMenus: {},
  backend: {
    enabled: true,
    online: false,
    baseUrl: "http://127.0.0.1:8000",
    lastError: "未检测",
    eventStream: "idle"
  },
  auth: {
    token: "",
    user: null,
    mode: "login",
    loading: false
  },
  commerce: {
    plans: [],
    entitlement: "free",
    limits: {
      planPeriods: ["day"],
      maxRangeDays: 1,
      rangeShopping: false,
      historyReview: false,
      shareExport: false,
      edgeOffline: false
    },
    subscription: null,
    orders: [],
    loading: false,
    lastError: ""
  },
  apiEvents: []
};

const STORAGE_KEYS = {
  records: "dietPlannerSevenLayerRecordsV1",
  apiEvents: "dietPlannerApiEventsV1",
  authToken: "dietPlannerAuthTokenV1"
};

const DIET_PLAN_VARIETY_VERSION = "date-context-v5-angle-score-tradeoff";
const PLAN_DISPLAY_LABELS = ["方案 A", "方案 B", "方案 C"];
const PLAN_ANGLE_META = [
  {
    label: "营养稳态角度",
    role: "营养约束 Agent",
    defaultName: "营养稳态高蛋白餐"
  },
  {
    label: "饱腹体验角度",
    role: "偏好体验 Agent",
    defaultName: "高纤慢糖饱腹餐"
  },
  {
    label: "时令地域角度",
    role: "时令地域 Agent",
    defaultName: "时令地域轻负担餐"
  }
];
const PLAN_ANGLE_SCORE_PROFILES = [
  { cost: 80, season: 84, region: 94 },
  { cost: 94, season: 82, region: 78 },
  { cost: 76, season: 96, region: 88 }
];
const COMMERCE_PLAN_FALLBACKS = [
  {
    id: "free",
    name: "免费体验版",
    amountCny: 0,
    billingCycle: "none",
    description: "体验问卷和单日饮食计划。",
    features: ["单日基础方案", "本地计划记录", "基础采购清单"]
  },
  {
    id: "pro_month",
    name: "Pro 月会员",
    amountCny: 19.9,
    billingCycle: "month",
    description: "解锁周期计划、采购合并和报告导出。",
    features: ["一周/一个月计划", "周期合并采购清单", "打卡历史复盘", "分享报告导出"]
  }
];
const COMMERCE_LIMIT_FALLBACKS = {
  free: {
    planPeriods: ["day"],
    maxRangeDays: 1,
    rangeShopping: false,
    historyReview: false,
    shareExport: false,
    edgeOffline: false
  },
  pro: {
    planPeriods: ["day", "week", "month"],
    maxRangeDays: 30,
    rangeShopping: true,
    historyReview: true,
    shareExport: true,
    edgeOffline: true
  }
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
    { id: "market", name: "sharing-writer", api: "/api/v1/marketing/content" }
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
  initPlanCalendarControls();
  initAuthState();
  renderBodyTrendPanel();
  goToCustomerHome({ silent: true });
  addSystemLog("system", "系统初始化完成，已准备生成个性化饮食方案。");
  addSystemLog("switch", "正在检查后端服务连接；若服务不可用，将自动使用本地计算流程。");
  addSystemLog("client", "已进入客户主页；尚无计划时可先定制饮食计划。");
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch (err) {
      console.warn("Clipboard API 复制失败，尝试降级复制。", err);
    }
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
      copied ? resolve("execCommand") : reject(new Error("execCommand copy failed"));
    } catch (err) {
      document.body.removeChild(textArea);
      reject(err);
    }
  });
}

function selectTextElement(element) {
  if (!element || !window.getSelection || !document.createRange) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  element.classList.add("copy-selected");

  setTimeout(() => {
    element.classList.remove("copy-selected");
  }, 2400);

  return true;
}

function flashCopyButton(btn, html, className) {
  const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
  btn.dataset.originalHtml = originalHtml;
  btn.innerHTML = html;
  btn.classList.remove("copied", "manual-copy");
  btn.classList.add(className);

  setTimeout(() => {
    btn.innerHTML = originalHtml;
    btn.classList.remove("copied", "manual-copy");
    delete btn.dataset.originalHtml;
  }, className === "copied" ? 2000 : 2800);
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
  const headers = { "Content-Type": "application/json" };
  if (state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }

  const response = await fetch(`${baseUrl}/api/v1/switch/dispatch`, {
    method: "POST",
    headers,
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

function initAuthState() {
  state.auth.token = localStorage.getItem(STORAGE_KEYS.authToken) || "";
  state.auth.user = null;
  state.auth.loading = false;
  state.auth.mode = "login";
  renderAuthPanel();
  refreshCommerceState({ silent: true });

  if (state.auth.token) {
    refreshCurrentUser({ announce: true });
  }
}

function getAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }
  return headers;
}

async function requestAuth(path, options = {}) {
  const baseUrl = getBackendBaseUrl();
  state.backend.baseUrl = baseUrl;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {})
      }
    });
  } catch (err) {
    const networkError = new Error("后端服务未连接，无法访问账户数据库");
    networkError.cause = err;
    throw networkError;
  }

  let data = {};
  try {
    data = await response.json();
  } catch (err) {
    data = {};
  }

  if (!response.ok) {
    const message = data.detail || `账户服务 HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  state.backend.online = true;
  state.backend.lastError = "";
  renderApiSwitchMetrics();
  return data;
}

function getCommercePlans() {
  return state.commerce.plans.length ? state.commerce.plans : COMMERCE_PLAN_FALLBACKS;
}

function getCommerceLimits() {
  return state.commerce.limits || COMMERCE_LIMIT_FALLBACKS[state.commerce.entitlement] || COMMERCE_LIMIT_FALLBACKS.free;
}

function isProEntitled() {
  return state.commerce.entitlement === "pro";
}

function hasCommerceFeature(featureName) {
  return Boolean(getCommerceLimits()[featureName]);
}

function setCommerceMessage(message, type = "info") {
  const el = document.getElementById("membershipMessage");
  if (!el) return;
  el.textContent = message || "";
  el.dataset.type = type;
}

function promptUpgradeForFeature(featureLabel) {
  const message = `${featureLabel} 属于 Pro 权益，请先开通会员。`;
  setCommerceMessage(message, "error");
  addSystemLog("market", message);
  return false;
}

function canUsePlanPeriod(period) {
  const normalized = normalizePlanPeriod(period);
  return (getCommerceLimits().planPeriods || ["day"]).includes(normalized);
}

function getAllowedPlanPeriod(period, options = {}) {
  const normalized = normalizePlanPeriod(period);
  if (canUsePlanPeriod(normalized)) return normalized;
  if (options.announce) {
    promptUpgradeForFeature(`${getPlanPeriodLabel(normalized)}周期计划`);
  }
  return "day";
}

function ensureEntitledPlanPeriod(options = {}) {
  const allowed = getAllowedPlanPeriod(state.dietCalendar.period, options);
  if (allowed !== state.dietCalendar.period) {
    state.dietCalendar.period = allowed;
    setVisiblePlanDate(state.dietCalendar.startDate || getTodayIsoDate());
  }
}

function applyCommercePayload(data = {}) {
  const entitlement = data.entitlement || "free";
  state.commerce.plans = Array.isArray(data.plans) && data.plans.length
    ? data.plans
    : getCommercePlans();
  state.commerce.entitlement = entitlement;
  state.commerce.limits = data.limits || COMMERCE_LIMIT_FALLBACKS[entitlement] || COMMERCE_LIMIT_FALLBACKS.free;
  state.commerce.subscription = data.subscription || null;
  state.commerce.orders = Array.isArray(data.orders) ? data.orders : [];
  state.commerce.lastError = "";
  ensureEntitledPlanPeriod();
  renderCommercePanel();
  renderPlanCalendarControls();
  renderRangeShoppingPanel();
  if (typeof saveDataRecord === "function") {
    saveDataRecord("commerce.subscription.current", {
      entitlement: state.commerce.entitlement,
      subscription: state.commerce.subscription,
      orders: state.commerce.orders
    });
  }
}

function resetCommerceState() {
  state.commerce.entitlement = "free";
  state.commerce.limits = COMMERCE_LIMIT_FALLBACKS.free;
  state.commerce.subscription = null;
  state.commerce.orders = [];
  state.commerce.loading = false;
  state.commerce.lastError = "";
  ensureEntitledPlanPeriod();
  renderCommercePanel();
  renderPlanCalendarControls();
  renderRangeShoppingPanel();
}

async function refreshCommerceState(options = {}) {
  state.commerce.loading = true;
  renderCommercePanel();
  try {
    const data = state.auth.token
      ? await requestAuth("/api/v1/business/subscription/me", { method: "GET" })
      : await requestAuth("/api/v1/business/plans", { method: "GET" });
    applyCommercePayload(state.auth.token ? data : {
      ...data,
      entitlement: "free",
      limits: COMMERCE_LIMIT_FALLBACKS.free,
      subscription: null,
      orders: []
    });
    if (options.announce && state.auth.token) {
      addSystemLog("market", `会员权益已同步：${isProEntitled() ? "Pro" : "免费版"}。`);
    }
  } catch (err) {
    state.commerce.lastError = err.message || "会员服务不可用";
    if (!state.commerce.plans.length) state.commerce.plans = COMMERCE_PLAN_FALLBACKS;
    if (!state.auth.token) resetCommerceState();
    renderCommercePanel();
  } finally {
    state.commerce.loading = false;
    renderCommercePanel();
  }
}

function formatCommercePrice(plan) {
  const amount = Number(plan.amountCny || 0);
  if (!amount) return "免费";
  const cycle = plan.billingCycle === "year" ? "年" : "月";
  return `¥${amount.toFixed(amount % 1 ? 1 : 0)}/${cycle}`;
}

function renderCommercePanel() {
  const status = document.getElementById("membershipStatus");
  const benefits = document.getElementById("membershipBenefits");
  const list = document.getElementById("membershipPlanList");
  const message = document.getElementById("membershipMessage");
  if (!status && !benefits && !list) return;

  const subscription = state.commerce.subscription;
  if (status) {
    status.textContent = state.commerce.loading
      ? "会员状态同步中..."
      : (isProEntitled()
        ? `Pro 已开通 · ${formatDateTime(subscription?.expiresAt)} 到期`
        : "免费版 · 单日计划");
  }

  if (benefits) {
    benefits.innerHTML = "";
    const activePlan = getCommercePlans().find(plan => plan.id === subscription?.planId)
      || getCommercePlans().find(plan => plan.id === (isProEntitled() ? "pro_month" : "free"))
      || COMMERCE_PLAN_FALLBACKS[0];
    (activePlan.features || []).slice(0, 4).forEach(feature => {
      const item = document.createElement("span");
      item.textContent = feature;
      benefits.appendChild(item);
    });
  }

  if (list) {
    list.innerHTML = "";
    getCommercePlans()
      .filter(plan => plan.id !== "free")
      .forEach(plan => {
        const item = document.createElement("article");
        item.className = "commerce-plan-item";

        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = `${plan.name} · ${formatCommercePrice(plan)}`;
        const desc = document.createElement("small");
        desc.textContent = plan.description || (plan.features || []).join("、");
        info.appendChild(name);
        info.appendChild(desc);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.membershipPlan = plan.id;
        btn.textContent = subscription?.planId === plan.id ? "已开通" : "开通";
        btn.disabled = state.commerce.loading || subscription?.planId === plan.id;

        item.appendChild(info);
        item.appendChild(btn);
        list.appendChild(item);
      });
  }

  if (message && state.commerce.lastError) {
    message.textContent = state.commerce.lastError;
    message.dataset.type = "error";
  }
}

async function checkoutMembershipPlan(planId, options = {}) {
  if (!state.auth.token) {
    setCommerceMessage("请先登录账户，再开通会员套餐。", "error");
    setAuthMessage("请先登录后再开通会员", "error");
    return null;
  }

  state.commerce.loading = true;
  renderCommercePanel();
  try {
    const data = await requestAuth("/api/v1/business/orders/checkout", {
      method: "POST",
      body: JSON.stringify({
        planId,
        channel: options.channel || "sidebar-membership",
        paymentMethod: "demo"
      })
    });
    applyCommercePayload(data);
    setCommerceMessage(`已开通 ${data.subscription?.planName || "Pro 会员"}，订单 ${data.order?.id || "已记录"}。`, "success");
    addSystemLog("market", `会员订单已支付：${data.subscription?.planName || planId}，Pro 权益已生效。`);
    return data;
  } catch (err) {
    setCommerceMessage(err.message || "会员开通失败", "error");
    state.commerce.lastError = err.message || "会员开通失败";
    return null;
  } finally {
    state.commerce.loading = false;
    renderCommercePanel();
  }
}

function setAuthMode(mode) {
  state.auth.mode = mode === "register" ? "register" : "login";
  renderAuthPanel();
}

function setAuthMessage(message, type = "info") {
  const messageEl = document.getElementById("authMessage");
  if (!messageEl) return;
  messageEl.innerText = message || "";
  messageEl.dataset.type = type;
}

function renderAuthPanel() {
  const guestPanel = document.getElementById("authGuestPanel");
  const userPanel = document.getElementById("authUserPanel");
  const displayNameGroup = document.getElementById("authDisplayNameGroup");
  const submitBtn = document.getElementById("authSubmitBtn");
  const userName = document.getElementById("authUserName");
  const userEmail = document.getElementById("authUserEmail");
  const profileStatus = document.getElementById("authProfileStatus");

  const isLoggedIn = Boolean(state.auth.user);
  if (guestPanel) guestPanel.hidden = isLoggedIn;
  if (userPanel) userPanel.hidden = !isLoggedIn;

  document.querySelectorAll("[data-auth-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.authMode === state.auth.mode);
  });

  if (displayNameGroup) {
    displayNameGroup.hidden = state.auth.mode !== "register";
  }

  if (submitBtn) {
    submitBtn.disabled = state.auth.loading;
    submitBtn.innerText = state.auth.loading
      ? "处理中..."
      : (state.auth.mode === "register" ? "注册并登录" : "登录账户");
  }

  if (isLoggedIn) {
    const user = state.auth.user;
    if (userName) userName.innerText = user.displayName || "已登录用户";
    if (userEmail) userEmail.innerText = user.email || "";
    if (profileStatus) {
      profileStatus.innerText = hasStoredProfile(user.profile)
        ? `数据库画像已保存 · ${formatDateTime(user.updatedAt)}`
        : "数据库中暂无画像，提交问卷后会保存";
    }
  }
}

function hasStoredProfile(profile) {
  return Boolean(profile && typeof profile === "object" && Object.keys(profile).length > 0);
}

function handleAuthenticatedProfile(profile, options = {}) {
  if (applyStoredProfileToForm(profile)) {
    if (options.announce) {
      addSystemLog("data", options.loadedMessage || "已从数据库读取客户画像，并填回问卷。");
    }
    return true;
  }

  setAuthMessage("当前账户暂无客户画像，请先完成基础健康问卷。", "info");
  goToStep(1);
  if (options.announce !== false) {
    addSystemLog("client", "当前账户暂无客户画像，已跳转到基础健康问卷收集客户画像。");
  }
  return false;
}

function formatDateTime(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function deepClone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTodayIsoDate() {
  return toIsoDate(new Date());
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function normalizeIsoDate(value) {
  return parseIsoDate(value) ? value : getTodayIsoDate();
}

function addDays(isoDate, count) {
  const date = parseIsoDate(isoDate) || new Date();
  date.setDate(date.getDate() + count);
  return toIsoDate(date);
}

function normalizePlanPeriod(period) {
  return ["day", "week", "month"].includes(period) ? period : "day";
}

function getPlanPeriodLength(period = state.dietCalendar.period) {
  const normalized = normalizePlanPeriod(period);
  if (normalized === "week") return 7;
  if (normalized === "month") return 30;
  return 1;
}

function getPlanPeriodLabel(period = state.dietCalendar.period) {
  const labels = {
    day: "一天",
    week: "一周",
    month: "一个月"
  };
  return labels[normalizePlanPeriod(period)] || labels.day;
}

function getPlanDateRange() {
  const startDate = normalizeIsoDate(state.dietCalendar.startDate || getTodayIsoDate());
  const length = getPlanPeriodLength();
  return Array.from({ length }, (_, index) => addDays(startDate, index));
}

function getVisiblePlanDate() {
  return normalizeIsoDate(
    state.dietCalendar.visibleDate
    || state.dietCalendar.selectedDate
    || state.dietCalendar.startDate
    || getTodayIsoDate()
  );
}

function setVisiblePlanDate(planDate) {
  const normalizedDate = normalizeIsoDate(planDate);
  state.dietCalendar.selectedDate = normalizedDate;
  state.dietCalendar.visibleDate = normalizedDate;
  return normalizedDate;
}

function getPlanGenerationEntry(planDate) {
  const normalizedDate = normalizeIsoDate(planDate);
  return state.dietCalendar.generationStatus?.[normalizedDate] || { status: "idle", message: "" };
}

function getPlanGenerationStatus(planDate) {
  return getPlanGenerationEntry(planDate).status || "idle";
}

function setPlanGenerationStatus(planDate, status, message = "") {
  const normalizedDate = normalizeIsoDate(planDate);
  if (!state.dietCalendar.generationStatus || typeof state.dietCalendar.generationStatus !== "object") {
    state.dietCalendar.generationStatus = {};
  }
  if (!status || status === "idle") {
    delete state.dietCalendar.generationStatus[normalizedDate];
    return;
  }
  state.dietCalendar.generationStatus[normalizedDate] = {
    status,
    message,
    updatedAt: new Date().toISOString()
  };
}

function getPlanGenerationLabel(status) {
  const labels = {
    queued: "排队中",
    generating: "生成中",
    saved: "已保存",
    failed: "生成失败"
  };
  return labels[status] || "";
}

function formatPlanDateLabel(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate || "未选日期";
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function formatPlanDateShort(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate || "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function getPlanWeekday(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function getPlanDateSeed(isoDate) {
  return String(isoDate || "")
    .replace(/\D/g, "")
    .split("")
    .reduce((sum, char) => sum + Number(char), 0);
}

function createEmptyPlanConstraints() {
  return { pinnedDishes: [], deletedDishes: [], revision: 0 };
}

function createEmptyPlanDiscussion() {
  return { agents: [], consensus: "", revision: 0 };
}

function normalizePlanConstraints(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    pinnedDishes: Array.isArray(source.pinnedDishes) ? deepClone(source.pinnedDishes) : [],
    deletedDishes: Array.isArray(source.deletedDishes) ? deepClone(source.deletedDishes) : [],
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : 0
  };
}

function normalizePlanDiscussion(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    agents: Array.isArray(source.agents) ? deepClone(source.agents) : [],
    consensus: source.consensus || "",
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : 0,
    updatedAt: source.updatedAt || ""
  };
}

function getDietPlanRecordKey(planDate) {
  const owner = state.auth.user?.id || "guest";
  return `diet.plan.${owner}.${planDate}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalizeComparableList(value) {
  return Array.isArray(value)
    ? value.map(item => String(item || "").trim()).filter(Boolean).sort()
    : [];
}

function getComparableProfile(profile = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  const extra = source.extraProfile && typeof source.extraProfile === "object" ? source.extraProfile : {};
  return {
    gender: source.gender || "",
    age: Number(source.age) || 0,
    height: Number(source.height) || 0,
    weight: Number(source.weight) || 0,
    goal: source.goal || "",
    activity: source.activity || "",
    dietHabit: source.dietHabit || "",
    region: source.region || "",
    allergies: normalizeComparableList(source.allergies),
    extraProfileText: String(source.extraProfileText || extra.rawText || "").trim(),
    extraProfile: {
      likes: normalizeComparableList(extra.likes),
      avoids: normalizeComparableList(extra.avoids),
      preferences: normalizeComparableList(extra.preferences),
      habits: normalizeComparableList(extra.habits),
      notes: normalizeComparableList(extra.notes)
    }
  };
}

function getProfileSignature(profile = state.formData) {
  return stableStringify(getComparableProfile(profile));
}

function isDietPlanSnapshotProfileMatch(snapshot, profile = state.formData) {
  if (!snapshot || !profile?.age) return true;
  const currentSignature = getProfileSignature(profile);
  const savedSignature = snapshot.metrics?.profileSignature || getProfileSignature(snapshot.profile || {});
  return savedSignature === currentSignature;
}

function getUsableDietPlanSnapshot(snapshot, planDate, sourceLabel = "已保存") {
  const normalized = normalizeDietPlanSnapshot(snapshot, snapshot?.source || "local");
  if (!normalized?.plans?.length) return null;
  if (isDietPlanSnapshotProfileMatch(normalized)) {
    if (normalized.metrics?.varietyVersion === DIET_PLAN_VARIETY_VERSION) {
      return normalized;
    }
    if (sourceLabel) {
      addSystemLog("data", `${sourceLabel} ${formatPlanDateLabel(planDate || normalized.planDate)} 的饮食计划来自旧版生成策略，已跳过并重新生成。`);
    }
    return null;
  }
  if (sourceLabel) {
    addSystemLog("data", `${sourceLabel} ${formatPlanDateLabel(planDate || normalized.planDate)} 的饮食计划与当前画像不一致，已跳过并重新生成。`);
  }
  return null;
}

function normalizeDietPlanSnapshot(rawSnapshot, source = "local") {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return null;
  const planDate = normalizeIsoDate(rawSnapshot.planDate || state.dietCalendar.selectedDate || state.dietCalendar.startDate);
  return {
    planDate,
    period: normalizePlanPeriod(rawSnapshot.period || state.dietCalendar.period),
    profile: deepClone(rawSnapshot.profile || {}),
    plans: Array.isArray(rawSnapshot.plans) ? deepClone(rawSnapshot.plans) : [],
    planDiscussion: normalizePlanDiscussion(rawSnapshot.planDiscussion),
    planConstraints: normalizePlanConstraints(rawSnapshot.planConstraints),
    metrics: deepClone(rawSnapshot.metrics || {}),
    createdAt: rawSnapshot.createdAt || rawSnapshot.updatedAt || new Date().toISOString(),
    updatedAt: rawSnapshot.updatedAt || new Date().toISOString(),
    source,
    dbSaved: source === "database" || Boolean(rawSnapshot.dbSaved)
  };
}

function createDietPlanSnapshot(planDate, source = "generated") {
  return normalizeDietPlanSnapshot({
    planDate,
    period: state.dietCalendar.period,
    profile: state.formData,
    plans: state.plans,
    planDiscussion: state.planDiscussion,
    planConstraints: state.planConstraints,
    metrics: {
      bmr: state.bmr,
      tdee: state.tdee,
      targetCalories: state.targetCalories,
      profileSignature: getProfileSignature(state.formData),
      varietyVersion: DIET_PLAN_VARIETY_VERSION,
      edgeCompute: state.edgeCompute
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dbSaved: false
  }, source);
}

function saveLocalDietPlanSnapshot(snapshot) {
  if (!snapshot?.planDate) return null;
  state.dietCalendar.savedDates[snapshot.planDate] = snapshot;
  if (snapshot.plans?.length) {
    setPlanGenerationStatus(snapshot.planDate, "saved");
  }
  return saveDataRecord(getDietPlanRecordKey(snapshot.planDate), snapshot);
}

function readLocalDietPlanSnapshot(planDate) {
  const record = readDataRecord(getDietPlanRecordKey(planDate));
  return normalizeDietPlanSnapshot(record?.value, "local");
}

async function fetchDietPlanRangeFromDb(startDate, endDate) {
  if (!state.auth.token) return [];
  const query = new URLSearchParams({ startDate, endDate });
  const data = await requestAuth(`/api/v1/diet/plans/saved?${query.toString()}`, { method: "GET" });
  return (data.plans || [])
    .map(item => normalizeDietPlanSnapshot(item, "database"))
    .filter(Boolean);
}

async function fetchDietPlanFromDb(planDate) {
  if (!state.auth.token) return null;
  const data = await requestAuth(`/api/v1/diet/plans/saved/${encodeURIComponent(planDate)}`, { method: "GET" });
  return normalizeDietPlanSnapshot(data.plan, "database");
}

async function persistDietPlanSnapshot(snapshot, options = {}) {
  saveLocalDietPlanSnapshot(snapshot);
  if (!state.auth.token || options.skipBackend) {
    return { snapshot, savedToDb: false };
  }

  try {
    const data = await requestAuth("/api/v1/diet/plans/saved", {
      method: "POST",
      body: JSON.stringify({
        planDate: snapshot.planDate,
        period: snapshot.period,
        profile: snapshot.profile,
        plans: snapshot.plans,
        planDiscussion: snapshot.planDiscussion,
        planConstraints: snapshot.planConstraints,
        metrics: snapshot.metrics
      })
    });
    const saved = normalizeDietPlanSnapshot(data.plan, "database") || snapshot;
    state.dietCalendar.savedDates[saved.planDate] = saved;
    saveLocalDietPlanSnapshot(saved);
    return { snapshot: saved, savedToDb: true };
  } catch (err) {
    if (!options.silent) {
      addSystemLog("data", `饮食计划数据库保存失败：${err.message || "账户服务不可用"}`);
    }
    return { snapshot, savedToDb: false, error: err };
  }
}

function getDietCheckinRecordKey(planDate) {
  const userPart = state.auth.user?.id || "local";
  return `diet.checkin.${userPart}.${normalizeIsoDate(planDate)}`;
}

function getHistoryMenuRecordKey(planDate) {
  const userPart = state.auth.user?.id || "local";
  return `diet.historyMenu.${userPart}.${normalizeIsoDate(planDate)}`;
}

function normalizeDietCheckin(rawCheckin, source = "local") {
  if (!rawCheckin || typeof rawCheckin !== "object") return null;
  const status = ["planned", "completed", "skipped"].includes(rawCheckin.status)
    ? rawCheckin.status
    : "completed";
  const feedback = normalizeCheckinFeedback(rawCheckin.feedback || rawCheckin.menuSnapshot?.feedback || {});
  return {
    planDate: normalizeIsoDate(rawCheckin.planDate || state.dietCalendar.selectedDate || getTodayIsoDate()),
    status,
    selectedPlanIndex: Number.isFinite(Number(rawCheckin.selectedPlanIndex)) ? Number(rawCheckin.selectedPlanIndex) : 0,
    planName: String(rawCheckin.planName || ""),
    menuSnapshot: deepClone(rawCheckin.menuSnapshot || {}),
    note: String(rawCheckin.note || ""),
    feedback,
    checkedAt: rawCheckin.checkedAt || rawCheckin.updatedAt || new Date().toISOString(),
    createdAt: rawCheckin.createdAt || rawCheckin.updatedAt || new Date().toISOString(),
    updatedAt: rawCheckin.updatedAt || new Date().toISOString(),
    source,
    dbSaved: source === "database" || Boolean(rawCheckin.dbSaved)
  };
}

function normalizeHistoryMenu(rawMenu, source = "local") {
  if (!rawMenu || typeof rawMenu !== "object") return null;
  return {
    planDate: normalizeIsoDate(rawMenu.planDate || state.dietCalendar.selectedDate || getTodayIsoDate()),
    period: normalizePlanPeriod(rawMenu.period || state.dietCalendar.period),
    selectedPlanIndex: Number.isFinite(Number(rawMenu.selectedPlanIndex)) ? Number(rawMenu.selectedPlanIndex) : 0,
    planName: String(rawMenu.planName || ""),
    profile: deepClone(rawMenu.profile || {}),
    menuSnapshot: deepClone(rawMenu.menuSnapshot || {}),
    createdAt: rawMenu.createdAt || rawMenu.updatedAt || new Date().toISOString(),
    updatedAt: rawMenu.updatedAt || new Date().toISOString(),
    source,
    dbSaved: source === "database" || Boolean(rawMenu.dbSaved)
  };
}

function saveLocalDietCheckin(checkin) {
  const normalized = normalizeDietCheckin(checkin, checkin?.source || "local");
  if (!normalized?.planDate) return null;
  state.checkins[normalized.planDate] = normalized;
  return saveDataRecord(getDietCheckinRecordKey(normalized.planDate), normalized);
}

function saveLocalHistoryMenu(menu) {
  const normalized = normalizeHistoryMenu(menu, menu?.source || "local");
  if (!normalized?.planDate) return null;
  state.historyMenus[normalized.planDate] = normalized;
  return saveDataRecord(getHistoryMenuRecordKey(normalized.planDate), normalized);
}

function readLocalDietCheckin(planDate) {
  const record = readDataRecord(getDietCheckinRecordKey(planDate));
  return normalizeDietCheckin(record?.value, "local");
}

function readLocalHistoryMenu(planDate) {
  const record = readDataRecord(getHistoryMenuRecordKey(planDate));
  return normalizeHistoryMenu(record?.value, "local");
}

function getDateRangeBetween(startDate, endDate) {
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate || start);
  const dates = [];
  let cursor = start;
  while (cursor <= end && dates.length < 370) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function isCheckinDateAllowed(planDate) {
  return normalizeIsoDate(planDate) <= getTodayIsoDate();
}

function getCheckinStatusLabel(status) {
  const labels = {
    planned: "待打卡",
    completed: "已完成",
    skipped: "已跳过"
  };
  return labels[status] || "未打卡";
}

function normalizeCheckinFeedback(raw = {}) {
  const satiety = ["hungry", "just-right", "too-full"].includes(raw.satiety) ? raw.satiety : "just-right";
  const difficulty = ["easy", "medium", "hard"].includes(raw.difficulty) ? raw.difficulty : "easy";
  return {
    satiety,
    difficulty,
    ateOut: Boolean(raw.ateOut),
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function getCheckinFeedbackLabel(feedback = {}) {
  const satietyLabels = {
    hungry: "偏饿",
    "just-right": "刚好",
    "too-full": "偏撑"
  };
  const difficultyLabels = {
    easy: "容易执行",
    medium: "一般",
    hard: "较难执行"
  };
  const normalized = normalizeCheckinFeedback(feedback);
  return `${satietyLabels[normalized.satiety]} · ${difficultyLabels[normalized.difficulty]}${normalized.ateOut ? " · 外食" : ""}`;
}

function collectCheckinFeedback() {
  return normalizeCheckinFeedback({
    satiety: document.getElementById("checkinSatiety")?.value || "just-right",
    difficulty: document.getElementById("checkinDifficulty")?.value || "easy",
    ateOut: Boolean(document.getElementById("checkinAteOut")?.checked)
  });
}

async function fetchDietCustomerRecordsRange(startDate, endDate, options = {}) {
  const dates = getDateRangeBetween(startDate, endDate);
  dates.forEach(date => {
    const localCheckin = readLocalDietCheckin(date);
    const localMenu = readLocalHistoryMenu(date);
    if (localCheckin) state.checkins[date] = localCheckin;
    if (localMenu) state.historyMenus[date] = localMenu;
  });

  if (!state.auth.token) {
    renderCheckinPanel();
    return { checkins: [], menus: [] };
  }

  const query = new URLSearchParams({ startDate: dates[0], endDate: dates[dates.length - 1] || dates[0] });
  try {
    const [checkinData, menuData] = await Promise.all([
      requestAuth(`/api/v1/diet/checkins?${query.toString()}`, { method: "GET" }),
      requestAuth(`/api/v1/diet/history-menus?${query.toString()}`, { method: "GET" })
    ]);
    const checkins = (checkinData.checkins || []).map(item => normalizeDietCheckin(item, "database")).filter(Boolean);
    const menus = (menuData.menus || []).map(item => normalizeHistoryMenu(item, "database")).filter(Boolean);
    checkins.forEach(saveLocalDietCheckin);
    menus.forEach(saveLocalHistoryMenu);
    renderCheckinPanel();
    return { checkins, menus };
  } catch (err) {
    if (!options.silent) {
      addSystemLog("data", `读取客户打卡与历史菜单失败：${err.message || "账户服务不可用"}`);
    }
    renderCheckinPanel();
    return { checkins: [], menus: [] };
  }
}

function getSelectedMenuSnapshot() {
  const planDate = getVisiblePlanDate();
  const planIndex = getCurrentMenuPlanIndex();
  const plan = state.plans[planIndex] || state.plans[state.activePlanIndex];
  if (!plan) return null;
  const selectedPlanIndex = state.plans.indexOf(plan);
  return {
    planDate,
    period: state.dietCalendar.period,
    selectedPlanIndex: selectedPlanIndex >= 0 ? selectedPlanIndex : 0,
    planName: formatPlanLabelName(plan, selectedPlanIndex >= 0 ? selectedPlanIndex : 0),
    plan: deepClone(plan),
    meals: deepClone(plan.meals || []),
    ingredients: normalizePlanIngredients(plan.ingredients),
    calories: Number(plan.calories) || 0,
    macros: normalizePlanMacros(plan.macros),
    scores: normalizePlanScores(plan.scores),
    profileSignature: getProfileSignature(state.formData),
    savedAt: new Date().toISOString()
  };
}

async function persistHistoryMenuForSelectedDate(options = {}) {
  const menuSnapshot = getSelectedMenuSnapshot();
  const planDate = menuSnapshot?.planDate || getVisiblePlanDate();
  if (!menuSnapshot) {
    if (!options.silent) addSystemLog("data", "当前日期还没有可保存的菜单。");
    renderCheckinPanel();
    return null;
  }
  if (!isCheckinDateAllowed(planDate)) {
    if (!options.silent) addSystemLog("data", "未来日期不能写入客户打卡或历史菜单。");
    renderCheckinPanel();
    return null;
  }

  let menu = normalizeHistoryMenu({
    planDate,
    period: state.dietCalendar.period,
    selectedPlanIndex: menuSnapshot.selectedPlanIndex,
    planName: menuSnapshot.planName,
    profile: state.formData,
    menuSnapshot,
    updatedAt: new Date().toISOString()
  }, "local");
  saveLocalHistoryMenu(menu);

  if (state.auth.token && !options.skipBackend) {
    try {
      const data = await requestAuth("/api/v1/diet/history-menus", {
        method: "POST",
        body: JSON.stringify({
          planDate,
          period: state.dietCalendar.period,
          selectedPlanIndex: menuSnapshot.selectedPlanIndex,
          planName: menuSnapshot.planName,
          profile: state.formData,
          menuSnapshot
        })
      });
      menu = normalizeHistoryMenu(data.menu, "database") || menu;
      saveLocalHistoryMenu(menu);
      if (!options.silent) {
        addSystemLog("data", `${formatPlanDateLabel(planDate)} 历史菜单已写入数据库。`);
      }
    } catch (err) {
      if (!options.silent) {
        addSystemLog("data", `历史菜单数据库保存失败，已保留本地记录：${err.message || "账户服务不可用"}`);
      }
    }
  } else if (!options.silent) {
    addSystemLog("data", `${formatPlanDateLabel(planDate)} 历史菜单已保存到本地，登录后可同步数据库。`);
  }

  renderCheckinPanel();
  return menu;
}

async function persistCheckinForSelectedDate(status = "completed", options = {}) {
  const planDate = getVisiblePlanDate();
  if (!isCheckinDateAllowed(planDate)) {
    addSystemLog("data", "未来日期不能打卡；请选择当天或历史日期。");
    renderCheckinPanel();
    return null;
  }

  const note = document.getElementById("checkinNote")?.value.trim() || "";
  const feedback = collectCheckinFeedback();
  const menu = await persistHistoryMenuForSelectedDate({ silent: true });
  const menuSnapshot = menu?.menuSnapshot || getSelectedMenuSnapshot();
  if (!menuSnapshot) {
    addSystemLog("data", "当前日期没有可打卡的菜单。");
    renderCheckinPanel();
    return null;
  }

  const menuSnapshotWithFeedback = {
    ...menuSnapshot,
    feedback
  };
  let checkin = normalizeDietCheckin({
    planDate,
    status,
    selectedPlanIndex: menuSnapshotWithFeedback.selectedPlanIndex,
    planName: menuSnapshotWithFeedback.planName,
    menuSnapshot: menuSnapshotWithFeedback,
    note,
    feedback,
    checkedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, "local");
  saveLocalDietCheckin(checkin);

  if (state.auth.token && !options.skipBackend) {
    try {
      const data = await requestAuth("/api/v1/diet/checkins", {
        method: "POST",
        body: JSON.stringify({
          planDate,
          status,
          selectedPlanIndex: menuSnapshotWithFeedback.selectedPlanIndex,
          planName: menuSnapshotWithFeedback.planName,
          menuSnapshot: menuSnapshotWithFeedback,
          note,
          checkedAt: checkin.checkedAt
        })
      });
      checkin = normalizeDietCheckin(data.checkin, "database") || checkin;
      saveLocalDietCheckin(checkin);
      addSystemLog("data", `${formatPlanDateLabel(planDate)} 客户打卡已写入数据库：${getCheckinStatusLabel(status)}。`);
    } catch (err) {
      addSystemLog("data", `打卡数据库保存失败，已保留本地记录：${err.message || "账户服务不可用"}`);
    }
  } else {
    addSystemLog("data", `${formatPlanDateLabel(planDate)} 客户打卡已保存到本地：${getCheckinStatusLabel(status)}。`);
  }

  await adjustNextDayPlanFromCheckin(checkin);
  renderCheckinPanel();
  return checkin;
}

function handleSaveCheckin(status) {
  persistCheckinForSelectedDate(status);
}

function handleSaveHistoryMenu() {
  if (!hasCommerceFeature("historyReview")) {
    promptUpgradeForFeature("历史菜单复盘");
    return;
  }
  persistHistoryMenuForSelectedDate();
}

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getCustomerHomePlanIndex() {
  if (state.plans[state.selectedPlanIndex]) return state.selectedPlanIndex;
  if (state.plans[state.activePlanIndex]) return state.activePlanIndex;
  return 0;
}

function getCurrentMenuPlanIndex() {
  if (state.currentStep === 5) return getCustomerHomePlanIndex();
  return state.currentStep >= 3 && state.plans[state.selectedPlanIndex]
    ? state.selectedPlanIndex
    : state.activePlanIndex;
}

function getCustomerHomePlan() {
  const index = getCustomerHomePlanIndex();
  return {
    index,
    plan: state.plans[index] || state.plans[state.activePlanIndex] || null
  };
}

function getLatestBodyMetricSummary() {
  const current = collectBodyMetricFromInput("home", { silent: true }) || collectBodyMetricFromForm();
  const records = readBodyMetricRecords();
  const latest = records[records.length - 1] || null;
  const previous = records.length >= 2 ? records[records.length - 2] : null;
  const trendText = latest && previous
    ? `较上次 ${latest.weight - previous.weight >= 0 ? "+" : ""}${(latest.weight - previous.weight).toFixed(1)}kg`
    : latest
      ? `最近记录 ${latest.weight}kg`
      : "暂无记录";
  return { current, records, latest, previous, trendText };
}

function renderCustomerHome() {
  const view = document.getElementById("customer-home");
  if (!view) return;

  const planDate = getVisiblePlanDate();
  const { plan, index } = getCustomerHomePlan();
  const hasPlan = Boolean(plan);
  const macros = normalizePlanMacros(plan?.macros || {});
  const planName = hasPlan ? formatPlanLabelName(plan, index) : "尚未定制";
  const checkin = state.checkins[planDate] || readLocalDietCheckin(planDate);
  const bodySummary = getLatestBodyMetricSummary();
  if (checkin) state.checkins[planDate] = checkin;

  setTextById("homeStatusText", `${formatPlanDateLabel(planDate)} · ${hasPlan ? "计划已就绪" : "请先定制饮食计划"}`);
  setTextById("homeDateLabel", formatPlanDateLabel(planDate));
  setTextById("homePeriodLabel", `${getPlanPeriodLabel()} · 起始 ${formatPlanDateShort(state.dietCalendar.startDate || planDate)}`);
  setTextById("homePlanName", planName);
  setTextById("homePlanAngle", hasPlan ? (plan.angleLabel || getPlanAngleMeta(index).label) : "等待问卷画像");
  setTextById("homePlanCalories", hasPlan ? `${plan.calories} kcal` : "-- kcal");
  setTextById("homePlanMacros", hasPlan ? `碳水 ${macros.carbs}% · 蛋白 ${macros.protein}% · 脂肪 ${macros.fat}%` : "碳水 -- · 蛋白 -- · 脂肪 --");
  setTextById("homeCheckinSummary", checkin ? getCheckinStatusLabel(checkin.status) : "未打卡");
  setTextById("homeBodySummary", bodySummary.latest ? `${bodySummary.latest.weight}kg · BMI ${bodySummary.latest.bmi}` : "体重暂无记录");

  const customizeBtn = document.getElementById("homeCustomizeCurrentBtn");
  if (customizeBtn) {
    customizeBtn.textContent = hasPlan ? "查看完整方案" : "定制饮食计划";
    customizeBtn.disabled = false;
  }

  const ingredientsBtn = document.getElementById("homeViewIngredientsBtn");
  if (ingredientsBtn) {
    ingredientsBtn.disabled = !hasPlan;
  }

  renderCustomerHomeMeals(plan, index);
  renderCustomerHomeBody();
  renderCustomerHomeCheckin();
}

function renderCustomerHomeMeals(plan, planIndex) {
  const list = document.getElementById("homeMealsList");
  if (!list) return;

  list.innerHTML = "";
  if (!plan) {
    const empty = document.createElement("div");
    empty.className = "home-empty-state";
    empty.textContent = "等待饮食计划生成";
    list.appendChild(empty);
    setTextById("homeMealStatus", "暂无当天计划");
    return;
  }

  setTextById("homeMealStatus", `${formatPlanLabelName(plan, planIndex)} · ${plan.meals?.length || 0} 餐`);
  (plan.meals || []).forEach(meal => {
    const row = document.createElement("article");
    row.className = "home-meal-row";

    const icon = document.createElement("div");
    icon.className = "home-meal-icon";
    icon.textContent = meal.icon || "🍽️";

    const detail = document.createElement("div");
    detail.className = "home-meal-detail";

    const title = document.createElement("strong");
    title.textContent = meal.name || "餐次";
    detail.appendChild(title);

    const dishes = document.createElement("span");
    dishes.textContent = splitMealDishes(meal.food).join("、") || meal.food || "暂无菜品";
    detail.appendChild(dishes);

    const cals = document.createElement("small");
    cals.textContent = meal.cals || "";

    row.appendChild(icon);
    row.appendChild(detail);
    row.appendChild(cals);
    list.appendChild(row);
  });
}

function renderCustomerHomeBody() {
  const summaryGrid = document.getElementById("homeBodySummaryGrid");
  const list = document.getElementById("homeBodyRecordList");
  const status = document.getElementById("homeBodyTrendStatus");
  if (!summaryGrid && !list && !status) return;

  syncBodyMetricInputDefaults();
  const { current, records, latest, trendText } = getLatestBodyMetricSummary();
  if (status) {
    status.textContent = latest
      ? `${formatPlanDateShort(latest.date)} · ${latest.weight}kg`
      : "暂无记录";
  }

  if (summaryGrid) {
    summaryGrid.innerHTML = "";
    const bmi = document.createElement("span");
    bmi.textContent = current ? `当前 BMI：${current.bmi}（${current.status}）` : "当前 BMI：--";
    const trend = document.createElement("span");
    trend.textContent = `趋势：${trendText}`;
    summaryGrid.appendChild(bmi);
    summaryGrid.appendChild(trend);
  }

  if (list) {
    list.innerHTML = "";
    const latestRecords = records.slice(-5).reverse();
    if (!latestRecords.length) {
      const empty = document.createElement("span");
      empty.textContent = "暂无身体数据记录";
      list.appendChild(empty);
    } else {
      latestRecords.forEach(item => {
        const chip = document.createElement("span");
        chip.textContent = `${formatPlanDateShort(item.date)} · ${item.weight}kg · BMI ${item.bmi}`;
        list.appendChild(chip);
      });
    }
  }
}

function renderCustomerHomeCheckin() {
  const card = document.getElementById("homeCheckinStatusCard");
  const noteInput = document.getElementById("homeCheckinNote");
  const completeBtn = document.getElementById("homeCompleteCheckinBtn");
  const skipBtn = document.getElementById("homeSkipCheckinBtn");
  const saveMenuBtn = document.getElementById("homeSaveHistoryMenuBtn");
  const satietyInput = document.getElementById("homeCheckinSatiety");
  const difficultyInput = document.getElementById("homeCheckinDifficulty");
  const ateOutInput = document.getElementById("homeCheckinAteOut");
  if (!card && !noteInput && !completeBtn && !skipBtn && !saveMenuBtn && !satietyInput && !difficultyInput && !ateOutInput) return;

  const planDate = getVisiblePlanDate();
  const { plan, index } = getCustomerHomePlan();
  const checkin = state.checkins[planDate] || readLocalDietCheckin(planDate);
  const historyMenu = state.historyMenus[planDate] || readLocalHistoryMenu(planDate);
  if (checkin) state.checkins[planDate] = checkin;
  if (historyMenu) state.historyMenus[planDate] = historyMenu;

  const allowed = isCheckinDateAllowed(planDate);
  const disabled = !allowed || !plan;
  const planName = plan ? formatPlanLabelName(plan, index) : "等待计划生成";
  setTextById("homeCheckinSummary", checkin ? getCheckinStatusLabel(checkin.status) : "未打卡");

  if (card) {
    card.innerHTML = "";
    [
      ["打卡日期", formatPlanDateLabel(planDate)],
      ["客户菜单", planName],
      ["打卡状态", checkin ? `${getCheckinStatusLabel(checkin.status)} · ${formatDateTime(checkin.checkedAt || checkin.updatedAt)}` : "未打卡"],
      ["历史菜单", historyMenu ? `${historyMenu.dbSaved ? "数据库已保存" : "本地已保存"} · ${formatDateTime(historyMenu.updatedAt)}` : "未保存"],
      ["执行反馈", checkin ? getCheckinFeedbackLabel(checkin.feedback) : "未记录"]
    ].forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "checkin-status-row";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      const valueEl = document.createElement("strong");
      valueEl.textContent = value;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      card.appendChild(row);
    });

    const note = document.createElement("div");
    note.className = "checkin-plan-note";
    note.textContent = allowed
      ? "可保存今日及历史日期的客户打卡与菜单。"
      : "未来日期仅展示计划，不允许写入打卡或历史菜单。";
    card.appendChild(note);
  }

  if (noteInput) {
    if (document.activeElement !== noteInput) {
      noteInput.value = checkin?.note || "";
    }
    noteInput.disabled = disabled;
  }
  if (satietyInput) {
    satietyInput.value = checkin?.feedback?.satiety || "just-right";
    satietyInput.disabled = disabled;
  }
  if (difficultyInput) {
    difficultyInput.value = checkin?.feedback?.difficulty || "easy";
    difficultyInput.disabled = disabled;
  }
  if (ateOutInput) {
    ateOutInput.checked = Boolean(checkin?.feedback?.ateOut);
    ateOutInput.disabled = disabled;
  }
  [completeBtn, skipBtn, saveMenuBtn].forEach(button => {
    if (button) button.disabled = disabled;
  });
}

function syncHomeCheckinInputsToMain() {
  const mappings = [
    ["homeCheckinNote", "checkinNote", "value"],
    ["homeCheckinSatiety", "checkinSatiety", "value"],
    ["homeCheckinDifficulty", "checkinDifficulty", "value"],
    ["homeCheckinAteOut", "checkinAteOut", "checked"]
  ];
  mappings.forEach(([homeId, mainId, prop]) => {
    const source = document.getElementById(homeId);
    const target = document.getElementById(mainId);
    if (source && target) target[prop] = source[prop];
  });
}

async function handleHomeSaveCheckin(status) {
  syncHomeCheckinInputsToMain();
  await persistCheckinForSelectedDate(status);
  renderCustomerHome();
}

async function handleHomeSaveHistoryMenu() {
  if (!hasCommerceFeature("historyReview")) {
    promptUpgradeForFeature("历史菜单复盘");
    return;
  }
  syncHomeCheckinInputsToMain();
  await persistHistoryMenuForSelectedDate();
  renderCustomerHome();
}

function openCurrentPlanForCustomization() {
  if (!state.plans.length) {
    goToStep(1);
    addSystemLog("client", "暂无可定制的当前计划，请先填写问卷生成饮食计划。");
    return;
  }
  state.activePlanIndex = getCustomerHomePlanIndex();
  goToStep(2);
  renderDietPlans();
  addSystemLog("diet", "已进入完整方案页；如需重算，请使用多 Agent 讨论区的重新生成当天按钮。");
}

function openHomeIngredients() {
  if (!state.plans.length) {
    addSystemLog("ingredient", "暂无可用饮食计划，请先完成问卷并生成计划。");
    renderCustomerHome();
    return;
  }
  state.activePlanIndex = getCustomerHomePlanIndex();
  state.selectedPlanIndex = state.activePlanIndex;
  goToStep(4);
  renderIngredients();
}

function getFeedbackAdjustmentRecordKey(planDate) {
  const owner = state.auth.user?.id || "local";
  return `diet.feedbackAdjustment.${owner}.${normalizeIsoDate(planDate)}`;
}

function savePendingFeedbackAdjustment(planDate, adjustment) {
  const normalizedDate = normalizeIsoDate(planDate);
  const value = {
    id: adjustment.id || `feedback-${normalizedDate}-${Date.now().toString(36)}`,
    targetDate: normalizedDate,
    ...adjustment,
    updatedAt: new Date().toISOString()
  };
  saveDataRecord(getFeedbackAdjustmentRecordKey(normalizedDate), value);
  return value;
}

function readPendingFeedbackAdjustment(planDate) {
  const record = readDataRecord(getFeedbackAdjustmentRecordKey(planDate));
  return record?.value && typeof record.value === "object" ? record.value : null;
}

function getFeedbackAdjustmentSummary(feedback, status) {
  const notes = [];
  if (status === "skipped") notes.push("上一日跳过打卡，次日降低备餐复杂度");
  if (feedback.satiety === "hungry") notes.push("上一日偏饿，次日增加高纤维与蛋白加餐");
  if (feedback.satiety === "too-full") notes.push("上一日偏撑，次日晚餐改为轻负担组合");
  if (feedback.difficulty === "hard") notes.push("执行难度较高，次日改为更快手的餐单");
  if (feedback.ateOut) notes.push("上一日外食较多，次日降低油盐并提高蔬菜占比");
  return notes.join("；") || "上一日反馈良好，次日保持原计划";
}

function buildFeedbackAdjustment(checkin) {
  const feedback = normalizeCheckinFeedback(checkin?.feedback || {});
  return {
    id: `feedback-${checkin.planDate}-${Date.now().toString(36)}`,
    sourceDate: checkin.planDate,
    status: checkin.status,
    feedback,
    summary: getFeedbackAdjustmentSummary(feedback, checkin.status),
    createdAt: new Date().toISOString()
  };
}

function adjustMealByFeedback(meal, planIndex, mealIndex, adjustment) {
  const feedback = normalizeCheckinFeedback(adjustment.feedback);
  let food = meal.food;
  let changed = false;
  const profile = state.formData;
  const isVegan = profile.dietHabit === "vegan";
  const avoidGluten = profile.allergies?.includes("gluten");
  const simpleProtein = isVegan ? "香煎豆腐" : "去皮鸡胸肉";
  const simpleGrain = avoidGluten ? "玉米段" : "杂粮饭";

  if (meal.name.includes("早餐") && (feedback.difficulty === "hard" || adjustment.status === "skipped")) {
    food = isVegan
      ? `无糖豆浆1杯 + 豆腐蔬菜卷 + 小番茄`
      : `无糖豆浆1杯 + 水煮蛋1个 + ${avoidGluten ? "蒸紫薯" : "燕麦杯"}`;
    changed = true;
  }

  if (meal.name.includes("午餐") && (feedback.ateOut || feedback.difficulty === "hard")) {
    food = `${simpleProtein}时蔬便当 + ${simpleGrain}`;
    changed = true;
  }

  if (meal.name.includes("晚餐") && (feedback.satiety === "too-full" || feedback.ateOut)) {
    food = isVegan
      ? "番茄菌菇豆腐汤 + 清炒油麦菜"
      : "番茄豆腐鸡丝汤 + 白灼绿叶菜";
    changed = true;
  }

  if (meal.name.includes("加餐") && feedback.satiety === "hungry") {
    food = isVegan
      ? "无糖豆浆半杯 + 毛豆仁80g"
      : "希腊酸奶半杯 + 鸡蛋白1个";
    changed = true;
  }

  if (!changed && feedback.satiety === "hungry" && meal.name.includes("午餐")) {
    food = appendDateSideDish(food, "凉拌黄瓜150g");
    changed = true;
  }

  if (!changed) return meal;
  return {
    ...meal,
    food,
    adjustedByCheckin: true,
    feedbackSourceDate: adjustment.sourceDate,
    id: meal.id || createMealId(planIndex, meal.name, mealIndex)
  };
}

function applyFeedbackAdjustmentToSnapshot(snapshot, adjustment) {
  const normalized = normalizeDietPlanSnapshot(snapshot, snapshot?.source || "local");
  if (!normalized?.plans?.length || !adjustment) return normalized;
  if (normalized.metrics?.feedbackAdjustmentId === adjustment.id) return normalized;

  const feedback = normalizeCheckinFeedback(adjustment.feedback);
  const calorieDelta = feedback.satiety === "hungry" ? 80 : feedback.satiety === "too-full" || feedback.ateOut ? -70 : 0;
  const adjustedPlans = normalized.plans.map((plan, planIndex) => {
    const meals = (plan.meals || []).map((meal, mealIndex) => adjustMealByFeedback(meal, planIndex, mealIndex, adjustment));
    const macros = normalizePlanMacros(plan.macros);
    const adjustedMacros = feedback.satiety === "hungry"
      ? normalizeMacroParts(macros.carbs + 1, macros.protein + 2, macros.fat - 3, macros)
      : feedback.satiety === "too-full" || feedback.ateOut
        ? normalizeMacroParts(macros.carbs - 2, macros.protein + 1, macros.fat + 1, macros)
        : macros;
    const adjustedPlan = {
      ...plan,
      calories: Math.max(1100, Math.round((Number(plan.calories) || state.targetCalories || 1500) + calorieDelta)),
      macros: adjustedMacros,
      meals,
      feedbackAdjusted: true,
      agentNotes: `${plan.agentNotes || "已生成方案"}；${adjustment.summary}`
    };
    adjustedPlan.ingredients = buildIngredientsFromMeals(adjustedPlan, normalized.profile || state.formData);
    adjustedPlan.agentScore = calculatePlanAgentScore(adjustedPlan, planIndex);
    return adjustedPlan;
  });

  return {
    ...normalized,
    plans: adjustedPlans,
    metrics: {
      ...(normalized.metrics || {}),
      feedbackAdjustmentId: adjustment.id,
      feedbackAdjustment: {
        sourceDate: adjustment.sourceDate,
        summary: adjustment.summary,
        feedback
      }
    },
    updatedAt: new Date().toISOString()
  };
}

async function persistAdjustedSnapshot(snapshot, options = {}) {
  if (!snapshot?.planDate) return null;
  const result = await persistDietPlanSnapshot(snapshot, { silent: true, skipBackend: options.skipBackend });
  state.dietCalendar.savedDates[result.snapshot.planDate] = result.snapshot;
  saveLocalDietPlanSnapshot(result.snapshot);
  return result.snapshot;
}

function applyPendingFeedbackAdjustmentToSnapshot(snapshot) {
  if (!snapshot?.planDate) return snapshot;
  const adjustment = readPendingFeedbackAdjustment(snapshot.planDate);
  if (!adjustment) return snapshot;
  return applyFeedbackAdjustmentToSnapshot(snapshot, adjustment);
}

async function adjustNextDayPlanFromCheckin(checkin) {
  if (!checkin?.planDate) return null;
  const feedback = normalizeCheckinFeedback(checkin.feedback);
  const shouldAdjust = checkin.status === "skipped"
    || feedback.satiety !== "just-right"
    || feedback.difficulty === "hard"
    || feedback.ateOut;
  if (!shouldAdjust) return null;

  const nextDate = addDays(checkin.planDate, 1);
  const adjustment = savePendingFeedbackAdjustment(nextDate, buildFeedbackAdjustment(checkin));
  let snapshot = state.dietCalendar.savedDates[nextDate] || readLocalDietPlanSnapshot(nextDate);
  if (!snapshot?.plans?.length && state.auth.token) {
    try {
      snapshot = await fetchDietPlanFromDb(nextDate);
    } catch (err) {
      snapshot = null;
    }
  }

  if (snapshot?.plans?.length) {
    const adjusted = applyFeedbackAdjustmentToSnapshot(snapshot, adjustment);
    await persistAdjustedSnapshot(adjusted);
    if (getVisiblePlanDate() === nextDate) {
      applyDietPlanSnapshot(adjusted);
      renderVisibleDietPlanIfNeeded();
    }
    addSystemLog("diet", `${formatPlanDateLabel(nextDate)} 已根据打卡反馈自动调整：${adjustment.summary}。`);
    return adjusted;
  }

  addSystemLog("diet", `${formatPlanDateLabel(nextDate)} 尚未生成，已记录次日自动调整规则：${adjustment.summary}。`);
  return null;
}

function applyDietPlanSnapshot(snapshot, options = {}) {
  const normalized = normalizeDietPlanSnapshot(snapshot, snapshot?.source || "local");
  if (!normalized) return false;

  state.dietCalendar.selectedDate = normalized.planDate;
  state.dietCalendar.visibleDate = normalized.planDate;
  if (options.applyPeriod) {
    state.dietCalendar.period = normalizePlanPeriod(normalized.period);
  }
  state.dietCalendar.savedDates[normalized.planDate] = normalized;
  if (normalized.plans?.length) {
    setPlanGenerationStatus(normalized.planDate, "saved");
  }
  state.dietCalendar.lastSource = normalized.source;
  state.plans = deepClone(normalized.plans || []);
  state.planDiscussion = normalizePlanDiscussion(normalized.planDiscussion);
  state.planConstraints = normalizePlanConstraints(normalized.planConstraints);

  if (normalized.metrics) {
    state.bmr = normalized.metrics.bmr ?? state.bmr;
    state.tdee = normalized.metrics.tdee ?? state.tdee;
    state.targetCalories = normalized.metrics.targetCalories ?? state.targetCalories;
    if (normalized.metrics.edgeCompute) {
      state.edgeCompute = deepClone(normalized.metrics.edgeCompute);
    }
  }

  state.activePlanIndex = Math.min(state.activePlanIndex, Math.max(0, state.plans.length - 1));
  state.selectedPlanIndex = Math.min(state.selectedPlanIndex, Math.max(0, state.plans.length - 1));
  saveDataRecord("diet.plans.current", state.plans);
  saveDataRecord("diet.planConstraints.current", state.planConstraints);
  saveDataRecord("diet.planDiscussion.current", state.planDiscussion);
  renderEdgeComputeStatus();
  return true;
}

function generateDietPlanSnapshotForDate(planDate, options = {}) {
  state.dietCalendar.selectedDate = normalizeIsoDate(planDate);
  state.planConstraints = normalizePlanConstraints(options.planConstraints || state.planConstraints);
  const dateContext = options.dateContext || buildPlanDateContext(state.dietCalendar.selectedDate, options);
  calculateAndGenerateDietData({
    reason: options.reason || "initial",
    planDate: state.dietCalendar.selectedDate,
    dateContext
  });
  return createDietPlanSnapshot(state.dietCalendar.selectedDate, "generated");
}

function summarizeDietPlanForVariety(snapshot) {
  if (!snapshot?.plans?.length) return null;
  return {
    planDate: snapshot.planDate,
    plans: snapshot.plans.slice(0, 3).map(plan => ({
      name: plan.name,
      meals: (plan.meals || []).map(meal => meal.food).filter(Boolean)
    }))
  };
}

function buildPlanDateContext(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  const rangeDates = Array.isArray(options.rangeDates) && options.rangeDates.length
    ? options.rangeDates
    : getPlanDateRange();
  const dayIndex = Math.max(0, rangeDates.indexOf(normalizedDate));
  const focusList = [
    "高蛋白低油",
    "高纤慢糖",
    "清爽补水",
    "豆制品与菌菇",
    "杂粮主食轮换",
    "轻食沙拉与温热汤",
    "家常低负担"
  ];
  const previousPlanSummaries = rangeDates
    .slice(Math.max(0, dayIndex - 3), dayIndex)
    .map(date => state.dietCalendar.savedDates[date])
    .map(summarizeDietPlanForVariety)
    .filter(Boolean);

  return {
    planDate: normalizedDate,
    weekday: getPlanWeekday(normalizedDate),
    dayIndex: dayIndex + 1,
    totalDays: rangeDates.length || 1,
    varietyFocus: focusList[(dayIndex + Number(state.planConstraints?.revision || 0)) % focusList.length],
    previousPlanSummaries
  };
}

async function generateDietPlanSnapshotForDateAsync(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  state.dietCalendar.selectedDate = normalizedDate;
  state.planConstraints = normalizePlanConstraints(options.planConstraints || state.planConstraints);
  const dateContext = buildPlanDateContext(normalizedDate, options);

  if (!state.backend.enabled) {
    return generateDietPlanSnapshotForDate(normalizedDate, { ...options, dateContext });
  }

  try {
    const response = await apiSwitch.request("/api/v1/diet/plans", {
      profile: state.formData,
      edgeCompute: state.edgeCompute,
      agentContext: state.formData.extraProfile,
      planConstraints: state.planConstraints,
      planDate: normalizedDate,
      planPeriod: state.dietCalendar.period,
      dateContext,
      regenerate: options.reason === "regenerate"
    }, {
      source: "customer-manager",
      target: "diet-planner",
      latency: 110
    });

    if (!response.ok || !Array.isArray(response.data?.plans) || response.data.plans.length < 3) {
      throw new Error(response.error || "后端未返回完整的多方案结果");
    }

    const snapshot = createDietPlanSnapshotFromAgentResponse(response.data, normalizedDate, { ...options, dateContext });
    const modeText = response.data.mode === "real"
      ? `大模型 ${response.data.providerName || response.data.providerId || ""}`.trim()
      : response.data.mode === "fallback"
        ? "大模型失败后的 fallback"
        : "mock 多 Agent";
    addSystemLog("diet", `${formatPlanDateLabel(normalizedDate)} 已由${modeText}生成 3 套候选方案。`);
    if (response.data.mode === "fallback" && response.data.note) {
      addSystemLog("diet", `方案生成 fallback 原因：${response.data.note}`);
    }
    return snapshot;
  } catch (err) {
    addSystemLog("diet", `大模型多 Agent 方案生成不可用，已切换前端本地 fallback：${err.message || "未知错误"}`);
    return generateDietPlanSnapshotForDate(normalizedDate, { ...options, dateContext });
  }
}

function createDietPlanSnapshotFromAgentResponse(data, planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  const localMetrics = computeMetabolicTargets(state.formData);

  state.bmr = Number(data.bmr) || localMetrics.bmr;
  state.tdee = Number(data.tdee) || localMetrics.tdee;
  state.targetCalories = Number(data.targetCalories) || localMetrics.targetCalories;
  state.edgeCompute = {
    ...state.edgeCompute,
    location: data.mode === "real" ? "大模型多 Agent 生成" : data.mode === "fallback" ? "大模型 fallback" : "Mock 多 Agent",
    bmr: `${state.bmr} kcal`,
    tdee: `${state.tdee} kcal`,
    runtimeMs: data.latencyMs || state.edgeCompute.runtimeMs || 0,
    cacheState: data.mode || "mock"
  };
  renderEdgeComputeStatus();

  state.plans = ensurePlanNamesUseAngles(
    data.plans.slice(0, 3).map((plan, planIndex) => normalizeAgentGeneratedPlan(plan, planIndex))
  );
  state.plans = calibratePlanScoresByAngle(state.plans);
  if (data.mode === "real") {
    ensureCrossDateMenuDiversity(normalizedDate, { ...options, dateContext: options.dateContext || buildPlanDateContext(normalizedDate, options) });
  } else {
    applyPlanDateVariation(normalizedDate, { resetIngredients: true });
  }
  applyPlanConstraintsToGeneratedPlans();
  state.plans = state.plans.map((plan, planIndex) => ({
    ...plan,
    agentScore: Number(plan.agentScore) || calculatePlanAgentScore(plan, planIndex),
    agentNotes: plan.agentNotes || buildPlanAgentNotes(plan),
    ingredients: hasUsableIngredients(plan.ingredients) ? plan.ingredients : buildIngredientsFromMeals(plan, state.formData)
  }));

  const discussion = normalizePlanDiscussion(data.planDiscussion);
  state.planDiscussion = discussion.agents.length
    ? discussion
    : buildPlanGenerationDiscussion({ ...options, reason: options.reason || "llm" });
  saveDataRecord("diet.planDiscussion.current", state.planDiscussion);

  return createDietPlanSnapshot(normalizedDate, data.mode === "real" ? "llm" : data.mode || "generated");
}

function computeMetabolicTargets(profile) {
  const f = profile || {};
  const genderOffset = f.gender === "male" ? 5 : -161;
  const bmr = Math.round(10 * Number(f.weight || 56) + 6.25 * Number(f.height || 165) - 5 * Number(f.age || 28) + genderOffset);
  const activityMultiplier = f.activity === "heavy" ? 1.725 : f.activity === "moderate" ? 1.55 : f.activity === "light" ? 1.375 : 1.2;
  const tdee = Math.round(bmr * activityMultiplier);
  const targetCalories = f.goal === "gain-muscle"
    ? tdee + 400
    : f.goal === "low-gi"
      ? Math.max(1300, tdee - 200)
      : f.goal === "lose-fat"
        ? Math.max(1200, tdee - 450)
        : tdee;
  return { bmr, tdee, targetCalories };
}

function normalizeAgentGeneratedPlan(plan, planIndex) {
  const fallbackMeals = [
    { name: "早餐", icon: "🌅", food: "均衡早餐", cals: "350 kcal" },
    { name: "午餐", icon: "☀️", food: "高蛋白午餐", cals: "550 kcal" },
    { name: "晚餐", icon: "🌙", food: "清淡晚餐", cals: "420 kcal" },
    { name: "加餐", icon: "🍎", food: "低糖加餐", cals: "150 kcal" }
  ];
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const normalizedMeals = fallbackMeals.map((fallback, mealIndex) => {
    const meal = meals[mealIndex] && typeof meals[mealIndex] === "object" ? meals[mealIndex] : {};
    return {
      name: meal.name || fallback.name,
      icon: meal.icon || fallback.icon,
      food: meal.food || fallback.food,
      cals: meal.cals || fallback.cals,
      id: meal.id || createMealId(planIndex, meal.name || fallback.name, mealIndex),
      deleted: false,
      replacedByAgent: false
    };
  });

  return {
    name: cleanPlanName(plan.name) || getDefaultPlanNameForAngle(planIndex),
    sub: plan.sub || "多 Agent 生成",
    calories: Number(plan.calories) || state.targetCalories || 1500,
    macros: normalizePlanMacros(plan.macros),
    meals: normalizedMeals,
    ingredients: normalizePlanIngredients(plan.ingredients),
    scores: normalizePlanScores(plan.scores),
    agentScore: normalizeScoreValue(plan.agentScore, 82),
    agentNotes: plan.agentNotes || ""
  };
}

function parseNumberLike(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return NaN;
}

function normalizeScoreValue(value, fallback = 80) {
  const fallbackScore = Number.isFinite(Number(fallback)) ? Number(fallback) : 80;
  const numeric = parseNumberLike(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return clampScore(fallbackScore);
  if (numeric <= 1) return clampScore(numeric * 100);
  if (numeric <= 10) return clampScore(numeric * 10);
  return clampScore(numeric);
}

function normalizeMacroParts(carbs, protein, fat, fallback = { carbs: 40, protein: 32, fat: 28 }) {
  const values = [carbs, protein, fat].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) {
    return { ...fallback };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  let macroCalories = total;
  if (total > 110) {
    macroCalories = (values[0] * 4) + (values[1] * 4) + (values[2] * 9);
    if (!Number.isFinite(macroCalories) || macroCalories <= 0) return { ...fallback };
    values[0] = (values[0] * 4 / macroCalories) * 100;
    values[1] = (values[1] * 4 / macroCalories) * 100;
    values[2] = (values[2] * 9 / macroCalories) * 100;
  } else if (Math.abs(total - 100) > 3) {
    values[0] = (values[0] / total) * 100;
    values[1] = (values[1] / total) * 100;
    values[2] = (values[2] / total) * 100;
  }

  const roundedCarbs = clampScore(values[0]);
  const roundedProtein = clampScore(values[1]);
  const roundedFat = Math.max(0, Math.min(100, 100 - roundedCarbs - roundedProtein));
  return {
    carbs: roundedCarbs,
    protein: roundedProtein,
    fat: roundedFat
  };
}

function normalizePlanMacros(macros) {
  const source = macros && typeof macros === "object" ? macros : {};
  return normalizeMacroParts(
    parseNumberLike(source.carbs),
    parseNumberLike(source.protein),
    parseNumberLike(source.fat)
  );
}

function normalizePlanScores(scores) {
  const source = scores && typeof scores === "object" ? scores : {};
  return {
    cost: normalizeScoreValue(source.cost, 80),
    season: normalizeScoreValue(source.season, 80),
    region: normalizeScoreValue(source.region, 80)
  };
}

function shiftScoreByModel(anchor, modelValue) {
  const delta = Math.max(-3, Math.min(3, Math.round((normalizeScoreValue(modelValue, anchor) - 80) / 6)));
  return clampScore(anchor + delta);
}

function getPlanAngleScoreProfile(index) {
  return PLAN_ANGLE_SCORE_PROFILES[index] || { cost: 84, season: 84, region: 84 };
}

function calibratePlanScoresByAngle(plans) {
  const calibrated = plans.map((plan, index) => {
    if (plan.scoreProfileVersion === DIET_PLAN_VARIETY_VERSION) {
      return {
        ...plan,
        scores: normalizePlanScores(plan.scores)
      };
    }
    const anchor = getPlanAngleScoreProfile(index);
    const modelScores = normalizePlanScores(plan.scores);
    return {
      ...plan,
      scoreProfileVersion: DIET_PLAN_VARIETY_VERSION,
      scores: {
        cost: shiftScoreByModel(anchor.cost, modelScores.cost),
        season: shiftScoreByModel(anchor.season, modelScores.season),
        region: shiftScoreByModel(anchor.region, modelScores.region)
      }
    };
  });

  if (calibrated.length >= 3) {
    calibrated[1].scores.cost = Math.max(calibrated[1].scores.cost, calibrated[0].scores.cost + 4, calibrated[2].scores.cost + 4);
    calibrated[2].scores.season = Math.max(calibrated[2].scores.season, calibrated[0].scores.season + 4, calibrated[1].scores.season + 4);
    calibrated[0].scores.region = Math.max(calibrated[0].scores.region, calibrated[1].scores.region + 4, calibrated[2].scores.region + 4);
    calibrated.forEach(plan => {
      plan.scores = normalizePlanScores(plan.scores);
    });
  }

  return calibrated;
}

function getPlanDisplayLabel(index) {
  return PLAN_DISPLAY_LABELS[index] || `方案 ${index + 1}`;
}

function getPlanAngleMeta(index) {
  return PLAN_ANGLE_META[index] || {
    label: "综合平衡角度",
    role: "综合协调 Agent",
    defaultName: `综合平衡餐 ${index + 1}`
  };
}

function cleanPlanName(value) {
  return String(value || "")
    .replace(/^方案\s*[ABCＡＢＣ]\s*[:：\-｜|]?\s*/i, "")
    .replace(/\s*方案\s*[ABCＡＢＣ]\s*$/i, "")
    .replace(/\s*[ABCＡＢＣ]\s*方案\s*$/i, "")
    .replace(/(?<=[\u4e00-\u9fa5])\s*[ABCＡＢＣ]\s*$/i, "")
    .trim();
}

function inferPlanNameBase(value) {
  return cleanPlanName(value)
    .replace(/餐$/g, "")
    .replace(/食谱$/g, "")
    .replace(/膳食$/g, "")
    .replace(/轻食$/g, "")
    .trim();
}

function getDefaultPlanNameForAngle(index, profile = state.formData) {
  const goal = profile?.goal || "lose-fat";
  const habit = profile?.dietHabit || "balanced";
  if (habit === "vegan") {
    return ["植物蛋白轻盈餐", "高纤谷豆饱腹餐", "纯素优脂时令餐"][index] || getPlanAngleMeta(index).defaultName;
  }
  if (goal === "gain-muscle") {
    return ["高蛋白训练修复餐", "复合碳水恢复餐", "优脂增肌能量餐"][index] || getPlanAngleMeta(index).defaultName;
  }
  if (goal === "low-gi" || habit === "low-carb") {
    return ["低 GI 稳糖低碳餐", "高纤慢糖平衡餐", "优脂轻食稳糖餐"][index] || getPlanAngleMeta(index).defaultName;
  }
  if (habit === "mediterranean") {
    return ["控脂高蛋白地中海餐", "全谷高纤地中海餐", "经典优脂地中海餐"][index] || getPlanAngleMeta(index).defaultName;
  }
  return ["高蛋白稳态减脂餐", "高纤慢糖饱腹餐", "优脂时令轻食餐"][index] || getPlanAngleMeta(index).defaultName;
}

function ensurePlanNamesUseAngles(plans, profile = state.formData) {
  const cleaned = plans.map((plan, index) => ({
    ...plan,
    name: cleanPlanName(plan.name) || getDefaultPlanNameForAngle(index, profile)
  }));
  const baseCounts = cleaned.reduce((acc, plan) => {
    const base = inferPlanNameBase(plan.name);
    acc[base] = (acc[base] || 0) + 1;
    return acc;
  }, {});
  const exactCounts = cleaned.reduce((acc, plan) => {
    const key = normalizeDishText(plan.name);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return cleaned.map((plan, index) => {
    const base = inferPlanNameBase(plan.name);
    const exact = normalizeDishText(plan.name);
    const shouldUseAngleName = !plan.name
      || baseCounts[base] > 1
      || exactCounts[exact] > 1
      || /^方案\s*[ABCＡＢＣ]/i.test(String(plan.name || ""))
      || /方案\s*[ABCＡＢＣ]$/i.test(String(plan.name || ""));
    const meta = getPlanAngleMeta(index);
    return {
      ...plan,
      name: shouldUseAngleName ? getDefaultPlanNameForAngle(index, profile) : plan.name,
      angleLabel: meta.label,
      angleRole: meta.role
    };
  });
}

function formatPlanLabelName(plan, index) {
  return `${getPlanDisplayLabel(index)}｜${plan?.name || getDefaultPlanNameForAngle(index)}`;
}

function normalizePlanIngredients(ingredients) {
  const source = ingredients && typeof ingredients === "object" ? ingredients : {};
  return ["meat", "veggies", "grains", "seasonings"].reduce((acc, key) => {
    const items = Array.isArray(source[key]) ? source[key] : [];
    acc[key] = items
      .filter(item => item && typeof item === "object")
      .map(item => ({ name: String(item.name || "食材"), qty: String(item.qty || "适量") }));
    return acc;
  }, {});
}

function hasUsableIngredients(ingredients) {
  return ingredients
    && typeof ingredients === "object"
    && Object.values(ingredients).some(items => Array.isArray(items) && items.length > 0);
}

async function resolveStoredDietPlanSnapshot(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  if (options.forceRegenerate) return null;

  let snapshot = state.dietCalendar.savedDates[normalizedDate] || readLocalDietPlanSnapshot(normalizedDate);
  snapshot = getUsableDietPlanSnapshot(snapshot, normalizedDate, options.sourceLabel ?? "本地/数据库中");
  if (snapshot?.plans?.length) {
    snapshot = applyPendingFeedbackAdjustmentToSnapshot(snapshot);
    state.dietCalendar.savedDates[normalizedDate] = snapshot;
    saveLocalDietPlanSnapshot(snapshot);
    return snapshot;
  }

  if (!state.auth.token || options.skipDb) return null;

  try {
    snapshot = getUsableDietPlanSnapshot(await fetchDietPlanFromDb(normalizedDate), normalizedDate, "数据库中");
    if (snapshot?.plans?.length) {
      snapshot = applyPendingFeedbackAdjustmentToSnapshot(snapshot);
      state.dietCalendar.savedDates[normalizedDate] = snapshot;
      saveLocalDietPlanSnapshot(snapshot);
      if (!options.silent) {
        addSystemLog("data", `已读取 ${formatPlanDateLabel(normalizedDate)} 的数据库饮食计划。`);
      }
      return snapshot;
    }
  } catch (err) {
    if (!options.silent) {
      addSystemLog("data", `读取 ${formatPlanDateLabel(normalizedDate)} 数据库计划失败，改用本地流程：${err.message || "账户服务不可用"}`);
    }
  }

  return null;
}

function clearCurrentPlanForPendingDate(planDate) {
  const normalizedDate = setVisiblePlanDate(planDate);
  state.plans = [];
  state.activePlanIndex = 0;
  state.selectedPlanIndex = 0;
  state.planDiscussion = createEmptyPlanDiscussion();
  state.planConstraints = createEmptyPlanConstraints();
  saveDataRecord("diet.plans.current", state.plans);
  return normalizedDate;
}

function restoreVisibleDietPlanSnapshot(planDate, activeIndex = state.activePlanIndex, selectedIndex = state.selectedPlanIndex) {
  const normalizedDate = normalizeIsoDate(planDate);
  const snapshot = state.dietCalendar.savedDates[normalizedDate] || getUsableDietPlanSnapshot(readLocalDietPlanSnapshot(normalizedDate), normalizedDate, "");
  if (snapshot?.plans?.length) {
    applyDietPlanSnapshot(snapshot);
    state.activePlanIndex = Math.min(activeIndex, Math.max(0, state.plans.length - 1));
    state.selectedPlanIndex = Math.min(selectedIndex, Math.max(0, state.plans.length - 1));
    return true;
  }
  clearCurrentPlanForPendingDate(normalizedDate);
  return false;
}

function renderVisibleDietPlanIfNeeded() {
  if (state.currentStep === 2) {
    renderDietPlans();
  } else if (state.currentStep === 3 && state.plans.length) {
    evaluatePlansRealtime();
  } else if (state.currentStep === 4) {
    renderIngredients();
  } else if (state.currentStep === 5) {
    renderCustomerHome();
  }
}

async function generateAndPersistDietPlanForDate(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  const visibleBefore = getVisiblePlanDate();
  const activeBefore = state.activePlanIndex;
  const selectedBefore = state.selectedPlanIndex;
  setPlanGenerationStatus(normalizedDate, "generating");
  renderPlanCalendarControls();

  try {
    let snapshot = await generateDietPlanSnapshotForDateAsync(normalizedDate, {
      reason: options.reason || "initial",
      planConstraints: options.planConstraints || createEmptyPlanConstraints(),
      rangeDates: options.rangeDates || getPlanDateRange()
    });
    const result = await persistDietPlanSnapshot(snapshot, {
      skipBackend: Boolean(options.skipBackend),
      silent: Boolean(options.silent)
    });
    snapshot = result.snapshot;
    const adjustedSnapshot = applyPendingFeedbackAdjustmentToSnapshot(snapshot);
    if (adjustedSnapshot?.metrics?.feedbackAdjustmentId && adjustedSnapshot.metrics.feedbackAdjustmentId !== snapshot.metrics?.feedbackAdjustmentId) {
      snapshot = await persistAdjustedSnapshot(adjustedSnapshot, { skipBackend: Boolean(options.skipBackend) }) || adjustedSnapshot;
    }
    setPlanGenerationStatus(normalizedDate, "saved");

    const desiredVisibleDate = getVisiblePlanDate() || visibleBefore;
    if (!options.preserveVisible || desiredVisibleDate === normalizedDate) {
      applyDietPlanSnapshot(snapshot);
    } else {
      restoreVisibleDietPlanSnapshot(desiredVisibleDate, activeBefore, selectedBefore);
    }

    renderPlanCalendarControls();
    renderVisibleDietPlanIfNeeded();
    return { ...result, snapshot };
  } catch (err) {
    setPlanGenerationStatus(normalizedDate, "failed", err.message || "生成失败");
    if (getVisiblePlanDate() === normalizedDate) {
      clearCurrentPlanForPendingDate(normalizedDate);
      renderVisibleDietPlanIfNeeded();
    } else if (options.preserveVisible) {
      restoreVisibleDietPlanSnapshot(visibleBefore, activeBefore, selectedBefore);
    }
    renderPlanCalendarControls();
    throw err;
  }
}

function enqueueBackgroundDietPlanDates(dates, options = {}) {
  const queue = Array.isArray(state.dietCalendar.backgroundQueue)
    ? state.dietCalendar.backgroundQueue
    : [];
  const queuedDates = new Set(queue.map(item => item.planDate));

  dates.map(normalizeIsoDate).forEach(planDate => {
    const snapshot = state.dietCalendar.savedDates[planDate];
    if (snapshot?.plans?.length) {
      setPlanGenerationStatus(planDate, "saved");
      return;
    }
    if (getPlanGenerationStatus(planDate) === "generating") return;
    setPlanGenerationStatus(planDate, "queued");
    if (!queuedDates.has(planDate)) {
      queue.push({
        planDate,
        reason: options.reason || "background",
        rangeDates: options.rangeDates || getPlanDateRange(),
        skipBackend: Boolean(options.skipBackend)
      });
      queuedDates.add(planDate);
    }
  });

  state.dietCalendar.backgroundQueue = queue;
  renderPlanCalendarControls();
  runDietPlanBackgroundQueue();
}

async function runDietPlanBackgroundQueue() {
  if (state.dietCalendar.backgroundQueueRunning) return;
  state.dietCalendar.backgroundQueueRunning = true;
  let backendAvailable = Boolean(state.auth.token);

  try {
    while (Array.isArray(state.dietCalendar.backgroundQueue) && state.dietCalendar.backgroundQueue.length > 0) {
      const item = state.dietCalendar.backgroundQueue.shift();
      const planDate = normalizeIsoDate(item.planDate);
      if (state.dietCalendar.savedDates[planDate]?.plans?.length) {
        setPlanGenerationStatus(planDate, "saved");
        continue;
      }

      const stored = await resolveStoredDietPlanSnapshot(planDate, {
        skipDb: item.skipBackend,
        silent: true,
        sourceLabel: ""
      });
      if (stored?.plans?.length) {
        setPlanGenerationStatus(planDate, "saved");
        if (getVisiblePlanDate() === planDate) {
          applyDietPlanSnapshot(stored);
          renderVisibleDietPlanIfNeeded();
        }
        continue;
      }

      try {
        const result = await generateAndPersistDietPlanForDate(planDate, {
          reason: item.reason,
          planConstraints: createEmptyPlanConstraints(),
          rangeDates: item.rangeDates,
          skipBackend: item.skipBackend || !backendAvailable,
          silent: true,
          preserveVisible: true
        });
        if (!result.savedToDb && result.error) {
          backendAvailable = false;
        }
      } catch (err) {
        addSystemLog("diet", `${formatPlanDateLabel(planDate)} 后台生成失败：${err.message || "未知错误"}`);
      }
    }
  } finally {
    state.dietCalendar.backgroundQueueRunning = false;
    renderPlanCalendarControls();
  }
}

async function prepareDietPlansForCurrentRange(options = {}) {
  syncPlanCalendarFromInputs();
  const dates = getPlanDateRange();
  if (!dates.length) return null;

  const requestedDate = normalizeIsoDate(state.dietCalendar.selectedDate || state.dietCalendar.visibleDate || dates[0]);
  const requestedSelectedDate = dates.includes(requestedDate) ? requestedDate : dates[0];
  setVisiblePlanDate(requestedSelectedDate);
  state.dietCalendar.loading = true;
  renderPlanCalendarControls();

  const selectedConstraints = normalizePlanConstraints(state.planConstraints);
  let backendAvailable = Boolean(state.auth.token);
  if (backendAvailable) {
    try {
      const savedPlans = await fetchDietPlanRangeFromDb(dates[0], dates[dates.length - 1]);
      const matchingSavedPlans = savedPlans.filter(snapshot => isDietPlanSnapshotProfileMatch(snapshot));
      const skippedCount = savedPlans.length - matchingSavedPlans.length;
      matchingSavedPlans.forEach(snapshot => {
        state.dietCalendar.savedDates[snapshot.planDate] = snapshot;
        saveLocalDietPlanSnapshot(snapshot);
      });
      if (matchingSavedPlans.length > 0) {
        addSystemLog("data", `已从数据库读取 ${matchingSavedPlans.length} 天与当前画像匹配的饮食计划。`);
      }
      if (skippedCount > 0) {
        addSystemLog("data", `数据库中 ${skippedCount} 天饮食计划与当前画像不一致，已跳过并重新生成。`);
      }
    } catch (err) {
      backendAvailable = false;
      addSystemLog("data", `读取数据库饮食计划失败，改用本地记录或重新生成：${err.message || "账户服务不可用"}`);
    }
  }
  fetchDietCustomerRecordsRange(dates[0], dates[dates.length - 1], { silent: true });

  let selectedSnapshot = await resolveStoredDietPlanSnapshot(requestedSelectedDate, {
    forceRegenerate: Boolean(options.forceRegenerate),
    skipDb: true,
    silent: true,
    sourceLabel: ""
  });

  if (!selectedSnapshot?.plans?.length) {
    const result = await generateAndPersistDietPlanForDate(requestedSelectedDate, {
      reason: options.reason || "initial",
      planConstraints: selectedConstraints,
      rangeDates: dates,
      skipBackend: !backendAvailable,
      silent: false,
      preserveVisible: false
    });
    selectedSnapshot = result.snapshot;
    if (!result.savedToDb && backendAvailable && result.error) {
      backendAvailable = false;
      addSystemLog("data", `饮食计划数据库保存失败，后续日期将仅保存本地：${result.error.message || "账户服务不可用"}`);
    }
  } else {
    if (backendAvailable && state.auth.token && !selectedSnapshot.dbSaved) {
      const result = await persistDietPlanSnapshot(selectedSnapshot, { silent: true });
      selectedSnapshot = result.snapshot;
      if (!result.savedToDb && result.error) {
        backendAvailable = false;
        addSystemLog("data", `本地饮食计划同步数据库失败，后续日期暂不重试：${result.error.message || "账户服务不可用"}`);
      }
    }
    applyDietPlanSnapshot(selectedSnapshot);
  }

  state.dietCalendar.loading = false;
  renderPlanCalendarControls();

  const backgroundDates = [];
  dates.forEach(planDate => {
    if (planDate === requestedSelectedDate) return;
    const snapshot = getUsableDietPlanSnapshot(
      state.dietCalendar.savedDates[planDate] || readLocalDietPlanSnapshot(planDate),
      planDate,
      ""
    );
    if (snapshot?.plans?.length) {
      state.dietCalendar.savedDates[planDate] = snapshot;
      saveLocalDietPlanSnapshot(snapshot);
      if (backendAvailable && state.auth.token && !snapshot.dbSaved) {
        persistDietPlanSnapshot(snapshot, { silent: true });
      }
    } else {
      backgroundDates.push(planDate);
    }
  });

  if (backgroundDates.length) {
    enqueueBackgroundDietPlanDates(backgroundDates, {
      reason: "background",
      rangeDates: dates,
      skipBackend: !backendAvailable
    });
    addSystemLog("diet", `当前日期计划已展示，剩余 ${backgroundDates.length} 天已进入后台生成队列。`);
  }

  return selectedSnapshot;
}

async function loadOrGenerateDietPlanForDate(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate);
  setVisiblePlanDate(normalizedDate);
  state.dietCalendar.loading = true;
  renderPlanCalendarControls();
  fetchDietCustomerRecordsRange(normalizedDate, normalizedDate, { silent: true });

  try {
    let snapshot = await resolveStoredDietPlanSnapshot(normalizedDate, {
      forceRegenerate: Boolean(options.forceRegenerate),
      sourceLabel: "本地/数据库中"
    });

    if (!snapshot?.plans?.length) {
      const status = getPlanGenerationStatus(normalizedDate);
      if (!options.forceRegenerate && (status === "queued" || status === "generating")) {
        clearCurrentPlanForPendingDate(normalizedDate);
        return null;
      }

      const result = await generateAndPersistDietPlanForDate(normalizedDate, {
        reason: options.reason || (options.forceRegenerate ? "regenerate" : "initial"),
        planConstraints: options.forceRegenerate ? state.planConstraints : createEmptyPlanConstraints(),
        rangeDates: options.rangeDates || getPlanDateRange(),
        preserveVisible: false
      });
      snapshot = result.snapshot;
    }

    applyDietPlanSnapshot(snapshot);
    return snapshot;
  } finally {
    state.dietCalendar.loading = false;
    renderPlanCalendarControls();
  }
}

function syncPlanCalendarFromInputs() {
  const checkedPeriod = document.querySelector("input[name='planPeriod']:checked")?.value;
  const startInput = document.getElementById("planStartDate");
  state.dietCalendar.period = getAllowedPlanPeriod(checkedPeriod || state.dietCalendar.period);
  state.dietCalendar.startDate = normalizeIsoDate(startInput?.value || state.dietCalendar.startDate || getTodayIsoDate());
  if (!state.dietCalendar.selectedDate || !getPlanDateRange().includes(state.dietCalendar.selectedDate)) {
    setVisiblePlanDate(state.dietCalendar.startDate);
  } else {
    state.dietCalendar.visibleDate = state.dietCalendar.selectedDate;
  }
}

function initPlanCalendarControls() {
  const today = getTodayIsoDate();
  state.dietCalendar.startDate = normalizeIsoDate(state.dietCalendar.startDate || today);
  setVisiblePlanDate(state.dietCalendar.selectedDate || state.dietCalendar.startDate);

  document.querySelectorAll("input[name='planPeriod']").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) {
        setPlanPeriod(input.value);
      }
    });
  });

  document.querySelectorAll("[data-plan-period]").forEach(button => {
    button.addEventListener("click", () => {
      setPlanPeriod(button.dataset.planPeriod);
    });
  });

  const startInput = document.getElementById("planStartDate");
  if (startInput) {
    startInput.value = state.dietCalendar.startDate;
    startInput.addEventListener("change", () => {
      setPlanStartDate(startInput.value);
    });
  }

  const dateSelect = document.getElementById("planDateSelect");
  if (dateSelect) {
    dateSelect.addEventListener("change", () => {
      handlePlanDateSelection(dateSelect.value);
    });
  }

  renderPlanCalendarControls();
}

function setPlanPeriod(period) {
  const requestedPeriod = normalizePlanPeriod(period);
  const nextPeriod = getAllowedPlanPeriod(requestedPeriod, { announce: true });
  const changed = state.dietCalendar.period !== nextPeriod;
  state.dietCalendar.period = nextPeriod;
  const dates = getPlanDateRange();
  if (!dates.includes(state.dietCalendar.selectedDate)) {
    setVisiblePlanDate(dates[0]);
  }
  renderPlanCalendarControls();
  if (changed) {
    reloadDietPlansAfterCalendarChange();
  }
}

function setPlanStartDate(value) {
  state.dietCalendar.startDate = normalizeIsoDate(value);
  setVisiblePlanDate(state.dietCalendar.startDate);
  renderPlanCalendarControls();
  reloadDietPlansAfterCalendarChange();
}

async function handlePlanDateSelection(planDate) {
  const normalizedDate = setVisiblePlanDate(planDate);
  renderPlanCalendarControls();
  if (!state.formData?.age) return;

  const stored = await resolveStoredDietPlanSnapshot(normalizedDate, { silent: true, sourceLabel: "" });
  if (stored?.plans?.length) {
    applyDietPlanSnapshot(stored);
  } else if (["queued", "generating"].includes(getPlanGenerationStatus(normalizedDate))) {
    clearCurrentPlanForPendingDate(normalizedDate);
  } else {
    await loadOrGenerateDietPlanForDate(normalizedDate, { reason: "select" });
  }

  renderDietPlans();
  addSystemLog("diet", `已切换查看 ${formatPlanDateLabel(normalizedDate)} 的饮食计划。`);
}

async function reloadDietPlansAfterCalendarChange() {
  if (!state.formData?.age || state.currentStep < 2) return;
  const previousActive = state.activePlanIndex;
  await prepareDietPlansForCurrentRange({ reason: "calendar-change" });
  state.activePlanIndex = Math.min(previousActive, Math.max(0, state.plans.length - 1));
  renderDietPlans();
  addSystemLog("diet", `计划周期已切换为${getPlanPeriodLabel()}，当前查看 ${formatPlanDateLabel(state.dietCalendar.selectedDate)}。`);
}

function renderPlanCalendarControls() {
  ensureEntitledPlanPeriod();
  if (!state.dietCalendar.startDate) {
    state.dietCalendar.startDate = getTodayIsoDate();
  }
  if (!state.dietCalendar.selectedDate) {
    setVisiblePlanDate(state.dietCalendar.startDate);
  }

  const dates = getPlanDateRange();
  if (!dates.includes(getVisiblePlanDate())) {
    setVisiblePlanDate(dates[0] || state.dietCalendar.startDate);
  }
  const visibleDate = getVisiblePlanDate();

  document.querySelectorAll("input[name='planPeriod']").forEach(input => {
    const locked = !canUsePlanPeriod(input.value);
    input.checked = input.value === state.dietCalendar.period;
    input.disabled = locked;
    input.closest("label")?.classList.toggle("entitlement-locked", locked);
    input.closest("label")?.setAttribute("title", locked ? "Pro 会员解锁该周期" : "");
  });

  document.querySelectorAll("[data-plan-period]").forEach(button => {
    const locked = !canUsePlanPeriod(button.dataset.planPeriod);
    button.classList.toggle("active", button.dataset.planPeriod === state.dietCalendar.period);
    button.classList.toggle("entitlement-locked", locked);
    button.disabled = locked;
    button.title = locked ? "Pro 会员解锁该周期" : "";
  });

  const startInput = document.getElementById("planStartDate");
  if (startInput && startInput.value !== state.dietCalendar.startDate) {
    startInput.value = state.dietCalendar.startDate;
  }

  const dateSelect = document.getElementById("planDateSelect");
  if (dateSelect) {
    dateSelect.innerHTML = dates.map(date => {
      const snapshot = state.dietCalendar.savedDates[date];
      const statusInfo = getPlanGenerationEntry(date);
      const statusText = snapshot?.plans?.length
        ? "已保存"
        : getPlanGenerationLabel(statusInfo.status);
      const marker = statusText ? ` · ${statusText}` : "";
      return `<option value="${date}" ${date === visibleDate ? "selected" : ""}>${formatPlanDateLabel(date)}${marker}</option>`;
    }).join("");
  }

  const status = document.getElementById("planPersistenceStatus");
  if (status) {
    const snapshot = state.dietCalendar.savedDates[visibleDate];
    const statusInfo = getPlanGenerationEntry(visibleDate);
    if (snapshot?.plans?.length && snapshot.dbSaved) {
      status.innerText = `数据库已保存 · ${formatPlanDateLabel(snapshot.planDate)} · ${formatDateTime(snapshot.updatedAt)}`;
    } else if (snapshot?.plans?.length && state.auth.user) {
      status.innerText = `本地已生成 · 数据库待同步 · ${formatDateTime(snapshot.updatedAt)}`;
    } else if (snapshot?.plans?.length) {
      status.innerText = `本地已保存 · 登录后可写入客户数据库 · ${formatDateTime(snapshot.updatedAt)}`;
    } else if (statusInfo.status === "generating" || state.dietCalendar.loading) {
      status.innerText = `${formatPlanDateLabel(visibleDate)} 生成中，请稍候...`;
    } else if (statusInfo.status === "queued") {
      status.innerText = `${formatPlanDateLabel(visibleDate)} 排队中，后台会自动生成`;
    } else if (statusInfo.status === "failed") {
      status.innerText = `${formatPlanDateLabel(visibleDate)} 生成失败：${statusInfo.message || "请重新生成"}`;
    } else if (!snapshot?.plans?.length) {
      status.innerText = `${formatPlanDateLabel(visibleDate)} 尚未生成`;
    }
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (state.auth.loading) return;

  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const displayNameInput = document.getElementById("authDisplayName");
  const email = emailInput?.value.trim();
  const password = passwordInput?.value || "";
  const displayName = displayNameInput?.value.trim();

  if (!email || !password || (state.auth.mode === "register" && !displayName)) {
    setAuthMessage("请完整填写账户信息", "error");
    return;
  }

  state.auth.loading = true;
  renderAuthPanel();
  setAuthMessage("");

  try {
    const path = state.auth.mode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";
    const payload = state.auth.mode === "register"
      ? { email, password, displayName, profile: {} }
      : { email, password };
    const data = await requestAuth(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.auth.token = data.token;
    state.auth.user = data.user;
    state.dietCalendar.savedDates = {};
    state.dietCalendar.generationStatus = {};
    state.dietCalendar.backgroundQueue = [];
    state.checkins = {};
    state.historyMenus = {};
    localStorage.setItem(STORAGE_KEYS.authToken, data.token);
    if (passwordInput) passwordInput.value = "";
    setAuthMessage("");
    renderAuthPanel();
    await refreshCommerceState({ announce: true });

    handleAuthenticatedProfile(data.user.profile, {
      announce: true,
      loadedMessage: "已从数据库读取该用户已有画像，并填回问卷。"
    });
  } catch (err) {
    setAuthMessage(err.message || "账户请求失败", "error");
    state.backend.online = false;
    state.backend.lastError = err.message || "auth unavailable";
    renderApiSwitchMetrics();
  } finally {
    state.auth.loading = false;
    renderAuthPanel();
  }
}

async function refreshCurrentUser(options = {}) {
  if (!state.auth.token) return;

  try {
    const previousUserId = state.auth.user?.id || "";
    const data = await requestAuth("/api/v1/auth/me", { method: "GET" });
    state.auth.user = data.user;
    if (previousUserId && previousUserId !== data.user.id) {
      state.dietCalendar.savedDates = {};
      state.dietCalendar.generationStatus = {};
      state.dietCalendar.backgroundQueue = [];
      state.checkins = {};
      state.historyMenus = {};
    }
    renderAuthPanel();
    await refreshCommerceState();
    handleAuthenticatedProfile(data.user.profile, {
      announce: options.announce,
      loadedMessage: "已加载登录用户，并复用数据库中已有画像。"
    });
  } catch (err) {
    if (err.status === 401) {
      clearAuthState();
      setAuthMessage(err.message || "登录已失效", "error");
    } else {
      setAuthMessage(err.message || "暂时无法读取账户信息", "error");
    }
  }
}

function clearAuthState() {
  state.auth.token = "";
  state.auth.user = null;
  state.auth.loading = false;
  state.dietCalendar.savedDates = {};
  state.dietCalendar.generationStatus = {};
  state.dietCalendar.backgroundQueue = [];
  state.checkins = {};
  state.historyMenus = {};
  localStorage.removeItem(STORAGE_KEYS.authToken);
  resetCommerceState();
  renderAuthPanel();
}

function handleLogout() {
  clearAuthState();
  setAuthMessage("已退出登录", "info");
  addSystemLog("data", "已退出账户；当前页面数据仍可本地使用。");
}

async function syncStoredProfileFromDb() {
  if (!state.auth.token) return;
  await refreshCurrentUser({ announce: true });
}

function getCurrentProfileRecordKey() {
  return state.auth.user ? `profile.user.${state.auth.user.id}` : "profile.current";
}

function getBodyMetricsRecordKey() {
  const owner = state.auth.user?.id || "local";
  return `body.metrics.${owner}`;
}

function readBodyMetricRecords() {
  const record = readDataRecord(getBodyMetricsRecordKey());
  const items = Array.isArray(record?.value) ? record.value : [];
  return items
    .filter(item => item && typeof item === "object")
    .map(item => ({
      date: normalizeIsoDate(item.date),
      weight: Number(item.weight) || 0,
      height: Number(item.height) || 0,
      bmi: Number(item.bmi) || 0,
      status: item.status || "",
      recordedAt: item.recordedAt || ""
    }))
    .filter(item => item.weight > 0 && item.height > 0 && item.bmi > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function saveBodyMetricRecords(records) {
  const cleaned = records
    .filter(item => item?.date && item.weight > 0 && item.height > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);
  saveDataRecord(getBodyMetricsRecordKey(), cleaned);
  return cleaned;
}

function getBodyMetricInputIds(source = "form") {
  return source === "home"
    ? { date: "homeBodyMetricDate", weight: "homeBodyMetricWeight" }
    : { date: "bodyMetricDate", weight: "bodyMetricWeight" };
}

function getBodyMetricHeight() {
  return Number(document.getElementById("height")?.value || state.formData.height || 0);
}

function getFallbackBodyMetricWeight() {
  const records = readBodyMetricRecords();
  const latest = records[records.length - 1];
  return Number(latest?.weight || document.getElementById("weight")?.value || state.formData.weight || 0);
}

function syncBodyMetricInputDefaults(metric = null, options = {}) {
  const fallbackMetric = metric || readBodyMetricRecords().slice(-1)[0] || collectBodyMetricFromForm();
  const fallbackDate = fallbackMetric?.date || getTodayIsoDate();
  const fallbackWeight = Number(fallbackMetric?.weight || getFallbackBodyMetricWeight() || 0);

  ["form", "home"].forEach(source => {
    const ids = getBodyMetricInputIds(source);
    const dateInput = document.getElementById(ids.date);
    const weightInput = document.getElementById(ids.weight);

    if (dateInput) {
      dateInput.max = getTodayIsoDate();
      if (options.force || (!dateInput.value && document.activeElement !== dateInput)) {
        dateInput.value = fallbackDate;
      }
    }
    if (weightInput && fallbackWeight > 0 && (options.force || (!weightInput.value && document.activeElement !== weightInput))) {
      weightInput.value = fallbackWeight.toFixed(1).replace(/\.0$/, "");
    }
  });
}

function collectBodyMetricFromForm() {
  const height = getBodyMetricHeight();
  const weight = Number(document.getElementById("weight")?.value || state.formData.weight || 0);
  if (!height || !weight) return null;
  const bmi = weight / Math.pow(height / 100, 2);
  return {
    date: getTodayIsoDate(),
    weight,
    height,
    bmi: Number(bmi.toFixed(1)),
    status: getBmiStatus(bmi),
    recordedAt: new Date().toISOString()
  };
}

function collectBodyMetricFromInput(source = "form", options = {}) {
  const ids = getBodyMetricInputIds(source);
  const dateInput = document.getElementById(ids.date);
  const weightInput = document.getElementById(ids.weight);
  const date = normalizeIsoDate(dateInput?.value || getTodayIsoDate());
  const weight = Number(weightInput?.value || 0);
  const height = getBodyMetricHeight();

  if (!parseIsoDate(dateInput?.value || date)) {
    if (!options.silent) addSystemLog("data", "体重记录日期格式无效，请重新选择日期。");
    return null;
  }
  if (date > getTodayIsoDate()) {
    if (!options.silent) addSystemLog("data", "体重记录日期不能晚于今天。");
    return null;
  }
  if (!weight || weight < 20 || weight > 250) {
    if (!options.silent) addSystemLog("data", "请输入 20-250kg 之间的体重数值。");
    return null;
  }
  if (!height) {
    if (!options.silent) addSystemLog("data", "请先填写身高，系统需要身高计算 BMI。");
    return null;
  }

  const bmi = weight / Math.pow(height / 100, 2);
  return {
    date,
    weight: Number(weight.toFixed(1)),
    height,
    bmi: Number(bmi.toFixed(1)),
    status: getBmiStatus(bmi),
    recordedAt: new Date().toISOString()
  };
}

function saveBodyMetricFromCurrentForm(options = {}) {
  const metric = collectBodyMetricFromInput(options.source || "form", options);
  if (!metric) return null;
  const records = readBodyMetricRecords();
  const next = records.filter(item => item.date !== metric.date);
  next.push(metric);
  const saved = saveBodyMetricRecords(next);
  syncBodyMetricInputDefaults(metric, { force: true });
  renderBodyTrendPanel();
  if (state.currentStep === 5) {
    renderCustomerHomeBody();
  }
  if (!options.silent) {
    addSystemLog("data", `已记录 ${formatPlanDateLabel(metric.date)} 体重 ${metric.weight}kg，BMI ${metric.bmi}。`);
  }
  return saved;
}

function renderBodyTrendPanel() {
  const summary = document.getElementById("bodyTrendSummary");
  const chart = document.getElementById("bodyTrendChart");
  const list = document.getElementById("bodyTrendList");
  if (!summary && !chart && !list) return;

  syncBodyMetricInputDefaults();
  const current = collectBodyMetricFromInput("form", { silent: true }) || collectBodyMetricFromForm();
  const records = readBodyMetricRecords();
  const latestRecords = records.slice(-8);
  const previous = records.length >= 2 ? records[records.length - 2] : null;
  const latest = records[records.length - 1] || null;
  const trendText = latest && previous
    ? `较上次 ${latest.weight - previous.weight >= 0 ? "+" : ""}${(latest.weight - previous.weight).toFixed(1)}kg`
    : latest
      ? `最近记录 ${latest.weight}kg`
      : "暂无记录";

  if (summary) {
    summary.innerHTML = "";
    const bmiItem = document.createElement("span");
    bmiItem.textContent = current
      ? `当前 BMI：${current.bmi}（${current.status}）`
      : "当前 BMI：--";
    const trendItem = document.createElement("span");
    trendItem.textContent = `趋势：${trendText}`;
    summary.appendChild(bmiItem);
    summary.appendChild(trendItem);
  }

  if (chart) {
    chart.innerHTML = "";
    if (latestRecords.length < 2) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "180");
      text.setAttribute("y", "66");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "body-trend-empty-text");
      text.textContent = "至少记录 2 次后显示趋势线";
      chart.appendChild(text);
    } else {
      const weights = latestRecords.map(item => item.weight);
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      const span = Math.max(1, max - min);
      const points = latestRecords.map((item, index) => {
        const x = 22 + (index * (316 / Math.max(1, latestRecords.length - 1)));
        const y = 92 - ((item.weight - min) / span * 64);
        return { x, y, item };
      });

      const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
      grid.setAttribute("d", "M22 28H338M22 60H338M22 92H338");
      grid.setAttribute("class", "body-trend-grid-line");
      chart.appendChild(grid);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", points.map(point => `${point.x},${point.y}`).join(" "));
      line.setAttribute("class", "body-trend-line");
      chart.appendChild(line);

      points.forEach(point => {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", String(point.x));
        dot.setAttribute("cy", String(point.y));
        dot.setAttribute("r", "4");
        dot.setAttribute("class", "body-trend-dot");
        chart.appendChild(dot);
      });
    }
  }

  if (list) {
    list.innerHTML = "";
    if (!latestRecords.length) {
      const empty = document.createElement("span");
      empty.textContent = "暂无身体数据记录";
      list.appendChild(empty);
    } else {
      latestRecords.slice().reverse().forEach(item => {
        const chip = document.createElement("span");
        chip.textContent = `${formatPlanDateShort(item.date)} · ${item.weight}kg · BMI ${item.bmi}`;
        list.appendChild(chip);
      });
    }
  }
}

function collectHealthFormData() {
  syncPlanCalendarFromInputs();
  const allergies = [];
  document.querySelectorAll("input[name='allergies']:checked").forEach(cb => {
    allergies.push(cb.value);
  });

  const dietHabit = document.querySelector("input[name='dietHabit']:checked")?.value || "balanced";
  const extraProfileText = document.getElementById("freeProfileText")?.value.trim() || "";
  const extraProfile = extractAdditionalProfile(extraProfileText);

  return {
    gender: document.getElementById("gender").value,
    age: parseInt(document.getElementById("age").value),
    height: parseInt(document.getElementById("height").value),
    weight: parseInt(document.getElementById("weight").value),
    goal: document.getElementById("goal").value,
    activity: document.getElementById("activity").value,
    planPeriod: state.dietCalendar.period,
    planStartDate: state.dietCalendar.startDate,
    dietHabit,
    region: document.getElementById("region").value,
    allergies,
    extraProfileText,
    extraProfile
  };
}

function extractAdditionalProfile(text) {
  const rawText = (text || "").trim();
  const result = {
    rawText,
    likes: [],
    avoids: [],
    preferences: [],
    habits: [],
    notes: []
  };
  if (!rawText) return result;

  const rules = {
    avoids: {
      triggers: ["不吃", "不喜欢", "不能吃", "忌口", "过敏", "避免", "少吃", "戒", "不耐受"],
      terms: ["香菜", "葱", "姜", "蒜", "辣椒", "海鲜", "虾", "蟹", "贝类", "牛肉", "猪肉", "羊肉", "内脏", "乳制品", "牛奶", "酸奶", "奶酪", "鸡蛋", "坚果", "花生", "麸质", "小麦", "糖", "油炸", "高油", "高盐", "高糖"]
    },
    likes: {
      triggers: ["喜欢", "爱吃", "偏爱", "想吃", "希望吃", "接受", "可以吃"],
      terms: ["鸡胸肉", "鱼", "虾", "牛肉", "鸡蛋", "豆腐", "豆浆", "酸奶", "燕麦", "玉米", "红薯", "土豆", "米饭", "面", "番茄", "西兰花", "菠菜", "菌菇", "水果", "咖啡", "茶", "清淡", "麻辣", "酸甜", "番茄味"]
    },
    preferences: {
      triggers: ["偏好", "口味", "尽量", "需要", "倾向", "希望", "目标", "预算", "方便", "快速", "简单"],
      terms: ["清淡", "少油", "少盐", "少糖", "低糖", "低脂", "低碳", "低 GI", "高蛋白", "高纤维", "控糖", "减脂", "增肌", "均衡", "中式", "西式", "日式", "地中海", "快手", "便当", "外卖", "低预算", "省钱"]
    },
    habits: {
      triggers: ["经常", "通常", "每天", "每周", "工作日", "周末", "早餐", "午餐", "晚餐", "加班", "运动", "健身", "跑步", "睡眠", "作息", "通勤", "带饭", "公司"],
      terms: ["久坐", "加班", "带饭", "外食", "外卖", "食堂", "早餐少", "夜宵", "健身", "跑步", "力量训练", "游泳", "瑜伽", "睡得晚", "通勤", "公司吃", "周末运动"]
    }
  };

  splitProfileSentences(rawText).forEach(sentence => {
    let classified = false;
    Object.entries(rules).forEach(([key, rule]) => {
      const matched = rule.triggers.some(trigger => sentence.includes(trigger))
        || rule.terms.some(term => sentence.includes(term));
      if (!matched) return;
      classified = true;
      addExtractedTerms(result[key], sentence, rule.terms);
    });

    if (!classified) {
      result.notes.push(sentence);
    }
  });

  Object.keys(result).forEach(key => {
    if (Array.isArray(result[key])) {
      result[key] = Array.from(new Set(result[key])).slice(0, 8);
    }
  });

  return result;
}

function splitProfileSentences(text) {
  return text
    .split(/[，,。；;！!？?\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function addExtractedTerms(target, sentence, terms) {
  const matchedTerms = terms.filter(term => sentence.includes(term));
  if (matchedTerms.length > 0) {
    target.push(...matchedTerms);
  } else {
    target.push(sentence);
  }
}

function renderAdditionalProfilePreview(extracted = null) {
  const container = document.getElementById("profileExtractPreview");
  if (!container) return;

  const data = extracted || extractAdditionalProfile(document.getElementById("freeProfileText")?.value || "");
  const groups = [
    { key: "likes", label: "喜好" },
    { key: "avoids", label: "忌口" },
    { key: "preferences", label: "偏好" },
    { key: "habits", label: "习惯" },
    { key: "notes", label: "备注" }
  ].filter(group => data[group.key]?.length > 0);

  container.innerHTML = "";
  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "profile-extract-empty";
    empty.innerText = "暂无补充信息";
    container.appendChild(empty);
    return;
  }

  groups.forEach(group => {
    const card = document.createElement("div");
    card.className = "profile-extract-card";

    const title = document.createElement("strong");
    title.innerText = group.label;
    const content = document.createElement("span");
    content.innerText = data[group.key].join("、");

    card.appendChild(title);
    card.appendChild(content);
    container.appendChild(card);
  });
}

function handleExtractProfileText(options = {}) {
  const text = document.getElementById("freeProfileText")?.value || "";
  const extracted = extractAdditionalProfile(text);
  renderAdditionalProfilePreview(extracted);
  saveDataRecord("profile.extra.draft", extracted);
  if (options.announce) {
    addSystemLog("client", extracted.rawText ? "补充信息已提取，将随用户画像提供给后续 Agent。" : "补充信息已清空。");
  }
  return extracted;
}

function hasAdditionalProfile(extracted) {
  if (!extracted) return false;
  return Boolean(
    extracted.rawText
    || extracted.likes?.length
    || extracted.avoids?.length
    || extracted.preferences?.length
    || extracted.habits?.length
    || extracted.notes?.length
  );
}

function buildExtraProfileSummary(extracted) {
  if (!hasAdditionalProfile(extracted)) return "无";
  const parts = [
    ["喜好", extracted.likes],
    ["忌口", extracted.avoids],
    ["偏好", extracted.preferences],
    ["习惯", extracted.habits],
    ["备注", extracted.notes]
  ]
    .filter(([, values]) => values?.length > 0)
    .map(([label, values]) => `${label}:${values.slice(0, 3).join("、")}`);
  return parts.length > 0 ? parts.join(" | ") : extracted.rawText.slice(0, 60);
}

function applyStoredProfileToForm(profile) {
  if (!hasStoredProfile(profile)) return false;

  const fieldIds = ["gender", "age", "height", "weight", "goal", "activity", "region"];
  fieldIds.forEach(id => {
    const input = document.getElementById(id);
    if (input && profile[id] !== undefined && profile[id] !== null) {
      input.value = profile[id];
    }
  });

  const rangeDisplays = {
    age: "ageVal",
    height: "heightVal",
    weight: "weightVal"
  };
  Object.entries(rangeDisplays).forEach(([fieldId, displayId]) => {
    const input = document.getElementById(fieldId);
    const display = document.getElementById(displayId);
    if (input && display) display.innerText = input.value;
  });

  if (profile.dietHabit) {
    const radio = document.querySelector(`input[name='dietHabit'][value='${profile.dietHabit}']`);
    if (radio) radio.checked = true;
  }

  if (profile.planPeriod) {
    state.dietCalendar.period = normalizePlanPeriod(profile.planPeriod);
  }

  if (profile.planStartDate) {
    state.dietCalendar.startDate = normalizeIsoDate(profile.planStartDate);
    setVisiblePlanDate(state.dietCalendar.startDate);
  }

  renderPlanCalendarControls();

  const allergies = Array.isArray(profile.allergies) ? profile.allergies : [];
  document.querySelectorAll("input[name='allergies']").forEach(cb => {
    cb.checked = allergies.includes(cb.value);
  });

  const extraProfileText = document.getElementById("freeProfileText");
  if (extraProfileText) {
    extraProfileText.value = profile.extraProfileText || profile.extraProfile?.rawText || "";
    renderAdditionalProfilePreview(profile.extraProfile || extractAdditionalProfile(extraProfileText.value));
  }

  state.formData = collectHealthFormData();
  computeEdgeProfile(state.formData);
  saveDataRecord(getCurrentProfileRecordKey(), state.formData);
  renderBodyTrendPanel();
  return true;
}

async function persistAuthenticatedProfile(profile) {
  if (!state.auth.token) {
    addSystemLog("data", "未登录账户，画像仅保存到本地浏览器。");
    return false;
  }

  try {
    const data = await requestAuth("/api/v1/auth/me/profile", {
      method: "PUT",
      body: JSON.stringify({ profile })
    });
    state.auth.user = data.user;
    renderAuthPanel();
    addSystemLog("data", "用户画像已写入数据库；下次登录会直接复用。");
    return true;
  } catch (err) {
    if (err.status === 401) {
      clearAuthState();
    }
    addSystemLog("data", `数据库画像保存失败：${err.message || "账户服务不可用"}`);
    return false;
  }
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

  document.querySelectorAll("[data-auth-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      setAuthMode(btn.dataset.authMode);
      setAuthMessage("");
    });
  });

  const authForm = document.getElementById("authForm");
  if (authForm) {
    authForm.addEventListener("submit", handleAuthSubmit);
  }

  const logoutBtn = document.getElementById("authLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  const syncProfileBtn = document.getElementById("syncProfileBtn");
  if (syncProfileBtn) {
    syncProfileBtn.addEventListener("click", syncStoredProfileFromDb);
  }

  const membershipPlanList = document.getElementById("membershipPlanList");
  if (membershipPlanList) {
    membershipPlanList.addEventListener("click", event => {
      const btn = event.target.closest("[data-membership-plan]");
      if (!btn) return;
      checkoutMembershipPlan(btn.dataset.membershipPlan, { channel: "sidebar-membership" });
    });
  }

  const extraProfileText = document.getElementById("freeProfileText");
  if (extraProfileText) {
    extraProfileText.addEventListener("input", () => {
      renderAdditionalProfilePreview();
    });
  }

  const extractProfileTextBtn = document.getElementById("extractProfileTextBtn");
  if (extractProfileTextBtn) {
    extractProfileTextBtn.addEventListener("click", () => {
      handleExtractProfileText({ announce: true });
    });
  }

  // 提交问卷按钮
  const submitBtn = document.getElementById("submitFormBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", handleFormSubmit);
  }

  ["height", "weight"].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", renderBodyTrendPanel);
    }
  });

  ["bodyMetricDate", "bodyMetricWeight"].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", renderBodyTrendPanel);
    }
  });

  ["homeBodyMetricDate", "homeBodyMetricWeight"].forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", renderCustomerHomeBody);
    }
  });

  const saveBodyMetricBtn = document.getElementById("saveBodyMetricBtn");
  if (saveBodyMetricBtn) {
    saveBodyMetricBtn.addEventListener("click", () => saveBodyMetricFromCurrentForm());
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

  const regeneratePlansBtn = document.getElementById("regeneratePlansBtn");
  if (regeneratePlansBtn) {
    regeneratePlansBtn.addEventListener("click", handleRegeneratePlans);
  }

  const homeCustomizeCurrentBtn = document.getElementById("homeCustomizeCurrentBtn");
  if (homeCustomizeCurrentBtn) {
    homeCustomizeCurrentBtn.addEventListener("click", openCurrentPlanForCustomization);
  }

  const ingredientsBackHomeBtn = document.getElementById("ingredientsBackHomeBtn");
  if (ingredientsBackHomeBtn) {
    ingredientsBackHomeBtn.addEventListener("click", goToCustomerHome);
  }

  const homeViewIngredientsBtn = document.getElementById("homeViewIngredientsBtn");
  if (homeViewIngredientsBtn) {
    homeViewIngredientsBtn.addEventListener("click", openHomeIngredients);
  }

  const homeRecordWeightBtn = document.getElementById("homeRecordWeightBtn");
  if (homeRecordWeightBtn) {
    homeRecordWeightBtn.addEventListener("click", () => {
      saveBodyMetricFromCurrentForm({ source: "home" });
      renderCustomerHomeBody();
    });
  }

  const homeCompleteCheckinBtn = document.getElementById("homeCompleteCheckinBtn");
  if (homeCompleteCheckinBtn) {
    homeCompleteCheckinBtn.addEventListener("click", () => handleHomeSaveCheckin("completed"));
  }

  const homeSkipCheckinBtn = document.getElementById("homeSkipCheckinBtn");
  if (homeSkipCheckinBtn) {
    homeSkipCheckinBtn.addEventListener("click", () => handleHomeSaveCheckin("skipped"));
  }

  const homeSaveHistoryMenuBtn = document.getElementById("homeSaveHistoryMenuBtn");
  if (homeSaveHistoryMenuBtn) {
    homeSaveHistoryMenuBtn.addEventListener("click", handleHomeSaveHistoryMenu);
  }

  const homeBackToQuestionnaireBtn = document.getElementById("homeBackToQuestionnaireBtn");
  if (homeBackToQuestionnaireBtn) {
    homeBackToQuestionnaireBtn.addEventListener("click", () => goToStep(1));
  }

  // 计划分享 Tab 切换
  document.querySelectorAll(".marketing-tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const tabButton = e.currentTarget;
      const platform = tabButton.getAttribute("data-platform");
      document.querySelectorAll(".marketing-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".marketing-panel").forEach(p => p.classList.remove("active"));
      
      tabButton.classList.add("active");
      document.getElementById(`market-${platform}`).classList.add("active");
      addSystemLog("market", `已切换到【${tabButton.innerText}】分享面板。`);
    });
  });

  // 一键复制功能
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const targetEl = document.getElementById(targetId);
      const textToCopy = targetEl ? targetEl.innerText : "";
      
      copyTextToClipboard(textToCopy).then(() => {
        flashCopyButton(btn, `<span>✓</span> <span>已复制成功！</span>`, "copied");
        addSystemLog("system", `已将生成的内容成功复制到剪贴板。`);
      }).catch(err => {
        console.warn("复制失败，已尝试选中文案: ", err);
        const selected = selectTextElement(targetEl);
        flashCopyButton(
          btn,
          selected
            ? `<span>!</span> <span>已选中文案，请按 Ctrl+C</span>`
            : `<span>!</span> <span>请手动复制文案</span>`,
          "manual-copy"
        );
        addSystemLog(
          "system",
          selected
            ? "浏览器拒绝直接写入剪贴板，已自动选中文案，可按 Ctrl+C 复制。"
            : "浏览器拒绝直接写入剪贴板，请手动选择文案复制。"
        );
      });
    });
  });

  const sharePlanBtn = document.getElementById("sharePlanBtn");
  if (sharePlanBtn) {
    sharePlanBtn.addEventListener("click", () => {
      goToSharePage();
    });
  }

  const backToIngredientsBtn = document.getElementById("backToIngredientsBtn");
  if (backToIngredientsBtn) {
    backToIngredientsBtn.addEventListener("click", () => {
      goToStep(4);
      addSystemLog("ingredient", "已返回分类食材采购清单。");
    });
  }

  // 重新开始按钮
  const restartBtn = document.getElementById("restartBtn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      state.currentStep = 1;
      state.formData = {};
      state.plans = [];
      state.activePlanIndex = 0;
      state.selectedPlanIndex = 0;
      state.planConstraints = createEmptyPlanConstraints();
      state.planDiscussion = createEmptyPlanDiscussion();
      state.dietCalendar = {
        period: "day",
        startDate: getTodayIsoDate(),
        selectedDate: getTodayIsoDate(),
        visibleDate: getTodayIsoDate(),
        savedDates: {},
        generationStatus: {},
        backgroundQueueRunning: false,
        backgroundQueue: [],
        loading: false,
        lastSource: "new"
      };
      state.checkins = {};
      state.historyMenus = {};
      document.getElementById("healthForm").reset();
      document.getElementById("ageVal").innerText = "28";
      document.getElementById("heightVal").innerText = "165";
      document.getElementById("weightVal").innerText = "56";
      renderPlanCalendarControls();
      renderAdditionalProfilePreview(extractAdditionalProfile(""));
      
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

  // 计划打卡视频生成按钮
  const genVideoBtn = document.getElementById("generateVideoBtn");
  if (genVideoBtn) {
    genVideoBtn.addEventListener("click", startVideoRecording);
  }

  // 分享数据包下载按钮
  const downloadPackBtn = document.getElementById("downloadPublishPackBtn");
  if (downloadPackBtn) {
    downloadPackBtn.addEventListener("click", downloadPublishPackage);
  }

  // 个人平台分享助手弹窗
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

  const reevaluatePlansBtn = document.getElementById("reevaluatePlansBtn");
  if (reevaluatePlansBtn) {
    reevaluatePlansBtn.addEventListener("click", handleReevaluatePlans);
  }

  const completeCheckinBtn = document.getElementById("completeCheckinBtn");
  if (completeCheckinBtn) {
    completeCheckinBtn.addEventListener("click", () => handleSaveCheckin("completed"));
  }

  const skipCheckinBtn = document.getElementById("skipCheckinBtn");
  if (skipCheckinBtn) {
    skipCheckinBtn.addEventListener("click", () => handleSaveCheckin("skipped"));
  }

  const saveHistoryMenuBtn = document.getElementById("saveHistoryMenuBtn");
  if (saveHistoryMenuBtn) {
    saveHistoryMenuBtn.addEventListener("click", handleSaveHistoryMenu);
  }

  const refreshRangeShoppingBtn = document.getElementById("refreshRangeShoppingBtn");
  if (refreshRangeShoppingBtn) {
    refreshRangeShoppingBtn.addEventListener("click", () => {
      if (!hasCommerceFeature("rangeShopping")) {
        promptUpgradeForFeature("周期合并采购清单");
        renderRangeShoppingPanel();
        return;
      }
      renderRangeShoppingPanel();
      addSystemLog("ingredient", "已刷新周期合并采购清单。");
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
      if (state.currentStep === 3) {
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
  const progressPercent = step * 25;
  document.getElementById("progressBar").style.width = `${progressPercent}%`;
  
  const stepNames = [
    "基础健康问卷",
    "个性化膳食方案",
    "方案量化评估",
    "分类食材采购清单"
  ];
  document.getElementById("current-step-name").innerText = stepNames[step - 1];

  if (step === 3 && state.plans.length) {
    updateWeightTextDisplays();
    evaluatePlansRealtime();
    renderAiDebate();
  }

  if (step === 4 && state.plans.length) {
    renderIngredients();
  }

}

function goToCustomerHome(options = {}) {
  const targetView = document.getElementById("customer-home");
  if (!targetView) return;

  state.currentStep = 5;
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  targetView.classList.add("active");

  const progressBar = document.getElementById("progressBar");
  const currentStepName = document.getElementById("current-step-name");
  if (progressBar) progressBar.style.width = "100%";
  if (currentStepName) currentStepName.innerText = "客户主页";

  renderCustomerHome();
  if (!options.silent) {
    addSystemLog("client", "已进入客户主页，可查看当天饮食计划、打卡面板与体重记录。");
  }
}

function goToSharePage() {
  if (!hasCommerceFeature("shareExport")) {
    promptUpgradeForFeature("分享报告与推广素材导出");
    return;
  }

  const shareView = document.getElementById("share-page");
  if (!shareView) return;

  prepareShareContent();

  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  shareView.classList.add("active");

  state.currentStep = 4;
  document.getElementById("progressBar").style.width = "100%";
  document.getElementById("current-step-name").innerText = "附加环节：计划分享与推广辅助";
  addSystemLog("market", "已跳转到计划分享与推广辅助页面，可从左上角返回食材清单。");
}

// 带加载动画和日志的步骤流转
async function triggerStepTransition(targetStep) {
  // 显示加载遮罩
  const loadingView = document.getElementById("step-loading");
  document.querySelectorAll(".step-view").forEach(view => {
    view.classList.remove("active");
  });
  loadingView.classList.add("active");

  const processingText = document.getElementById("processingText");
  
  // 注入不同步骤的处理进度
  if (targetStep === 2) {
    processingText.innerText = "正在读取或生成日期饮食规划...";
    syncPlanCalendarFromInputs();
    
    enqueueLog("client", "问卷收集完成，正在整理画像字段并排查过敏源。");
    enqueueLog("switch", "用户健康画像已提交，正在请求多 Agent 生成膳食方案。");
    enqueueLog("diet", "用户画像已生成。");
    enqueueLog("diet", `目标：${translateGoal(state.formData.goal)} | 饮食风格：${translateHabit(state.formData.dietHabit)}`);
    enqueueLog("diet", `过敏排除食材：${state.formData.allergies.length > 0 ? state.formData.allergies.map(translateAllergy).join('、') : '无'}`);
    if (hasAdditionalProfile(state.formData.extraProfile)) {
      enqueueLog("diet", `补充参考：${buildExtraProfileSummary(state.formData.extraProfile)}`);
    }
    enqueueLog("diet", `计划周期：${getPlanPeriodLabel()}，起始日期：${formatPlanDateLabel(state.dietCalendar.startDate)}。`);
    enqueueLog("diet", "正在按日期检查已保存饮食计划；缺失日期才会重新生成。");

    try {
      await prepareDietPlansForCurrentRange({ reason: "initial" });
    } catch (err) {
      addSystemLog("diet", `日期计划读取失败，已切换为本地重新生成：${err.message || "未知错误"}`);
      const fallback = generateDietPlanSnapshotForDate(state.dietCalendar.selectedDate || state.dietCalendar.startDate, {
        reason: "initial",
        planConstraints: createEmptyPlanConstraints()
      });
      await persistDietPlanSnapshot(fallback, { skipBackend: true });
      applyDietPlanSnapshot(fallback);
    }

    enqueueLog("diet", `计算完成。基础代谢(BMR) ≈ ${state.bmr} kcal，日消耗(TDEE) ≈ ${state.tdee} kcal。每日饮食热量靶点设定。`);
    enqueueLog("diet", `当前查看日期：${formatPlanDateLabel(state.dietCalendar.selectedDate)}。`);
    enqueueLog("diet", `多 Agent 讨论结论：${state.planDiscussion.consensus}`);
    if (state.plans.length >= 3) {
      enqueueLog("diet", `已成功为您定制当前日期的3套侧重点不同的健康饮食方案：\n1. ${formatPlanLabelName(state.plans[0], 0)}\n2. ${formatPlanLabelName(state.plans[1], 1)}\n3. ${formatPlanLabelName(state.plans[2], 2)}`);
    }
    enqueueLog("diet", `当前查看日期计划已就绪；周期内其他日期会在后台继续生成。`);
    saveDataRecord("diet.plans.current", state.plans);

    goToStep(2);
    renderDietPlans();

  } else if (targetStep === 3) {
    processingText.innerText = "正在基于成本、地域和夏季时令进行多维评分...";

    const evaluationResponsePromise = apiSwitch.request("/api/v1/evaluation/score", {
      weights: state.weights,
      plans: state.plans.map(plan => ({ name: plan.name, scores: plan.scores })),
      agentContext: state.formData.extraProfile,
      planDate: state.dietCalendar.selectedDate
    }, {
      source: "diet-planner",
      target: "evaluation-engine"
    });
    
    enqueueLog("eval", "启动综合推荐评分模型。");
    enqueueLog("eval", `引入约束条件：[夏季生鲜时令指数]、[${translateRegion(state.formData.region)}食材物价指数]、[营养均衡比例评估]。`);
    enqueueLog("eval", `当前推荐权重设为 -> 成本控制: ${state.weights.cost}% | 季节适宜: ${state.weights.season}% | 地域匹配: ${state.weights.region}%`);
    enqueueLog("eval", "正在使用归一化加权公式实时计算 3 个方案的最终健康推荐评分。");
    enqueueLog("switch", "正在从可执行性、营养结构和量化约束三个角度进行独立复核。");

    try {
      await evaluationResponsePromise;
    } catch (err) {
      enqueueLog("eval", `评分服务暂不可用，继续使用本地权重评估：${err.message || "未知错误"}`);
    }

    await wait(2500);
    goToStep(3);
    evaluatePlansRealtime();
    try {
      await runAiDebateForPlans();
    } catch (err) {
      enqueueLog("eval", `智能复核暂不可用，已保留本地评分结果：${err.message || "未知错误"}`);
    }
    enqueueLog("eval", `打分已就绪！当前判定综合得分最高的是：【${state.plans[state.selectedPlanIndex].name}】。`);
    enqueueLog("eval", "用户可手动调节权重滑块重新评估。确定最终方案后，将为该方案生成采购清单。");

  } else if (targetStep === 4) {
    processingText.innerText = "正在基于最终推荐方案生成食材采购清单...";
    state.activePlanIndex = state.selectedPlanIndex;

    const ingredientResponsePromise = apiSwitch.request("/api/v1/ingredients/list", {
      activePlanIndex: state.selectedPlanIndex,
      plans: state.plans.map(plan => ({
        name: plan.name,
        meals: plan.meals,
        ingredients: plan.ingredients,
        macros: plan.macros,
        calories: plan.calories
      })),
      agentContext: state.formData.extraProfile,
      planDate: state.dietCalendar.selectedDate,
      planPeriod: state.dietCalendar.period
    }, {
      source: "evaluation-engine",
      target: "ingredient-planner"
    });
    
    enqueueLog("ingredient", `已锁定最终推荐方案：【${state.plans[state.selectedPlanIndex].name}】。`);
    enqueueLog("ingredient", "正在按最终方案拆解食材并折算采购用量。");
    enqueueLog("ingredient", `分析配菜风格为：${translateRegion(state.formData.region)}...`);
    
    const allergiesStr = state.formData.allergies.map(translateAllergy).join('、');
    if (state.formData.allergies.length > 0) {
      enqueueLog("ingredient", `⚠️ 检测到避忌食材：[${allergiesStr}]。已开启食材替换算法，使用安全蛋白与主食替代。`);
    }

    try {
      const ingredientResponse = await ingredientResponsePromise;
      if (ingredientResponse.ok && hasUsableIngredients(ingredientResponse.data?.ingredients)) {
        state.plans[state.selectedPlanIndex].ingredients = normalizePlanIngredients(ingredientResponse.data.ingredients);
        state.plans[state.selectedPlanIndex].ingredientMode = ingredientResponse.data.mode || "mock";
        enqueueLog(
          "ingredient",
          ingredientResponse.data.mode === "real"
            ? "大模型食材 Agent 已按最终方案重新折算采购清单。"
            : ingredientResponse.data.mode === "fallback"
              ? "大模型食材 Agent 调用失败，已使用 fallback 采购清单。"
              : "Mock 食材 Agent 已生成采购清单。"
        );
      }
    } catch (err) {
      enqueueLog("ingredient", `食材 Agent 暂不可用，继续使用方案内置采购清单：${err.message || "未知错误"}`);
    }

    enqueueLog("ingredient", "已计算出生鲜肉蛋奶类、时令蔬菜水果类、膳食粗粮谷物类以及调味耗材的具体用量。");
    enqueueLog("switch", "最终方案采购清单已生成，下一步可保存或分享本次计划。");
    enqueueLog("ingredient", "食材清单规划完成，并加入高温储鲜与保水防潮建议。");
    saveDataRecord("ingredients.current", state.plans.map(plan => ({
      name: plan.name,
      ingredients: plan.ingredients
    })));

    await wait(2400);
    goToStep(4);
    renderIngredients();
  }
}

// 提交表单处理
async function handleFormSubmit() {
  const form = document.getElementById("healthForm");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  state.formData = collectHealthFormData();
  renderAdditionalProfilePreview(state.formData.extraProfile);
  saveBodyMetricFromCurrentForm({ silent: true });
  state.planConstraints = createEmptyPlanConstraints();
  state.planDiscussion = createEmptyPlanDiscussion();
  state.dietCalendar.savedDates = {};
  state.dietCalendar.generationStatus = {};
  state.dietCalendar.backgroundQueue = [];
  state.dietCalendar.backgroundQueueRunning = false;
  state.dietCalendar.visibleDate = state.dietCalendar.selectedDate;
  state.dietCalendar.lastSource = "new";
  state.checkins = {};
  state.historyMenus = {};

  computeEdgeProfile(state.formData);
  saveDataRecord(getCurrentProfileRecordKey(), state.formData);
  saveDataRecord("profile.extra.current", state.formData.extraProfile);
  persistAuthenticatedProfile(state.formData);
  enqueueLog("data", "用户画像已保存，后续步骤可继续复用。");
  if (hasAdditionalProfile(state.formData.extraProfile)) {
    enqueueLog("client", "补充文本与提取结果已加入用户画像。");
  }
  enqueueLog("switch", "画像创建请求已进入处理队列。");

  try {
    const profileResponse = await apiSwitch.request("/api/v1/profile/create", state.formData, {
      source: "ui-controller",
      target: "customer-manager"
    });
    if (profileResponse.ok && profileResponse.data) {
      state.formData.agentProfile = profileResponse.data.agentProfile || {};
      saveDataRecord("profile.agent.current", profileResponse.data);
      enqueueLog(
        "client",
        profileResponse.data.mode === "real"
          ? "大模型客户经理 Agent 已完成用户画像整理。"
          : profileResponse.data.mode === "fallback"
            ? "大模型客户经理 Agent 调用失败，已使用 fallback 用户画像。"
            : "Mock 客户经理 Agent 已完成用户画像整理。"
      );
    }
  } catch (err) {
    enqueueLog("client", `客户经理 Agent 暂不可用，继续使用本地画像：${err.message || "未知错误"}`);
  }

  // 开启流转动画，进入膳食方案页；后续步骤由用户点击下一步推进。
  await triggerStepTransition(2);
}

// 计算代谢消耗并产生模拟的饮食方案数据 (与用户输入深度动态关联)
function calculateAndGenerateDietData(options = {}) {
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

  applyPlanDateVariation(options.planDate || state.dietCalendar.selectedDate, options);
  finalizeGeneratedPlans(options);
}

function mealHasPinnedConstraint(planIndex, mealName) {
  return state.planConstraints.pinnedDishes.some(item => (
    item.planIndex === planIndex && item.mealName === mealName
  ));
}

function getMealPrimaryDish(food) {
  return splitMealDishes(food)[0] || String(food || "");
}

function mealLooksRepeated(food, previousFoods = []) {
  const primary = normalizeDishText(getMealPrimaryDish(food));
  if (!primary) return false;

  return previousFoods.some(previous => {
    const previousPrimary = normalizeDishText(getMealPrimaryDish(previous));
    if (!previousPrimary) return false;
    if (primary === previousPrimary) return true;
    if (primary.length >= 4 && previousPrimary.includes(primary)) return true;
    return previousPrimary.length >= 4 && primary.includes(previousPrimary);
  });
}

function collectPreviousMealFoods(dateContext, planIndex = null, mealIndex = null) {
  const summaries = Array.isArray(dateContext?.previousPlanSummaries)
    ? dateContext.previousPlanSummaries
    : [];

  return summaries.flatMap(summary => (
    (Array.isArray(summary?.plans) ? summary.plans : []).flatMap((plan, currentPlanIndex) => {
      if (planIndex !== null && currentPlanIndex !== planIndex) return [];
      const meals = Array.isArray(plan?.meals) ? plan.meals : [];
      if (mealIndex !== null) return meals[mealIndex] ? [meals[mealIndex]] : [];
      return meals;
    })
  )).filter(Boolean);
}

function selectDateRotatedMeal(meal, planIndex, mealIndex, seed, previousFoods = []) {
  if (mealHasPinnedConstraint(planIndex, meal.name)) return meal.food;

  const profile = state.formData;
  const candidates = getMealReplacementOptions(meal.name, profile, planIndex)
    .filter(option => (
      !dishMatchesDeleted(option)
      && !dishViolatesAvoids(option, profile)
    ));
  if (!candidates.length) return meal.food;

  const freshCandidates = candidates.filter(option => !mealLooksRepeated(option, previousFoods));
  const list = freshCandidates.length ? freshCandidates : candidates;
  const currentPrimary = normalizeDishText(getMealPrimaryDish(meal.food));
  const offset = Math.abs(seed + planIndex * 11 + mealIndex * 7) % list.length;

  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[(offset + i) % list.length];
    if (normalizeDishText(getMealPrimaryDish(candidate)) !== currentPrimary) {
      return candidate;
    }
  }

  return list[offset] || meal.food;
}

function appendDateSideDish(food, extra) {
  const dishes = splitMealDishes(food);
  const hasExtra = dishes.some(dish => normalizeDishText(dish) === normalizeDishText(extra));
  return hasExtra ? joinMealDishes(dishes) : joinMealDishes([...dishes, extra]);
}

function applyPlanDateVariation(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate || getTodayIsoDate());
  const revisionOffset = Number(state.planConstraints?.revision || 0) * 17;
  const seed = getPlanDateSeed(normalizedDate) + revisionOffset;
  const weekday = getPlanWeekday(normalizedDate);
  const dateText = formatPlanDateShort(normalizedDate);
  const dateContext = options.dateContext || buildPlanDateContext(normalizedDate, options);
  const additions = {
    "早餐": ["奇亚籽5g", "蓝莓50g", "焯菠菜80g", "无糖黑咖啡1杯", "猕猴桃半个"],
    "午餐": ["冬瓜海带汤1碗", "凉拌番茄120g", "紫菜蛋花汤1碗", "清炒生菜150g", "菌菇汤1碗"],
    "晚餐": ["蒸南瓜80g", "番茄豆腐汤1碗", "清炒油麦菜150g", "凉拌秋葵100g", "萝卜海带汤1碗"],
    "加餐": ["无糖茶1杯", "小番茄100g", "苹果半个", "黄瓜条120g", "柚子2瓣"]
  };

  state.plans.forEach((plan, planIndex) => {
    plan.planDate = normalizedDate;
    const baseSub = String(plan.sub || "多 Agent 生成").replace(/\s*·\s*\d{2}\/\d{2}.*$/, "");
    plan.sub = `${baseSub} · ${dateText} ${weekday}`;
    plan.meals = plan.meals.map((meal, mealIndex) => {
      const additionOptions = additions[meal.name] || additions["加餐"];
      const extra = additionOptions[(seed + planIndex + mealIndex) % additionOptions.length];
      const previousFoods = collectPreviousMealFoods(dateContext, planIndex, mealIndex);
      const baseFood = selectDateRotatedMeal(meal, planIndex, mealIndex, seed, previousFoods);
      return {
        ...meal,
        planDate: normalizedDate,
        food: appendDateSideDish(baseFood, extra)
      };
    });
    if (options.resetIngredients) {
      plan.ingredients = {};
    }
  });
}

function ensureCrossDateMenuDiversity(planDate, options = {}) {
  const normalizedDate = normalizeIsoDate(planDate || getTodayIsoDate());
  const dateContext = options.dateContext || buildPlanDateContext(normalizedDate, options);
  const revisionOffset = Number(state.planConstraints?.revision || 0) * 17;
  const seed = getPlanDateSeed(normalizedDate) + revisionOffset + 37;
  let changed = false;

  state.plans.forEach((plan, planIndex) => {
    let planChanged = false;
    plan.planDate = normalizedDate;
    plan.meals = plan.meals.map((meal, mealIndex) => {
      const previousFoods = collectPreviousMealFoods(dateContext, planIndex, mealIndex);
      if (!mealLooksRepeated(meal.food, previousFoods)) {
        return { ...meal, planDate: normalizedDate };
      }

      const replacement = selectDateRotatedMeal(meal, planIndex, mealIndex, seed, previousFoods);
      if (normalizeDishText(replacement) === normalizeDishText(meal.food)) {
        return { ...meal, planDate: normalizedDate };
      }

      changed = true;
      planChanged = true;
      return {
        ...meal,
        planDate: normalizedDate,
        food: replacement,
        replacedByAgent: true
      };
    });

    if (planChanged) {
      plan.ingredients = {};
    }
  });

  if (changed) {
    addSystemLog("diet", `${formatPlanDateLabel(normalizedDate)} 已根据前几天菜单自动调整重复主餐。`);
  }
}

function finalizeGeneratedPlans(options = {}) {
  state.plans = ensurePlanNamesUseAngles(state.plans);
  state.plans = calibratePlanScoresByAngle(state.plans);
  state.plans.forEach((plan, planIndex) => {
    plan.meals = plan.meals.map((meal, mealIndex) => ({
      ...meal,
      id: meal.id || createMealId(planIndex, meal.name, mealIndex),
      deleted: false,
      replacedByAgent: false
    }));
  });

  applyPlanConstraintsToGeneratedPlans();

  state.plans.forEach((plan, planIndex) => {
    plan.agentScore = calculatePlanAgentScore(plan, planIndex);
    plan.agentNotes = buildPlanAgentNotes(plan);
    plan.ingredients = buildIngredientsFromMeals(plan, state.formData);
  });

  state.planDiscussion = buildPlanGenerationDiscussion(options);
  saveDataRecord("diet.planDiscussion.current", state.planDiscussion);
}

function createMealId(planIndex, mealName, mealIndex) {
  return `plan-${planIndex}-${mealIndex}-${mealName}`;
}

function createConstraintId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeDishText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()（）[\]【】,，.。;；:：]/g, "")
    .toLowerCase();
}

function splitMealDishes(food) {
  return String(food || "")
    .split(/\s*[+＋]\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function joinMealDishes(dishes) {
  return dishes.filter(Boolean).join(" + ");
}

function findPinnedDish(planIndex, mealName, dishIndex) {
  return state.planConstraints.pinnedDishes.find(item => (
    item.planIndex === planIndex
    && item.mealName === mealName
    && item.dishIndex === dishIndex
  ));
}

function isDishPinned(planIndex, mealName, dishIndex) {
  return Boolean(findPinnedDish(planIndex, mealName, dishIndex));
}

function dishMatchesDeleted(food) {
  const normalized = normalizeDishText(food);
  return state.planConstraints.deletedDishes.some(item => {
    const deleted = normalizeDishText(item.food);
    return normalized === deleted || normalized.includes(deleted) || deleted.includes(normalized);
  });
}

function getProfileAvoidTerms(profile = state.formData) {
  const allergyTerms = {
    seafood: ["海鲜", "虾", "蟹", "贝类", "鲈鱼", "三文鱼", "金枪鱼"],
    dairy: ["乳制品", "牛奶", "酸奶", "奶酪", "水牛奶酪", "燕麦奶"],
    nuts: ["坚果", "扁桃仁", "花生"],
    gluten: ["全麦", "面包", "面条", "小麦", "麸质"],
    "beef-pork": ["牛肉", "猪肉", "牛腩", "猪里脊"]
  };

  const terms = [];
  (profile.allergies || []).forEach(item => {
    terms.push(...(allergyTerms[item] || []));
  });
  terms.push(...(profile.extraProfile?.avoids || []));
  return Array.from(new Set(terms.filter(Boolean)));
}

function dishViolatesAvoids(food, profile = state.formData) {
  const normalized = normalizeDishText(food);
  return getProfileAvoidTerms(profile).some(term => normalized.includes(normalizeDishText(term)));
}

function applyPlanConstraintsToGeneratedPlans() {
  state.plans.forEach((plan, planIndex) => {
    plan.meals = plan.meals.map((meal, mealIndex) => {
      let replacedCount = 0;
      const dishes = splitMealDishes(meal.food).map((dish, dishIndex) => {
        const pinned = findPinnedDish(planIndex, meal.name, dishIndex);
        if (pinned) return pinned.food;

        if (dishMatchesDeleted(dish) || dishViolatesAvoids(dish)) {
          replacedCount += 1;
          return selectReplacementDish(planIndex, mealIndex, dishIndex, meal.name, dish);
        }

        return dish;
      });

      return {
        ...meal,
        food: joinMealDishes(dishes),
        id: meal.id || createMealId(planIndex, meal.name, mealIndex),
        pinned: dishes.some((_, dishIndex) => isDishPinned(planIndex, meal.name, dishIndex)),
        deleted: false,
        replacedByAgent: replacedCount > 0,
        replacedDishCount: replacedCount
      };
    });
  });
}

function selectReplacementDish(planIndex, mealIndex, dishIndex, mealName, currentDish) {
  const profile = state.formData;
  const options = getDishReplacementOptions(mealName, profile, planIndex);
  const likes = profile.extraProfile?.likes || [];
  const filtered = options.filter(option => (
    !dishMatchesDeleted(option)
    && !dishViolatesAvoids(option, profile)
    && normalizeDishText(option) !== normalizeDishText(currentDish)
    && !state.planConstraints.pinnedDishes.some(item => normalizeDishText(item.food) === normalizeDishText(option))
  ));

  const likedOptions = filtered.filter(option => (
    likes.some(like => normalizeDishText(option).includes(normalizeDishText(like)))
  ));
  const candidates = likedOptions.length ? likedOptions : filtered;
  const fallback = profile.dietHabit === "vegan"
    ? "豆腐菌菇时蔬碗"
    : "香煎鸡胸时蔬碗";
  const list = candidates.length ? candidates : [fallback];
  const offset = (state.planConstraints.revision + planIndex + mealIndex + dishIndex) % list.length;

  return list[offset];
}

function getDishReplacementOptions(mealName, profile, planIndex) {
  return getMealReplacementOptions(mealName, profile, planIndex)
    .flatMap(option => splitMealDishes(option))
    .map(item => item.trim())
    .filter(Boolean);
}

function getMealReplacementOptions(mealName, profile, planIndex) {
  const avoidDairy = profile.allergies?.includes("dairy");
  const avoidGluten = profile.allergies?.includes("gluten");
  const isVegan = profile.dietHabit === "vegan";
  const protein = isVegan ? "香煎豆腐" : "去皮鸡胸肉";
  const drink = avoidDairy || isVegan ? "无糖豆浆" : "低脂酸奶";
  const grain = avoidGluten ? "藜麦饭" : "全麦饭团";
  const warmGrain = avoidGluten ? "糙米饭" : "杂粮饭";
  const quickGrain = avoidGluten ? "玉米段" : "全麦贝果半个";
  const proteinAlt = isVegan ? "鹰嘴豆" : "鸡蛋白";
  const proteinLight = isVegan ? "毛豆仁" : "低脂鸡肉丁";
  const regionFlavor = {
    south: ["清蒸", "白灼", "荷塘"],
    north: ["番茄炖", "葱香", "杂粮"],
    sichuan: ["椒麻少油", "鲜椒", "凉拌"],
    western: ["香草柠檬", "番茄罗勒", "藜麦沙拉"]
  }[profile.region] || ["清爽"];

  const breakfast = [
    `${drink}1杯 + ${avoidGluten ? "蒸紫薯" : "燕麦"} + ${isVegan ? "卤水豆腐" : "水煮蛋"}`,
    `${grain} + 圣女果 + ${drink}`,
    `${isVegan ? "鹰嘴豆泥" : "鸡蛋蔬菜卷"} + 黄瓜条 + 无糖茶`,
    `${avoidGluten ? "南瓜藜麦粥" : "燕麦鸡蛋杯"} + 焯青菜 + 无糖茶`,
    `${isVegan ? "豆腐蔬菜卷" : "鸡胸蔬菜卷"} + 小番茄 + ${drink}`,
    `${avoidGluten ? "红薯块" : "全麦吐司1片"} + ${proteinAlt} + 生菜`,
    `${avoidGluten ? "玉米燕麦糊" : "杂粮馒头半个"} + ${isVegan ? "拌豆腐" : "蒸蛋羹"} + 黄瓜条`
  ];
  const lunch = [
    `${regionFlavor[0]}${protein}配西兰花 + ${avoidGluten ? "糙米饭" : "杂粮饭"}`,
    `${regionFlavor[1] || "清炒"}菌菇时蔬 + ${isVegan ? "毛豆" : "鸡肉丁"}`,
    `番茄豆腐${isVegan ? "鹰嘴豆" : "鸡肉"}碗 + 凉拌黄瓜`,
    `${regionFlavor[2] || "清爽"}莲藕荷兰豆 + ${proteinLight} + ${warmGrain}`,
    `冬瓜菌菇汤 + ${isVegan ? "香煎豆腐" : "香煎鸡胸"} + ${avoidGluten ? "藜麦饭" : "荞麦面小份"}`,
    `彩椒西兰花炒${isVegan ? "豆干" : "鸡蛋白"} + ${quickGrain}`,
    `番茄生菜能量碗 + ${isVegan ? "鹰嘴豆" : "鸡胸肉丝"} + ${warmGrain}`
  ];
  const dinner = [
    `${regionFlavor[2] || "清爽"}时蔬汤 + ${protein}`,
    `番茄菌菇豆腐汤 + ${avoidGluten ? "玉米" : "小份杂粮面"}`,
    `${isVegan ? "豆腐藜麦沙拉" : "柠檬鸡肉沙拉"} + 水煮菜心`,
    `丝瓜蛋白汤 + ${isVegan ? "毛豆拌菜" : "鸡肉蔬菜碗"}`,
    `蒸南瓜 + 清炒油麦菜 + ${isVegan ? "豆腐块" : "鸡蛋羹"}`,
    `冬瓜海带汤 + ${isVegan ? "鹰嘴豆沙拉" : "鸡胸肉片"} + 小份${avoidGluten ? "糙米饭" : "杂粮饭"}`,
    `菌菇青菜汤 + ${isVegan ? "豆干丝" : "低脂鸡肉丸"} + 凉拌黄瓜`
  ];
  const snack = [
    "小番茄 + 无糖茶",
    avoidDairy || isVegan ? "无糖椰子酸奶" : "希腊酸奶",
    "苹果半个 + 黄瓜条",
    "猕猴桃半个 + 温水",
    "黄瓜条 + 无糖黑咖啡",
    "蓝莓50g + 无糖茶",
    avoidDairy || isVegan ? "无糖豆浆半杯" : "低脂奶酪小份"
  ];

  if (mealName.includes("早餐")) return breakfast;
  if (mealName.includes("午餐")) return lunch;
  if (mealName.includes("晚餐")) return dinner;
  return snack;
}

function calculatePlanAgentScore(plan, planIndex) {
  const mealsText = plan.meals.map(meal => meal.food).join(" ");
  const calorieFit = clampScore(100 - Math.abs((plan.calories || 0) - (state.targetCalories || plan.calories)) / 12);
  const likeCount = (state.formData.extraProfile?.likes || []).filter(term => mealsText.includes(term)).length;
  const avoidCount = getProfileAvoidTerms().filter(term => mealsText.includes(term)).length;
  const pinnedMatches = state.planConstraints.pinnedDishes.filter(item => item.planIndex === planIndex).length;
  const normalizedMealsText = normalizeDishText(mealsText);
  const deletedViolations = state.planConstraints.deletedDishes.filter(item => (
    normalizedMealsText.includes(normalizeDishText(item.food))
  )).length;
  const preferenceFit = clampScore(78 + likeCount * 6 - avoidCount * 10 - deletedViolations * 18);
  const executionFit = clampScore((plan.scores.cost * 0.36) + (plan.scores.season * 0.34) + (plan.scores.region * 0.3) + pinnedMatches * 3);
  return clampScore(calorieFit * 0.36 + preferenceFit * 0.32 + executionFit * 0.32);
}

function buildPlanAgentNotes(plan) {
  const replacements = plan.meals.reduce((sum, meal) => sum + (meal.replacedDishCount || 0), 0);
  if (replacements > 0) return `已按删除/忌口约束替换 ${replacements} 个菜品`;
  if (plan.agentScore >= 88) return "营养、偏好和执行约束匹配较高";
  return "可继续通过固定或删除菜品细化";
}

function buildPlanGenerationDiscussion(options = {}) {
  const pinnedCount = state.planConstraints.pinnedDishes.length;
  const deletedCount = state.planConstraints.deletedDishes.length;
  const extraText = hasAdditionalProfile(state.formData.extraProfile)
    ? buildExtraProfileSummary(state.formData.extraProfile)
    : "无额外文本";
  const bestPlan = state.plans.reduce((best, plan) => (
    !best || plan.agentScore > best.agentScore ? plan : best
  ), null);

  const agents = [
    {
      name: "营养约束 Agent",
      role: "热量、宏量营养、过敏安全",
      opinion: `以 ${state.targetCalories || "--"} kcal 为目标，优先排除过敏/忌口项，并检查蛋白、碳水、脂肪比例。`
    },
    {
      name: "偏好体验 Agent",
      role: "口味、生活习惯、执行难度",
      opinion: `参考补充信息：${extraText}。保留用户喜欢且易执行的餐次，降低重复和不爱吃食材。`
    },
    {
      name: "约束协调 Agent",
      role: "固定菜品、删除菜品、重新生成策略",
      opinion: `当前固定 ${pinnedCount} 道菜，删除 ${deletedCount} 道菜；固定项优先保留，删除项进入全局排除列表。`
    }
  ];

  const consensus = bestPlan
    ? `第 ${state.planConstraints.revision + 1} 轮讨论完成，当前共识最高的是「${bestPlan.name}」（${bestPlan.agentScore} 分）。${options.reason === "regenerate" ? "本轮已按固定与删除约束重新生成。" : "初始方案已生成，可继续固定或删除菜品细化。"}`
    : "等待生成方案。";

  return {
    agents,
    consensus,
    revision: state.planConstraints.revision,
    reason: options.reason || "initial",
    updatedAt: new Date().toISOString()
  };
}

function buildIngredientsFromMeals(plan, profile) {
  const text = plan.meals.map(meal => meal.food).join(" ");
  const matchCatalog = (catalog, fallback) => {
    const items = catalog
      .filter(item => item.keys.some(key => text.includes(key)))
      .map(item => ({ name: item.name, qty: item.qty }));
    return items.length ? uniqueIngredientItems(items).slice(0, 4) : fallback;
  };

  return {
    meat: matchCatalog([
      { keys: ["鸡胸", "鸡肉", "鸡丁", "蒸鸡"], name: "去皮鸡胸肉", qty: "180g" },
      { keys: ["豆腐", "素鸡"], name: "北豆腐/素鸡", qty: "180g" },
      { keys: ["鸡蛋", "水煮蛋"], name: "柴鸡蛋", qty: "1个" },
      { keys: ["牛肉", "牛腩"], name: "牛肉", qty: "120g" },
      { keys: ["鱼", "鲈鱼", "三文鱼", "金枪鱼"], name: "鱼类蛋白", qty: "150g" },
      { keys: ["虾"], name: "虾仁", qty: "100g" },
      { keys: ["鹰嘴豆", "毛豆"], name: "豆类蛋白", qty: "120g" }
    ], profile.dietHabit === "vegan" ? [{ name: "豆腐/豆类", qty: "180g" }] : [{ name: "去皮鸡胸肉", qty: "180g" }]),
    veggies: matchCatalog([
      { keys: ["西兰花"], name: "西兰花", qty: "150g" },
      { keys: ["番茄", "圣女果", "小番茄"], name: "番茄", qty: "150g" },
      { keys: ["黄瓜"], name: "黄瓜", qty: "150g" },
      { keys: ["菌菇", "香菇", "蘑菇"], name: "菌菇", qty: "100g" },
      { keys: ["菜心", "生菜", "时蔬"], name: "时令绿叶菜", qty: "200g" },
      { keys: ["木耳"], name: "黑木耳", qty: "30g" }
    ], [{ name: "时令蔬菜", qty: "350g" }]),
    grains: matchCatalog([
      { keys: ["燕麦"], name: "燕麦", qty: "50g" },
      { keys: ["紫薯", "红薯"], name: "薯类主食", qty: "150g" },
      { keys: ["糙米", "杂粮", "藜麦"], name: "杂粮/藜麦", qty: "80g" },
      { keys: ["玉米"], name: "玉米", qty: "1根" },
      { keys: ["面包", "全麦"], name: "全麦制品", qty: "60g" }
    ], [{ name: profile.allergies?.includes("gluten") ? "藜麦/玉米" : "杂粮主食", qty: "80g" }]),
    seasonings: [
      { name: "橄榄油/亚麻籽油", qty: "10ml" },
      { name: "低钠盐/香醋/黑胡椒", qty: "少量" }
    ]
  };
}

function uniqueIngredientItems(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function getPlanBlueprints(goal, dietHabit) {
  if (dietHabit === "vegan") {
    return [
      {
        name: "植物蛋白轻盈餐",
        sub: "以豆制品、菌菇和低 GI 主食构成的清爽纯素方案",
        calorieFactor: goal === "gain-muscle" ? 1.02 : 0.95,
        macros: { carbs: 38, protein: 32, fat: 30 }
      },
      {
        name: "高纤谷豆饱腹餐",
        sub: "谷物、豆类与时令蔬菜组合，强调饱腹和稳定能量",
        calorieFactor: 1,
        macros: { carbs: 52, protein: 24, fat: 24 }
      },
      {
        name: "纯素优脂时令餐",
        sub: "橄榄油、坚果替代和番茄类食材提升抗氧化摄入",
        calorieFactor: 1.04,
        macros: { carbs: 42, protein: 24, fat: 34 }
      }
    ];
  }

  if (goal === "gain-muscle") {
    return [
      {
        name: "高蛋白训练修复餐",
        sub: "提高优质蛋白摄入，适合训练日肌肉修复",
        calorieFactor: 1.05,
        macros: { carbs: 40, protein: 35, fat: 25 }
      },
      {
        name: "复合碳水恢复餐",
        sub: "用慢糖谷物和高纤蔬菜支持训练后的糖原恢复",
        calorieFactor: 1,
        macros: { carbs: 48, protein: 32, fat: 20 }
      },
      {
        name: "优脂增肌能量餐",
        sub: "用优质脂肪和高密度蛋白提升热量质量",
        calorieFactor: 1.1,
        macros: { carbs: 35, protein: 33, fat: 32 }
      }
    ];
  }

  if (goal === "low-gi" || dietHabit === "low-carb") {
    return [
      {
        name: "低 GI 稳糖低碳餐",
        sub: "控制精制碳水，用蛋白和优质脂肪稳定餐后血糖",
        calorieFactor: 0.95,
        macros: { carbs: 28, protein: 38, fat: 34 }
      },
      {
        name: "高纤慢糖平衡餐",
        sub: "保留必要复合碳水，提升膳食纤维和饱腹感",
        calorieFactor: 1,
        macros: { carbs: 42, protein: 32, fat: 26 }
      },
      {
        name: "优脂轻食稳糖餐",
        sub: "以番茄、橄榄油和低加工主食构建温和控糖餐",
        calorieFactor: 1.02,
        macros: { carbs: 35, protein: 30, fat: 35 }
      }
    ];
  }

  if (dietHabit === "mediterranean") {
    return [
      {
        name: "控脂高蛋白地中海餐",
        sub: "在热量可控前提下提高鱼禽和蔬菜占比",
        calorieFactor: 0.96,
        macros: { carbs: 35, protein: 35, fat: 30 }
      },
      {
        name: "全谷高纤地中海餐",
        sub: "用全谷物和时令果蔬提供稳定饱腹感",
        calorieFactor: 1,
        macros: { carbs: 48, protein: 28, fat: 24 }
      },
      {
        name: "经典优脂地中海餐",
        sub: "突出橄榄油、番茄、鱼类和坚果的抗氧化优势",
        calorieFactor: 1.04,
        macros: { carbs: 38, protein: 28, fat: 34 }
      }
    ];
  }

  return [
    {
      name: "高蛋白稳态减脂餐",
      sub: "专注控制升糖与胰岛素，适合减碳需求",
      calorieFactor: 0.95,
      macros: { carbs: 25, protein: 45, fat: 30 }
    },
    {
      name: "高纤慢糖饱腹餐",
      sub: "以复合谷物与高膳食纤维为主，饱腹感强",
      calorieFactor: 1,
      macros: { carbs: 50, protein: 30, fat: 20 }
    },
    {
      name: "优脂时令轻食餐",
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
      label: "计划日期",
      value: `${getPlanPeriodLabel()} · ${formatPlanDateLabel(state.dietCalendar.selectedDate)}`,
      meta: `起始：${formatPlanDateLabel(state.dietCalendar.startDate)}`
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

  if (hasAdditionalProfile(f.extraProfile)) {
    profileItems.push({
      label: "补充参考",
      value: buildExtraProfileSummary(f.extraProfile),
      meta: "已同步给后续 Agent"
    });
  }

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
  renderPlanCalendarControls();
  renderPlanAgentPanel();

  const container = document.getElementById("plansSelectorTabs");
  if (!container) return;
  container.innerHTML = "";

  if (!state.plans.length) {
    renderPendingDietPlanState();
    return;
  }
  
  state.plans.forEach((plan, idx) => {
    const tab = document.createElement("div");
    tab.className = `plan-tab ${idx === state.activePlanIndex ? "active" : ""}`;
    tab.innerHTML = `
      <div class="plan-tab-title">${formatPlanLabelName(plan, idx)}</div>
      <div class="plan-tab-sub">${plan.calories} kcal | ${plan.angleLabel || getPlanAngleMeta(idx).label} | ${plan.sub}</div>
      <div class="plan-tab-score">Agent 共识 ${plan.agentScore || "--"} 分</div>
    `;
    tab.addEventListener("click", () => {
      state.activePlanIndex = idx;
      // 刷新 Tab 高亮
      document.querySelectorAll(".plan-tab").forEach((t, i) => {
        if (i === idx) t.classList.add("active");
        else t.classList.remove("active");
      });
      showPlanDetails(idx);
      addSystemLog("diet", `用户切换查看【${formatPlanLabelName(plan, idx)}】的详细三餐构成。`);
    });
    container.appendChild(tab);
  });

  showPlanDetails(state.activePlanIndex);
}

function renderPendingDietPlanState() {
  const visibleDate = getVisiblePlanDate();
  const statusInfo = getPlanGenerationEntry(visibleDate);
  const statusLabel = getPlanGenerationLabel(statusInfo.status) || (state.dietCalendar.loading ? "生成中" : "尚未生成");
  const messageMap = {
    queued: "该日期已进入后台队列，生成完成后会自动显示。",
    generating: "该日期正在生成，当前页面会在完成后自动刷新。",
    failed: statusInfo.message || "该日期生成失败，请点击重新生成当天。",
    saved: "该日期计划已保存，正在读取详情。"
  };
  const message = messageMap[statusInfo.status] || "该日期还没有可展示的饮食方案。";

  const tabs = document.getElementById("plansSelectorTabs");
  const mealsContainer = document.getElementById("mealsListContainer");
  const totalKcal = document.getElementById("totalKcalVal");
  const chartSvg = document.getElementById("macroPieChart");
  const legend = document.getElementById("macroLegend");

  if (tabs) {
    tabs.innerHTML = `
      <div class="plan-tab plan-tab-placeholder">
        <div class="plan-tab-title">${formatPlanDateLabel(visibleDate)} · ${statusLabel}</div>
        <div class="plan-tab-sub">${message}</div>
      </div>
    `;
  }

  if (mealsContainer) {
    mealsContainer.innerHTML = `
      <div class="plan-pending-card">
        <strong>${formatPlanDateLabel(visibleDate)} ${statusLabel}</strong>
        <span>${message}</span>
      </div>
    `;
  }

  if (totalKcal) totalKcal.innerText = "--";
  if (chartSvg) {
    chartSvg.innerHTML = `<circle cx="50" cy="50" r="40" fill="transparent" stroke="#1f2937" stroke-width="12"></circle>`;
  }
  if (legend) {
    legend.innerHTML = `
      <div class="macro-empty">等待当前日期计划生成后展示营养结构</div>
    `;
  }
}

function renderPlanAgentPanel() {
  renderPlanConstraintList();
  const grid = document.getElementById("planDiscussionGrid");
  if (!grid) return;

  grid.innerHTML = "";
  const discussion = state.planDiscussion;
  if (!discussion.agents?.length) {
    const empty = document.createElement("div");
    empty.className = "plan-agent-consensus";
    empty.innerText = "提交问卷后，多 Agent 会基于画像、偏好、固定菜品和删除菜品给出方案。";
    grid.appendChild(empty);
    return;
  }

  discussion.agents.forEach(agent => {
    const card = document.createElement("article");
    card.className = "plan-agent-card";
    const name = document.createElement("strong");
    name.innerText = agent.name;
    const role = document.createElement("span");
    role.innerText = agent.role;
    const opinion = document.createElement("p");
    opinion.innerText = agent.opinion;
    card.appendChild(name);
    card.appendChild(role);
    card.appendChild(opinion);
    grid.appendChild(card);
  });

  const consensus = document.createElement("div");
  consensus.className = "plan-agent-consensus";
  consensus.innerText = discussion.consensus;
  grid.appendChild(consensus);
}

function renderPlanConstraintList() {
  const container = document.getElementById("planConstraintList");
  if (!container) return;

  container.innerHTML = "";
  const constraints = [
    ...state.planConstraints.pinnedDishes.map(item => ({ ...item, type: "fixed", label: "固定" })),
    ...state.planConstraints.deletedDishes.map(item => ({ ...item, type: "deleted", label: "删除" }))
  ];

  if (!constraints.length) {
    const empty = document.createElement("span");
    empty.className = "constraint-empty";
    empty.innerText = "暂无固定或删除菜品";
    container.appendChild(empty);
    return;
  }

  constraints.forEach(item => {
    const chip = document.createElement("span");
    chip.className = `constraint-chip ${item.type}`;
    const text = document.createElement("span");
    const position = item.mealName ? `${item.mealName} / 菜品 ${Number(item.dishIndex ?? 0) + 1}` : "菜品";
    text.innerText = `${item.label}：${position} · ${item.food}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = "×";
    btn.title = "移除约束";
    btn.addEventListener("click", () => removePlanConstraint(item.type, item.id));
    chip.appendChild(text);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function persistPlanConstraints() {
  saveDataRecord("diet.planConstraints.current", state.planConstraints);
}

function togglePinnedDish(planIndex, mealIndex, dishIndex) {
  const plan = state.plans[planIndex];
  const meal = plan?.meals?.[mealIndex];
  const dish = splitMealDishes(meal?.food)[dishIndex];
  if (!plan || !meal || !dish || dishMatchesDeleted(dish)) return;

  const existingIndex = state.planConstraints.pinnedDishes.findIndex(item => (
    item.planIndex === planIndex
    && item.mealName === meal.name
    && item.dishIndex === dishIndex
  ));

  if (existingIndex >= 0) {
    const [removed] = state.planConstraints.pinnedDishes.splice(existingIndex, 1);
    addSystemLog("diet", `已取消固定菜品：${removed.food}`);
  } else {
    state.planConstraints.pinnedDishes.push({
      id: createConstraintId("pin"),
      planIndex,
      planName: plan.name,
      mealName: meal.name,
      dishIndex,
      food: dish,
      cals: meal.cals,
      icon: meal.icon,
      pinnedAt: new Date().toISOString()
    });
    addSystemLog("diet", `已固定【${meal.name}】中的菜品：${dish}。重新生成当天时将保留该菜品。`);
  }

  persistPlanConstraints();
  renderPlanAgentPanel();
  showPlanDetails(planIndex);
}

function markDishDeleted(planIndex, mealIndex, dishIndex) {
  const plan = state.plans[planIndex];
  const meal = plan?.meals?.[mealIndex];
  const dish = splitMealDishes(meal?.food)[dishIndex];
  if (!plan || !meal || !dish) return;

  state.planConstraints.pinnedDishes = state.planConstraints.pinnedDishes.filter(item => !(
    item.planIndex === planIndex
    && item.mealName === meal.name
    && item.dishIndex === dishIndex
  ));

  const alreadyDeleted = state.planConstraints.deletedDishes.some(item => (
    normalizeDishText(item.food) === normalizeDishText(dish)
  ));
  if (!alreadyDeleted) {
    state.planConstraints.deletedDishes.push({
      id: createConstraintId("delete"),
      planIndex,
      planName: plan.name,
      mealName: meal.name,
      dishIndex,
      food: dish,
      deletedAt: new Date().toISOString()
    });
  }

  addSystemLog("diet", `已删除【${plan.name} - ${meal.name}】中的菜品：${dish}。重新生成当天时将只替换该菜品。`);
  persistPlanConstraints();
  renderPlanAgentPanel();
  showPlanDetails(planIndex);
}

async function replaceDishOnce(planIndex, mealIndex, dishIndex) {
  const plan = state.plans[planIndex];
  const meal = plan?.meals?.[mealIndex];
  const dishes = splitMealDishes(meal?.food);
  const dish = dishes[dishIndex];
  if (!plan || !meal || !dish) return;
  if (isDishPinned(planIndex, meal.name, dishIndex)) {
    addSystemLog("diet", "该菜品已固定，取消固定后才能一键替换。");
    return;
  }

  state.planConstraints.revision += 1;
  const replacement = selectReplacementDish(planIndex, mealIndex, dishIndex, meal.name, dish);
  dishes[dishIndex] = replacement;
  plan.meals[mealIndex] = {
    ...meal,
    food: joinMealDishes(dishes),
    replacedByAgent: true,
    oneClickReplacedAt: new Date().toISOString()
  };
  plan.ingredients = buildIngredientsFromMeals(plan, state.formData);
  plan.agentScore = calculatePlanAgentScore(plan, planIndex);
  plan.agentNotes = `已一键替换「${dish}」为「${replacement}」`;
  state.planDiscussion = buildPlanGenerationDiscussion({ reason: "one-click-replace" });

  const planDate = getVisiblePlanDate();
  const snapshot = createDietPlanSnapshot(planDate, "local");
  await persistDietPlanSnapshot(snapshot, { silent: true });
  saveDataRecord("diet.plans.current", state.plans);
  renderPlanAgentPanel();
  showPlanDetails(planIndex);
  renderPlanCalendarControls();
  if (state.currentStep === 3) evaluatePlansRealtime();
  if (state.currentStep === 4) renderIngredients();
  addSystemLog("diet", `${formatPlanDateLabel(planDate)} 已替换菜品：${dish} → ${replacement}。`);
}

function removePlanConstraint(type, id) {
  if (type === "fixed") {
    state.planConstraints.pinnedDishes = state.planConstraints.pinnedDishes.filter(item => item.id !== id);
  } else {
    state.planConstraints.deletedDishes = state.planConstraints.deletedDishes.filter(item => item.id !== id);
  }
  addSystemLog("diet", "已移除一个菜品约束。");
  persistPlanConstraints();
  renderPlanAgentPanel();
  renderDietPlans();
}

async function handleRegeneratePlans() {
  if (!state.formData?.age) {
    addSystemLog("diet", "请先完成基础问卷，再重新生成当天方案。");
    return;
  }

  const planDate = state.dietCalendar.selectedDate || state.dietCalendar.startDate || getTodayIsoDate();
  const btn = document.getElementById("regeneratePlansBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "讨论中...";
  }

  state.planConstraints.revision += 1;
  state.aiDebate = { reviews: [], consensus: [] };
  addSystemLog("switch", `已提交 ${formatPlanDateLabel(planDate)} 重新生成请求：携带当前画像、补充文本、固定菜品与删除菜品。`);
  addSystemLog("diet", "多 Agent 正在重新讨论当天膳食方案。");

  try {
    let snapshot = await generateDietPlanSnapshotForDateAsync(planDate, {
      reason: "regenerate",
      planConstraints: state.planConstraints,
      rangeDates: getPlanDateRange()
    });
    const result = await persistDietPlanSnapshot(snapshot);
    snapshot = result.snapshot;
    applyDietPlanSnapshot(snapshot);
    state.activePlanIndex = Math.min(state.activePlanIndex, state.plans.length - 1);
    state.selectedPlanIndex = 0;
    saveDataRecord("diet.plans.current", state.plans);
    saveDataRecord("diet.planConstraints.current", state.planConstraints);
    renderDietPlans();
    addSystemLog("diet", `${formatPlanDateLabel(planDate)} 重新生成完成：${state.planDiscussion.consensus}`);
  } catch (err) {
    addSystemLog("diet", `重新生成失败：${err.message || "未知错误"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "重新生成当天";
    }
  }
}

// 显示所选方案的三餐与营养配比图表
function showPlanDetails(idx) {
  const plan = state.plans[idx];
  if (!plan) {
    renderPendingDietPlanState();
    return;
  }
  
  // 1. 三餐渲染
  const mealsContainer = document.getElementById("mealsListContainer");
  const totalKcal = document.getElementById("totalKcalVal");
  const chartSvg = document.getElementById("macroPieChart");
  const legend = document.getElementById("macroLegend");
  if (!mealsContainer || !totalKcal || !chartSvg || !legend) return;

  mealsContainer.innerHTML = "";
  
  plan.meals.forEach((meal, mealIndex) => {
    const dishes = splitMealDishes(meal.food);
    const hasPinnedDish = dishes.some((_, dishIndex) => isDishPinned(idx, meal.name, dishIndex));
    const hasDeletedDish = dishes.some(dish => dishMatchesDeleted(dish));
    const card = document.createElement("div");
    card.className = `meal-card ${hasPinnedDish ? "pinned" : ""} ${hasDeletedDish ? "deleted" : ""}`;
    card.innerHTML = `
      <div class="meal-icon">${meal.icon}</div>
      <div class="meal-details">
        <div class="meal-name">${meal.name}</div>
        <div class="dish-list">
          ${dishes.map((dish, dishIndex) => {
            const pinned = isDishPinned(idx, meal.name, dishIndex);
            const deleted = dishMatchesDeleted(dish);
            return `
              <div class="dish-row ${pinned ? "pinned" : ""} ${deleted ? "deleted" : ""}">
                <span class="dish-name">${deleted ? `待替换：${dish}` : dish}</span>
                <span class="dish-actions">
                  <button type="button" class="meal-tool replace" data-action="replace" data-dish-index="${dishIndex}" ${pinned || deleted ? "disabled" : ""}>换一个</button>
                  <button type="button" class="meal-tool ${pinned ? "active" : ""}" data-action="pin" data-dish-index="${dishIndex}" ${deleted ? "disabled" : ""}>${pinned ? "已固定" : "固定"}</button>
                  <button type="button" class="meal-tool delete" data-action="delete" data-dish-index="${dishIndex}" ${pinned || deleted ? "disabled" : ""}>删除</button>
                </span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="meal-cals">${meal.cals}</div>
    `;
    card.querySelectorAll("[data-action='pin']").forEach(button => {
      button.addEventListener("click", () => togglePinnedDish(idx, mealIndex, parseInt(button.dataset.dishIndex)));
    });
    card.querySelectorAll("[data-action='replace']").forEach(button => {
      button.addEventListener("click", () => {
        replaceDishOnce(idx, mealIndex, parseInt(button.dataset.dishIndex))
          .catch(err => addSystemLog("diet", `一键替换失败：${err.message || "未知错误"}`));
      });
    });
    card.querySelectorAll("[data-action='delete']").forEach(button => {
      button.addEventListener("click", () => markDishDeleted(idx, mealIndex, parseInt(button.dataset.dishIndex)));
    });
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

function renderCheckinPanel() {
  const card = document.getElementById("checkinStatusCard");
  const noteInput = document.getElementById("checkinNote");
  const completeBtn = document.getElementById("completeCheckinBtn");
  const skipBtn = document.getElementById("skipCheckinBtn");
  const saveMenuBtn = document.getElementById("saveHistoryMenuBtn");
  const satietyInput = document.getElementById("checkinSatiety");
  const difficultyInput = document.getElementById("checkinDifficulty");
  const ateOutInput = document.getElementById("checkinAteOut");
  if (!card && !noteInput && !completeBtn && !skipBtn && !saveMenuBtn && !satietyInput && !difficultyInput && !ateOutInput) return;

  const planDate = getVisiblePlanDate();
  const activePlan = state.plans[state.activePlanIndex] || state.plans[state.selectedPlanIndex];
  const checkin = state.checkins[planDate] || readLocalDietCheckin(planDate);
  const historyMenu = state.historyMenus[planDate] || readLocalHistoryMenu(planDate);
  if (checkin) state.checkins[planDate] = checkin;
  if (historyMenu) state.historyMenus[planDate] = historyMenu;

  const allowed = isCheckinDateAllowed(planDate);
  const hasMenu = Boolean(activePlan);
  const disabled = !allowed || !hasMenu;
  const activePlanIndex = state.plans.indexOf(activePlan);
  const planName = activePlan ? formatPlanLabelName(activePlan, activePlanIndex >= 0 ? activePlanIndex : 0) : "等待计划生成";

  if (card) {
    const checkinText = checkin
      ? `${getCheckinStatusLabel(checkin.status)} · ${formatDateTime(checkin.checkedAt || checkin.updatedAt)}`
      : "未打卡";
    const menuText = historyMenu
      ? `${historyMenu.dbSaved ? "数据库已保存" : "本地已保存"} · ${formatDateTime(historyMenu.updatedAt)}`
      : "未保存";
    const feedbackText = checkin
      ? getCheckinFeedbackLabel(checkin.feedback)
      : "未记录";
    const restrictionText = allowed
      ? "可保存今日及历史日期的客户打卡与菜单。"
      : "未来日期仅展示计划，不允许写入打卡或历史菜单。";
    card.innerHTML = `
      <div class="checkin-status-row">
        <span>打卡日期</span>
        <strong>${formatPlanDateLabel(planDate)}</strong>
      </div>
      <div class="checkin-status-row">
        <span>客户菜单</span>
        <strong>${planName}</strong>
      </div>
      <div class="checkin-status-row">
        <span>打卡状态</span>
        <strong>${checkinText}</strong>
      </div>
      <div class="checkin-status-row">
        <span>历史菜单</span>
        <strong>${menuText}</strong>
      </div>
      <div class="checkin-status-row">
        <span>执行反馈</span>
        <strong>${feedbackText}</strong>
      </div>
      <div class="checkin-plan-note">${restrictionText}</div>
    `;
  }

  if (noteInput) {
    if (document.activeElement !== noteInput) {
      noteInput.value = checkin?.note || "";
    }
    noteInput.disabled = disabled;
  }

  if (satietyInput) {
    satietyInput.value = checkin?.feedback?.satiety || "just-right";
    satietyInput.disabled = disabled;
  }
  if (difficultyInput) {
    difficultyInput.value = checkin?.feedback?.difficulty || "easy";
    difficultyInput.disabled = disabled;
  }
  if (ateOutInput) {
    ateOutInput.checked = Boolean(checkin?.feedback?.ateOut);
    ateOutInput.disabled = disabled;
  }

  [completeBtn, skipBtn, saveMenuBtn].forEach(button => {
    if (button) button.disabled = disabled;
  });

  if (state.currentStep === 5) {
    renderCustomerHomeCheckin();
  }
}

function getRangeShoppingCategoryLabels() {
  return {
    meat: "肉蛋奶/蛋白",
    veggies: "蔬果",
    grains: "主食谷物",
    seasonings: "油脂调味"
  };
}

function getPlanForRangeShopping(date) {
  const normalizedDate = normalizeIsoDate(date);
  let snapshot = state.dietCalendar.savedDates[normalizedDate] || readLocalDietPlanSnapshot(normalizedDate);
  if (normalizedDate === getVisiblePlanDate() && state.plans.length) {
    snapshot = createDietPlanSnapshot(normalizedDate, "current");
  }
  if (!snapshot?.plans?.length) return null;
  const selectedIndex = Math.min(state.selectedPlanIndex || 0, snapshot.plans.length - 1);
  const plan = snapshot.plans[selectedIndex] || snapshot.plans[0];
  if (!plan) return null;
  const ingredients = hasUsableIngredients(plan.ingredients)
    ? normalizePlanIngredients(plan.ingredients)
    : buildIngredientsFromMeals(plan, snapshot.profile || state.formData);
  return {
    date: normalizedDate,
    planName: formatPlanLabelName(plan, selectedIndex),
    ingredients
  };
}

function buildRangeShoppingList() {
  const dates = getPlanDateRange();
  const categoryLabels = getRangeShoppingCategoryLabels();
  const categories = Object.keys(categoryLabels).reduce((acc, key) => {
    acc[key] = new Map();
    return acc;
  }, {});
  const usedDates = [];

  dates.forEach(date => {
    const item = getPlanForRangeShopping(date);
    if (!item) return;
    usedDates.push(item.date);
    Object.keys(categoryLabels).forEach(category => {
      (item.ingredients[category] || []).forEach(ingredient => {
        const name = String(ingredient.name || "食材").trim();
        if (!name) return;
        const key = normalizeDishText(name);
        const existing = categories[category].get(key) || {
          name,
          quantities: [],
          dates: new Set()
        };
        existing.quantities.push(String(ingredient.qty || "适量"));
        existing.dates.add(item.date);
        categories[category].set(key, existing);
      });
    });
  });

  const output = Object.keys(categoryLabels).reduce((acc, category) => {
    acc[category] = Array.from(categories[category].values()).map(item => {
      const uniqueQty = Array.from(new Set(item.quantities.filter(Boolean)));
      const repeatedQty = uniqueQty.length === 1
        ? `${uniqueQty[0]} × ${item.dates.size}天`
        : uniqueQty.join(" / ");
      return {
        name: item.name,
        qty: repeatedQty || "按天适量",
        dayCount: item.dates.size,
        dates: Array.from(item.dates).sort()
      };
    }).sort((a, b) => b.dayCount - a.dayCount || a.name.localeCompare(b.name));
    return acc;
  }, {});

  return {
    dates,
    usedDates,
    missingCount: Math.max(0, dates.length - usedDates.length),
    categories: output
  };
}

function renderRangeShoppingPanel() {
  const grid = document.getElementById("rangeShoppingGrid");
  const status = document.getElementById("rangeShoppingStatus");
  if (!grid && !status) return;

  if (!hasCommerceFeature("rangeShopping")) {
    if (status) {
      status.textContent = "Pro 会员解锁一周/一个月合并采购清单。";
    }
    if (grid) {
      grid.innerHTML = "";
      const locked = document.createElement("div");
      locked.className = "range-shopping-empty";
      locked.textContent = "当前为免费版，仅展示单日采购清单。开通 Pro 后可合并周期食材并用于套餐采购。";
      grid.appendChild(locked);
    }
    return;
  }

  const data = buildRangeShoppingList();
  const categoryLabels = getRangeShoppingCategoryLabels();
  if (status) {
    status.textContent = `已合并 ${data.usedDates.length}/${data.dates.length} 天；${data.missingCount ? `还有 ${data.missingCount} 天等待生成` : "周期内日期已全部纳入"}`;
  }
  if (!grid) return;
  grid.innerHTML = "";

  const hasAny = Object.values(data.categories).some(items => items.length > 0);
  if (!hasAny) {
    const empty = document.createElement("div");
    empty.className = "range-shopping-empty";
    empty.textContent = "等待周期计划生成后展示合并清单";
    grid.appendChild(empty);
    return;
  }

  Object.entries(categoryLabels).forEach(([category, label]) => {
    const items = data.categories[category] || [];
    const card = document.createElement("article");
    card.className = "range-shopping-card";
    const title = document.createElement("h4");
    title.textContent = label;
    card.appendChild(title);

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "range-shopping-card-empty";
      empty.textContent = "暂无该类食材";
      card.appendChild(empty);
    } else {
      items.slice(0, 8).forEach(item => {
        const row = document.createElement("div");
        row.className = "range-shopping-row";
        const name = document.createElement("span");
        name.textContent = item.name;
        const qty = document.createElement("strong");
        qty.textContent = item.qty;
        const dates = document.createElement("small");
        dates.textContent = item.dates.map(formatPlanDateShort).join("、");
        row.appendChild(name);
        row.appendChild(qty);
        row.appendChild(dates);
        card.appendChild(row);
      });
    }
    grid.appendChild(card);
  });

  saveDataRecord("ingredients.rangeShopping.current", data);
}

// 步骤 4：渲染食材清单 (带勾选和折叠交互)
function renderIngredients() {
  const activePlan = state.plans[state.activePlanIndex];
  const container = document.getElementById("ingredientsAccordion");
  if (!container) {
    renderCheckinPanel();
    return;
  }

  if (!activePlan) {
    container.innerHTML = `
      <div class="plan-pending-card">
        <strong>${formatPlanDateLabel(getVisiblePlanDate())} 暂无可用食材清单</strong>
        <span>等待当前日期饮食方案生成后再展示采购清单和客户打卡计划。</span>
      </div>
    `;
    const tipText = document.getElementById("ingredientTipText");
    if (tipText) {
      tipText.innerText = `${formatPlanDateLabel(getVisiblePlanDate())} 计划尚未生成，暂不能保存打卡或历史菜单。`;
    }
    renderRangeShoppingPanel();
    renderCheckinPanel();
    return;
  }

  container.innerHTML = "";

  const tipText = document.getElementById("ingredientTipText");
  if (tipText) {
    tipText.innerText = `以下是 ${formatPlanDateLabel(state.dietCalendar.selectedDate)}【${formatPlanLabelName(activePlan, state.activePlanIndex)}】对应的采购食材清单（已自动替换过敏食材并优先选择适宜的夏季时令食材）：`;
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

  renderCheckinPanel();
  renderRangeShoppingPanel();
  void persistHistoryMenuForSelectedDate({ silent: true });
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
    const scores = normalizePlanScores(plan.scores);
    const macros = normalizePlanMacros(plan.macros);
    plan.scores = scores;
    plan.macros = macros;
    const macroFit = clampScore(
      100
      - Math.abs(macros.carbs - idealMacros.carbs) * 0.8
      - Math.abs(macros.protein - idealMacros.protein) * 1.1
      - Math.abs(macros.fat - idealMacros.fat) * 0.7
    );
    const executionFit = clampScore((scores.cost * 0.45) + (scores.season * 0.35) + (scores.region * 0.2));

    let score = 0;
    if (provider.id === "doubao") {
      score = (scores.region * 0.32) + (scores.season * 0.26) + (executionFit * 0.24) + (macroFit * 0.18);
    } else if (provider.id === "qianwen") {
      score = (macroFit * 0.36) + (scores.region * 0.24) + (scores.season * 0.22) + (scores.cost * 0.18);
    } else {
      score = (scores.cost * 0.3) + (macroFit * 0.3) + (scores.season * 0.22) + (scores.region * 0.18);
    }

    return {
      idx,
      planName: formatPlanLabelName(plan, idx),
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

async function handleReevaluatePlans() {
  if (!state.plans.length) {
    addSystemLog("eval", "暂无可评估方案，请先生成饮食方案。");
    return;
  }

  const button = document.getElementById("reevaluatePlansBtn");
  if (button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.innerText = "重新评估中...";
  }

  enqueueLog("eval", "已接收新的评估权重，正在重新生成方案量化评估。");
  enqueueLog("eval", `当前推荐权重设为 -> 成本控制: ${state.weights.cost}% | 季节适宜: ${state.weights.season}% | 地域匹配: ${state.weights.region}%`);

  try {
    await apiSwitch.request("/api/v1/evaluation/score", {
      weights: state.weights,
      plans: state.plans.map((plan, index) => ({ name: formatPlanLabelName(plan, index), scores: plan.scores })),
      agentContext: state.formData.extraProfile,
      planDate: state.dietCalendar.selectedDate
    }, {
      source: "evaluation-panel",
      target: "evaluation-engine"
    });

    evaluatePlansRealtime();
    enqueueLog("eval", `评分看板已更新，当前推荐方案为：【${formatPlanLabelName(state.plans[state.selectedPlanIndex], state.selectedPlanIndex)}】。`);
    enqueueLog("switch", "正在按新权重重新汇总多角度智能复核。");
    await runAiDebateForPlans();
    enqueueLog("eval", "重新评估完成，可继续进入食材清单规划。");
  } catch (err) {
    evaluatePlansRealtime();
    enqueueLog("eval", `重新评估时后端暂不可用，已使用本地评分结果：${err.message || "未知错误"}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerText = "重新生成方案量化评估";
    }
  }
}

function runAiDebateForPlans() {
  if (!state.plans.length) return Promise.resolve();

  renderAiDebate(true);

  const reviewCalls = serviceRegistry.cloudProviders.map(provider => {
    return apiSwitch.request("/api/v1/cloud/providers/review", {
      provider: provider.id,
      plans: state.plans.map((plan, index) => ({
        name: formatPlanLabelName(plan, index),
        angleLabel: plan.angleLabel || getPlanAngleMeta(index).label,
        macros: plan.macros,
        scores: plan.scores
      })),
      context: {
        profile: state.formData,
        agentContext: state.formData.extraProfile
      }
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

  return Promise.all(reviewCalls).then(reviews => {
    state.aiDebate.reviews = reviews;
    state.aiDebate.consensus = state.plans.map((plan, idx) => {
      const score = reviews.reduce((sum, review) => {
        return sum + (review.planScores.find(item => item.idx === idx)?.score || 0);
      }, 0) / reviews.length;

      return {
        idx,
        name: formatPlanLabelName(plan, idx),
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
      planName: item.planName || formatPlanLabelName(state.plans[item.idx], item.idx),
      score: normalizeScoreValue(item.score, 80),
      macroFit: normalizeScoreValue(item.macroFit ?? item.score, 80),
      executionFit: normalizeScoreValue(item.executionFit ?? item.score, 80)
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

// 步骤 3：实时加权打分与胜出方案推荐
function evaluatePlansRealtime() {
  if (!state.plans.length) return;
  state.plans = calibratePlanScoresByAngle(ensurePlanNamesUseAngles(state.plans));

  const costWeight = state.weights.cost / 100;
  const seasonWeight = state.weights.season / 100;
  const regionWeight = state.weights.region / 100;

  let maxScore = -1;
  let winnerIndex = 0;
  
  const scoresOutput = [];

  state.plans.forEach((plan, idx) => {
    const scores = normalizePlanScores(plan.scores);
    plan.scores = scores;
    plan.macros = normalizePlanMacros(plan.macros);
    // 归一化综合评分
    const ruleScore = Math.round(
      (scores.cost * costWeight) +
      (scores.season * seasonWeight) +
      (scores.region * regionWeight)
    );
    const consensusScore = getConsensusScoreForPlan(idx);
    const finalScore = consensusScore === null
      ? ruleScore
      : Math.round((ruleScore * 0.86) + (consensusScore * 0.14));

    scoresOutput.push({ idx, name: plan.name, displayName: formatPlanLabelName(plan, idx), score: finalScore, ruleScore, consensusScore });

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
          <span>${item.displayName}</span>
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
      <div style="font-weight: 700; color: #10B981; margin-bottom: 0.15rem;">推荐方案：${formatPlanLabelName(winnerPlan, winnerIndex)}</div>
      <div style="color: var(--text-secondary); line-height: 1.4;">
        在您当前的评估指标下，该方案表现最优。时令匹配度为 ${winnerPlan.scores.season}%，
        地域风味匹配度为 ${winnerPlan.scores.region}%${winnerConsensus === null ? "" : `，多 AI 共识分为 ${winnerConsensus} 分`}，能够最大程度满足预算与适宜性。
      </div>
    </div>
  `;

  saveDataRecord("evaluation.current", {
    weights: state.weights,
    selectedPlanIndex: state.selectedPlanIndex,
    selectedPlanName: formatPlanLabelName(winnerPlan, winnerIndex),
    scores: scoresOutput
  });
}

async function prepareShareContent(options = {}) {
  const selectedPlan = state.plans[state.selectedPlanIndex];
  if (!selectedPlan || !state.formData.age) return;

  generateMarketingTexts();

  try {
    const response = await apiSwitch.request("/api/v1/marketing/content", {
      selectedPlanIndex: state.selectedPlanIndex,
      selectedPlan,
      agentContext: state.formData.extraProfile,
      planDate: state.dietCalendar.selectedDate
    }, {
      source: "ingredient-planner",
      target: "sharing-writer"
    });

    if (response.ok && applyMarketingTextsFromAgent(response.data)) {
      addSystemLog(
        "market",
        response.data.mode === "real"
          ? "大模型内容 Agent 已生成用户分享和商家推广文案。"
          : response.data.mode === "fallback"
            ? "大模型内容 Agent 调用失败，已使用 fallback 文案。"
            : "Mock 内容 Agent 已生成用户分享和商家推广文案。"
      );
    }
  } catch (err) {
    addSystemLog("market", `内容 Agent 暂不可用，继续使用本地模板：${err.message || "未知错误"}`);
  }

  if (!options.silent) {
    addSystemLog("market", `已根据最终方案【${selectedPlan.name}】生成个人分享文案、打卡脚本和计划长文。`);
  }
}

function applyMarketingTextsFromAgent(data) {
  if (!data || typeof data !== "object") return false;
  const mode = data.mode || "mock";
  const isRealModelText = mode === "real";
  const fields = [
    ["copyBoxXhs", "xhsText"],
    ["copyBoxVideo", "videoText"],
    ["copyBoxGzh", "gzhText"],
    ["copyBoxPromo", "promoText"]
  ];
  let applied = false;
  fields.forEach(([elementId, key]) => {
    const value = data[key];
    const target = document.getElementById(elementId);
    if (target && typeof value === "string" && value.trim()) {
      const incomingText = value.trim();
      const currentText = target.innerText.trim();
      const keepLocalFullTemplate = !isRealModelText
        && currentText.length >= 180
        && currentText.length > incomingText.length;
      if (keepLocalFullTemplate) return;
      target.innerText = incomingText;
      applied = true;
    }
  });
  if (applied) {
    saveDataRecord("sharing.current", {
      selectedPlan: state.plans[state.selectedPlanIndex]?.name || "",
      xhsText: document.getElementById("copyBoxXhs")?.innerText || "",
      videoText: document.getElementById("copyBoxVideo")?.innerText || "",
      gzhText: document.getElementById("copyBoxGzh")?.innerText || "",
      promoText: document.getElementById("copyBoxPromo")?.innerText || "",
      mode: data.mode || "mock",
      providerId: data.providerId || ""
    });
  }
  return applied;
}

// 计划分享生成引擎 (自适应用户指标和方案结果)
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

  // 1. 小红书个人分享文案
  const xhsText = `📌 我的专属健康饮食计划：【${templateParams.PlanName}】✨

今天用系统根据我的身高、体重、活动量、健康目标、饮食禁忌和地域口味，生成了一套可以执行的饮食计划。
这是一份个人健康管理记录：方案、热量、营养比例和采购清单都整理好了，方便后续复盘和打卡。

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

接下来准备按这个方案执行一周，看看身体状态、饱腹感和备餐难度会不会更稳定。
#健康饮食记录 #饮食计划打卡 #科学备餐 #我的健康生活 #AI饮食规划`;

  // 2. 短视频打卡脚本
  const videoText = `🎬 短视频打卡脚本：《我的一日健康饮食计划》

【BGM】：轻快、动感、充满活力的卡点音乐
【视频时长】：30秒
【适合调性】：真实记录、自律日常、健康管理

---
🎥 【画面 1】
- 画面：手机打开健康饮食规划页面，镜头扫过个人画像和热量预算。
- 视觉提示：屏幕中央浮现花字：“今天开始认真吃饭。”
- 旁白：我给自己生成了一套更适合当前状态的饮食计划。

🎥 【画面 2】
- 画面：切入手机，特写健康饮食规划页面，展示个人画像、热量预算和三餐安排。
- 视觉提示：显示“已生成专属方案”和“采购清单已就绪”。
- 旁白：系统根据身高体重、活动量、目标和地域口味，推荐了【${templateParams.PlanName}】。

🎥 【画面 3】
- 画面：快速卡点切入三餐实拍或备餐画面。
- 视觉提示：屏幕左侧打上能量卡片：${templateParams.Calories} kcal，营养比例均衡。
- 旁白：早餐是【${templateParams.Breakfast}】，午餐安排【${templateParams.Lunch}】，晚餐是【${templateParams.Dinner}】。全天预算约 ${templateParams.Calories} 大卡。

🎥 【画面 4】
- 画面：主角拿着手机食材清单，在超市里开心地挑选新鲜果蔬。
- 旁白：评估之后再生成采购清单，买什么、买多少会更明确。

🎥 【画面 5】
- 画面：展示今天的计划截图和备餐成果。
- 视觉提示：花字：“记录第 1 天，看看能不能坚持一周。”
- 旁白：先按这个计划执行几天，再回来复盘真实感受。`;

  // 3. 计划长文记录
  const gzhText = `标题：我的健康饮食计划记录：【${templateParams.PlanName}】

引言：
这是一份面向个人执行和复盘的饮食计划记录。系统根据基础画像、健康目标、活动量、地域口味和饮食禁忌，生成多套方案并完成评估，最终推荐【${templateParams.PlanName}】。

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
科学饮食不是一份固定模板，而是一个不断记录、执行、复盘和调整的过程。接下来会按这套计划进行尝试，并根据真实体验继续优化。`;

  const ingredientHighlights = Object.values(winnerPlan.ingredients || {})
    .flat()
    .map(item => typeof item === "string" ? item : item?.name)
    .filter(Boolean)
    .slice(0, 6)
    .join("、") || "优质蛋白、时令蔬果、基础谷物和低负担调味";

  // 4. 商家推广文案（可选，和用户分享分开）
  const promoText = `【商家推广文案｜最终方案脱敏版】

推广主题：${templateParams.PlanName} 健康餐组合

这份文案只基于最终推荐方案的餐单、营养结构和采购清单生成，不包含姓名、年龄、身高、体重、联系方式、疾病史等个人健康信息。

方案卖点：
- 一日能量规划约 ${templateParams.Calories} kcal，适合做健康餐组合展示或营养搭配案例。
- 营养结构清晰：碳水 ${templateParams.Carbs}% | 蛋白质 ${templateParams.Protein}% | 脂肪 ${templateParams.Fat}%。
- 餐单完整：早餐「${templateParams.Breakfast}」，午餐「${templateParams.Lunch}」，晚餐「${templateParams.Dinner}」，加餐「${templateParams.Snack}」。
- 采购清单可落地：重点食材包括 ${ingredientHighlights}，方便门店备货、套餐搭配或私域推荐。

推荐发布文案：
今天推荐一套可直接落地的健康饮食组合：【${templateParams.PlanName}】。它把三餐、加餐、热量预算和采购清单一起整理好，既方便用户照着执行，也方便商家做健康餐套餐、食材组合包或营养咨询展示。

适用场景：
健康餐定制 / 轻食套餐设计 / 食材采购搭配 / 私域用户服务 / 营养方案展示

合规提示：
正式推广时请使用脱敏案例和商家自有菜品图片；如引用真实用户计划，应先获得授权。`;

  // 填入 DOM 中
  const xhsBox = document.getElementById("copyBoxXhs");
  const videoBox = document.getElementById("copyBoxVideo");
  const gzhBox = document.getElementById("copyBoxGzh");
  const promoBox = document.getElementById("copyBoxPromo");

  if (xhsBox) xhsBox.innerText = xhsText;
  if (videoBox) videoBox.innerText = videoText;
  if (gzhBox) gzhBox.innerText = gzhText;
  if (promoBox) promoBox.innerText = promoText;

  saveDataRecord("sharing.current", {
    selectedPlan: winnerPlan.name,
    xhsText,
    videoText,
    gzhText,
    promoText
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
    case "market": tagClass = "market"; tagLabel = "分享"; break;
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

// --- 视频录制与分享数据包导出模块 ---

let recordingCanvas = null;
let canvasCtx = null;
let mediaRecorder = null;
let recordedChunks = [];
let animId = null;

// 启动计划打卡视频录制生成流程
function startVideoRecording() {
  if (!hasCommerceFeature("shareExport")) {
    promptUpgradeForFeature("计划打卡视频生成");
    return;
  }

  const btn = document.getElementById("generateVideoBtn");
  const progressContainer = document.getElementById("videoProgressContainer");
  const progressBar = document.getElementById("videoProgressBar");
  const progressText = document.getElementById("videoProgressText");
  const selectedPlan = state.plans[state.selectedPlanIndex];

  if (!btn || !progressContainer || !progressBar || !progressText) return;
  if (!selectedPlan) {
    addSystemLog("market", "未找到最终方案，无法生成计划打卡视频。请先完成方案评估。");
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

  addSystemLog("market", "正在构建离屏 Canvas 分享视频画幅，初始化 MediaRecorder 录像轨道...");

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
    btn.innerText = "🎬 1. 生成计划打卡视频";
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
    downloadLink.download = "plan_share_video.webm";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    addSystemLog("market", "🎬 计划打卡短视频已成功生成并自动触发浏览器下载：[plan_share_video.webm]。");
    
    // 解禁后续按钮
    document.getElementById("downloadPublishPackBtn").disabled = false;
    document.getElementById("openPublishDialogBtn").disabled = false;

    btn.innerText = "✓ 打卡视频已生成";
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
    canvasCtx.fillText('我的健康饮食计划', 300, 95);

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
    canvasCtx.fillText('记录今天的健康饮食计划', 0, 0);
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

// 生成并下载个人平台分享助手所需的 share_data.json
function downloadPublishPackage() {
  if (!hasCommerceFeature("shareExport")) {
    promptUpgradeForFeature("分享数据包导出");
    return;
  }

  const activePlan = state.plans[state.selectedPlanIndex];
  if (!activePlan) {
    addSystemLog("market", "未找到最终方案，无法导出分享数据包。");
    return;
  }
  
  // 生成个人短视频平台分享描述
  const dyText = `🎬 我的【${activePlan.name}】健康饮食计划记录：每日约 ${activePlan.calories} 千卡，三餐安排和采购清单都整理好了，先按计划执行几天再复盘。#健康饮食记录 #饮食计划打卡 #科学备餐 #自律日常`;
  
  const xhsBox = document.getElementById("copyBoxXhs");
  const data = {
    plan_name: activePlan.name,
    calories: activePlan.calories,
    xhs_text: xhsBox ? xhsBox.innerText : "",
    video_desc: dyText
  };

  apiSwitch.request("/api/v1/publish/package", data, {
    source: "sharing-writer",
    target: "publish-bot"
  });
  saveDataRecord("sharing.package", data);

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const downloadLink = document.createElement("a");
  downloadLink.href = url;
  downloadLink.download = "share_data.json";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  addSystemLog("market", "📦 分享数据包已导出为 [share_data.json] 并开始下载。请将此文件与计划打卡视频放在同一目录。");
}
