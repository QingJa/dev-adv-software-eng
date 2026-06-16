# 七层架构补齐后续实施计划

生成时间：2026-06-16

## 目标

在现有 `implementation_plan.md` 的多智能体健康饮食规划 SPA 基础上，补齐并可视化 7 个实现层次。最终系统不仅展示客户经理、饮食助理、食材助理、评估助理、营销助理的业务流程，还要明确具备云端 AI 平台、双层数据、业务容器化、多 API、AI 对抗、云端/端边协同、通用 API 协议、API Switch 全双工异步调度、MVC/MVVM UI 和端侧/边侧算力能力。

## 七层实现映射

| 层级 | 必须满足项 | 落地方式 |
| --- | --- | --- |
| 1. 云端平台层 | 国内 AI：豆、千、DS | 在前端运行时建立 `Doubao`、`Qianwen`、`DeepSeek` 三个云端 AI Provider 模拟节点；所有 Provider 调用通过统一 API 信封进入 Switch；展示在线状态、延迟、成本、角色能力。 |
| 2. 数据层 | 缓存与持久化两层 | 使用内存 `Map` 做热缓存，使用 `localStorage` 做持久化快照；对画像、方案、评估、营销、API 事件、端侧算力结果分别落盘；UI 展示缓存命中与持久化版本。 |
| 3. 业务层 | 容器化、多 API、多 AI 对抗、云端协同 | 用服务注册表描述 5 个业务 Agent 容器；将画像、膳食、食材、评估、营销拆成独立 API；评估阶段引入三家 AI 对抗评审并形成共识分；端侧算力与云端 Provider 共同参与结果解释。 |
| 4. API 层 | 内外通信都通过 API、通用协议 | 定义统一协议信封：`traceId`、`route`、`source`、`target`、`payload`、`meta`、`createdAt`；内部 Agent 通信和云端 Provider 调用统一走该信封。 |
| 5. Switch 层 | API 总调度，全双工、异步、非阻塞，FastAPI 风格 | 新增 `apiSwitch`，支持异步 Promise 调度、请求/响应事件、双向通道状态、队列深度、吞吐统计；路由命名采用 FastAPI 风格路径，如 `/api/v1/diet/plans`。 |
| 6. UI 层 | MVC、MVVM，可用 3D UI | 保留 DOM 视图层，补充架构运行态面板；状态 `state` 作为 Model，渲染函数作为 ViewModel，事件处理和 Switch 作为 Controller；用轻量 CSS 透视层实现 3D 架构栈，不引入外部 3D 依赖。 |
| 7. 端/边侧算力层 | 部分端侧算力或边侧算力 | 在浏览器端完成 BMI、BMR、TDEE、宏量营养、缓存命中、设备能力估算；渲染端侧算力卡片，说明哪些计算在端侧完成、哪些交给云端 AI Provider。 |

## 逐文件实施顺序

### 1. `index.html`

- 在侧边栏智能体列表下新增「七层架构运行态」区域。
- 在工作区顶部新增 3D 架构栈面板，展示 7 层从云端到端侧的执行关系。
- 在评估步骤中新增「多 AI 对抗评审」容器，展示豆包、千问、DeepSeek 的对抗评分与共识结果。
- 在底部日志旁保留现有控制台，不破坏原五步流程。

### 2. `style.css`

- 增加七层架构面板、Provider 状态卡、API Switch 仪表、双层数据状态、端侧算力卡片样式。
- 增加 CSS 3D 架构栈效果，保持轻量无外部依赖。
- 增强移动端布局，确保架构面板在窄屏下可换行和横向滚动。
- 保持已有深色/浅色主题兼容。

### 3. `app.js`

- 新增架构注册表：
  - 云端 Provider：豆包、千问、DeepSeek。
  - 业务容器：客户经理、饮食助理、食材助理、评估助理、营销助理。
  - API 路由：画像、膳食、食材、评估、营销、发布。
- 新增数据层：
  - `memoryCache`：热缓存。
  - `persistenceStore`：`localStorage` 持久化。
  - `saveDataRecord()`、`readDataRecord()`、`renderDataLayerStatus()`。
- 新增 API Switch：
  - `createApiEnvelope()`。
  - `apiSwitch.request()`。
  - 请求、响应、错误、队列、全双工通道状态统计。
- 新增多 AI 对抗：
  - `runAiDebateForPlans()`。
  - 三家 Provider 对每个方案从营养、成本、时令、地域、可执行性给出评分。
  - 将共识分与现有评估权重结合展示。
- 新增端/边侧算力：
  - `computeEdgeProfile()`。
  - 估算 BMI、BMR、TDEE、计算位置、端侧耗时、缓存状态。
- 将关键流程接入 API Switch：
  - 表单提交。
  - 方案生成。
  - 食材规划。
  - 多维评估。
  - 营销文案。
  - 发布包导出。

### 4. `modification_details.md`

- 更新当前修改详情。
- 记录新增文件、七层实现点、验证命令和工作区状态。

## 验收标准

- 页面仍可直接打开 `index.html` 使用，无外部依赖。
- 五步业务流程完整可运行。
- 页面中能直接看到 7 层架构：
  - 云端 AI Provider：豆包、千问、DeepSeek。
  - 数据层：缓存与持久化状态。
  - 业务层：容器/API/对抗/云端协同。
  - API 层：通用协议信封。
  - Switch 层：全双工、异步、非阻塞、FastAPI 风格路由。
  - UI 层：MVC/MVVM 与 3D 架构栈。
  - 端/边侧算力：端侧计算结果与边侧协同说明。
- 评估阶段可以看到三家 AI 的对抗评分。
- 控制台日志能看到 API Switch、缓存、持久化、端侧算力和云端 Provider 的流转记录。
- 本地验证通过：
  - `new Function(app.js)` 语法检查。
  - `python3 -m py_compile publisher_bot.py`。
  - `git diff --check -- index.html style.css app.js seven_layer_implementation_plan.md modification_details.md`。
