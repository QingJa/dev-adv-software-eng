# 个性化健康饮食规划系统

这是一个可本地运行、支持账户数据持久化和基础商业化闭环的健康饮食规划应用。项目由前端单页应用、FastAPI 后端、SQLite 数据库、PWA/Android WebView 套壳和可选云端大模型 Agent 编排组成。当前首屏是客户主页，用户可以查看当天饮食计划、打卡状态、体重记录和会员权益；问卷、计划生成、采购清单、分享推广和 APP 上线能力作为业务流程继续展开。

## 当前能力

- 用户账户：支持注册、登录、读取当前用户、更新画像；登录后会自动读取客户画像，若数据库中暂无画像则跳转到基础健康问卷收集；密码使用 PBKDF2-SHA256 加盐哈希保存。
- 会员商业化：侧边栏提供免费版、Pro 月会员、Pro 年会员展示；登录用户可通过演示下单接口开通 Pro，后端会记录订单、订阅和权益。
- 权益控制：免费版仅开放单日计划和基础采购清单；Pro 解锁一周/一个月计划、周期合并采购清单、历史菜单复盘、分享报告/视频/数据包导出和端侧离线能力。
- 客户主页：计划生成后的主工作台，集中展示当天计划、热量目标、打卡面板、采购清单入口和体重记录。
- 用户画像：采集性别、年龄、身高、体重、健康目标、活动量、饮食风格、地域口味、过敏/禁忌和补充文本。
- 计划周期：支持一天、一周或一个月；免费版会锁定一周/月入口，Pro 会员解锁完整周期计划，一个月按 30 天准备。
- 日期保存：登录用户的每日计划按 `user_id + plan_date` 保存到 SQLite。再次查看同一日期时优先读取数据库；只有点击“重新生成当天”才覆盖该日期。
- 三套方案：每个日期由多 Agent 生成 3 套不同侧重点的膳食方案，并包含热量、宏量营养比例、三餐/加餐、Agent 共识分和食材明细。
- 局部调整：支持固定菜品、删除菜品，并在重新生成当天时保留或替换对应菜品。
- 采购清单：按肉蛋奶、蔬果、谷物、调味品分类生成采购明细，并支持勾选；Pro 会员可合并周期内多天采购清单。
- 体重记录：客户主页和问卷页都有独立的日期、体重输入框，点击“保存体重记录”后按输入值保存，并使用画像身高计算 BMI 和趋势。
- 客户打卡：支持当天及历史日期完成/跳过打卡、记录饱腹感、执行难度、是否外食和备注；未来日期只展示计划，不允许写入执行结果。
- 历史菜单：可保存当天或历史日期的菜单快照，Pro 会员用于复盘；登录态下会同步到 SQLite。
- 方案评估：按成本、季节、地域权重实时评分并推荐最终方案。
- 大模型 Agent：可接入豆包、通义千问、DeepSeek，覆盖用户画像、方案生成、方案复核、食材清单、用户分享和商家推广；未配置 key 时自动使用 mock/fallback。
- 计划分享：生成小红书个人分享文案、短视频打卡脚本、计划长文记录，并提供本地半自动分享助手说明。
- 商家推广：与用户分享分开展示，仅作为卖家/运营可选模块，推广内容需脱敏并获得授权。
- APP 上线：提供 `manifest.webmanifest`、`sw.js`、应用图标、PWA 安装入口和 Android WebView 套壳工程；主页“APP 上线”入口只跳转到带套壳标识的包装网页。
- 离线兜底：后端不可用时，前端会回退到浏览器本地计算和 `localStorage` 持久化。

## 技术栈

- 前端：原生 HTML/CSS/JavaScript 单页应用。
- 后端：FastAPI、Pydantic、Uvicorn。
- 数据库：SQLite。
- 鉴权：自签名 HMAC Bearer token。
- 大模型编排：HTTP API 调用豆包、通义千问、DeepSeek，支持 mock/fallback。
- 商业权益：后端保存会员套餐、订单和订阅状态，前端按权益锁定或开放功能。
- PWA/套壳：Web App Manifest、Service Worker、Android WebView。
- 容器化：Dockerfile + Docker Compose。
- 分享辅助：`publisher_bot.py` 使用 Playwright 辅助填充个人平台分享内容，最终发布需人工确认。

## 项目结构

```text
.
├── index.html                  # 前端页面结构
├── app.js                      # 前端状态、生成流程、日期计划读写、评估和文案逻辑
├── style.css                   # 页面样式和响应式布局
├── launch.js                   # PWA、APP 套壳、端侧模型和商业闭环运行时
├── edge-model.js               # 浏览器端侧饮食规划兜底模型
├── sw.js                       # Service Worker 缓存和离线兜底
├── manifest.webmanifest        # PWA 安装清单
├── assets/app-icon.svg         # 应用图标
├── publisher_bot.py            # 本地个人平台分享辅助脚本
├── docker-compose.yml          # 本地容器编排
├── backend/
│   ├── main.py                 # FastAPI 入口、鉴权、接口路由、静态文件服务
│   ├── storage.py              # SQLite 初始化和读写封装
│   ├── schemas.py              # Pydantic 请求/响应模型
│   ├── services.py             # 本地确定性饮食、食材、评分、文案生成服务
│   ├── providers.py            # 云端大模型 Agent 客户端与 mock/fallback 调度
│   ├── switch.py               # API Switch 请求信封调度和事件记录
│   ├── config.py               # .env 加载
│   └── requirements.txt        # 后端依赖
├── mobile/android/             # Android WebView 套壳工程
└── .env.example                # 环境变量模板，不包含真实密钥
```

## 核心流程

1. 用户进入客户主页；未生成计划时可重新填写问卷或定制当前计划。
2. 用户登录后，前端读取账户画像和会员权益；有画像时自动填回问卷，无画像时跳转到基础健康问卷收集；免费版锁定周期和分享类 Pro 功能。
3. 用户填写健康问卷，前端计算 BMI、BMR、TDEE，并生成结构化画像。
4. 用户选择计划周期和起始日期；免费版只能生成一天，Pro 可生成一周或一个月。
5. 前端按日期范围检查已保存计划：
   - 登录时优先读取 SQLite 中的 `diet_plans`。
   - 未登录或后端不可用时读取浏览器本地记录。
   - 缺失日期才重新生成并尝试保存。
6. 用户查看某天计划，切换日期时只读取或生成该日期。
7. 用户固定/删除某个菜品后，点击“重新生成当天”只覆盖当前日期，不影响周期内其它日期。
8. 提交问卷后先进入膳食方案页，保留方案查看、固定/删除菜品和重新生成当天等交互；用户点击“下一步”才进入方案评分和云端复核。
9. 评估完成后，用户继续点击“下一步”生成食材采购清单；食材清单完成页提供返回客户主页入口，主页展示完整流转后的当天计划、打卡和体重记录。
10. Pro 用户可进入分享/推广附加页，导出分享报告、打卡视频和分享数据包。配置大模型 API 后，用户画像、方案生成、智能复核、食材清单和附加页文案都会优先由大模型 Agent 生成。

## 数据持久化

SQLite 默认数据库路径：

```text
backend/diet_planner.db
```

主要表：

- `users`：账户、密码哈希、用户画像、创建/更新时间、最近登录时间。
- `diet_plans`：按 `user_id + plan_date` 保存每日计划，包含周期、画像快照、3 套方案、讨论结果、调整约束和代谢指标。
- `diet_checkins`：按 `user_id + plan_date` 保存客户打卡、备注、执行反馈和菜单快照。
- `history_menus`：按 `user_id + plan_date` 保存历史菜单复盘快照。
- `subscription_orders`：保存会员套餐演示订单、金额、渠道、支付方式和订单载荷。
- `user_subscriptions`：保存当前用户会员套餐、权益、状态、起止时间和来源订单。
- `records`：通用业务快照。
- `api_events`：API Switch 请求、响应、错误和事件流记录。

浏览器本地还会通过 `localStorage` 保存未登录用户的计划、体重记录、打卡、历史菜单、端侧模型结果和商业运行时快照。体重记录当前只做本地持久化，登录态下会按用户 ID 分隔本地记录。

## 快速运行

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

打开：

```text
http://127.0.0.1:8000/
```

如果不启动后端，也可以直接打开 `index.html`。此时前端会使用本地计算和模拟复核流程，登录、数据库读取和跨设备持久化不可用。

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

访问：

```text
http://127.0.0.1:8000/
```

## 环境变量

仓库不会提交真实 API Key。需要真实调用豆包、通义千问或 DeepSeek 时：

```bash
cp .env.example .env
```

主要变量：

```text
DIET_PLANNER_DB=backend/diet_planner.db
CORS_ALLOW_ORIGINS=*
AUTH_SECRET=replace-with-a-long-random-secret
LLM_PRIMARY_PROVIDER=deepseek
LLM_TIMEOUT_SECONDS=60

DOUBAO_API_KEY=
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3/responses
DOUBAO_MODEL=doubao-seed-2-0-lite-260428

QIANWEN_API_KEY=
QIANWEN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
QIANWEN_MODEL=qwen-plus

DEEPSEEK_API_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
```

`LLM_PRIMARY_PROVIDER` 可填 `deepseek`、`qianwen` 或 `doubao`。`LLM_TIMEOUT_SECONDS` 用于控制大模型 HTTP 请求超时；多方案生成一次要返回 3 套完整 JSON，建议不低于 45 秒。未填写 key 时，后端会自动使用 mock/fallback 模式，应用仍可完整运行。

## 主要后端接口

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `PUT /api/v1/auth/me/profile`
- `GET /api/v1/business/plans`
- `GET /api/v1/business/subscription/me`
- `POST /api/v1/business/orders/checkout`
- `GET /api/v1/diet/plans/saved?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/v1/diet/plans/saved/{plan_date}`
- `POST /api/v1/diet/plans/saved`
- `GET /api/v1/diet/checkins?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `POST /api/v1/diet/checkins`
- `GET /api/v1/diet/history-menus?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `POST /api/v1/diet/history-menus`
- `POST /api/v1/switch/dispatch`
- `GET /api/v1/switch/stats`
- `GET /api/v1/events`
- `GET /api/v1/events/stream`

前端默认探测 `http://127.0.0.1:8000`。后端在线时使用真实 HTTP API；后端不可用时自动回退本地流程。

## 会员权益

当前实现使用演示支付，不接入真实支付网关：

- `free`：免费体验版，支持单日基础方案、本地计划记录和基础采购清单。
- `pro_month`：Pro 月会员，演示价格 `19.9` 元，开通后 31 天有效。
- `pro_year`：Pro 年会员，演示价格 `199` 元，开通后 366 天有效。

开通 Pro 后，前端会解锁一周/一个月计划、周期合并采购清单、历史菜单复盘、分享报告导出、计划打卡视频生成和分享数据包下载。侧边栏会员卡片和 APP 上线面板里的“开通 Pro 演示”都会写入同一套订单与订阅表。

## APP 上线与套壳

- PWA：`manifest.webmanifest`、`sw.js` 和 `assets/app-icon.svg` 提供安装入口、缓存和离线兜底。
- Android WebView：`mobile/android` 下包含 Gradle 工程和 `MainActivity.java`，通过 `BuildConfig.APP_URL` 加载 Web 应用。
- 主页“APP 上线”按钮不会再打开复杂上线面板，只会跳转到当前站点的包装网页参数：`?source=android-webview&appShell=wrapped-web`。

## 验证命令

```bash
. .venv/bin/activate
python -m py_compile backend/*.py publisher_bot.py
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e 'const src = readFile("app.js"); new Function(src); print("app.js syntax ok");'
git diff --check
```

可选接口烟测：

```bash
curl -s http://127.0.0.1:8000/api/v1/health
```

## 注意事项

- `.env`、本地 SQLite 数据库、虚拟环境和缓存文件不应提交。
- `AUTH_SECRET` 在生产环境必须替换为高强度随机字符串。
- 当前 SQLite 适合本地和演示场景；生产部署建议迁移到 Postgres/MySQL，并增加迁移、备份和审计策略。
