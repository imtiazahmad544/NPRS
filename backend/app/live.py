"""Server push for the Live Monitor and Dashboard (FR-DSH-04, FR-LOG-11).

Connected WebSocket clients receive each new event as it is stored. The
frontend falls back to polling if the socket drops.
"""
import asyncio
import json

_clients = set()


async def connect(ws):
    await ws.accept()
    _clients.add(ws)


def disconnect(ws):
    _clients.discard(ws)


def broadcast(payload: dict):
    """Called from sync code paths; schedules sends on the running loop."""
    if not _clients:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    text = json.dumps(payload, default=str)
    for ws in list(_clients):
        try:
            loop.create_task(ws.send_text(text))
        except Exception:
            _clients.discard(ws)
