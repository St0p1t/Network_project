"""
Events: particle bursts and expanding shockwave rings triggered by audio onsets.
"""
import math
import random
from dataclasses import dataclass

from .boids import WORLD_W, WORLD_H

MAX_PARTICLES = 300
MAX_RINGS     = 12


@dataclass
class Particle:
    x: float = 0.0;  y: float = 0.0
    vx: float = 0.0; vy: float = 0.0
    life: float = 0.0; max_life: float = 1.0
    hue: float = 0.5
    alive: bool = False


@dataclass
class Ring:
    cx: float = 0.0;     cy: float = 0.0
    radius: float = 0.0; max_radius: float = 300.0
    life: float = 0.0;   hue: float = 0.5
    alive: bool = False


class Events:
    def __init__(self) -> None:
        self._pool  = [Particle() for _ in range(MAX_PARTICLES)]
        self._rings = [Ring()     for _ in range(MAX_RINGS)]
        self._ph    = 0
        self._rh    = 0
        self._cd    = 0.0

    def reset(self) -> None:
        for p in self._pool:
            p.alive = False
        for r in self._rings:
            r.alive = False
        self._ph = 0
        self._rh = 0
        self._cd = 0.0

    def update(self, dt: float, audio: dict) -> None:
        self._cd = max(0.0, self._cd - dt)
        onset = audio.get("onset", 0)

        if onset > 0.2 and self._cd <= 0.0:
            self._cd = 0.1
            self._burst(audio)
            self._ring(audio)

        for p in self._pool:
            if not p.alive:
                continue
            p.life -= dt
            if p.life <= 0.0:
                p.alive = False
                continue
            p.x  += p.vx * dt;  p.y  += p.vy * dt
            p.vx *= (1.0 - dt * 1.8)
            p.vy *= (1.0 - dt * 1.8)

        for r in self._rings:
            if not r.alive:
                continue
            r.life  += dt
            r.radius = r.max_radius * min(1.0, r.life * 2.0)
            if r.life / (r.max_radius / 180.0) >= 1.0:
                r.alive = False

    def _burst(self, audio: dict) -> None:
        hw = WORLD_W / 2; hh = WORLD_H / 2
        bx = random.uniform(-hw * 0.7, hw * 0.7)
        by = random.uniform(-hh * 0.7, hh * 0.7)
        count  = int(18 + audio.get("onset", 0) * 45)
        speed  = 80.0 + audio.get("rms", 0) * 240.0
        life   = 0.6  + audio.get("onset", 0) * 0.8
        hue    = 0.5  + audio.get("pitch", 0.5) * 0.35

        for _ in range(count):
            p = self._pool[self._ph % MAX_PARTICLES]
            self._ph += 1
            a = random.uniform(0, math.tau)
            s = (0.3 + random.random() * 0.7) * speed
            p.alive = True
            p.x = bx; p.y = by
            p.vx = math.cos(a) * s; p.vy = math.sin(a) * s
            p.life = life; p.max_life = life; p.hue = hue

    def _ring(self, audio: dict) -> None:
        hw = WORLD_W / 2; hh = WORLD_H / 2
        r = self._rings[self._rh % MAX_RINGS]
        self._rh += 1
        r.alive      = True
        r.life       = 0.0
        r.cx         = random.uniform(-hw * 0.5, hw * 0.5)
        r.cy         = random.uniform(-hh * 0.5, hh * 0.5)
        r.max_radius = 180.0 + audio.get("onset", 0) * 280.0
        r.radius     = 5.0
        r.hue        = 0.5 + audio.get("pitch", 0.5) * 0.35

    def get_state(self) -> dict:
        particles = [
            {"x": round(p.x, 1), "y": round(p.y, 1),
             "t": round(p.life / p.max_life, 3),
             "h": round(p.hue, 3)}
            for p in self._pool if p.alive
        ]
        rings = [
            {"cx": round(r.cx, 1), "cy": round(r.cy, 1),
             "rad": round(r.radius, 1),
             "t":   round(r.life / (r.max_radius / 180.0), 3),
             "h":   round(r.hue, 3)}
            for r in self._rings if r.alive
        ]
        return {"p": particles, "r": rings}
