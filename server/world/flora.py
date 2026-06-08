"""
Flora: growing tendril structures spawned on sound onsets and during silence.
State is sent to the client only when it changes (dirty flag).
"""
import math
import random
from dataclasses import dataclass, field
from typing import List, Optional

from .boids import WORLD_W, WORLD_H

MAX_BRANCHES  = 70
MAX_PTS       = 32
GROW_INTERVAL = 0.06  # seconds between new point additions


@dataclass
class Branch:
    points: List[tuple] = field(default_factory=list)
    angle:  float = 0.0
    timer:  float = 0.0
    pitch:  float = 0.5
    age:    float = 0.0
    done:   bool  = False

    @classmethod
    def spawn(cls, x: float, y: float, angle: float, pitch: float) -> "Branch":
        b = cls()
        b.points = [(x, y)]
        b.angle  = angle
        b.pitch  = pitch
        return b

    def update(self, dt: float, audio: dict) -> bool:
        """Returns True if a new point was added (dirty)."""
        if self.done:
            return False
        self.age   += dt
        self.timer += dt
        if self.timer < GROW_INTERVAL:
            return False
        self.timer = 0.0

        if len(self.points) >= MAX_PTS:
            self.done = True
            return False

        self.angle += (random.random() - 0.5) * 0.65
        step = 9.0 + audio.get("rms", 0) * 18.0 + audio.get("bass", 0) * 12.0
        lx, ly = self.points[-1]
        self.points.append((lx + math.cos(self.angle) * step,
                            ly + math.sin(self.angle) * step))
        return True

    def segments(self) -> List[list]:
        """List of [x1,y1,x2,y2,alpha,hue] ready for JSON."""
        alpha = round(max(0.05, min(0.55, 0.55 * (1.0 - self.age / 30.0))), 3)
        hue   = round(self.pitch, 3)
        out   = []
        for i in range(1, len(self.points)):
            x1, y1 = self.points[i - 1]
            x2, y2 = self.points[i]
            out.append([round(x1, 1), round(y1, 1),
                        round(x2, 1), round(y2, 1),
                        alpha, hue])
        return out


class Flora:
    def __init__(self) -> None:
        self._branches: List[Branch] = []
        self._onset_cd  = 0.0
        self._dirty     = True   # send full state on first connection

    def reset(self) -> None:
        self._branches.clear()
        self._onset_cd = 0.0
        self._dirty    = True

    def update(self, dt: float, audio: dict) -> None:
        self._onset_cd = max(0.0, self._onset_cd - dt)
        onset   = audio.get("onset",   0)
        silence = audio.get("silence", 0)

        if onset > 0.25 and self._onset_cd <= 0.0:
            self._onset_cd = 0.18
            for _ in range(2 + int(onset * 4)):
                self._spawn(audio)
            self._dirty = True

        if silence > 0.55 and random.random() < dt * 0.4:
            self._spawn(audio)
            self._dirty = True

        while len(self._branches) > MAX_BRANCHES:
            self._branches.pop(0)

        for b in self._branches:
            if b.update(dt, audio):
                self._dirty = True

    def _spawn(self, audio: dict) -> None:
        hw = WORLD_W / 2 * 0.85
        hh = WORLD_H / 2 * 0.85
        self._branches.append(Branch.spawn(
            random.uniform(-hw, hw),
            random.uniform(-hh, hh),
            random.uniform(0, math.tau),
            audio.get("pitch", 0.5),
        ))

    def get_state(self, force: bool = False) -> Optional[List]:
        """Returns segments list if dirty, else None."""
        if not self._dirty and not force:
            return None
        self._dirty = False
        segs: List[list] = []
        for b in self._branches:
            segs.extend(b.segments())
        return segs
