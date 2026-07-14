// KIMI game relay — static file server + WebSocket race relay on one port.
// Same protocol as the rest of the KIMI AROUND THE WORLD fleet:
//   join {name,color,auto} -> welcome {id, serverNow, race, players[]} + roster broadcast
//   state {at, d[], lap, prog} -> 20 Hz fan-out {t:'states', now, arr:[{id,d,at,lap,prog}]}
//   startRace -> raceStart {startAt: now+5000, serverNow, laps}
//   auto joiners in lobby arm a 4 s grace auto-start (everyone redirected from
//   the moon lands on the same grid)
//   finish {time} -> finishes broadcast; all finished (or deadline) -> raceEnd
//   item {...} -> relayed verbatim with from (victim-authoritative on clients)
// Usage: node server.js   (PORT + LAPS via env; see bottom)
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 9102;
const LAPS = +(process.env.LAPS || 3);
const GAME_NAME = process.env.GAME_NAME || 'GONDOLIER';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary',
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
      'X-Kimi-Lunar': '1',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'X-Kimi-Lunar': '1' }); res.end('not found');
  }
});

// ------------------------------------------------------------- relay state
const players = new Map(); // id -> {ws, name, color, slot, state, stateAt, lap, prog, finished}
let nextId = 1;
const race = { phase: 'lobby', startAt: 0, laps: LAPS, finishes: [], participants: new Set(), deadline: 0 };
let autoStartTimer = null;

const roster = () => [...players.entries()].map(([id, p]) =>
  ({ id, name: p.name, color: p.color, slot: p.slot }));

function freeSlot() {
  const used = new Set([...players.values()].map((p) => p.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(data);
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function startRaceNow() {
  if (race.phase === 'racing' && Date.now() < race.startAt) return;
  race.phase = 'racing';
  race.startAt = Date.now() + 5000;
  race.finishes = [];
  race.participants = new Set(players.keys());
  race.deadline = race.startAt + 12 * 60 * 1000;
  for (const p of players.values()) { p.finished = false; p.lap = 0; p.prog = 0; }
  broadcast({ t: 'raceStart', startAt: race.startAt, serverNow: Date.now(), laps: race.laps });
  console.log(`[race] started for ${players.size} player(s)`);
}

const wss = new WebSocketServer({ server });

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, 15000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let id = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', c: msg.c, s: Date.now() });
        break;

      case 'join': {
        if (id !== null) return;
        if (players.size >= 8) { send(ws, { t: 'full', max: 8 }); ws.close(); return; }
        id = nextId++;
        const slot = freeSlot();
        const color = Number.isInteger(msg.color) ? msg.color : 0x2e7bf6;
        players.set(id, {
          ws, name: String(msg.name || 'KIMI').slice(0, 10).toUpperCase(),
          color, slot, state: null, stateAt: null, lap: 0, prog: 0, finished: false,
        });
        send(ws, { t: 'welcome', id, serverNow: Date.now(), race, players: roster() });
        broadcast({ t: 'roster', players: roster() });
        console.log(`[net] ${players.get(id).name} joined as #${id} slot ${slot} — ${players.size} online`);
        // moon-lobby arrivals (auto=1) land within ~1 s of each other: one
        // shared grace window, then the race arms itself
        if (msg.auto && race.phase === 'lobby' && !autoStartTimer) {
          autoStartTimer = setTimeout(() => {
            autoStartTimer = null;
            if (players.size > 0 && race.phase === 'lobby') startRaceNow();
          }, 4000);
        }
        break;
      }

      case 'state': {
        const p = players.get(id);
        if (!p || !Array.isArray(msg.d)) return;
        p.state = msg.d;
        p.stateAt = msg.at ?? null;
        p.lap = msg.lap | 0;
        p.prog = +msg.prog || 0;
        break;
      }

      case 'startRace':
        startRaceNow();
        break;

      case 'finish': {
        const p = players.get(id);
        if (!p || p.finished || race.phase !== 'racing' || !race.participants.has(id)) return;
        p.finished = true;
        race.finishes.push({ id, name: p.name, color: p.color, time: +msg.time || 0 });
        broadcast({ t: 'finishes', finishes: race.finishes });
        break;
      }

      case 'item': {
        if (id === null) return;
        broadcast({ t: 'item', ...msg, from: id });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (id === null) return;
    players.delete(id);
    race.participants.delete(id);
    broadcast({ t: 'roster', players: roster() });
    broadcast({ t: 'leave', id });
    if (players.size === 0) { race.phase = 'lobby'; race.finishes = []; }
  });

  ws.on('error', () => {});
});

function maybeEndRace() {
  if (race.phase !== 'racing') return;
  if (Date.now() < race.startAt) return;
  // participants still connected; abandoned races (a tab left open on the
  // grid, everyone quit, etc.) must reset or every later join is a broken
  // mid-race join forever
  const present = [...race.participants].filter((pid) => players.has(pid));
  const unfinished = present.filter((pid) => !players.get(pid).finished);
  const timedOut = race.deadline && Date.now() > race.deadline;
  if (present.length === 0 || unfinished.length === 0 || timedOut) {
    race.phase = 'lobby';
    broadcast({ t: 'raceEnd', finishes: race.finishes });
    console.log('[race] complete:', race.finishes.map((f) => f.name).join(', ') || '(abandoned)');
  }
}
setInterval(maybeEndRace, 5000);

// 20 Hz state fan-out — one packet with everyone's latest transform.
setInterval(() => {
  if (players.size === 0) return;
  const now = Date.now();
  const arr = [];
  for (const [pid, p] of players) {
    if (p.state) arr.push({ id: pid, d: p.state, at: p.stateAt, lap: p.lap, prog: p.prog });
  }
  if (arr.length) broadcast({ t: 'states', now, arr });
}, 50);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${GAME_NAME} server on http://0.0.0.0:${PORT} (static + ws, ${LAPS} laps)`);
});
