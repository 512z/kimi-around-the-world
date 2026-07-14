// LAN multiplayer client. Silently falls back to single-player if no server
// answers within ~2s (e.g. the static public deploy).
export class NetClient {
  constructor() {
    this.ws = null;
    this.online = false;
    this.id = null;
    this.onInit = null;     // (msg) => void
    this.onJoin = null;     // (player) => void
    this.onLeave = null;    // (id) => void
    this.onState = null;    // (msg) => void
    this.onFallback = null; // () => void
    this._joined = false;
  }

  async connect(profile) {
    // file:// deploys and servers without the probe endpoint get no WS attempt
    // (a failed WebSocket handshake logs a console error we can't suppress)
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      this._fallback();
      return;
    }
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 1500);
      // '/' returns 200 on any static host (no console-noisy 404); only the
      // game server stamps the X-Kimi-Lunar header
      const r = await fetch(`${location.origin}/`, { signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok || r.headers.get('x-kimi-lunar') !== '1') { this._fallback(); return; }
    } catch {
      this._fallback();
      return;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}`);
    } catch {
      this._fallback();
      return;
    }
    this.ws = ws;
    const timer = setTimeout(() => {
      if (!this._joined) { try { ws.close(); } catch { /* noop */ } this._fallback(); }
    }, 2000);

    ws.onopen = () => {
      this._joined = true;
      clearTimeout(timer);
      this.online = true;
      this.send({ t: 'join', name: profile.name, color: profile.color });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'init') { this.id = msg.id; this.onInit?.(msg); }
      else if (msg.t === 'join') this.onJoin?.(msg);
      else if (msg.t === 'leave') this.onLeave?.(msg.id);
      else if (msg.t === 'state') this.onState?.(msg);
      else if (msg.t === 'host') this.onHost?.(msg.hostId);
      else if (msg.t === 'raceCountdown') this.onCountdown?.(msg);
      else if (msg.t === 'full') { this.full = true; this._fallback(); }
    };
    ws.onclose = () => { this.online = false; };
    ws.onerror = () => {};
  }

  _fallback() {
    if (this._fallbackDone) return;
    this._fallbackDone = true;
    this.online = false;
    this.onFallback?.();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendState(s) { if (this.online) this.send({ t: 'state', ...s }); }

  startRace(game) { if (this.online) this.send({ t: 'startRace', game }); }

  leave() {
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
    this.ws = null;
    this.online = false;
    this._joined = false;
  }
}
