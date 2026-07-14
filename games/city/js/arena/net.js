// WebSocket client for the arena — same relay protocol as the other games
// (join/roster/states/raceStart/item). Snapshots carry the sender's sample
// time so remote ships interpolate smoothly on the true timeline.
const SEND_HZ = 20;
export const INTERP_DELAY = 140; // ms

export class Net {
  constructor() {
    this.ws = null;
    this.id = -1;
    this.clockOffset = 0;
    this.lastSend = 0;
    this.handlers = {};
    this.connected = false;
    this.joinedAs = null;
    this.reconnecting = false;
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, data) { this.handlers[evt]?.(data); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      const pings = [];
      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
      };
      ws.onerror = () => reject(new Error('connection failed'));
      ws.onclose = () => {
        this.connected = false;
        this.emit('disconnect');
        this.scheduleReconnect();
      };
      ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.t) {
          case 'pong': {
            const now = Date.now();
            const rtt = now - msg.c;
            pings.push(msg.s + rtt / 2 - now);
            if (pings.length < 4) ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
            else {
              pings.sort((a, b) => a - b);
              this.clockOffset = pings[Math.floor(pings.length / 2)];
              resolve();
            }
            break;
          }
          case 'welcome': this.id = msg.id; this.emit('welcome', msg); break;
          case 'roster': this.emit('roster', msg.players); break;
          case 'states': this.emit('states', msg); break;
          case 'raceStart': this.emit('raceStart', msg); break;
          case 'item': this.emit('item', msg); break;
          case 'full': this.emit('full', msg); break;
        }
      };
      setTimeout(() => reject(new Error('connection timeout')), 6000);
    });
  }

  serverTime() { return Date.now() + this.clockOffset; }

  scheduleReconnect() {
    if (this.reconnecting || !this.joinedAs) return;
    this.reconnecting = true;
    const attempt = () => {
      this.connect().then(() => {
        this.reconnecting = false;
        this.join(this.joinedAs.name, this.joinedAs.color);
      }).catch(() => setTimeout(attempt, 2000));
    };
    setTimeout(attempt, 1200);
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  join(name, color, auto = false) {
    this.joinedAs = { name, color };
    this.send({ t: 'join', name, color, auto: !!auto });
  }
  startRace() { this.send({ t: 'startRace' }); }
  sendItem(payload) { this.send({ t: 'item', ...payload }); }

  maybeSendState(P) {
    const now = performance.now();
    if (now - this.lastSend < 1000 / SEND_HZ) return;
    this.lastSend = now;
    const r = x => Math.round(x * 1000) / 1000;
    this.send({
      t: 'state',
      at: this.serverTime(),
      d: [r(P.pos.x), r(P.pos.y), r(P.pos.z), r(P.vel.x), r(P.vel.y), r(P.speed), r(P.bank)],
      lap: 0, prog: 0,
    });
  }
}

// Interpolated remote ship puppet.
export class RemoteShip {
  constructor(info) {
    this.info = info; // {id, name, color, slot}
    this.buffer = [];
    this.ship = null; // assigned by main
    this.speed = 0;
    this.vx = 0;
    this.vy = 0;
    this.bank = 0;
  }

  pushState(d, at) {
    const last = this.buffer[this.buffer.length - 1];
    if (last && at <= last.at) return; // relay re-broadcasts — drop duplicates
    this.buffer.push({ at, x: d[0], y: d[1], z: d[2], vx: d[3], vy: d[4], speed: d[5], bank: d[6] });
    if (this.buffer.length > 40) this.buffer.splice(0, this.buffer.length - 40);
  }

  update(serverNow) {
    if (!this.ship || this.buffer.length === 0) return;
    const t = serverNow - INTERP_DELAY;
    const buf = this.buffer;
    let a = null, b = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].at <= t) { a = buf[i]; b = buf[i + 1] || null; break; }
    }
    const g = this.ship.group;
    const apply = (s0, s1, k) => {
      // loop-wrap teleport: never interpolate across the 800 m seam
      if (Math.abs(s1.z - s0.z) > 300) { const s = k < 0.5 ? s0 : s1; s0 = s; s1 = s; k = 0; }
      g.position.set(
        s0.x + (s1.x - s0.x) * k,
        s0.y + (s1.y - s0.y) * k,
        s0.z + (s1.z - s0.z) * k,
      );
      this.vx = s0.vx + (s1.vx - s0.vx) * k;
      this.vy = s0.vy + (s1.vy - s0.vy) * k;
      this.speed = s0.speed + (s1.speed - s0.speed) * k;
      this.bank = s0.bank + (s1.bank - s0.bank) * k;
    };
    if (!a) { apply(buf[0], buf[0], 0); return; }
    if (!b) {
      const prev = buf[buf.length - 2] || a;
      const last = buf[buf.length - 1];
      const span = last.at - prev.at || 50;
      const k = Math.min((t - last.at) / span, 2);
      if (t - last.at < 250) apply(prev, last, 1 + k);
      else apply(last, last, 0);
      return;
    }
    apply(a, b, (t - a.at) / Math.max(1, b.at - a.at));
  }
}
