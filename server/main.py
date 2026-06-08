"""
Resonance — Python simulation server.

Architecture:
  - FastAPI WebSocket endpoint /ws  (bidirectional)
  - Client → server: JSON {"type":"audio","state":{rms,bass,mid,high,pitch,onset,silence}}
  - Server → client: binary boids frame  (every tick)
                     JSON {"type":"fe", flora, events, time}  (every tick)
  - Background asyncio task runs simulation at ~30 fps.
  - Static files (HTML/CSS/JS) served from ../static/
"""
import asyncio
import json
import math
import os
import struct
from contextlib import asynccontextmanager
from typing import Dict, List

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from .world.boids import Boids, WORLD_W, WORLD_H
from .world.flora import Flora
from .world.events import Events

# ── World ─────────────────────────────────────────────────────────────────────

boids  = Boids(count=700)
flora  = Flora()
events = Events()

current_audio: Dict[str, float] = {
    "rms": 0.0, "bass": 0.0, "mid": 0.0, "high": 0.0,
    "pitch": 0.5, "onset": 0.0, "silence": 1.0,
}

# ── Connection manager ────────────────────────────────────────────────────────

class Manager:
    def __init__(self) -> None:
        self._conns: List[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._conns.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._conns = [c for c in self._conns if c is not ws]

    @property
    def count(self) -> int:
        return len(self._conns)

    async def broadcast_bytes(self, data: bytes) -> None:
        dead = []
        for ws in self._conns:
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_text(self, text: str) -> None:
        dead = []
        for ws in self._conns:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = Manager()

# ── Binary packing ────────────────────────────────────────────────────────────
# Per boid: int16 px, int16 py, uint16 angle, uint8 energy  → 7 bytes
# Header:   uint32 count                                    → 4 bytes
# Scale: px/py normalised over ±(WORLD_W/2, WORLD_H/2) → ±32767

_PX_NORM = 32767.0 / (WORLD_W / 2)
_PY_NORM = 32767.0 / (WORLD_H / 2)
_ANG_NORM = 65535.0 / (2 * math.pi)

_DT = np.dtype([("px", ">i2"), ("py", ">i2"), ("ang", ">u2"), ("en", "u1")])


def _pack_boids() -> bytes:
    n = boids.count
    arr      = np.empty(n, dtype=_DT)
    arr["px"] = np.clip(boids.px * _PX_NORM, -32767, 32767).astype(np.int16)
    arr["py"] = np.clip(boids.py * _PY_NORM, -32767, 32767).astype(np.int16)
    angles    = np.arctan2(boids.vy, boids.vx) % (2 * math.pi)
    arr["ang"] = (angles * _ANG_NORM).astype(np.uint16)
    arr["en"]  = (boids.energy * 255).astype(np.uint8)
    return struct.pack(">I", n) + arr.tobytes()

# ── Simulation loop ───────────────────────────────────────────────────────────

async def _sim_loop() -> None:
    target     = 1.0 / 30.0
    loop       = asyncio.get_running_loop()
    prev       = loop.time()
    sim_time   = 0.0

    while True:
        t0      = loop.time()
        dt      = min(t0 - prev, 0.05)
        prev    = t0
        sim_time += dt

        boids.update(dt,  current_audio)
        flora.update(dt,  current_audio)
        events.update(dt, current_audio)

        if manager.count:
            await manager.broadcast_bytes(_pack_boids())

            flora_state = flora.get_state()
            msg = {
                "type":   "fe",
                "time":   round(sim_time, 2),
                "flora":  flora_state,
                "events": events.get_state(),
            }
            await manager.broadcast_text(json.dumps(msg, separators=(",", ":")))

        elapsed = loop.time() - t0
        await asyncio.sleep(max(0.0, target - elapsed))

# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def _lifespan(app: FastAPI):
    asyncio.create_task(_sim_loop())
    yield


app = FastAPI(docs_url=None, redoc_url=None, lifespan=_lifespan)


@app.websocket("/ws")
async def _ws(ws: WebSocket) -> None:
    await manager.connect(ws)
    # Send full flora state immediately so new client sees existing plants
    initial_flora = flora.get_state(force=True)
    if initial_flora is not None:
        await ws.send_text(json.dumps(
            {"type": "fe", "time": 0, "flora": initial_flora, "events": {"p": [], "r": []}},
            separators=(",", ":"),
        ))
    try:
        async for text in ws.iter_text():
            data = json.loads(text)
            if data.get("type") == "audio":
                current_audio.update(data["state"])
            elif data.get("type") == "reset":
                boids.reset()
                flora.reset()
                events.reset()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)


# Static files must be mounted LAST (catch-all)
_STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
