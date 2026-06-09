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

        self.n_clusters = int(np.random.randint(3, 11))   # 3..10 включительно
        self._init_attractors()

    # ── Аттракторы ───────────────────────────────────────────────────────────

    def _init_attractors(self) -> None:
        """Случайные начальные позиции и скорости точек-аттракторов."""
        k   = self.n_clusters
        hw  = WORLD_W * 0.40
        hh  = WORLD_H * 0.40
        self.attractors = np.column_stack([
            np.random.uniform(-hw, hw, k),
            np.random.uniform(-hh, hh, k),
        ]).astype(np.float32)                           # (k, 2)
        self._attr_vx = np.random.uniform(-15, 15, k).astype(np.float32)
        self._attr_vy = np.random.uniform(-15, 15, k).astype(np.float32)

    def _update_attractors(self, dt: float) -> None:
        """Медленное блуждание аттракторов с отражением от границ."""
        k = self.n_clusters
        # Случайное ускорение
        self._attr_vx += np.random.uniform(-8.0, 8.0, k) * dt
        self._attr_vy += np.random.uniform(-8.0, 8.0, k) * dt
        # Ограничение скорости
        spd     = np.hypot(self._attr_vx, self._attr_vy)
        safe    = np.where(spd > 0, spd, 1.0)
        cap     = 28.0
        too_fast = spd > cap
        self._attr_vx = np.where(too_fast, self._attr_vx / safe * cap, self._attr_vx)
        self._attr_vy = np.where(too_fast, self._attr_vy / safe * cap, self._attr_vy)
        # Отражение от мягкой границы (±42% мира)
        hw, hh = WORLD_W * 0.42, WORLD_H * 0.42
        ax, ay = self.attractors[:, 0], self.attractors[:, 1]
        bx = ((ax >  hw) & (self._attr_vx > 0)) | ((ax < -hw) & (self._attr_vx < 0))
        by = ((ay >  hh) & (self._attr_vy > 0)) | ((ay < -hh) & (self._attr_vy < 0))
        self._attr_vx = np.where(bx, -self._attr_vx, self._attr_vx)
        self._attr_vy = np.where(by, -self._attr_vy, self._attr_vy)
        self.attractors[:, 0] += self._attr_vx * dt
        self.attractors[:, 1] += self._attr_vy * dt

    # ── Reset ─────────────────────────────────────────────────────────────────

    def reset(self) -> None:
        n = self.count
        hw, hh = WORLD_W / 2, WORLD_H / 2
        self.px = np.random.uniform(-hw * 0.88, hw * 0.88, n).astype(np.float32)
        self.py = np.random.uniform(-hh * 0.88, hh * 0.88, n).astype(np.float32)
        angles  = np.random.uniform(0, math.tau, n)
        speeds  = np.random.uniform(28, 55, n)
        self.vx = (np.cos(angles) * speeds).astype(np.float32)
        self.vy = (np.sin(angles) * speeds).astype(np.float32)
        self.energy = np.random.uniform(0.1, 0.9, n).astype(np.float32)
        self.age    = np.zeros(n, dtype=np.float32)
        self.n_clusters = int(np.random.randint(3, 11))
        self._init_attractors()

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, dt: float, audio: dict) -> None:
        rms     = float(audio.get("rms",     0))
        bass    = float(audio.get("bass",    0))
        mid     = float(audio.get("mid",     0))
        onset   = float(audio.get("onset",   0))
        silence = float(audio.get("silence", 0))

        # Нормированный уровень звука: 0 = тишь, 1 = rms ≥ 0.15
        sound = min(1.0, rms / 0.15)

        max_speed = 60.0 + rms * 500.0
        min_speed = 18.0 * (1.0 - silence * 0.75)
        sep_r     = 28.0 + bass * 20.0 + sound * 18.0
        align_r   = 65.0
        coh_r     = 80.0

        n = self.count

        # ── Попарные векторы (n, n) ──────────────────────────────────────────
        dx  = self.px[np.newaxis, :] - self.px[:, np.newaxis]
        dy  = self.py[np.newaxis, :] - self.py[:, np.newaxis]
        dsq = dx * dx + dy * dy
        np.fill_diagonal(dsq, 1e9)

        # ── Разделение ───────────────────────────────────────────────────────
        sep_mask = dsq < (sep_r * sep_r)
        dist     = np.sqrt(np.where(dsq > 0.001, dsq, 1.0))
        sep_x    = np.sum(-dx / dist * sep_mask, axis=1)
        sep_y    = np.sum(-dy / dist * sep_mask, axis=1)
        sep_cnt  = sep_mask.sum(axis=1).clip(min=1)
        sep_f    = 2.5 + bass * 2.0 + sound * 3.5
        fx = (sep_x / sep_cnt) * sep_f
        fy = (sep_y / sep_cnt) * sep_f

        # ── Выравнивание (ослабевает со звуком) ─────────────────────────────
        align_mask = dsq < (align_r * align_r)
        a_cnt_raw  = align_mask.sum(axis=1)
        a_cnt      = a_cnt_raw.clip(min=1)
        avg_vx = np.sum(self.vx[np.newaxis, :] * align_mask, axis=1) / a_cnt
        avg_vy = np.sum(self.vy[np.newaxis, :] * align_mask, axis=1) / a_cnt
        has_align = (a_cnt_raw > 0).astype(np.float32)
        align_str = 0.25 * (1.0 - sound * 0.9)
        fx += (avg_vx - self.vx) * align_str * dt * 8.0 * has_align
        fy += (avg_vy - self.vy) * align_str * dt * 8.0 * has_align

        # ── Сцепление ↔ Разлёт ──────────────────────────────────────────────
        coh_mask  = dsq < (coh_r * coh_r)
        c_cnt_raw = coh_mask.sum(axis=1)
        c_cnt     = c_cnt_raw.clip(min=1)
        avg_px = np.sum(self.px[np.newaxis, :] * coh_mask, axis=1) / c_cnt
        avg_py = np.sum(self.py[np.newaxis, :] * coh_mask, axis=1) / c_cnt
        has_coh = (c_cnt_raw > 0).astype(np.float32)

        coh_f     = 0.10 * (1.0 - sound)
        scatter_f = sound * 3.0
        net_weight = (coh_f - scatter_f) * dt * 8.0 * has_coh
        fx += (avg_px - self.px) * net_weight
        fy += (avg_py - self.py) * net_weight

        # ── Случайный шум ────────────────────────────────────────────────────
        noise = 5.0 + sound * 20.0
        fx += np.random.uniform(-noise, noise, n) * dt
        fy += np.random.uniform(-noise, noise, n) * dt

        # ── Всплеск: разлёт в случайных направлениях ────────────────────────
        if onset > 0.03:
            scatter_a = np.random.uniform(0, math.tau, n)
            fx += np.cos(scatter_a) * (onset * 700.0 * dt)
            fy += np.sin(scatter_a) * (onset * 700.0 * dt)

        # ── Тишина: стягивание к ближайшему аттрактору ──────────────────────
        self._update_attractors(dt)

        if silence > 0.25:
            # Для каждого существа — дистанция до каждого аттрактора: (n, k)
            dx_a = self.attractors[:, 0] - self.px[:, np.newaxis]   # (n, k)
            dy_a = self.attractors[:, 1] - self.py[:, np.newaxis]   # (n, k)
            nearest  = np.argmin(dx_a ** 2 + dy_a ** 2, axis=1)    # (n,)
            target_x = self.attractors[nearest, 0]
            target_y = self.attractors[nearest, 1]
            pull_f   = silence * 0.15
            fx += (target_x - self.px) * pull_f * dt * 8.0
            fy += (target_y - self.py) * pull_f * dt * 8.0

        # ── Интеграция ───────────────────────────────────────────────────────
        self.vx += fx
        self.vy += fy

        spd  = np.sqrt(self.vx ** 2 + self.vy ** 2)
        safe = np.where(spd > 0, spd, 1.0)
        fast = spd > max_speed
        slow = (spd < min_speed) & (spd > 0)
        self.vx = np.where(fast, self.vx / safe * max_speed, self.vx)
        self.vy = np.where(fast, self.vy / safe * max_speed, self.vy)
        self.vx = np.where(slow, self.vx / safe * min_speed, self.vx)
        self.vy = np.where(slow, self.vy / safe * min_speed, self.vy)

        # ── Угловой хаос пропорционально громкости ───────────────────────────
        if sound > 0.05:
            max_angle = sound * 0.55
            theta  = np.random.uniform(-max_angle, max_angle, n).astype(np.float32)
            cos_t  = np.cos(theta)
            sin_t  = np.sin(theta)
            new_vx = self.vx * cos_t - self.vy * sin_t
            new_vy = self.vx * sin_t + self.vy * cos_t
            self.vx = new_vx
            self.vy = new_vy

        self.px += self.vx * dt
        self.py += self.vy * dt

        # ── Обёртка по краям ─────────────────────────────────────────────────
        hw, hh = WORLD_W / 2, WORLD_H / 2
        self.px = np.where(self.px >  hw, self.px - WORLD_W, self.px)
        self.px = np.where(self.px < -hw, self.px + WORLD_W, self.px)
        self.py = np.where(self.py >  hh, self.py - WORLD_H, self.py)
        self.py = np.where(self.py < -hh, self.py + WORLD_H, self.py)

        self.age    += dt
        self.energy  = np.clip(self.energy + (rms * 0.6 - 0.008) * dt, 0.0, 1.0)
