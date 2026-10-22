#!/usr/bin/env node
// Finds network printers: scans your PC's local /24 subnets for anything accepting connections on port 9100.
//   npm run find-printer                 (scans every private network this PC is on)
//   npm run find-printer -- 192.168.1    (scans one subnet prefix)
import net from 'node:net';
import os from 'node:os';

const PORT = Number(process.env.PORT_TO_SCAN || 9100);
const probe = (host, ms = 500) => new Promise((resolve) => {
  const s = net.createConnection({ host, port: PORT });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(ms, () => done(false)); s.once('error', () => done(false)); s.once('connect', () => done(true));
});

function localPrefixes() {
  const out = new Map();
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.set(i.address.split('.').slice(0, 3).join('.'), `${name} (this PC is ${i.address})`);
  return out;
}

const arg = process.argv[2];
const targets = arg ? new Map([[arg.replace(/\.$/, ''), 'given']]) : localPrefixes();
if (!targets.size) { console.log('No network connection found.'); process.exit(1); }

const found = [];
for (const [prefix, where] of targets) {
  console.log(`Scanning ${prefix}.1-254 on port ${PORT}  [${where}] ...`);
  const hosts = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
  let next = 0;
  await Promise.all(Array.from({ length: 96 }, async () => {
    while (next < hosts.length) { const h = hosts[next++]; if (await probe(h)) { found.push(h); console.log(`  FOUND  ${h}:${PORT}`); } }
  }));
}
console.log(found.length
  ? `\nPut this in ADMIN > PRINTER IP:  ${found.join('  or  ')}`
  : `\nNothing answered on port ${PORT}. The printer may be on another network, off, or have raw port ${PORT} disabled.`);
