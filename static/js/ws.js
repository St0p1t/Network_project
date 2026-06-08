/**
 * WebSocket client with automatic reconnect.
 * onBoids(ArrayBuffer)    — binary boid frame
 * onFrame({flora,events,time}) — combined flora+events JSON
 */
export class ResonanceWS {
  constructor({ onBoids, onFrame, onStatus }) {
    this._onBoids  = onBoids;
    this._onFrame  = onFrame;
    this._onStatus = onStatus;
    this._ws       = null;
    this._delay    = 1000;
    this._alive    = true;
    this._connect();
  }

  _connect() {
    if (!this._alive) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${location.host}/ws`;
    this._onStatus('connecting');

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.onopen = () => {
      this._delay = 1000;
      this._onStatus('open');
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this._onBoids(e.data);
      } else {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'fe') this._onFrame(msg);
        } catch (_) {}
      }
    };

    ws.onclose = () => {
      this._onStatus('closed');
      if (this._alive) {
        setTimeout(() => this._connect(), this._delay);
        this._delay = Math.min(this._delay * 1.5, 8000);
      }
    };

    ws.onerror = () => ws.close();
  }

  /** Send current audio state to server (throttled by caller). */
  sendAudio(state) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'audio', state }));
    }
  }

  close() {
    this._alive = false;
    this._ws?.close();
  }
}

/**
 * Decode binary boid frame from Python server.
 * Format: [uint32 count] then count × [int16 px][int16 py][uint16 angle][uint8 energy]
 * All multibyte values are big-endian.
 */
export function decodeBoids(buffer, worldW, worldH) {
  const view     = new DataView(buffer);
  const count    = view.getUint32(0, false);
  const PX_S     = (worldW / 2) / 32767;
  const PY_S     = (worldH / 2) / 32767;
  const ANG_S    = (2 * Math.PI) / 65535;
  const boids    = new Array(count);
  let   off      = 4;

  for (let i = 0; i < count; i++) {
    boids[i] = {
      px:     view.getInt16( off,     false) * PX_S,
      py:     view.getInt16( off + 2, false) * PY_S,
      angle:  view.getUint16(off + 4, false) * ANG_S,
      energy: view.getUint8( off + 6)        / 255,
    };
    off += 7;
  }
  return boids;
}
