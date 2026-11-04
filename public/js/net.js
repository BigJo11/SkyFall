// WebSocket client with a tiny event router.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.ping = 0;          // smoothed round trip in ms
    this._pingTimer = null;
    this.closed = false;
  }

  // Round trip in milliseconds, sent with every position report so the server
  // knows how far back to rewind a target when a shot is fired.
  get rtt() {
    return Math.max(0, Math.min(400, Math.round(this.ping || 0)));
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, msg) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(msg);
  }

  connect(name, code = '', cosmetic = null, map = 'big') {
    this.code = code;
    this.cosmetic = cosmetic;
    this.map = map;
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws`;
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      this.closed = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          t: 'join', name, code: this.code, cosmetic: this.cosmetic, map: this.map,
        }));
        settled = true;
        resolve();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg && msg.t === 'pong' && Number.isFinite(msg.c)) {
          const sample = Math.max(0, Math.min(400, Date.now() - msg.c));
          // exponential average, but let a real spike through quickly
          this.ping = this.ping ? this.ping * 0.7 + sample * 0.3 : sample;
        }
        if (msg && msg.t) this.emit(msg.t, msg);
      };
      ws.onclose = () => {
        this.closed = true;
        clearInterval(this._pingTimer);
        if (!settled) reject(new Error('Could not reach the game server'));
        else this.emit('close', {});
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new Error('WebSocket error')); }
      };

      this._pingTimer = setInterval(() => {
        if (ws.readyState === 1) this.send({ t: 'ping', c: Date.now() });
      }, 1500);
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  disconnect() {
    this.closed = true;
    clearInterval(this._pingTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
