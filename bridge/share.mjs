// Share store: gives each finished photo session a private folder holding its colour photo and GIF, so a QR code can
// point a customer's phone at them. Zero dependencies, plain files on disk, no database.
//
//   POST /share/<id>/photo.jpg   body = JPEG bytes   (booth -> bridge, local)      -> {ok:true,bytes:N}
//   POST /share/<id>/photo.gif   body = GIF bytes                                   -> {ok:true,bytes:N}
//   GET|HEAD /s/<id>/photo.jpg | /s/<id>/photo.gif   (customer's phone, public)    -> the file
//
// <id> is a 128-bit random token made by the booth (32 hex chars): unguessable, one per photo session, so a QR from an
// old session can only ever open that old session's files. Files expire `ttlMs` after upload (default 24 h).
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const ID_RE = /^[a-f0-9]{32}$/;
export const FILE_TYPES = { 'photo.jpg': 'image/jpeg', 'photo.gif': 'image/gif' };
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Real file signature, so the share folder can't be used to host arbitrary content. */
export function looksLike(name, buf) {
  if (name === 'photo.jpg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (name === 'photo.gif') return buf.length > 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8';
  return false;
}

export function createShareStore({ dir, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  if (!dir) throw new Error('share store needs a directory');
  const root = path.resolve(dir);
  const valid = (id, name) => typeof id === 'string' && ID_RE.test(id) && Object.hasOwn(FILE_TYPES, name);
  const where = (id, name) => path.join(root, id, name);

  return {
    root, ttlMs,
    valid,
    /** Saves (or replaces, for a retry) one file of one session. */
    async put(id, name, buf) {
      if (!valid(id, name)) throw Object.assign(new Error('bad id or file name'), { code: 'EBADREQ' });
      if (!buf.length || buf.length > MAX_FILE_BYTES) throw Object.assign(new Error('bad size'), { code: 'ESIZE' });
      if (!looksLike(name, buf)) throw Object.assign(new Error('not a real ' + name), { code: 'ETYPE' });
      await fs.mkdir(path.join(root, id), { recursive: true });
      const tmp = where(id, name) + '.part';
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, where(id, name)); // atomic: a scan never sees a half-written file
    },
    /** File + metadata, or null when unknown/expired (expired files are deleted on the spot). */
    async get(id, name) {
      if (!valid(id, name)) return null;
      try {
        const st = await fs.stat(where(id, name));
        if (now() - st.mtimeMs > ttlMs) { await fs.rm(path.join(root, id), { recursive: true, force: true }); return null; }
        return { buf: await fs.readFile(where(id, name)), type: FILE_TYPES[name], expiresAt: st.mtimeMs + ttlMs };
      } catch { return null; }
    },
    /** Deletes every expired session folder (and stray .part files). Returns how many folders were removed. */
    async sweep() {
      let removed = 0, names = [];
      try { names = await fs.readdir(root); } catch { return 0; }
      for (const id of names) {
        if (!ID_RE.test(id)) continue;
        const d = path.join(root, id);
        try {
          const files = await fs.readdir(d);
          let newest = 0;
          for (const f of files) newest = Math.max(newest, (await fs.stat(path.join(d, f))).mtimeMs);
          if (!files.length || now() - newest > ttlMs) { await fs.rm(d, { recursive: true, force: true }); removed++; }
        } catch { /* folder vanished meanwhile */ }
      }
      return removed;
    }
  };
}

/** GET|HEAD /s/<id>/<file>. Returns true when the path was a share path (handled), false to let the caller continue. */
export async function serveShareFile(store, req, res, pathname) {
  const m = /^\/s\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return false;
  const base = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...base, Allow: 'GET, HEAD' }); res.end(); return true; }
  const f = await store.get(m[1], m[2]);
  if (!f) { res.writeHead(404, { ...base, 'Content-Type': 'text/plain' }); res.end('This link has expired or does not exist.'); return true; }
  res.writeHead(200, { ...base, 'Content-Type': f.type, 'Content-Length': f.buf.length, 'Content-Disposition': `inline; filename="${m[2]}"` });
  res.end(req.method === 'HEAD' ? undefined : f.buf);
  return true;
}

/** POST /share/<id>/<file>. Returns true when handled. `send(code, obj)` is the bridge's JSON responder. */
export async function receiveShareUpload(store, req, send, pathname) {
  const m = /^\/share\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return false;
  if (req.method !== 'POST') { send(405, { ok: false, error: 'method not allowed' }); return true; }
  if (!store.valid(m[1], m[2])) { send(400, { ok: false, error: 'bad id or file name' }); return true; }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_FILE_BYTES) { send(413, { ok: false, error: 'too large' }); return true; } chunks.push(c); }
  const body = Buffer.concat(chunks);
  try {
    await store.put(m[1], m[2], body);
    send(200, { ok: true, bytes: body.length, ttlMs: store.ttlMs });
  } catch (e) {
    send(e.code === 'ETYPE' || e.code === 'ESIZE' || e.code === 'EBADREQ' ? 400 : 500, { ok: false, error: e.message });
  }
  return true;
}

/**
 * Read-only server for the OUTSIDE world (put a tunnel/reverse proxy in front of THIS port, never the bridge's).
 * It can only serve /s/<id>/<file>; it has no print, status or upload routes at all.
 */
export function createShareServer(store) {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://share').pathname;
    if (await serveShareFile(store, req, res, pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
  });
}
