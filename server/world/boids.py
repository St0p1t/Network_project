"""
Boids flocking simulation using numpy — full O(n²) pairwise computation.
Audio state dict keys: rms, bass, mid, high, pitch, onset, silence (all float 0-1).
"""
import math
import numpy as np

WORLD_W = 1920.0
WORLD_H = 1080.0


class Boids:
    def __init__(self, count: int = 700) -> None:
        self.count = count
        n = count
        hw, hh = WORLD_W / 2, WORLD_H / 2

        self.px = np.random.uniform(-hw * 0.88, hw * 0.88, n).astype(np.float32)
        self.py = np.random.uniform(-hh * 0.88, hh * 0.88, n).astype(np.float32)
        angles  = np.random.uniform(0, math.tau, n)
        speeds  = np.random.uniform(28, 55, n)
        self.vx = (np.cos(angles) * speeds).astype(np.float32)
        self.vy = (np.sin(angles) * speeds).astype(np.float32)
        self.energy = np.random.uniform(0.1, 0.9, n).astype(np.float32)
        self.age    = np.random.uniform(0, 80, n).astype(np.float32)

    def update(self, dt: float, audio: dict) -> None:
        rms     = float(audio.get("rms",     0))
        bass    = float(audio.get("bass",    0))
        mid     = float(audio.get("mid",     0))
        onset   = float(audio.get("onset",   0))
        silence = float(audio.get("silence", 0))

        max_speed = 55.0 + rms * 350.0
        min_speed = 18.0 * (1.0 - silence * 0.75)
        sep_r     = 18.0 + bass * 22.0
        align_r   = 55.0
        coh_r     = 65.0 + mid * 70.0

        n = self.count

        # ── Pairwise vectors (n, n) ──────────────────────────────────────────
        # dx[i,j] = px[j] - px[i]  (vector FROM i TO j)
        dx  = self.px[np.newaxis, :] - self.px[:, np.newaxis]
        dy  = self.py[np.newaxis, :] - self.py[:, np.newaxis]
        dsq = dx * dx + dy * dy
        np.fill_diagonal(dsq, 1e9)  # exclude self

        # ── Separation ──────────────────────────────────────────────────────
        sep_mask = dsq < (sep_r * sep_r)
        dist     = np.sqrt(np.where(dsq > 0.001, dsq, 1.0))
        sep_x    = np.sum(-dx / dist * sep_mask, axis=1)
        sep_y    = np.sum(-dy / dist * sep_mask, axis=1)
        sep_cnt  = sep_mask.sum(axis=1).clip(min=1)
        sep_f    = 1.6 + bass * 2.2
        fx = (sep_x / sep_cnt) * sep_f
        fy = (sep_y / sep_cnt) * sep_f

        # ── Alignment ───────────────────────────────────────────────────────
        align_mask = dsq < (align_r * align_r)
        a_cnt  = align_mask.sum(axis=1).clip(min=1)
        avg_vx = np.sum(self.vx[np.newaxis, :] * align_mask, axis=1) / a_cnt
        avg_vy = np.sum(self.vy[np.newaxis, :] * align_mask, axis=1) / a_cnt
        fx += (avg_vx - self.vx) * 0.9 * dt * 8.0
        fy += (avg_vy - self.vy) * 0.9 * dt * 8.0

        # ── Cohesion ─────────────────────────────────────────────────────────
        coh_mask = dsq < (coh_r * coh_r)
        c_cnt  = coh_mask.sum(axis=1).clip(min=1)
        avg_px = np.sum(self.px[np.newaxis, :] * coh_mask, axis=1) / c_cnt
        avg_py = np.sum(self.py[np.newaxis, :] * coh_mask, axis=1) / c_cnt
        coh_f  = 0.55 + mid * 1.1
        fx += (avg_px - self.px) * coh_f * dt * 8.0
        fy += (avg_py - self.py) * coh_f * dt * 8.0

        # ── Onset panic ──────────────────────────────────────────────────────
        if onset > 0.08:
            panic_a = (np.arctan2(self.py, self.px) +
                       np.random.uniform(-0.6, 0.6, n))
            fx += np.cos(panic_a) * (onset * 480.0 * dt)
            fy += np.sin(panic_a) * (onset * 480.0 * dt)

        # ── Silence: converge to centre ──────────────────────────────────────
        if silence > 0.25:
            fx -= self.px * 0.25 * silence * dt
            fy -= self.py * 0.25 * silence * dt

        # ── Integrate ────────────────────────────────────────────────────────
        self.vx += fx
        self.vy += fy

        spd   = np.sqrt(self.vx ** 2 + self.vy ** 2)
        safe  = np.where(spd > 0, spd, 1.0)
        fast  = spd > max_speed
        slow  = (spd < min_speed) & (spd > 0)
        self.vx = np.where(fast, self.vx / safe * max_speed, self.vx)
        self.vy = np.where(fast, self.vy / safe * max_speed, self.vy)
        self.vx = np.where(slow, self.vx / safe * min_speed, self.vx)
        self.vy = np.where(slow, self.vy / safe * min_speed, self.vy)

        self.px += self.vx * dt
        self.py += self.vy * dt

        # ── Wrap ─────────────────────────────────────────────────────────────
        hw, hh = WORLD_W / 2, WORLD_H / 2
        self.px = np.where(self.px >  hw, self.px - WORLD_W, self.px)
        self.px = np.where(self.px < -hw, self.px + WORLD_W, self.px)
        self.py = np.where(self.py >  hh, self.py - WORLD_H, self.py)
        self.py = np.where(self.py < -hh, self.py + WORLD_H, self.py)

        self.age    += dt
        self.energy  = np.clip(self.energy + (rms * 0.6 - 0.008) * dt, 0.0, 1.0)
