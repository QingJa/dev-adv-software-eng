# 七层架构补齐后续实施计划

生成时间：2026-06-16

## 目标

在现有 `implementation_plan.md` 的健康饮食规划 SPA 基础上，补齐 7 个实现层次对应的真实功能能力。七层架构与客户经理、饮食助理、食材助理、评估助理、营销助理是系统内部职责与处理链路，不作为页面上的架构展板或角色列表直接展示。用户界面只呈现业务结果：用户画像、3 套饮食方案、分类采购清单、量化评估、最终推荐和多平台文案。

## 口径修正

2026-06-17 追加修正：此前文档中“可视化 7 层”“侧边栏七层状态”“3D 架构栈”等条目属于早期演示化方案，已被废弃。当前验收口径改为：

- 七层能力必须在代码和调用链中真实存在：
  - 云端 AI Provider 真实接入。
  - 双层数据存储与后端 SQLite 持久化。
  - 业务职责拆分为画像、膳食、食材、评估、营销等处理函数与 API。
  - 内外通信通过统一 API envelope。
  - 后端 Switch 负责异步调度和事件流。
  - 前端按业务流程组织 UI，不显示架构层级。
  - 本地浏览器计算 BMI/BMR/TDEE，并与云端复核结果协同。
- 页面不直接展示：
  - “七层架构运行态”“七层实现状态”“3D 架构栈”。
  - “客户经理/饮食助理/食材助理/评估助理/营销助理”作为可见角色卡或标题。
  - “豆包/千问/DeepSeek/API Switch/Provider/数据层”等内部实现名。
- 可见结果只保留业务功能：
  - 基础健康问卷。
  - 结构化用户画像卡片。
  - 3 套饮食方案。
  - 分类食材采购清单。
  - 成本、季节、地域量化评估和自动推荐。
  - 小红书、短视频脚本、微信公众号文案。

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

## 当前仍未完成的部分

当前实现已经完成“本地 SPA 可视化原型”和“浏览器内模拟 7 层链路”，但仍有以下生产化能力尚未完成。后续如果要从课程/演示级原型升级为可真实调用、可部署、可运维系统，需要继续实现这些部分。

| 层级 | 当前已完成 | 未完成 / 待增强 |
| --- | --- | --- |
| 1. 云端平台层 | 已在前端注册豆包、千问、DeepSeek 三个 Provider，并模拟延迟、角色和对抗评分。 | 尚未接入真实豆包、通义千问、DeepSeek API；缺少 API Key 管理、模型选择、流式响应、失败重试、限流、费用统计和真实内容安全策略。 |
| 2. 数据层 | 已使用 `Map` 热缓存和 `localStorage` 持久化快照。 | 尚未接入真实持久化数据库；缺少 Redis/IndexedDB/SQLite 等可扩展数据层、数据迁移、版本管理、加密存储、过期策略、用户隔离和备份恢复。 |
| 3. 业务层 | 已用前端注册表描述 5 个业务容器，并拆出多条 FastAPI 风格 API 路由。 | 尚未实现真实容器化服务；缺少 Dockerfile、docker-compose/K8s 编排、独立 Agent 服务进程、服务健康检查、异步任务队列和跨服务追踪。 |
| 4. API 层 | 已实现统一 API 信封和内部模拟请求。 | 尚未实现真实 HTTP API；缺少 FastAPI 后端、OpenAPI 文档、请求校验 schema、鉴权、CORS 策略、错误码规范、版本兼容和外部调用 SDK。 |
| 5. Switch 层 | 已实现浏览器内 `apiSwitch.request()`，模拟异步非阻塞、队列、全双工通道状态。 | 尚未实现真实 API Gateway/Switch；缺少 WebSocket/SSE 全双工链路、后端事件总线、并发控制、熔断降级、请求取消、超时控制和分布式日志。 |
| 6. UI 层 | 已实现 7 层运行态面板、CSS 3D 架构栈、AI 对抗评分和响应式样式。 | 尚未做真实浏览器截图验收；缺少 Playwright E2E、移动端/桌面端视觉回归、无障碍审计、长文案溢出测试和复杂状态下的交互测试。 |
| 7. 端/边侧算力层 | 已在浏览器端侧计算 BMI、BMR、TDEE 和缓存状态。 | 尚未实现真实端侧模型或边缘推理；缺少 Web Worker/WASM/WebGPU、离线模型包、边缘节点任务下发、端云协同策略和低性能设备降级方案。 |

## 后续补齐计划

### 阶段 1：真实后端与 API 协议

- 新建 `backend/`，使用 FastAPI 实现真实 API：
  - `POST /api/v1/profile/create`
  - `POST /api/v1/diet/plans`
  - `POST /api/v1/ingredients/list`
  - `POST /api/v1/evaluation/score`
  - `POST /api/v1/cloud/providers/review`
  - `POST /api/v1/marketing/content`
  - `POST /api/v1/publish/package`
- 使用 Pydantic 定义统一 API 信封和业务 payload schema。
- 自动生成 OpenAPI 文档，前端 API Switch 从模拟模式切换到真实 HTTP 模式。

### 阶段 2：真实云端 AI Provider

- 增加后端 Provider 适配层：
  - `DoubaoProvider`
  - `QianwenProvider`
  - `DeepSeekProvider`
- API Key 通过环境变量注入，不写入前端。
- 增加超时、重试、降级、限流、费用统计和安全过滤。
- 支持同步响应与流式响应两种模式。

### 阶段 3：数据层升级

- 增加 Redis 作为热缓存。
- 增加 SQLite 或 Postgres 作为持久化数据库。
- 为用户画像、方案、食材、评估、营销内容、API 事件建立表结构。
- 增加数据过期策略、数据导出、数据清理和本地隐私保护。

### 阶段 4：真实 Switch 与全双工链路

- 在后端实现 API Switch / Gateway。
- 使用 WebSocket 或 SSE 推送实时 Agent 协同日志。
- 增加请求 trace、队列状态、Provider 状态、错误事件和任务完成事件。
- 前端控制台改为订阅真实事件流，而不是只使用本地队列模拟。

### 阶段 5：容器化与部署

- 新增 Dockerfile。
- 新增 `docker-compose.yml`，至少包含：
  - frontend 静态服务
  - backend FastAPI
  - redis
  - database
- 增加健康检查和启动脚本。
- 补充部署文档，说明本地、测试和生产环境配置。

### 阶段 6：端/边侧算力增强

- 将 BMI/BMR/TDEE 和部分评分逻辑迁入 Web Worker，避免主线程阻塞。
- 预留 WASM/WebGPU 接口，用于端侧轻量模型或规则引擎。
- 增加端侧性能检测，根据设备能力决定本地计算、边缘计算或云端计算。
- 增加离线模式：无网络时仍能生成基础方案。

### 阶段 7：测试与验收

- 增加 Playwright E2E：
  - 完整问卷到营销文案流程。
  - 权重滑块重新评估。
  - 多 AI 对抗面板渲染。
  - 发布包导出。
- 增加移动端和桌面端截图验收。
- 增加 API schema 单元测试。
- 增加后端 Provider mock 测试，避免真实 API Key 泄露。

## 未完成项优先级

| 优先级 | 工作项 | 原因 |
| --- | --- | --- |
| P0 | FastAPI 后端 + 真实 API schema | 这是从前端模拟升级到真实系统的基础。 |
| P0 | 云端 Provider Key 管理和真实调用 | 满足“国内 AI 豆、千、DS”的真实能力要求。 |
| P1 | Redis/数据库数据层 | 满足缓存与持久化的生产级要求。 |
| P1 | WebSocket/SSE Switch | 满足真实全双工、异步、非阻塞通信要求。 |
| P1 | Docker 容器化 | 满足业务层容器化要求。 |
| P2 | Web Worker/WASM 端侧算力 | 将端侧算力从简单计算升级为可扩展执行环境。 |
| P2 | Playwright E2E 和视觉验收 | 保证复杂 UI 和多步骤流程稳定。 |

## 2026-06-16 继续实现进展

本轮已继续完成以下未完成项：

- 已新增 `backend/` FastAPI 后端骨架。
- 已新增统一 API schema：
  - `ApiEnvelope`
  - `ApiResponse`
  - `ApiEvent`
  - `HealthResponse`
- 已新增 SQLite 数据层：
  - `records`
  - `api_events`
- 已新增后端 API Switch：
  - `POST /api/v1/switch/dispatch`
  - `GET /api/v1/switch/stats`
  - `GET /api/v1/events`
  - `GET /api/v1/events/stream`
- 已新增后端业务路由：
  - `/api/v1/system/boot`
  - `/api/v1/profile/create`
  - `/api/v1/diet/plans`
  - `/api/v1/ingredients/list`
  - `/api/v1/evaluation/score`
  - `/api/v1/cloud/providers/review`
  - `/api/v1/marketing/content`
  - `/api/v1/publish/package`
- 已新增云端 Provider 适配层：
  - 豆包 Doubao
  - 通义千问 Qianwen
  - DeepSeek DS
- Provider 已支持两种模式：
  - 没有 API Key 时使用 mock 模式，保证本地可运行。
  - 配置 API Key 和 URL 后走真实 HTTP Provider 调用，并保留失败降级。
- 已将前端 `apiSwitch.request()` 改为真实后端优先：
  - 默认探测 `http://127.0.0.1:8000/api/v1/health`。
  - 后端在线时统一发到 `POST /api/v1/switch/dispatch`。
  - 后端不可用时自动回退浏览器内本地模拟，不影响静态打开。
- 已新增容器化文件：
  - `backend/Dockerfile`
  - `docker-compose.yml`
- 已新增 `backend/README.md`，说明本地运行、Provider 环境变量和主要 API。
- 已新增 `.gitignore`，忽略 `.venv/`、`__pycache__/` 和本地 SQLite 数据库。
- 已安装后端依赖到 `.venv/`。

本轮验证结果：

- `python -m py_compile backend/*.py publisher_bot.py` 通过。
- `jsc new Function(app.js)` 通过。
- `git diff --check -- app.js backend docker-compose.yml seven_layer_implementation_plan.md modification_details.md` 通过。
- FastAPI 后端已启动验证过：
  - `GET /api/v1/health` 返回 `ok: true`。
  - `POST /api/v1/switch/dispatch` 可正确处理 `/api/v1/profile/create`。
  - `GET /api/v1/switch/stats` 可返回请求/响应/错误统计。
  - `GET /api/v1/events` 可返回 SQLite 中的 API 事件。

## 当前剩余未完成项

继续实现后，仍未完成的部分主要集中在真实生产化外部能力和测试覆盖：

| 优先级 | 剩余项 | 说明 |
| --- | --- | --- |
| P0 | 真实 Provider 联调 | 后端已支持真实 HTTP Provider 适配，但当前未配置真实豆包/千问/DeepSeek API Key，因此验证结果仍是 mock 模式。 |
| P1 | Redis 数据层 | 当前已从纯 `localStorage` 升级到 SQLite，尚未加入 Redis 热缓存服务。 |
| P1 | 真正的容器编排验证 | 已提供 Dockerfile 和 compose 文件，但本轮未执行 Docker build/up 验证。 |
| P1 | 前端订阅 SSE | 后端已有 `/api/v1/events/stream`，前端控制台还未切换为订阅真实 SSE 事件流。 |
| P2 | Web Worker/WASM 端侧算力 | 当前端侧算力仍在主线程执行 BMI/BMR/TDEE，尚未迁入 Web Worker。 |
| P2 | Playwright E2E | 尚未增加自动端到端流程测试和截图验收。 |

## 2026-06-17 继续实现进展

本轮根据当前可用的千问 API Key 和豆包方舟 Responses API 示例，继续补齐真实 Provider 接入与后端事件链路。实际密钥不写入仓库，统一通过 `.env`、`backend/.env` 或运行环境变量注入。

已完成：

- 已将豆包 Provider 默认接口切换为火山方舟 Responses API：
  - `https://ark.cn-beijing.volces.com/api/v3/responses`
  - 默认模型：`doubao-seed-2-0-lite-260428`
  - 请求体使用 `model` + `input` + `input_text`。
- 已保留千问 Provider 的 OpenAI 兼容接口：
  - `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  - 默认模型：`qwen-plus`
- 已将 DeepSeek Provider 保持为 OpenAI 兼容 `chat/completions`。
- 已增强 `backend/providers.py`：
  - 按 Provider 类型构造不同请求体。
  - 支持解析真实模型返回的 JSON 评分。
  - 解析失败或请求失败时自动降级到本地确定性评分，并标记 `fallback`。
  - 修复 Docker 环境中空字符串覆盖默认 URL / 模型的问题。
- 已新增本地环境配置加载：
  - 新增 `backend/config.py`。
  - FastAPI 启动时读取仓库根目录 `.env` 和 `backend/.env`。
  - shell / 容器环境变量优先级高于本地 `.env`。
- 已新增 `.env.example`，记录 Provider 变量名、默认 URL 和默认模型，不包含真实密钥。
- 已更新 `.gitignore`，忽略 `.env`、`.env.*`、`backend/.env` 和 `backend/.env.*`，避免密钥误提交。
- 已更新 `docker-compose.yml`，为豆包、千问、DeepSeek 写入默认 URL 和模型。
- 已更新 `backend/README.md`，说明真实 Provider 配置、豆包 Responses 请求形态和降级策略。
- 已将前端接入后端 SSE：
  - 后端在线时订阅 `GET /api/v1/events/stream`。
  - 真实 Switch 事件会同步写入前端 `apiEvents`。
  - Switch 运行态面板新增 SSE 事件流状态。
  - 后端不可用时自动关闭事件流并回退本地模拟。

本轮之后的剩余项：

| 优先级 | 剩余项 | 当前状态 |
| --- | --- | --- |
| P0 | 真实 Provider 联调 | 代码已支持豆包 Responses 和千问 OpenAI 兼容接口；仍需要在本机 `.env` 写入真实 key 后进行联网验证。 |
| P1 | Redis 数据层 | 未开始；当前仍是 SQLite 持久化 + 前端 Map/localStorage。 |
| P1 | Docker 编排验证 | Compose 配置已更新；仍未执行 Docker build/up。 |
| P2 | Web Worker/WASM 端侧算力 | 未开始；BMI/BMR/TDEE 仍在主线程。 |
| P2 | Playwright E2E | 未开始；尚未增加自动流程测试和截图验收。 |

## 2026-06-17 功能化整改补充

根据最新要求，已将“七层”和“五个助理”从页面直接展示改为内部功能链路：

- `index.html`
  - 移除侧栏角色列表。
  - 移除侧栏七层状态。
  - 移除主工作区七层运行态面板、Provider 状态卡、API Switch 指标卡、数据层状态卡、本地算力状态卡和 3D 架构栈。
  - 将页面标题和步骤标题改为业务结果导向：基础健康问卷、个性化膳食方案、分类食材采购清单、方案量化评估、多平台推广文案。
  - 评估阶段保留智能复核结果，但不显示真实模型供应商名。
- `app.js`
  - 保留真实后端、Provider 调用、API envelope、Switch 调度、SSE、缓存和本地计算能力。
  - 旧架构展示渲染函数改为 no-op，避免旧 DOM 容器恢复后重新显示架构内容。
  - 处理日志改为业务进度：画像、方案、清单、评估、文案、服务、保存。
  - 营销文案模板、短视频脚本和发布包文案已移除“多智能体/助理/内部节点”等实现表述。
  - 智能复核卡片只显示复核维度：可执行性复核、营养结构复核、量化约束复核。
- `style.css`
  - 删除未使用的角色卡、七层运行态、Provider/Switch 指标、3D 架构栈样式。
  - 保留业务流程、评估、复核、日志和响应式布局样式。
- `backend/main.py`
  - 增加 `/style.css` 和 `/app.js` 静态文件路由。
  - 修复通过 `http://127.0.0.1:8000/` 打开时样式和脚本 404 的问题。

当前功能验收口径：

- 用户填写基本信息后生成结构化画像。
- 系统生成 3 套饮食方案，每套包含热量、营养素配比和一日三餐/加餐。
- 系统为每套方案生成分类采购清单、预估重量和储存建议。
- 系统从成本、季节匹配度、地域匹配度量化评估并自动推荐最终方案。
- 系统基于最终方案生成小红书、短视频脚本和微信公众号文案。
- 内部仍真实调用三家 Provider 进行复核，但 UI 不暴露供应商和架构细节。

本轮验证结果：

- `python -m py_compile backend/*.py publisher_bot.py` 通过。
- `jsc new Function(app.js)` 通过。
- `git diff --check -- app.js backend docker-compose.yml .gitignore .env.example seven_layer_implementation_plan.md modification_details.md` 通过。
- FastAPI TestClient 验证通过：
  - `GET /api/v1/health` 返回 `health True mock`。
  - `POST /api/v1/switch/dispatch` 调用 `/api/v1/cloud/providers/review` 返回 `provider True doubao mock 1`。
- 密钥片段扫描未命中，确认真实 key 未写入仓库文件。

## 2026-06-17 真实 Provider 联调补充

已将三家真实 Provider key 写入本地 ignored `.env`，不进入 git：

- 豆包 Doubao：火山方舟 Responses API。
- 通义千问 Qianwen：DashScope OpenAI 兼容接口。
- DeepSeek DS：OpenAI 兼容接口。

联网烟测结果：

- `GET /api/v1/health` 返回 `providerMode=real:doubao,qianwen,deepseek`。
- `/api/v1/cloud/providers/review` 三家 Provider 均返回 `real` 模式：
  - `doubao real 2`
  - `qianwen real 2`
  - `deepseek real 2`
- 本地 FastAPI 服务已可使用真实 Provider 配置启动，地址为 `http://127.0.0.1:8000`。

当前状态：

| 优先级 | 剩余项 | 当前状态 |
| --- | --- | --- |
| P0 | 真实 Provider 联调 | 已完成豆包、千问、DeepSeek 最小联调。后续可继续补流式响应、费用统计、重试限流和内容安全。 |
| P1 | Redis 数据层 | 未开始；当前仍是 SQLite 持久化 + 前端 Map/localStorage。 |
| P1 | Docker 编排验证 | Compose 配置已更新；仍未执行 Docker build/up。 |
| P2 | Web Worker/WASM 端侧算力 | 未开始；BMI/BMR/TDEE 仍在主线程。 |
| P2 | Playwright E2E | 未开始；尚未增加自动流程测试和截图验收。 |
