#!/usr/bin/env node
// Print bridge: lets the photobooth web app (which cannot open raw TCP) send ESC/POS bytes to a network
// thermal printer (port 9100). Zero dependencies. Run:  node bridge/server.mjs   (or: npm run bridge)
//
//   POST /print?host=10.0.0.11&port=9100   body = raw printer bytes   -> {ok:true,bytes:N}
//   GET  /status?host=10.0.0.11&port=9100                              -> {ok:true} if the printer accepts a connection
//
// Safety: only private-network IPv4 addresses (10.x, 172.16-31.x, 192.168.x, 127.x) and port 9100 are allowed,
// so the bridge can't be used to reach the internet or other services. Override the port list with ALLOW_PORTS=9100,9101.
// Optional: ALLOW_ORIGIN=https://your-booth-host (comma-separated) so only your booth page may call it; unset = any page (original behaviour).
import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { listPrinters, printerInfo, runPowerShell, sendRaw } from './windows.mjs';

const MAX_BYTES = 64 * 1024 * 1024;

export function isPrivateHost(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h || '');
  if (!m) return h === 'localhost';
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Opens a TCP connection, runs `use(socket)`, always closes. Rejects on connect error/timeout. */
function withSocket(host, port, timeoutMs, use) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    let done = false;
    const end = (err, val) => { if (done) return; done = true; s.destroy(); err ? reject(err) : resolve(val); };
    s.setTimeout(timeoutMs, () => end(Object.assign(new Error('printer connection timed out'), { code: 'ETIMEDOUT' })));
    s.once('error', (e) => end(e));
    s.once('connect', () => { s.setTimeout(0); Promise.resolve(use(s)).then((v) => end(null, v), (e) => end(e)); });
  });
}

const writeAll = (s, buf) => new Promise((res, rej) => s.write(buf, (e) => (e ? rej(e) : res())));
const flushAndClose = (s) => new Promise((res) => { s.end(() => setTimeout(res, 150)); }); // brief grace so the last bytes leave the OS buffer

/**
 * CORS origin to send back. `allowOrigins` empty/undefined = '*' (the original behaviour: any page may call the bridge).
 * With a list, only a matching request Origin is echoed; anything else gets no allow-origin header, so the browser blocks it.
 */
export function corsOrigin(allowOrigins, requestOrigin) {
  if (!allowOrigins || allowOrigins.length === 0) return '*';
  return requestOrigin && allowOrigins.includes(requestOrigin) ? requestOrigin : null;
}

export function createBridge({ allowPorts = [9100], allowOrigins = [], log = () => {}, powershell = runPowerShell } = {}) {
  return http.createServer(async (req, res) => {
    const origin = corsOrigin(allowOrigins, req.headers.origin);
    const cors = {
      ...(origin ? { 'Access-Control-Allow-Origin': origin, ...(origin !== '*' ? { Vary: 'Origin' } : {}) } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600'
    };
    const send = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    const url = new URL(req.url || '/', 'http://bridge');
    const host = url.searchParams.get('host') || '';
    const port = Number(url.searchParams.get('port') || 9100);
    const needsPrinter = url.pathname === '/print' || url.pathname === '/status';
    if (url.pathname === '/' && req.method === 'GET') return send(200, { ok: true, name: 'photobooth print bridge' });

    // Windows print queues (USB printers installed in Windows): GET /printers, GET /status?printer=NAME, POST /print?printer=NAME
    const queue = url.searchParams.get('printer');
    if (url.pathname === '/printers' && req.method === 'GET') {
      try { return send(200, { ok: true, printers: await listPrinters(powershell) }); }
      catch (e) { return send(e.code === 'ENOTWIN' ? 501 : 502, { ok: false, error: e.message }); }
    }
    if (needsPrinter && queue !== null) {
      if (!queue.trim() || queue.length > 200) return send(400, { ok: false, error: 'printer name is empty or too long' });
      try {
        if (url.pathname === '/status' && req.method === 'GET') {
          const info = await printerInfo(queue, powershell);
          log(`status ok Windows printer "${queue}" (port ${info?.PortName})`);
          return send(200, { ok: true, port: info?.PortName, driver: info?.DriverName });
        }
        if (url.pathname === '/print' && req.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const c of req) { size += c.length; if (size > MAX_BYTES) return send(413, { ok: false, error: 'too large' }); chunks.push(c); }
          const body = Buffer.concat(chunks);
          if (!body.length) return send(400, { ok: false, error: 'empty body' });
          await sendRaw(queue, body, powershell);
          log(`printed ${body.length} bytes -> Windows printer "${queue}"`);
          return send(200, { ok: true, bytes: body.length });
        }
        return send(405, { ok: false, error: 'method not allowed' });
      } catch (e) {
        log(`error Windows printer "${queue}": ${e.message}`);
        return send(e.code === 'ENOTWIN' ? 501 : 502, { ok: false, error: e.code === 'ENOTWIN' ? e.message : `Windows printer "${queue}" failed: ${e.message}` });
      }
    }
    if (!needsPrinter) return send(404, { ok: false, error: 'not found' });
    if (!isPrivateHost(host)) return send(400, { ok: false, error: 'host must be a private-network IPv4 address' });
    if (!allowPorts.includes(port)) return send(400, { ok: false, error: `port ${port} is not allowed` });

    try {
      if (url.pathname === '/status' && req.method === 'GET') {
        await withSocket(host, port, 3000, () => {});
        log(`status ok ${host}:${port}`);
        return send(200, { ok: true });
      }
      if (url.pathname === '/print' && req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > MAX_BYTES) return send(413, { ok: false, error: 'too large' }); chunks.push(c); }
        const body = Buffer.concat(chunks);
        if (!body.length) return send(400, { ok: false, error: 'empty body' });
        await withSocket(host, port, 5000, async (s) => { await writeAll(s, body); await flushAndClose(s); });
        log(`printed ${body.length} bytes -> ${host}:${port}`);
        return send(200, { ok: true, bytes: body.length });
      }
      return send(405, { ok: false, error: 'method not allowed' });
    } catch (e) {
      log(`error ${host}:${port} ${e.code || e.message}`);
      return send(502, { ok: false, error: `printer unreachable (${e.code || e.message})` });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 9101);
  const allowPorts = (process.env.ALLOW_PORTS || '9100').split(',').map(Number);
  // ALLOW_ORIGIN=https://booth.example.com[,http://localhost:5173] restricts which web pages may call the bridge (default: any).
  const allowOrigins = (process.env.ALLOW_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  createBridge({ allowPorts, allowOrigins, log: (m) => console.log(new Date().toLocaleTimeString(), m) })
    .listen(port, () => console.log(`Print bridge listening on http://localhost:${port}  (printer port(s): ${allowPorts.join(', ')}; origins: ${allowOrigins.join(', ') || 'any'})`));
}
