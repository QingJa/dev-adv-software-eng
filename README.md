# 个性化健康饮食规划系统

这是一个可直接本地运行的健康饮食规划应用。前端提供问卷、画像、膳食方案、采购清单、方案评估和推广文案生成；后端提供 FastAPI API、统一请求信封、事件流、SQLite 持久化和云端模型复核。

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

如果不启动后端，也可以直接打开 `index.html`。此时前端会使用本地计算和模拟复核流程。

## 配置真实模型

仓库不会提交真实 API Key。需要真实调用豆包、通义千问或 DeepSeek 时：

```bash
cp .env.example .env
```

然后填写 `.env` 中的 key。未填写 key 时，后端会自动使用 mock/fallback 模式，应用仍可完整运行。

主要变量：

```text
DOUBAO_API_KEY=
QIANWEN_API_KEY=
DEEPSEEK_API_KEY=
```

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

访问：

```text
http://127.0.0.1:8000/
```

## 主要后端接口

- `GET /api/v1/health`
- `POST /api/v1/switch/dispatch`
- `GET /api/v1/switch/stats`
- `GET /api/v1/events`
- `GET /api/v1/events/stream`

前端默认会探测 `http://127.0.0.1:8000`。后端在线时使用真实 API；后端不可用时自动回退本地流程。

## 验证命令

```bash
. .venv/bin/activate
python -m py_compile backend/*.py publisher_bot.py
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e 'const src = readFile("app.js"); new Function(src); print("app.js syntax ok");'
```
