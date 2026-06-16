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
