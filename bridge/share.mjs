// Share store: gives each finished photo session a private folder holding its colour photo and GIF, so a QR code can
// point a customer's phone at them. Zero dependencies, plain files on disk, no database.
//
//   POST /share/<id>/photo.jpg   body = JPEG bytes   (booth -> bridge, local)      -> {ok:true,bytes:N}
//   POST /share/<id>/photo.gif   body = GIF bytes                                   -> {ok:true,bytes:N}
//   GET|HEAD /s/<id>/photo.jpg | /s/<id>/photo.gif   (customer's phone, public)    -> the file (`?download=<name>` saves instead of showing)
//   GET|HEAD /p/<id>                                 (customer's phone, public)    -> the result page the ONE QR code opens: colour photo + GIF
//
// <id> is a 128-bit random token made by the booth (32 hex chars): unguessable, one per photo session, so a QR from an
// old session can only ever open that old session's files. Files expire `ttlMs` after upload (default 24 h).
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { errorHtml, notFoundHtml, photoPageHtml } from './page.mjs';

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
    /** Is this file stored and unexpired? (no read of the bytes; expired sessions are deleted on the spot) */
    async has(id, name) {
      if (!valid(id, name)) return false;
      try {
        const st = await fs.stat(where(id, name));
        if (now() - st.mtimeMs > ttlMs) { await fs.rm(path.join(root, id), { recursive: true, force: true }); return false; }
        return true;
      } catch { return false; }
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
export async function serveShareFile(store, req, res, pathname, search = '') {
  const m = /^\/s\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return false;
  const base = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...base, Allow: 'GET, HEAD' }); res.end(); return true; }
  const f = await store.get(m[1], m[2]);
  if (!f) { res.writeHead(404, { ...base, 'Content-Type': 'text/plain' }); res.end('This link has expired or does not exist.'); return true; }
  // ?download=<name> → attachment, so a phone saves the file instead of opening it (the page's DOWNLOAD buttons). The name is sanitised: it lands in a header.
  const dl = new URLSearchParams(search).get('download');
  const saveAs = dl === null ? null : dl.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || m[2];
  res.writeHead(200, { ...base, 'Content-Type': f.type, 'Content-Length': f.buf.length, 'Content-Disposition': `${saveAs ? 'attachment' : 'inline'}; filename="${saveAs ?? m[2]}"` });
  res.end(req.method === 'HEAD' ? undefined : f.buf);
  return true;
}

/**
 * GET|HEAD /p/<id>: the page the ONE QR code opens. Shows whichever of colour photo / GIF is stored; neither (bad id, never
 * uploaded, expired, deleted) = a friendly 404 page. A storage failure is a friendly 500 page. Raw errors never reach the visitor.
 */
export async function servePhotoPage(store, req, res, pathname) {
  const m = /^\/p\/([^/]*)\/?$/.exec(pathname);
  if (!m) return false;
  const head = { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" };
  const reply = (code, html) => { res.writeHead(code, { ...head, 'Content-Length': Buffer.byteLength(html) }); res.end(req.method === 'HEAD' ? undefined : html); return true; };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...head, Allow: 'GET, HEAD' }); res.end(); return true; }
  let id; try { id = decodeURIComponent(m[1]); } catch { return reply(404, notFoundHtml()); }
  if (!ID_RE.test(id)) return reply(404, notFoundHtml());
  try {
    const [color, gif] = await Promise.all([store.has(id, 'photo.jpg'), store.has(id, 'photo.gif')]);
    return color || gif ? reply(200, photoPageHtml(id, { color, gif })) : reply(404, notFoundHtml());
  } catch { return reply(500, errorHtml()); }
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
 * It can only serve /s/<id>/<file> and the /p/<id> result page; it has no print, status or upload routes at all.
 */
export function createShareServer(store) {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://share');
    if (await serveShareFile(store, req, res, u.pathname, u.search)) return;
    if (await servePhotoPage(store, req, res, u.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
  });
}
