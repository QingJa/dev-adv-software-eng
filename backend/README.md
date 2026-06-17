# Seven Layer Diet Planner Backend

## Run Locally

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend `app.js` auto-detects `http://127.0.0.1:8000`. If the backend is unavailable, it falls back to the in-browser simulated API Switch.

## Cloud Provider Environment

The backend works in mock mode without keys. To use real providers, copy `.env.example` to `.env` or `backend/.env`, then fill only the keys you want to enable. Local `.env` files are ignored by git; do not put real keys in frontend code.

```bash
export DOUBAO_API_KEY="..."
export DOUBAO_API_URL="https://ark.cn-beijing.volces.com/api/v3/responses"
export DOUBAO_MODEL="doubao-seed-2-0-lite-260428"

export QIANWEN_API_KEY="..."
export QIANWEN_API_URL="https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
export QIANWEN_MODEL="qwen-plus"

export DEEPSEEK_API_KEY="..."
export DEEPSEEK_API_URL="https://api.deepseek.com/chat/completions"
export DEEPSEEK_MODEL="deepseek-chat"
```

Provider request formats:

- Doubao uses the Ark Responses API shape: `model` + `input` with `input_text`.
- Qianwen and DeepSeek use OpenAI-compatible `chat/completions`.
- If a real provider call fails or returns unparseable scores, the backend falls back to deterministic local scoring and marks the mode as `fallback`.

## Main Endpoints

- `GET /api/v1/health`
- `POST /api/v1/switch/dispatch`
- `GET /api/v1/switch/stats`
- `GET /api/v1/events`
- `GET /api/v1/events/stream`

The frontend sends all business calls through `/api/v1/switch/dispatch` with the shared API envelope.
