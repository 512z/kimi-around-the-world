// KIMI AROUND THE WORLD — one-command fleet launcher.
// Starts the lobby + all three game servers as child processes and pipes
// their logs through with a prefix. Ctrl-C stops the whole fleet.
//
//   npm run fleet            # lobby :9100, race :9101, venice :9102, city :9103
//   PORT=8125 npm run fleet  # lobby port override (games stay on 9101-9103)
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { join } from 'path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const SERVICES = [
  { name: 'lobby',  script: 'server.js',               port: +(process.env.PORT || 9100) },
  { name: 'race',   script: 'games/race/server.js',    port: 9101 },
  { name: 'venice', script: 'games/venice/server.js',  port: 9102 },
  { name: 'city',   script: 'games/city/server.js',    port: 9103 },
];

const kids = [];
for (const s of SERVICES) {
  const child = spawn(process.execPath, [join(ROOT, s.script)], {
    env: { ...process.env, PORT: String(s.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${s.name}:${s.port}] `;
  child.stdout.on('data', (d) => process.stdout.write(tag + d));
  child.stderr.on('data', (d) => process.stderr.write(tag + d));
  child.on('exit', (code) => { console.log(`${tag}exited (${code})`); shutdown(code ?? 0); });
  kids.push(child);
}

function shutdown(code = 0) {
  for (const k of kids) k.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('KIMI AROUND THE WORLD fleet:');
for (const s of SERVICES) console.log(`  ${s.name.padEnd(7)} http://0.0.0.0:${s.port}`);
console.log('Ctrl-C to stop all.\n');
