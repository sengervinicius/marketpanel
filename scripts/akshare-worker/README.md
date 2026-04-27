# scripts/akshare-worker — Reference Python worker for R1.2

A 70-line FastAPI server that exposes AkShare endpoints over HTTP so
the Node-side adapter at `server/providers/akshare.js` can call them.

This worker is **not deployed automatically**. It lives in the repo
as a reference. Deploy it whenever you're ready — as a separate
Render service, a small VPS, a tiny EC2 box, or anywhere that runs
Python 3.11.

## Why a separate worker

AkShare is Python-only and ships > 200 MB of dependencies (pandas,
numpy, lxml, beautifulsoup4, requests). Bundling it into the main
Node server would balloon the Render image, lengthen builds, and
make deploys slower. A separate worker keeps the main server lean.

## Endpoints

```
GET /api/akshare/quote?symbol=600519
GET /api/akshare/breadth?index=000001
GET /api/akshare/flow?direction=northbound
GET /healthz
```

All responses are JSON. Errors return `{ "error": "<message>" }` with
appropriate HTTP status.

## Local run

```bash
cd scripts/akshare-worker
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn worker:app --host 0.0.0.0 --port 7800
```

Then on the Node server, set:

```
AKSHARE_URL=http://localhost:7800
```

## Deploy on Render

1. Create a new Web Service on Render.
2. Repo: this same repo.
3. Root directory: `scripts/akshare-worker`.
4. Runtime: Python.
5. Build command: `pip install -r requirements.txt`.
6. Start command: `uvicorn worker:app --host 0.0.0.0 --port $PORT`.
7. Plan: Free tier is fine for canary; bump if Chinese-market traffic justifies.
8. After deploy, copy the `https://<name>.onrender.com` URL.
9. On the main `senger-server` service, add env var `AKSHARE_URL=<that URL>`.
10. Restart `senger-server` to pick up the env.

## Auth (optional)

Set `AKSHARE_WORKER_TOKEN` on the worker and `AKSHARE_API_KEY=<same value>`
on the Node server. The Node side sends `Authorization: Bearer <token>`;
the worker rejects requests without it.

## Feature flag

Even after the worker is deployed, the AkShare MCP tools sit behind
`AKSHARE_V1` in `feature_flags`. Until the flag is on, the tools
return `{ error: "akshare_not_configured" }` and AI chat won't try
to call them.
