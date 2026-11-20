"""NPRS core service — application assembly (SDS §2, C-01..C-16 host).

Run: uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
The REST API is documented at /docs (OpenAPI 3.0, SW-03) and is the only
interface the web app uses (NFR-INT-01).
"""
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db as db_mod
from . import live, seed
from .routers_admin import router as admin_router
from .routers_auth import router as auth_router
from .routers_ops import router as ops_router

app = FastAPI(title="NPRS — Number Plate Recognition & Vehicle Access Logging",
              version="1.0.0",
              description="Implements SRS-NPRS-001 v1.0 per SDS-NPRS-001.")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])

app.include_router(auth_router, prefix="/api")
app.include_router(ops_router, prefix="/api")
app.include_router(admin_router, prefix="/api")


@app.on_event("startup")
def _startup():
    db_mod.init_db()
    seed.seed()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "nprs-core", "version": "1.0.0"}


@app.websocket("/api/live/ws")
async def live_ws(ws: WebSocket):
    await live.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        live.disconnect(ws)


# Serve the web app (frontend/) when present.
_FRONTEND = os.environ.get(
    "NPRS_FRONTEND_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.isdir(_FRONTEND):
    app.mount("/", StaticFiles(directory=_FRONTEND, html=True), name="frontend")
