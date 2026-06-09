/**
 * Audio analysis module.
 * Exports AudioAnalyzer — produces {rms, bass, mid, high, pitch, onset, silence}.
 * Falls back to autonomous sine-wave values if mic is denied.
 */
export class AudioAnalyzer {
  constructor() {
    this.rms     = 0;
    this.bass    = 0;
    this.mid     = 0;
    this.high    = 0;
    this.pitch   = 0.5;
    this.onset   = 0;
    this.silence = 1;

    this.sensitivity = 5;
    this.musicMode   = false;
    this.autonomous  = true;
    this._ctx      = null;
    this._an       = null;
    this._td       = null;
    this._fd       = null;
    this._audioEl  = null;
    this._musicSrc = null;

    this._prevRms  = 0;
    this._onsetCd  = 0;
    this._silTimer = 0;
    this._autoT    = 0;
  }

  // Ensure AudioContext exists and is running (call inside a user-gesture handler).
  async ensureContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') await this._ctx.resume();
  }

  // Switch to music mode: play audio from a URL (cors=true for cross-origin streams).
  async initMusic(url, cors = false) {
    await this.ensureContext();

    // Disconnect previous music source
    if (this._musicSrc) { this._musicSrc.disconnect(); this._musicSrc = null; }
    if (this._audioEl)  { this._audioEl.pause(); this._audioEl.src = ''; this._audioEl = null; }

    const el = document.createElement('audio');
    if (cors) el.crossOrigin = 'anonymous';
    el.src  = url;
    el.loop = true;
    this._audioEl = el;

    const an = this._ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.75;

    const src = this._ctx.createMediaElementSource(el);
    src.connect(an);
    an.connect(this._ctx.destination);    // route to speakers
    this._musicSrc = src;

    this._an = an;
    this._td = new Uint8Array(an.fftSize);
    this._fd = new Uint8Array(an.frequencyBinCount);
    this.autonomous = false;
    this.musicMode  = true;

    try { await el.play(); } catch (e) { console.warn('Audio play:', e); }
  }

  // Switch to music mode from a local File object.
  initFile(file) {
    return this.initMusic(URL.createObjectURL(file), false);
  }

  get paused()  { return this._audioEl?.paused ?? true; }
  togglePlay()  {
    if (!this._audioEl) return;
    this._audioEl.paused ? this._audioEl.play() : this._audioEl.pause();
  }
  stopMusic() {
    if (this._musicSrc) { this._musicSrc.disconnect(); this._musicSrc = null; }
    if (this._audioEl)  { this._audioEl.pause(); this._audioEl.src = ''; this._audioEl = null; }
    this.musicMode  = false;
    this.autonomous = true;
    this.rms = this.bass = this.mid = this.high = this.onset = 0;
    this.silence = 1;
  }

  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this._ctx.createMediaStreamSource(stream);
    const an  = this._ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.75;
    src.connect(an);
    this._an = an;
    this._td = new Uint8Array(an.fftSize);
    this._fd = new Uint8Array(an.frequencyBinCount);
    this.autonomous = false;
  }

  update(dt) {
    if (this.autonomous) { this._auto(dt); return; }

    this._an.getByteTimeDomainData(this._td);
    this._an.getByteFrequencyData(this._fd);

    // RMS
    let sq = 0;
    for (let i = 0; i < this._td.length; i++) {
      const s = (this._td[i] / 128) - 1;
      sq += s * s;
    }
    const rawRms = Math.sqrt(sq / this._td.length);
    this.rms += (rawRms > this.rms ? 0.35 : 0.08) * (rawRms - this.rms);

    // Frequency bands
    const sr   = this._ctx.sampleRate;
    const bins = this._fd.length;
    const bHz  = (sr / 2) / bins;
    const bEnd = Math.floor(250  / bHz);
    const mEnd = Math.floor(2000 / bHz);
    const hEnd = Math.floor(8000 / bHz);

    let bS = 0, mS = 0, hS = 0;
    for (let i = 1;    i <= bEnd; i++) bS += this._fd[i];
    for (let i = bEnd+1; i <= mEnd; i++) mS += this._fd[i];
    for (let i = mEnd+1; i <= Math.min(hEnd, bins-1); i++) hS += this._fd[i];
    this.bass += 0.25 * (bS / (bEnd * 255) - this.bass);
    this.mid  += 0.18 * (mS / ((mEnd - bEnd) * 255) - this.mid);
    this.high += 0.18 * (hS / ((hEnd - mEnd) * 255) - this.high);

    // Spectral centroid → pitch
    let wS = 0, wT = 0;
    for (let i = 1; i < bins; i++) { wS += i * this._fd[i]; wT += this._fd[i]; }
    this.pitch += 0.06 * (Math.min(1, (wT > 0 ? wS / wT : 0) / (bins * 0.45)) - this.pitch);

    // Onset detection — thresholds scale with sensitivity (5 = default)
    const sens = this.sensitivity / 5;
    this._onsetCd = Math.max(0, this._onsetCd - dt);
    this.onset    = Math.max(0, this.onset - dt * 5);
    if (this._onsetCd <= 0) {
      const d = rawRms - this._prevRms;
      if (d > 0.045 / sens && rawRms > 0.035 / sens) {
        this.onset = Math.min(1, d * 9);
        this._onsetCd = 0.12;
      }
    }
    this._prevRms = rawRms;

    // Silence
    if (rawRms < 0.012 / sens) this._silTimer = Math.min(1, this._silTimer + dt * 0.4);
    else                       this._silTimer = Math.max(0, this._silTimer - dt * 2.5);
    this.silence = this._silTimer;
  }

  _auto(dt) {
    this._autoT += dt;
    const t = this._autoT;
    this.rms    = 0.07 + 0.04 * Math.sin(t * 0.45) + 0.02 * Math.sin(t * 1.3);
    this.bass   = 0.09 + 0.07 * Math.sin(t * 0.28 + 1.0);
    this.mid    = 0.06 + 0.04 * Math.sin(t * 0.62 + 2.1);
    this.high   = 0.04 + 0.03 * Math.sin(t * 0.95 + 3.2);
    this.pitch  = 0.5  + 0.35 * Math.sin(t * 0.09);
    this.silence = 0.2 + 0.15 * Math.sin(t * 0.18 + 0.7);
    this.onset   = Math.max(0, this.onset - dt * 3);
    if (Math.random() < dt * 0.35) this.onset = 0.35 + Math.random() * 0.65;
  }

  get state() {
    // sensitivity 5 = neutral (×1); 1 = ×0.2 (deaf); 10 = ×2 (amplified).
    // Pitch and silence are ratios — don't scale them.
    const g = this.sensitivity / 5;
    return {
      rms:     Math.min(1, this.rms    * g),
      bass:    Math.min(1, this.bass   * g),
      mid:     Math.min(1, this.mid    * g),
      high:    Math.min(1, this.high   * g),
      pitch:   this.pitch,
      onset:   Math.min(1, this.onset  * g),
      silence: this.silence,
    };
  }
}
