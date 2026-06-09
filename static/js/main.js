import { AudioAnalyzer }    from './audio.js';
import { ResonanceWS, decodeBoids } from './ws.js';
import { initEnvGL }        from './env_gl.js';
import { MusicUI }          from './music.js';

// ── Constants ────────────────────────────────────────────────────────────────
const WORLD_W = 1920;
const WORLD_H = 1080;

// ── Canvas setup ─────────────────────────────────────────────────────────────
const bgCanvas = document.getElementById('bg-canvas');
const fgCanvas = document.getElementById('fg-canvas');
const fgCtx    = fgCanvas.getContext('2d');

let W = window.innerWidth;
let H = window.innerHeight;

// ── WebGL background ──────────────────────────────────────────────────────────
let envGL = initEnvGL(bgCanvas);

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  bgCanvas.width  = fgCanvas.width  = W;
  bgCanvas.height = fgCanvas.height = H;
  envGL?.resize(W, H);
}
resize();
window.addEventListener('resize', resize);

// ── Shared world state ────────────────────────────────────────────────────────
const state = {
  boids:  [],
  flora:  [],          // [[x1,y1,x2,y2,alpha,hue], ...]
  events: { p: [], r: [] },
};

// ── Audio ─────────────────────────────────────────────────────────────────────
const audio = new AudioAnalyzer();

// ── WebSocket ─────────────────────────────────────────────────────────────────
let wsStatus = 'init';
let ws;

function startWS() {
  ws = new ResonanceWS({
    onBoids(buf)  { state.boids = decodeBoids(buf, WORLD_W, WORLD_H); },
    onFrame(msg)  {
      if (msg.flora  !== null) state.flora  = msg.flora  ?? [];
      state.events = msg.events ?? { p: [], r: [] };
    },
    onStatus(s)   { wsStatus = s; },
  });
}

// ── Debug overlay ─────────────────────────────────────────────────────────────
const dbEl = document.getElementById('debug-overlay');
let dbVisible = true;   // visible by default; D toggles it off/on
let dbFrozen  = false;  // P freezes audio values in the overlay
const dbBars = {}, dbVals = {};
['rms','bass','mid','high','pitch','onset'].forEach(k => {
  dbBars[k] = document.getElementById(`db-${k}`);
  dbVals[k] = document.getElementById(`dv-${k}`);
});
const dbSilB     = document.getElementById('db-sil');
const dbSilV     = document.getElementById('dv-sil');
const dbFps      = document.getElementById('db-fps');
const dbWs       = document.getElementById('db-ws');
const dbFreezeBtn = document.getElementById('db-freeze-btn');

function toggleFreeze() {
  dbFrozen = !dbFrozen;
  dbEl.classList.toggle('frozen', dbFrozen);
  if (dbFreezeBtn) dbFreezeBtn.textContent = dbFrozen ? '▶' : '⏸';
}

document.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') {
    dbVisible = !dbVisible;
    dbEl.classList.toggle('hidden', !dbVisible);
  }
  if (e.key === 'p' || e.key === 'P') {
    toggleFreeze();
  }
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
    else document.exitFullscreen().catch(()=>{});
  }
  if ((e.key === 'r' || e.key === 'R') && started) {
    resetWorld();
  }
});

if (dbFreezeBtn) dbFreezeBtn.addEventListener('click', toggleFreeze);

const _ftimes = [];
function updateDebug() {
  if (!dbVisible) return;

  const now = performance.now();
  _ftimes.push(now);
  if (_ftimes.length > 60) _ftimes.shift();
  const span = _ftimes.at(-1) - _ftimes[0];
  dbFps.textContent = span > 0 ? `${Math.round((_ftimes.length-1)/span*1000)} fps` : '-- fps';
  dbWs.textContent  = `ws: ${wsStatus}`;

  if (dbFrozen) return;  // audio values frozen — fps/ws still live

  const a = audio;
  [['rms',a.rms],['bass',a.bass],['mid',a.mid],['high',a.high],['pitch',a.pitch],['onset',a.onset]].forEach(([k,v]) => {
    dbBars[k].style.width = `${Math.min(100, v*100).toFixed(0)}%`;
    dbVals[k].textContent  = v.toFixed(2);
  });
  dbSilB.style.width   = `${Math.min(100, audio.silence*100).toFixed(0)}%`;
  dbSilV.textContent   = audio.silence.toFixed(2);
}

// ── Render helpers ────────────────────────────────────────────────────────────

// Map world coords (centred, ±WORLD_W/2) to canvas coords (top-left origin).
// Uses "cover" scaling so boids always fill the screen.
function worldToScreen(wx, wy) {
  const scale = Math.max(W / WORLD_W, H / WORLD_H);
  return [W/2 + wx * scale, H/2 - wy * scale];
}

function drawBoids(ctx, boids, a) {
  if (!boids.length) return;
  const scale = Math.max(W / WORLD_W, H / WORLD_H);
  const { rms, pitch } = a;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const b of boids) {
    const sx = W/2 + b.px * scale;
    const sy = H/2 - b.py * scale;
    const e  = b.energy;

    const r  = Math.min(255, ((0.15 + pitch*0.45 + e*0.25 + rms*0.15) * 255)|0);
    const g  = Math.min(255, ((0.45 + e*0.35 - pitch*0.15) * 255)|0);
    const bl = Math.min(255, ((0.80 + pitch*0.18 - e*0.08) * 255)|0);

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(b.angle + Math.PI / 2);
    ctx.fillStyle   = `rgb(${r},${g},${bl})`;
    ctx.globalAlpha = 0.85;

    ctx.beginPath();
    ctx.moveTo(0,    -5.5);
    ctx.lineTo(-2.5,  3.5);
    ctx.lineTo( 2.5,  3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawFlora(ctx, segs) {
  if (!segs.length) return;
  const scale = Math.max(W / WORLD_W, H / WORLD_H);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.2;

  for (const [x1, y1, x2, y2, alpha, hue] of segs) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `hsl(${(hue * 360)|0}, 85%, 55%)`;
    ctx.beginPath();
    ctx.moveTo(W/2 + x1*scale, H/2 - y1*scale);
    ctx.lineTo(W/2 + x2*scale, H/2 - y2*scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEvents(ctx, ev) {
  if (!ev) return;
  const scale = Math.max(W / WORLD_W, H / WORLD_H);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Particles
  for (const p of (ev.p || [])) {
    ctx.globalAlpha = p.t * 0.85;
    ctx.fillStyle   = `hsl(${(p.h * 360)|0}, 100%, 70%)`;
    ctx.beginPath();
    ctx.arc(W/2 + p.x*scale, H/2 - p.y*scale, Math.max(0.5, 2*p.t), 0, Math.PI*2);
    ctx.fill();
  }

  // Shockwave rings
  ctx.lineWidth = 2;
  for (const r of (ev.r || [])) {
    const alpha = Math.max(0, (1 - r.t) * 0.65);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `hsl(${(r.h * 360)|0}, 100%, 65%)`;
    ctx.beginPath();
    ctx.arc(W/2 + r.cx*scale, H/2 - r.cy*scale, r.rad * scale, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Render loop ───────────────────────────────────────────────────────────────

let started  = false;
let lastAudioSend = 0;
const AUDIO_SEND_INTERVAL = 50; // ms

function frame(now) {
  requestAnimationFrame(frame);

  const time = now / 1000;
  const dt   = Math.min((now - (frame._prev || now)) / 1000, 0.05);
  frame._prev = now;

  audio.update(dt);
  updateDebug();    // always — so overlay works on welcome screen too

  // Background always renders (visible behind welcome screen too)
  envGL?.draw(audio.state, time);

  if (!started) return;

  // Send audio state to server every 50ms
  if (now - lastAudioSend > AUDIO_SEND_INTERVAL) {
    ws?.sendAudio(audio.state);
    lastAudioSend = now;
  }

  // Foreground
  fgCtx.clearRect(0, 0, W, H);
  drawFlora(fgCtx,  state.flora);
  drawBoids(fgCtx,  state.boids, audio.state);
  drawEvents(fgCtx, state.events);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetWorld() {
  state.boids  = [];
  state.flora  = [];
  state.events = { p: [], r: [] };
  ws?.sendReset();
}

// ── Music UI ──────────────────────────────────────────────────────────────────

const musicUI = new MusicUI(audio);
musicUI.setup();

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const welcome        = document.getElementById('welcome');
const startBtn       = document.getElementById('start-btn');
const controls       = document.getElementById('controls');
const resetBtn       = document.getElementById('reset-btn');
const homeBtn        = document.getElementById('home-btn');
const sensSlider     = document.getElementById('sens-slider');
const sensVal        = document.getElementById('sens-val');
const musicControls  = document.getElementById('music-controls');
const musicStopBtn   = document.getElementById('music-stop-btn');
const musicToggleBtn = document.getElementById('music-toggle-btn');

sensSlider.addEventListener('input', () => {
  audio.sensitivity = Number(sensSlider.value);
  sensVal.textContent = sensSlider.value;
});

function showWelcome() {
  welcome.style.display = '';
  welcome.classList.remove('fade-out');
  startBtn.textContent = started ? 'Продолжить' : 'Войти в мир';
  startBtn.disabled    = false;
}

function hideWelcome() {
  welcome.classList.add('fade-out');
  welcome.addEventListener('transitionend', () => welcome.style.display = 'none', { once: true });
}

startBtn.addEventListener('click', async () => {
  // If world is already running, just close the overlay.
  if (started) { hideWelcome(); return; }

  startBtn.textContent = 'Инициализация…';
  startBtn.disabled    = true;

  if (musicUI.isMusicMode) {
    await audio.ensureContext().catch(() => {});
  } else {
    try {
      await Promise.race([
        audio.init(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
    } catch (_) {
      audio.autonomous = true;
    }
  }

  startWS();
  started = true;
  controls.classList.add('visible');

  if (musicUI.isMusicMode) {
    musicControls.style.display = 'flex';
    musicUI.updateControls();
  }

  hideWelcome();
});

homeBtn.addEventListener('click', showWelcome);
resetBtn.addEventListener('click', resetWorld);
musicStopBtn.addEventListener('click', () => {
  musicUI.stopMusic();
  musicControls.style.display = 'none';
  if (musicToggleBtn) musicToggleBtn.textContent = '⏸';
});

requestAnimationFrame(frame);
