"""
worker.py — R1.2 AkShare HTTP gateway.

A tiny FastAPI process that exposes a curated subset of the AkShare
Python library as HTTP endpoints the Node-side adapter consumes.

Run locally:
    pip install -r requirements.txt
    uvicorn worker:app --host 0.0.0.0 --port 7800

Auth: optional bearer token via AKSHARE_WORKER_TOKEN env var. When
set, every request must include `Authorization: Bearer <token>`.

Caching: handled on the Node side. This worker is intentionally
stateless apart from AkShare's own internal request session.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

import akshare as ak  # type: ignore

app = FastAPI(title="particle-akshare-worker", version="1.0")

_TOKEN = os.environ.get("AKSHARE_WORKER_TOKEN")


def _check_auth(authorization: str | None) -> None:
    if not _TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    if authorization.split(" ", 1)[1].strip() != _TOKEN:
        raise HTTPException(status_code=403, detail="bad token")


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/akshare/quote")
def quote(
    symbol: str = Query(..., min_length=1, max_length=16),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    _check_auth(authorization)
    try:
        # A-shares: 6-digit numeric. HK: leading zeros tolerated.
        if symbol.isdigit() and len(symbol) == 6:
            df = ak.stock_individual_info_em(symbol=symbol)
        else:
            df = ak.stock_hk_spot_em()
            df = df[df["代码"] == symbol]
        rows = df.to_dict(orient="records") if hasattr(df, "to_dict") else []
        return JSONResponse({"symbol": symbol, "rows": rows[:50]})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"akshare.quote: {e}"}, status_code=200)


@app.get("/api/akshare/breadth")
def breadth(
    index: str = Query(..., min_length=1, max_length=16),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    _check_auth(authorization)
    try:
        df = ak.stock_zh_index_spot_em(symbol="\u4e0a\u8bc1\u7cfb\u5217" if index.startswith("000") else "\u6df1\u8bc1\u7cfb\u5217")
        rows = df[df["\u4ee3\u7801"] == index].to_dict(orient="records") if hasattr(df, "to_dict") else []
        return JSONResponse({"index": index, "rows": rows[:5]})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"akshare.breadth: {e}"}, status_code=200)


@app.get("/api/akshare/flow")
def flow(
    direction: str = Query(..., regex="^(northbound|southbound)$"),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    _check_auth(authorization)
    try:
        # Northbound = HK \u2192 SHSE/SZSE (foreign buying mainland).
        # Southbound = SHSE/SZSE \u2192 HK (mainland buying HK).
        if direction == "northbound":
            df = ak.stock_hsgt_hist_em(symbol="\u5317\u5411\u8d44\u91d1")
        else:
            df = ak.stock_hsgt_hist_em(symbol="\u5357\u5411\u8d44\u91d1")
        rows = df.tail(30).to_dict(orient="records") if hasattr(df, "to_dict") else []
        return JSONResponse({"direction": direction, "rows": rows})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"akshare.flow: {e}"}, status_code=200)
