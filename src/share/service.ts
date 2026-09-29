import { qrMatrix } from './qr';
import { publicUrl, uploadUrl, type ShareFile } from './url';
import type { ShareAsset } from './assets';

/** Why one QR could not be produced. The screen maps each to short customer-facing copy. */
export type ShareFailure = 'missing' | 'config' | 'render' | 'upload' | 'unreachable' | 'qr';
export type ShareResult = { ok: true; url: string; matrix: boolean[][]; asset: ShareAsset; ttlMs: number | null } | { ok: false; code: ShareFailure };

export interface ShareEnv {
  /** Booth → bridge upload. */
  fetch: typeof fetch;
  /** Bridge address for uploads. */
  bridgeUrl: string;
  /** Normalised public address for the QR (null = not configured / unusable). */
  publicBase: string | null;
  signal?: AbortSignal;
}

/** Fetch failures that are not aborts. */
const tryFetch = async (env: ShareEnv, input: string, init?: RequestInit) => {
  try { return await env.fetch(input, { ...init, signal: env.signal }); } catch { return null; }
};

/**
 * One QR, end to end: make the file → upload it under THIS session's id → confirm the PUBLIC link serves it → build the QR.
 * A QR is only returned once the link actually works from where customers will open it, so it never points at nothing.
 * `make` returning null/throwing 'missing' means the source (photo / frames) does not exist.
 */
export async function prepareShare(file: ShareFile, id: string, make: () => Promise<ShareAsset | null>, env: ShareEnv): Promise<ShareResult> {
  if (!env.publicBase) return { ok: false, code: 'config' };
  let asset: ShareAsset | null;
  try { asset = await make(); } catch (e) { return { ok: false, code: (e as Error)?.message === 'no-photos' ? 'missing' : 'render' }; }
  if (!asset) return { ok: false, code: 'missing' };

  const up = await tryFetch(env, uploadUrl(env.bridgeUrl, id, file), { method: 'POST', headers: { 'Content-Type': asset.type }, body: asset.bytes as BodyInit });
  if (!up || !up.ok) return { ok: false, code: 'upload' };
  const info = await up.json().catch(() => null) as { ok?: boolean; bytes?: number; ttlMs?: number } | null;
  if (!info?.ok || info.bytes !== asset.bytes.length) return { ok: false, code: 'upload' }; // truncated in transit

  const url = publicUrl(env.publicBase, id, file);
  const head = await tryFetch(env, url, { method: 'HEAD', cache: 'no-store' });
  if (!head || !head.ok || Number(head.headers.get('content-length')) !== asset.bytes.length) return { ok: false, code: 'unreachable' };

  try { return { ok: true, url, matrix: qrMatrix(url), asset, ttlMs: typeof info.ttlMs === 'number' ? info.ttlMs : null }; } catch { return { ok: false, code: 'qr' }; }
}

/** Owner check used by ADMIN: uploads a tiny real GIF and reads it back through the public address. */
const PIXEL_GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), (c) => c.charCodeAt(0));
export async function checkShare(id: string, env: ShareEnv): Promise<ShareFailure | null> {
  const r = await prepareShare('photo.gif', id, async () => ({ bytes: PIXEL_GIF, type: 'image/gif' }), env);
  return r.ok ? null : r.code;
}
