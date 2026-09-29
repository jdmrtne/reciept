import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ShareAsset } from './assets';
import type { ShareFile } from './url';
import type { ShareStore, StoreResult } from './service';

export const BUCKET = 'photobooth-media';
/** Storage layout: photos/<sessionId>/color.jpg and photos/<sessionId>/animation.gif (one folder per session, never overwritten). */
export const FILE_NAME: Record<ShareFile, string> = { 'photo.jpg': 'color.jpg', 'photo.gif': 'animation.gif' };
export const objectPath = (sessionId: string, file: ShareFile) => `photos/${sessionId}/${FILE_NAME[file]}`;

/** Only the SAFE client credentials. Never put a service_role key here (or anywhere Vite can see it). */
export interface SupabaseConfig { url: string; publishableKey: string }

/** Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Returns null unless both look valid. */
export function supabaseConfigFromEnv(env: Record<string, unknown> = import.meta.env): SupabaseConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!/^https:\/\/[^/\s]+$/.test(url) || !publishableKey) return null;
  if (/service_role|sb_secret_/i.test(publishableKey)) return null; // refuse a secret key in browser code
  return { url, publishableKey };
}

const UPLOAD_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [800, 2500];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isDuplicate = (e: { message?: string; statusCode?: string | number; status?: number } | null) =>
  !!e && (String(e.statusCode ?? e.status) === '409' || /already exists|duplicate/i.test(e.message ?? ''));

/**
 * Supabase Storage as a ShareStore. Upload (no upsert, so an existing file is never overwritten) → confirm → public URL.
 * Transient failures (network, 5xx, timeout) are retried a couple of times; 4xx (policy/bucket) and collisions are not.
 */
export function createSupabaseStore(cfg: SupabaseConfig, opts: { client?: SupabaseClient; fetchImpl?: typeof fetch; retryDelays?: number[]; timeoutMs?: number } = {}): ShareStore {
  const client = opts.client ?? createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const delays = opts.retryDelays ?? RETRY_DELAYS_MS, timeoutMs = opts.timeoutMs ?? UPLOAD_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? ((i: string, o?: RequestInit) => fetch(i, o));

  const attempt = async (path: string, asset: ShareAsset): Promise<StoreResult | 'retry'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = new Blob([asset.bytes as BlobPart], { type: asset.type });
      const res = await Promise.race([
        client.storage.from(BUCKET).upload(path, body, { contentType: asset.type, upsert: false, cacheControl: '31536000' }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })
      ]);
      if (res.error) {
        if (isDuplicate(res.error as never)) return { ok: false, code: 'collision' };
        const status = Number((res.error as { statusCode?: string }).statusCode ?? 0);
        return status >= 400 && status < 500 ? { ok: false, code: 'upload' } : 'retry';
      }
      return { ok: true, url: client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, ttlMs: null };
    } catch { return 'retry'; } // network down / timeout
    finally { clearTimeout(timer); }
  };

  return {
    async upload(sessionId, file, asset, signal) {
      const path = objectPath(sessionId, file);
      let r: StoreResult | 'retry' = 'retry';
      for (let i = 0; i <= delays.length; i++) {
        if (signal?.aborted) return { ok: false, code: 'upload' };
        r = await attempt(path, asset);
        if (r !== 'retry') break;
        if (i < delays.length) await sleep(delays[i]);
      }
      if (r === 'retry') return { ok: false, code: 'upload' };
      if (!r.ok) return r;

      // Confirm the PUBLIC link serves the file (what a phone will open). Only a definite "no" fails: a network/CORS hiccup on this
      // extra check must not discard an upload Storage already acknowledged.
      try {
        const head = await doFetch(r.url, { method: 'HEAD', cache: 'no-store', signal });
        if (!head.ok) return { ok: false, code: 'unreachable' };
        const len = head.headers.get('content-length');
        if (len !== null && Number(len) !== asset.bytes.length) return { ok: false, code: 'unreachable' };
      } catch { /* unverifiable, but the upload itself succeeded */ }
      return r;
    }
  };
}
