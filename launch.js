/**
 * APP launch runtime: PWA install, Web-wrapper readiness, edge model inference,
 * and commercial funnel events.
 */
(function attachLaunchRuntime() {
  "use strict";

  const STORAGE_KEY = "dietPlannerLaunchRuntimeV1";
  let deferredInstallPrompt = null;
  let previousStepId = "step-1";

  function getWrappedWebUrl() {
    const target = new URL(window.location.href);
    target.hash = "";
    target.searchParams.delete("shortcut");
    target.searchParams.set("source", "android-webview");
    target.searchParams.set("appShell", "wrapped-web");
    return target.toString();
  }

  function readRuntime() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeRuntime(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function updateRuntime(patch) {
    const current = readRuntime();
    const next = {
      entitlement: "free",
      installStatus: "browser",
      edgeRuns: 0,
      leads: [],
      events: [],
      ...current,
      ...patch
    };
    writeRuntime(next);
    renderLaunchRuntime();
    return next;
  }

  function addLaunchEvent(type, payload = {}) {
    const runtime = readRuntime();
    const event = {
      type,
      payload,
      at: new Date().toISOString()
    };
    const next = {
      ...runtime,
      events: [event, ...(runtime.events || [])].slice(0, 30)
    };
    writeRuntime(next);
    renderLaunchRuntime();
    if (typeof addSystemLog === "function") {
      addSystemLog("switch", `APP 上线事件已记录：${type}`);
    }
    if (window.NativeEdgeBridge?.recordEvent) {
      try {
        window.NativeEdgeBridge.recordEvent(JSON.stringify(event));
      } catch {
        // Native bridge is optional in browser/PWA mode.
      }
    }
    return dispatchBusinessRoute("/api/v1/app/install-event", event);
  }

  function dispatchBusinessRoute(route, payload) {
    if (typeof apiSwitch !== "undefined" && apiSwitch?.request) {
      return apiSwitch.request(route, payload, {
        source: "app-launch-runtime",
        target: route.includes("business") ? "business-engine" : "app-shell"
      }).catch(() => null);
    }
    return Promise.resolve(null);
  }

  function getProfileForEdgeModel() {
    if (typeof state !== "undefined" && state.formData?.age) {
      return { ...state.formData };
    }
    if (typeof collectHealthFormData === "function") {
      try {
        return collectHealthFormData();
      } catch {
        return {};
      }
    }
    return {};
  }

  function getSelectedPlanName() {
    if (typeof state === "undefined" || !state.plans?.length) return "尚未选择方案";
    const idx = Number(state.selectedPlanIndex || 0);
    return state.plans[idx]?.name || state.plans[0]?.name || "尚未选择方案";
  }

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      updateRuntime({ serviceWorker: "unsupported" });
      return;
    }
    if (!window.isSecureContext && !location.hostname.includes("localhost") && location.hostname !== "127.0.0.1") {
      updateRuntime({ serviceWorker: "requires-https" });
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register("sw.js", { scope: "./" });
      updateRuntime({
        serviceWorker: registration.active ? "active" : "registered",
        serviceWorkerScope: registration.scope
      });
      addLaunchEvent("service-worker-registered", { scope: registration.scope });
    } catch (err) {
      updateRuntime({ serviceWorker: `failed: ${err.message || err}` });
    }
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateRuntime({ installStatus: "installable" });
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      updateRuntime({ installStatus: "installed" });
      addLaunchEvent("pwa-installed", { source: "browser-prompt" });
    });
  }

  async function handleInstallApp() {
    if (isStandalone()) {
      updateRuntime({ installStatus: "standalone" });
      addLaunchEvent("pwa-already-standalone");
      return;
    }
    if (!deferredInstallPrompt) {
      updateRuntime({ installStatus: "manual-install-required" });
      addLaunchEvent("pwa-manual-install-hint", {
        message: "浏览器暂未开放安装提示，可从地址栏或浏览器菜单选择安装。"
      });
      alert("当前浏览器暂未开放自动安装提示。可从地址栏或浏览器菜单选择“安装应用/添加到主屏幕”。");
      return;
    }

    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    updateRuntime({ installStatus: choice.outcome === "accepted" ? "installed" : "dismissed" });
    addLaunchEvent("pwa-install-choice", choice);
    deferredInstallPrompt = null;
  }

  function formatPlanList(plans) {
    return plans.map((plan, idx) => {
      const meals = (plan.meals || []).map(meal => `${meal.name}：${meal.food}`).join("\n    ");
      return `${idx + 1}. ${plan.name}｜${plan.calories} kcal｜碳水 ${plan.macros.carbs}% 蛋白 ${plan.macros.protein}% 脂肪 ${plan.macros.fat}%\n    ${meals}`;
    }).join("\n\n");
  }

  function renderEdgeResult(result) {
    const output = document.getElementById("edgeModelOutput");
    if (!output) return;
    output.innerText = [
      `模型版本：${result.modelVersion}`,
      `运行位置：浏览器端侧 / WebView 端侧`,
      `耗时：${result.runtimeMs} ms`,
      `BMI：${result.bmi}（${result.bmiStatus}）`,
      `BMR/TDEE：${result.bmr} / ${result.tdee} kcal`,
      `目标热量：${result.targetCalories} kcal`,
      "",
      formatPlanList(result.plans)
    ].join("\n");
  }

  function runEdgeModel() {
    if (!window.EdgeDietModel) {
      alert("端侧模型脚本未加载。");
      return null;
    }
    const profile = getProfileForEdgeModel();
    const planDate = typeof state !== "undefined"
      ? state.dietCalendar?.selectedDate || state.dietCalendar?.startDate
      : "";
    const result = window.EdgeDietModel.run(profile, { planDate });
    const runtime = readRuntime();
    writeRuntime({
      ...runtime,
      edgeRuns: Number(runtime.edgeRuns || 0) + 1,
      lastEdgeResult: result,
      lastEdgeRunAt: new Date().toISOString()
    });
    renderEdgeResult(result);
    renderLaunchRuntime();
    addLaunchEvent("edge-model-run", {
      runtimeMs: result.runtimeMs,
      targetCalories: result.targetCalories,
      planCount: result.plans.length
    });
    return result;
  }

  function applyEdgePlan() {
    const runtime = readRuntime();
    const result = runtime.lastEdgeResult || runEdgeModel();
    if (!result || typeof state === "undefined") return;

    state.formData = result.profile || getProfileForEdgeModel();
    state.bmr = result.bmr;
    state.tdee = result.tdee;
    state.targetCalories = result.targetCalories;
    state.plans = result.plans;
    state.activePlanIndex = 0;
    state.selectedPlanIndex = 0;
    state.edgeCompute = {
      location: "端侧模型离线推理",
      bmi: String(result.bmi),
      bmr: `${result.bmr} kcal`,
      tdee: `${result.tdee} kcal`,
      runtimeMs: result.runtimeMs,
      cacheState: "edge-model"
    };
    state.planDiscussion = result.planDiscussion || state.planDiscussion;
    state.dietCalendar = {
      ...state.dietCalendar,
      period: state.dietCalendar?.period || "day",
      startDate: state.dietCalendar?.startDate || result.planDate,
      selectedDate: result.planDate,
      lastSource: "edge-model"
    };

    if (typeof saveDataRecord === "function") {
      saveDataRecord("edge.model.current", result);
      saveDataRecord("diet.plans.current", result.plans);
    }
    if (typeof renderEdgeComputeStatus === "function") renderEdgeComputeStatus();
    if (typeof renderPlanCalendarControls === "function") renderPlanCalendarControls();
    if (typeof goToStep === "function") goToStep(2);
    if (typeof renderDietPlans === "function") renderDietPlans();

    addLaunchEvent("edge-plan-applied", {
      planDate: result.planDate,
      planCount: result.plans.length
    });
  }

  function mockSubscribe() {
    if (typeof checkoutMembershipPlan === "function") {
      checkoutMembershipPlan("pro_month", { channel: "launch-panel" }).then(data => {
        if (!data) return;
        updateRuntime({
          entitlement: data.entitlement || "pro",
          subscription: data.subscription || data.order || null
        });
        addLaunchEvent("subscription-converted", {
          orderId: data.order?.id,
          plan: data.subscription?.planName || "Pro 月会员"
        });
      });
      return;
    }

    const runtime = readRuntime();
    const event = {
      plan: "Pro 会员演示",
      amountCny: 19.9,
      selectedPlan: getSelectedPlanName(),
      at: new Date().toISOString()
    };
    updateRuntime({
      entitlement: "pro-demo",
      subscription: event,
      events: [event, ...(runtime.events || [])].slice(0, 30)
    });
    dispatchBusinessRoute("/api/v1/business/checkout", event);
    addLaunchEvent("subscription-converted", event);
  }

  function createMerchantLead() {
    const runtime = readRuntime();
    const lead = {
      id: `lead-${Date.now()}`,
      channel: "merchant-promo",
      selectedPlan: getSelectedPlanName(),
      need: "健康餐套餐 / 食材组合包 / 私域推广文案",
      status: "new",
      at: new Date().toISOString()
    };
    updateRuntime({
      leads: [lead, ...(runtime.leads || [])].slice(0, 20)
    });
    dispatchBusinessRoute("/api/v1/business/lead", lead);
    addLaunchEvent("merchant-lead-created", lead);
  }

  function exportLaunchPack() {
    const runtime = readRuntime();
    const pack = {
      exportedAt: new Date().toISOString(),
      app: {
        name: "个性化健康饮食规划系统",
        pwa: runtime.installStatus || "browser",
        serviceWorker: runtime.serviceWorker || "unknown",
        wrapperRoute: "mobile/android",
        edgeModel: window.EdgeDietModel?.VERSION || "not-loaded"
      },
      business: {
        entitlement: runtime.entitlement || "free",
        leadCount: (runtime.leads || []).length,
        eventCount: (runtime.events || []).length,
        selectedPlan: getSelectedPlanName()
      },
      lastEdgeResult: runtime.lastEdgeResult || null,
      events: runtime.events || [],
      leads: runtime.leads || []
    };
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "app_launch_pack.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLaunchEvent("launch-pack-exported", {
      eventCount: pack.business.eventCount,
      leadCount: pack.business.leadCount
    });
  }

  function renderLaunchRuntime() {
    const runtime = readRuntime();
    const standalone = isStandalone();
    const grid = document.getElementById("launchStatusGrid");
    const side = document.getElementById("sidebarAppStatus");
    const funnel = document.getElementById("businessFunnelOutput");
    const edgeOutput = document.getElementById("edgeModelOutput");

    const installStatus = standalone ? "standalone" : runtime.installStatus || "browser";
    const swStatus = runtime.serviceWorker || "not-registered";
    const entitlement = runtime.entitlement || "free";
    const leadCount = (runtime.leads || []).length;
    const eventCount = (runtime.events || []).length;
    const edgeRuns = Number(runtime.edgeRuns || 0);

    if (side) {
      side.innerText = `APP: ${installStatus} · 端侧模型 ${edgeRuns ? `已运行 ${edgeRuns} 次` : "待命"}`;
    }
    if (grid) {
      grid.innerHTML = [
        ["APP 壳状态", installStatus, "PWA/浏览器/套壳 WebView 共用同一前端"],
        ["Service Worker", swStatus, "缓存静态资源，支撑离线启动"],
        ["端侧模型", window.EdgeDietModel?.VERSION || "未加载", `${edgeRuns} 次推理`],
        ["商业转化", entitlement, `线索 ${leadCount} 个 · 事件 ${eventCount} 条`]
      ].map(item => `
        <article class="launch-status-card">
          <span>${item[0]}</span>
          <strong>${item[1]}</strong>
          <small>${item[2]}</small>
        </article>
      `).join("");
    }
    if (funnel) {
      const events = (runtime.events || []).slice(0, 8).map(event => {
        const time = new Date(event.at).toLocaleString();
        return `- ${time}｜${event.type}`;
      }).join("\n") || "暂无商业事件。";
      funnel.innerText = [
        `会员状态：${entitlement}`,
        `商家线索：${leadCount} 个`,
        `事件数量：${eventCount} 条`,
        "",
        events
      ].join("\n");
    }
    if (edgeOutput && runtime.lastEdgeResult && edgeOutput.innerText.includes("尚未运行")) {
      renderEdgeResult(runtime.lastEdgeResult);
    }
  }

  function openLaunchPage() {
    const active = document.querySelector(".step-view.active");
    previousStepId = active?.id || `step-${typeof state !== "undefined" ? state.currentStep : 1}`;
    document.querySelectorAll(".step-view").forEach(view => view.classList.remove("active"));
    document.getElementById("launch-page")?.classList.add("active");
    const title = document.getElementById("current-step-name");
    if (title) title.innerText = "附加环节：APP 上线与商业闭环";
    const progress = document.getElementById("progressBar");
    if (progress) progress.style.width = "100%";
    renderLaunchRuntime();
    addLaunchEvent("launch-panel-opened");
  }

  function openWrappedWebPage() {
    window.location.assign(getWrappedWebUrl());
  }

  function closeLaunchPage() {
    document.querySelectorAll(".step-view").forEach(view => view.classList.remove("active"));
    const target = document.getElementById(previousStepId) || document.getElementById("step-1");
    target?.classList.add("active");
    if (previousStepId?.startsWith("step-") && typeof goToStep === "function") {
      const step = Number(previousStepId.replace("step-", ""));
      if (Number.isFinite(step)) goToStep(step);
    } else if (previousStepId === "share-page" && typeof goToSharePage === "function") {
      goToSharePage();
    }
  }

  function bindLaunchControls() {
    document.getElementById("openLaunchPageBtn")?.addEventListener("click", openWrappedWebPage);
    document.getElementById("backFromLaunchBtn")?.addEventListener("click", closeLaunchPage);
    document.getElementById("installAppBtn")?.addEventListener("click", handleInstallApp);
    document.getElementById("runEdgeModelBtn")?.addEventListener("click", runEdgeModel);
    document.getElementById("applyEdgePlanBtn")?.addEventListener("click", applyEdgePlan);
    document.getElementById("mockSubscribeBtn")?.addEventListener("click", mockSubscribe);
    document.getElementById("merchantLeadBtn")?.addEventListener("click", createMerchantLead);
    document.getElementById("exportLaunchPackBtn")?.addEventListener("click", exportLaunchPack);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupInstallPrompt();
    bindLaunchControls();
    updateRuntime({
      installStatus: isStandalone() ? "standalone" : readRuntime().installStatus || "browser",
      edgeModelVersion: window.EdgeDietModel?.VERSION || "not-loaded"
    });
    registerServiceWorker();
    if (new URLSearchParams(location.search).get("shortcut") === "launch") {
      setTimeout(openWrappedWebPage, 300);
    }
  });
})();
