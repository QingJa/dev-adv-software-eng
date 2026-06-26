# 个性化健康饮食规划系统

这是一个可本地运行、支持账户数据持久化的健康饮食规划应用。项目由前端单页应用、FastAPI 后端、SQLite 数据库和可选云端大模型 Agent 编排组成，主流程覆盖从用户画像采集、饮食计划生成、方案评估到最终方案采购清单；计划分享与商家推广作为独立附加页进入，不计入问卷步骤。

## 当前能力

- 用户账户：支持注册、登录、读取当前用户、更新画像；密码使用 PBKDF2-SHA256 加盐哈希保存。
- 用户画像：采集性别、年龄、身高、体重、健康目标、活动量、饮食风格、地域口味、过敏/禁忌和补充文本。
- 计划周期：支持生成一天、一周或一个月的饮食计划；一个月按 30 天准备。
- 日期保存：登录用户的每日计划按 `user_id + plan_date` 保存到 SQLite。再次查看同一日期时优先读取数据库；只有点击“重新生成当天”才覆盖该日期。
- 三套方案：每个日期由多 Agent 生成 3 套不同侧重点的膳食方案，并包含热量、宏量营养比例、三餐/加餐、Agent 共识分和食材明细。
- 局部调整：支持固定菜品、删除菜品，并在重新生成当天时保留或替换对应菜品。
- 采购清单：按肉蛋奶、蔬果、谷物、调味品分类生成采购明细，并支持勾选。
- 方案评估：按成本、季节、地域权重实时评分并推荐最终方案。
- 大模型 Agent：可接入豆包、通义千问、DeepSeek，覆盖用户画像、方案生成、方案复核、食材清单、用户分享和商家推广；未配置 key 时自动使用 mock/fallback。
- 计划分享：生成小红书个人分享文案、短视频打卡脚本、计划长文记录，并提供本地半自动分享助手说明。
- 商家推广：与用户分享分开展示，仅作为卖家/运营可选模块，推广内容需脱敏并获得授权。
- 离线兜底：后端不可用时，前端会回退到浏览器本地计算和 `localStorage` 持久化。

## 技术栈

- 前端：原生 HTML/CSS/JavaScript 单页应用。
- 后端：FastAPI、Pydantic、Uvicorn。
- 数据库：SQLite。
- 鉴权：自签名 HMAC Bearer token。
- 大模型编排：HTTP API 调用豆包、通义千问、DeepSeek，支持 mock/fallback。
- 容器化：Dockerfile + Docker Compose。
- 分享辅助：`publisher_bot.py` 使用 Playwright 辅助填充个人平台分享内容，最终发布需人工确认。

## 项目结构

```text
.
├── index.html                  # 前端页面结构
├── app.js                      # 前端状态、生成流程、日期计划读写、评估和文案逻辑
├── style.css                   # 页面样式和响应式布局
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
└── .env.example                # 环境变量模板，不包含真实密钥
```

## 核心流程

1. 用户填写健康问卷，前端计算 BMI、BMR、TDEE，并生成结构化画像。
2. 用户选择计划周期和起始日期。
3. 前端按日期范围检查已保存计划：
   - 登录时优先读取 SQLite 中的 `diet_plans`。
   - 未登录或后端不可用时读取浏览器本地记录。
   - 缺失日期才重新生成并尝试保存。
4. 用户查看某天计划，切换日期时只读取或生成该日期。
5. 用户固定/删除某个菜品后，点击“重新生成当天”只覆盖当前日期，不影响周期内其它日期。
6. 当前日期的多套方案先进入方案评分和云端复核，确定最终推荐后生成采购清单；食材清单页右上角可进入独立的分享/推广附加页。配置大模型 API 后，第 1 步用户画像、第 2 步方案生成、第 3 步智能复核、第 4 步食材清单和附加页文案都会优先由大模型 Agent 生成。

## 数据持久化

SQLite 默认数据库路径：

```text
backend/diet_planner.db
```

主要表：

- `users`：账户、密码哈希、用户画像、创建/更新时间、最近登录时间。
- `diet_plans`：按 `user_id + plan_date` 保存每日计划，包含周期、画像快照、3 套方案、讨论结果、调整约束和代谢指标。
- `records`：通用业务快照。
- `api_events`：API Switch 请求、响应、错误和事件流记录。

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
- `GET /api/v1/diet/plans/saved?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/v1/diet/plans/saved/{plan_date}`
- `POST /api/v1/diet/plans/saved`
- `POST /api/v1/switch/dispatch`
- `GET /api/v1/switch/stats`
- `GET /api/v1/events`
- `GET /api/v1/events/stream`

前端默认探测 `http://127.0.0.1:8000`。后端在线时使用真实 HTTP API；后端不可用时自动回退本地流程。

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
