import { qrMatrix } from './qr';
import { pageUrl, publicUrl, uploadUrl, type ShareFile } from './url';
import type { ShareAsset } from './assets';

/** Why a file or the QR could not be produced. The screen maps each to short customer-facing copy. */
export type ShareFailure = 'missing' | 'config' | 'render' | 'upload' | 'unreachable' | 'qr' | 'collision';
/** One stored file: `url` is its direct public link (the result page shows it; the QR never encodes it). */
export type ShareResult = { ok: true; url: string; asset: ShareAsset; ttlMs: number | null } | { ok: false; code: ShareFailure };

/** A place that keeps a session's file and hands back the PUBLIC link. Only resolves ok once the file is really stored. */
export type StoreResult = { ok: true; url: string; ttlMs: number | null } | { ok: false; code: 'upload' | 'unreachable' | 'collision' };
export interface ShareStore {
  /** `allowExisting`: this is a retry of a file we may already have stored, so "already there" with the same size counts as success. */
  upload(sessionId: string, file: ShareFile, asset: ShareAsset, signal?: AbortSignal, opts?: { allowExisting?: boolean }): Promise<StoreResult>;
}
/** Where the job is, for the status line. */
export type SharePhase = 'preparing' | 'uploading' | 'qr';

export interface ShareEnv {
  /** When set (Supabase), uploads go here and the bridge / publicBase are not used. */
  store?: ShareStore;
  onPhase?: (phase: SharePhase) => void;
  /** Booth → bridge upload. */
  fetch: typeof fetch;
  /** Bridge address for uploads. */
  bridgeUrl: string;
  /** Bridge mode: normalised public address of the bridge's share server (serves the files AND /p/<id>). null = not configured / unusable. */
  publicBase: string | null;
  /** Supabase mode: where the booth app (which serves /p/<id>) is hosted. null = unknown, so there is nothing for a QR to point at. */
  pageBase?: string | null;
  /** This is a retry/revisit of a file that may already be stored (see ShareStore.upload). */
  allowExisting?: boolean;
  signal?: AbortSignal;
}

/** The host the ONE QR points at, for the active backend (null = cannot make a QR that works on a phone). */
export const qrBase = (env: Pick<ShareEnv, 'store' | 'publicBase' | 'pageBase'>) => (env.store ? env.pageBase ?? null : env.publicBase);

/** Fetch failures that are not aborts. */
const tryFetch = async (env: ShareEnv, input: string, init?: RequestInit) => {
  try { return await env.fetch(input, { ...init, signal: env.signal }); } catch { return null; }
};

/**
 * Stores ONE file of a session: make it → upload it under THIS session's id → confirm the PUBLIC link serves it.
 * The QR is separate (`makePageQr`): it encodes the session's page, and each file just has to be there when the page loads.
 * `make` returning null/throwing 'no-photos' means the source (photo / frames) does not exist.
 */
export async function uploadShareFile(file: ShareFile, id: string, make: () => Promise<ShareAsset | null>, env: ShareEnv): Promise<ShareResult> {
  if (!qrBase(env)) return { ok: false, code: 'config' };
  env.onPhase?.('preparing');
  let asset: ShareAsset | null;
  try { asset = await make(); } catch (e) { return { ok: false, code: (e as Error)?.message === 'no-photos' ? 'missing' : 'render' }; }
  if (!asset) return { ok: false, code: 'missing' };

  env.onPhase?.('uploading');
  if (env.store) {
    let r: StoreResult;
    try { r = await env.store.upload(id, file, asset, env.signal, { allowExisting: env.allowExisting }); } catch { return { ok: false, code: 'upload' }; }
    if (!r.ok) return { ok: false, code: r.code };
    env.onPhase?.('qr');
    return { ok: true, url: r.url, asset, ttlMs: r.ttlMs };
  }

  const up = await tryFetch(env, uploadUrl(env.bridgeUrl, id, file), { method: 'POST', headers: { 'Content-Type': asset.type }, body: asset.bytes as BodyInit });
  if (!up || !up.ok) return { ok: false, code: 'upload' };
  const info = await up.json().catch(() => null) as { ok?: boolean; bytes?: number; ttlMs?: number } | null;
  if (!info?.ok || info.bytes !== asset.bytes.length) return { ok: false, code: 'upload' }; // truncated in transit

  env.onPhase?.('qr');
  const url = publicUrl(env.publicBase!, id, file);
  const head = await tryFetch(env, url, { method: 'HEAD', cache: 'no-store' });
  if (!head || !head.ok || Number(head.headers.get('content-length')) !== asset.bytes.length) return { ok: false, code: 'unreachable' };
  return { ok: true, url, asset, ttlMs: typeof info.ttlMs === 'number' ? info.ttlMs : null };
}

/** The session's ONE QR: encodes only `<base>/p/<id>`. Reusable as-is by anything that needs the QR (the app screen, a download, Phase 2's frame). */
export type PhotoQr = { ok: true; url: string; matrix: boolean[][] } | { ok: false; code: 'qr' | 'config' };
export function makePageQr(base: string | null, id: string): PhotoQr {
  if (!base) return { ok: false, code: 'config' };
  try { const url = pageUrl(base, id); return { ok: true, url, matrix: qrMatrix(url) }; } catch { return { ok: false, code: 'qr' }; }
}

/** Owner check used by ADMIN: uploads a tiny real GIF and reads it back through the public address. */
const PIXEL_GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), (c) => c.charCodeAt(0));
export async function checkShare(id: string, env: ShareEnv): Promise<ShareFailure | null> {
  const r = await uploadShareFile('photo.gif', id, async () => ({ bytes: PIXEL_GIF, type: 'image/gif' }), env);
  if (!r.ok) return r.code;
  return makePageQr(qrBase(env), id).ok ? null : 'qr';
}
