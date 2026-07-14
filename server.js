// TYCHO-EDGE — combined static + WebSocket server for LAN multiplayer.
// Usage: node server.js   (PORT env override, default 8123, binds 0.0.0.0)
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 9100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store', // LAN dev fleet: never let a browser run stale modules
      'X-Kimi-Lunar': '1', // lets the client detect the game server without a 404 probe
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'X-Kimi-Lunar': '1' }); res.end('not found');
  }
});

// ---------------------------------------------------------------- multiplayer
const BALL_R = 0.8;
const PLAZA = { x: -95, z: 110 };          // open ground near the landing pad
const SLOTS = 8;
const RING = 8;
const slots = new Array(SLOTS).fill(null); // slot -> player
const players = new Map();                 // id -> player record
let nextId = 1;
// the moon doubles as the game-launch lobby: first player in = HOST; only the
// host can start a game, which arms a shared 5 s countdown for everyone
let hostId = null;
let launch = null;                         // { startAt, game } while counting down
const GAMES = ['race', 'venice', 'city'];

function slotPos(i) {
  const a = (i / SLOTS) * Math.PI * 2;
  return { x: PLAZA.x + Math.cos(a) * RING, z: PLAZA.z + Math.sin(a) * RING };
}

const wss = new WebSocketServer({ server });

// heartbeat: terminate half-open sockets (killed browsers, slept laptops)
// so ghost players never linger
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; } // close event → cleanup
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, 15000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let me = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !me) {
      // first free slot
      let si = slots.findIndex((s) => s === null);
      if (si === -1) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
      const id = String(nextId++);
      const name = String(msg.name || 'KIMI').slice(0, 4);
      const color = String(msg.color || 'blue');
      const sp = slotPos(si);
      me = { id, name, color, x: sp.x, z: sp.z, vx: 0, vz: 0, heading: 0, slot: si, ws };
      slots[si] = me;
      players.set(id, me);
      if (hostId === null) hostId = id;
      ws.send(JSON.stringify({
        t: 'init', id, spawn: { x: sp.x, z: sp.z }, hostId,
        launch: launch && launch.startAt > Date.now()
          ? { ...launch, serverNow: Date.now() } : null,
        players: [...players.values()].map((p) => ({
          id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, heading: p.heading,
        })),
      }));
      broadcast({ t: 'join', id, name, color, x: sp.x, z: sp.z }, id);
      console.log(`[net] ${name} (${color}) joined as #${id} slot ${si} — ${players.size} online`);
      return;
    }

    if (msg.t === 'startRace' && me && me.id === hostId) {
      if (launch && launch.startAt > Date.now()) return; // countdown already armed
      const game = GAMES.includes(msg.game) ? msg.game : 'race';
      launch = { startAt: Date.now() + 5000, game };
      broadcast({ t: 'raceCountdown', ...launch, serverNow: Date.now() });
      console.log(`[net] host #${me.id} launched ${game}`);
      return;
    }

    if (msg.t === 'state' && me) {
      me.x = +msg.x || 0; me.z = +msg.z || 0;
      me.y = +msg.y || 0;
      me.vx = +msg.vx || 0; me.vz = +msg.vz || 0;
      me.heading = +msg.heading || 0;
      broadcast({ t: 'state', id: me.id, x: me.x, z: me.z, y: me.y, vx: me.vx, vz: me.vz, heading: me.heading }, me.id);
    }
  });

  ws.on('close', () => {
    if (!me) return;
    slots[me.slot] = null;
    players.delete(me.id);
    broadcast({ t: 'leave', id: me.id }, me.id);
    if (players.size === 0) { hostId = null; launch = null; }
    else if (me.id === hostId) {
      hostId = players.keys().next().value;
      broadcast({ t: 'host', hostId });
    }
    console.log(`[net] #${me.id} left — ${players.size} online`);
  });

  ws.on('error', () => {});
});

function broadcast(msg, exceptId = null) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TYCHO-EDGE server on http://0.0.0.0:${PORT}  (static + ws, ${SLOTS} slots around ${PLAZA.x},${PLAZA.z})`);
});
