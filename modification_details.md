# 当前修改详情

生成时间：2026-06-16

## 修改目标

本次修改在现有 `implementation_plan.md` 的多智能体健康饮食规划 SPA 基础上，补齐用户要求的 7 个层次，并将后续完整计划输出为当前目录文件 `seven_layer_implementation_plan.md`。

7 个层次均已在页面、状态模型、API 调度和业务流程中落地：

1. 云端平台：国内 AI Provider，豆包、千问、DeepSeek。
2. 数据层：内存热缓存 `Map` 与 `localStorage` 持久化。
3. 业务层：5 个业务容器、多 API、多 AI 对抗、云端协同。
4. API 层：内部和云端调用统一使用 JSON 协议信封。
5. Switch 层：API 总调度，全双工、异步、非阻塞，FastAPI 风格路由。
6. UI 层：MVC/MVVM 状态渲染，并加入轻量 3D 架构栈。
7. 端/边侧算力：浏览器端侧完成 BMI、BMR、TDEE、缓存命中和设备侧计算状态。

## 新增文件

| 文件 | 说明 |
| --- | --- |
| `seven_layer_implementation_plan.md` | 后续完整详细实施计划，按 7 层架构和逐文件顺序列出落地步骤与验收标准。 |

## 修改文件

| 文件 | 修改概览 |
| --- | --- |
| `index.html` | 新增侧边栏七层状态、主工作区七层架构运行态面板、3D 架构栈、云端 Provider/API Switch/数据层/端侧算力容器，以及评估阶段多 AI 对抗评审容器。 |
| `style.css` | 新增七层架构面板、3D 架构栈、Provider 状态卡、API Switch 指标、双层数据状态、端侧算力状态、多 AI 对抗评分卡、浅色主题和移动端适配样式。 |
| `app.js` | 新增架构注册表、双层数据层、API Switch、统一 API 信封、端侧算力计算、多 AI 对抗评审、共识分合并、运行态渲染和关键业务流程 API 化。 |
| `modification_details.md` | 更新为当前这笔修改的完整记录。 |

## 关键实现点

### 1. 云端平台层

- 注册 3 个国内 AI Provider：
  - `豆包 Doubao`
  - `通义千问 Qianwen`
  - `DeepSeek DS`
- Provider 状态在「七层架构运行态」面板展示。
- 评估阶段通过 `/api/v1/cloud/providers/review` 并行调用三家 Provider 进行方案评审。

### 2. 数据层

- `memoryCache` 使用 `Map` 作为热缓存。
- `persistentRecords` 使用 `localStorage` 做持久化快照。
- 画像、膳食方案、食材清单、评估结果、AI 对抗结果、营销文案和发布包均写入数据层。
- UI 展示缓存条数、命中次数、持久化快照数量、最近数据键。

### 3. 业务层

- 建立 5 个业务容器注册：
  - `customer-manager`
  - `diet-planner`
  - `ingredient-planner`
  - `evaluation-engine`
  - `marketing-writer`
- 原五步业务流程保持完整，并通过 API Switch 串联。
- 评估阶段加入多 AI 对抗，规则分与 AI 共识分共同影响推荐方案。

### 4. API 层

- 新增 `createApiEnvelope()`。
- API 信封包含：
  - `traceId`
  - `protocol`
  - `method`
  - `route`
  - `source`
  - `target`
  - `duplex`
  - `payload`
  - `meta`
  - `createdAt`

### 5. API Switch 层

- 新增 `apiSwitch.request()`。
- 支持 Promise 异步调度，模拟非阻塞请求/响应。
- 展示队列深度、请求数量、响应数量、最近路由、全双工通道和 FastAPI 风格路由。
- 当前主要路由：
  - `/api/v1/profile/create`
  - `/api/v1/diet/plans`
  - `/api/v1/ingredients/list`
  - `/api/v1/evaluation/score`
  - `/api/v1/cloud/providers/review`
  - `/api/v1/marketing/content`
  - `/api/v1/publish/package`

### 6. UI 层

- 新增「七层架构运行态」常驻面板。
- 新增 CSS 3D 架构栈展示 7 层结构。
- `state` 作为 Model，渲染函数作为 ViewModel，事件处理与 Switch 调度作为 Controller。
- 保持原问卷、方案、食材、评估、营销五步 SPA 体验。

### 7. 端/边侧算力层

- `computeEdgeProfile()` 在浏览器端侧计算：
  - BMI
  - BMR
  - TDEE
  - 端侧耗时
  - 缓存状态
- 端侧计算结果写入热缓存和持久化层，并在 UI 中展示。

## 验证结果

已执行：

```text
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e 'const src = readFile("app.js"); new Function(src); print("app.js syntax ok");'
```

结果：

```text
app.js syntax ok
```

已执行：

```text
python3 -m py_compile publisher_bot.py
```

结果：通过，无输出。

已执行：

```text
git diff --check -- index.html style.css app.js seven_layer_implementation_plan.md modification_details.md
```

结果：通过，无输出。

说明：本机当前没有 `node` 命令，因此 JS 语法检查改用系统 JavaScriptCore `jsc` 完成。

## 当前工作区状态

主要变更文件：

```text
M app.js
M index.html
M style.css
?? implementation_plan.md
?? modification_details.md
?? seven_layer_implementation_plan.md
```

其中 `implementation_plan.md` 是既有需求文件，本次没有改动。

## 追加实现：真实后端与容器化

追加时间：2026-06-16

本轮继续实现计划中的未完成项，新增真实后端骨架、依赖安装、SQLite 数据层、后端 API Switch、Provider 适配层和容器化文件。

### 新增文件

| 文件 | 说明 |
| --- | --- |
| `.gitignore` | 忽略 `.venv/`、`__pycache__/`、本地 SQLite 数据库等运行产物。 |
| `backend/requirements.txt` | FastAPI、uvicorn、Pydantic、httpx 依赖。 |
| `backend/schemas.py` | 统一 API 信封、响应、事件和健康检查 schema。 |
| `backend/storage.py` | SQLite 记录表和 API 事件表。 |
| `backend/providers.py` | 豆包、千问、DeepSeek Provider 适配层，支持 mock 和真实 HTTP 调用。 |
| `backend/services.py` | 画像、膳食、食材、评估、营销业务服务。 |
| `backend/switch.py` | 后端 API Switch，总调度、事件记录和统计。 |
| `backend/main.py` | FastAPI 应用入口、CORS、dispatch、stats、events、SSE、静态首页。 |
| `backend/Dockerfile` | 后端容器镜像。 |
| `backend/README.md` | 后端运行说明、环境变量和接口清单。 |
| `docker-compose.yml` | 后端服务和持久化 volume 编排。 |

### 前端变更

- `app.js` 的 `apiSwitch.request()` 已改为真实后端优先。
- 默认探测 `http://127.0.0.1:8000/api/v1/health`。
- 后端在线时发到 `POST /api/v1/switch/dispatch`。
- 后端不可用时自动回退浏览器内本地模拟。
- Switch 面板新增真实后端状态展示。
- 多 AI 对抗阶段优先使用后端 Provider 返回；后端不可用时继续使用本地评审。

### 依赖安装

已创建 `.venv/` 并安装：

```text
fastapi 0.124.4
uvicorn 0.38.0
pydantic 2.13.4
httpx 0.28.1
```

说明：系统 Python 是 3.14，初始固定的 `pydantic==2.11.7` 会触发旧 `pydantic-core` 源码构建失败；已更新为 `pydantic==2.13.4`，使用支持 Python 3.14 的 wheel。

### 追加验证

已执行：

```text
. .venv/bin/activate && python -m py_compile backend/*.py publisher_bot.py
```

结果：通过。

已执行：

```text
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e 'const src = readFile("app.js"); new Function(src); print("app.js syntax ok");'
```

结果：

```text
app.js syntax ok
```

已执行：

```text
git diff --check -- app.js backend docker-compose.yml seven_layer_implementation_plan.md modification_details.md
```

结果：通过。

已启动 FastAPI 后端并验证：

```text
GET /api/v1/health
POST /api/v1/switch/dispatch
GET /api/v1/switch/stats
GET /api/v1/events
```

验证结果：

```text
health ok
dispatch /api/v1/profile/create ok
stats totalRequests=1 totalResponses=1 totalErrors=0
events contains request/response records
```

验证完成后已停止本地后端服务。

## 追加实现：真实 Provider 请求形态与 SSE

追加时间：2026-06-17

本轮继续推进 `seven_layer_implementation_plan.md` 中的 P0/P1 未完成项。用户已提供千问和豆包 API 信息；实际密钥未写入仓库，改为通过 `.env`、`backend/.env` 或运行环境变量加载。

### 新增文件

| 文件 | 说明 |
| --- | --- |
| `.env.example` | Provider、本地数据库和 CORS 环境变量模板，不包含真实密钥。 |
| `backend/config.py` | FastAPI 启动时加载根目录 `.env` 与 `backend/.env`，且不覆盖已存在的 shell / 容器环境变量。 |

### 修改文件

| 文件 | 修改概览 |
| --- | --- |
| `.gitignore` | 忽略 `.env`、`.env.*`、`backend/.env` 和 `backend/.env.*`，保留 `.env.example`。 |
| `backend/providers.py` | 豆包默认切换到方舟 Responses API；千问/DeepSeek 保持 OpenAI 兼容 Chat Completions；真实返回支持 JSON 评分解析，失败时降级本地评分。 |
| `backend/main.py` | 启动时加载本地环境配置。 |
| `backend/README.md` | 更新真实 Provider 配置说明、默认模型和降级策略。 |
| `docker-compose.yml` | 为 Provider URL 和模型写入安全默认值，避免空字符串覆盖后端默认值。 |
| `app.js` | 后端在线时订阅 `/api/v1/events/stream`；前端运行态面板新增 SSE 事件流状态；后端不可用时关闭事件流并回退本地模拟。 |
| `seven_layer_implementation_plan.md` | 追加 2026-06-17 实现进展与剩余项。 |

### 当前 Provider 配置方式

本机真实调用时创建 `.env` 或 `backend/.env`，填入：

```text
DOUBAO_API_KEY=...
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3/responses
DOUBAO_MODEL=doubao-seed-2-0-lite-260428

QIANWEN_API_KEY=...
QIANWEN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
QIANWEN_MODEL=qwen-plus
```

后端健康检查会通过 `providerMode` 显示当前启用的真实 Provider，例如 `real:doubao,qianwen`；未配置 key 时继续显示 `mock`。

### 本轮验证

已执行：

```text
. .venv/bin/activate && python -m py_compile backend/*.py publisher_bot.py
```

结果：通过。

已执行：

```text
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e 'const src = readFile("app.js"); new Function(src); print("app.js syntax ok");'
```

结果：

```text
app.js syntax ok
```

已执行：

```text
git diff --check -- app.js backend docker-compose.yml .gitignore .env.example seven_layer_implementation_plan.md modification_details.md
```

结果：通过。

已执行密钥片段扫描，覆盖本轮用户提供的真实密钥前缀和方舟 token 片段：

```text
rg -n "<本轮真实密钥片段>" .
```

结果：未命中，确认真实 key 未写入仓库文件。

已执行 FastAPI TestClient 检查：

```text
GET /api/v1/health -> health True mock
POST /api/v1/switch/dispatch /api/v1/cloud/providers/review -> provider True doubao mock 1
```

说明：真实 Provider 联网验证尚未执行，因为需要先在本机 `.env` 或运行环境中配置真实 key。

## 追加实现：真实 Key 本地配置与联网烟测

追加时间：2026-06-17

本轮已按用户确认的真实 key 完成本地配置：

- `.env` 已写入豆包、千问、DeepSeek 的真实 Provider 配置。
- `.env` 已由 `.gitignore` 忽略，不会进入 git diff 或提交。
- 文档和源码不记录任何真实 key。

真实联网烟测结果：

```text
health real:doubao,qianwen,deepseek
doubao real 2
qianwen real 2
deepseek real 2
```

后端服务已启动：

```text
http://127.0.0.1:8000
```

健康检查确认：

```text
{"ok":true,"service":"seven-layer-diet-planner","version":"0.2.0","providerMode":"real:doubao,qianwen,deepseek","database":"backend/diet_planner.db"}
```

## 追加实现：从架构展示改为功能实现

追加时间：2026-06-17

根据最新要求，七层架构和五个助理都应当是内部功能职责，而不是页面直接展示的内容。本轮已将前端从“架构演示面板”调整为“业务产品界面”。

### 修改文件

| 文件 | 修改概览 |
| --- | --- |
| `index.html` | 移除侧栏角色列表、七层状态区域、主工作区七层运行态面板和 3D 架构栈；页面标题和步骤标题改为业务功能。 |
| `style.css` | 删除未使用的角色卡、七层运行态、Provider/Switch 指标和 3D 架构栈样式；保留业务流程、评估、复核和处理进度样式。 |
| `app.js` | 保留内部真实后端、Provider、统一 API、Switch、SSE、缓存和本地计算能力；移除用户可见的架构/角色文案；旧架构渲染函数改为 no-op。 |
| `backend/main.py` | 新增 `/style.css` 和 `/app.js` 静态文件路由，确保通过 FastAPI 根路径打开页面时样式和脚本可正常加载。 |
| `seven_layer_implementation_plan.md` | 追加口径修正：七层和五段助理作为内部功能链路实现，不直接展示。 |

### 用户可见界面调整

- `基础健康问卷`
- `个性化膳食方案`
- `分类食材采购清单`
- `方案量化评估`
- `多平台推广文案`

不再直接显示：

- `七层架构运行态`
- `七层实现状态`
- `3D 架构栈`
- `客户经理 / 饮食助理 / 食材助理 / 评估助理 / 营销助理`
- `豆包 / 千问 / DeepSeek / Provider / API Switch / 数据层`

### 保留的内部功能

- 三家真实 Provider 仍通过后端参与方案复核。
- 前后端仍使用统一 API envelope 和后端 Switch 调度。
- 后端 SSE 仍用于同步处理事件。
- 本地缓存、持久化、本地 BMI/BMR/TDEE 计算仍保留。
- 评估阶段仍融合本地评分和多角度智能复核共识分。

### 本轮补充验证

已确认 FastAPI 静态入口：

```text
GET / -> 200 text/html
GET /style.css -> 200 text/css
GET /app.js -> 200 text/javascript
```

已扫描首页 HTML，不再命中旧的直接展示词：

```text
七层架构运行态 / 七层实现状态 / 客户经理 / 饮食助理 / 食材助理 / 评估助理 / 营销助理 / API Switch / 豆包 / 千问 / DeepSeek / Provider
```
