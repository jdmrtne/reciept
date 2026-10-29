import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ShareAsset } from './assets';
import type { ShareFile } from './url';
import type { ShareStore, StoreResult } from './service';
import { BUCKET, objectPath, SHARE_TTL_MS, type SupabaseConfig } from './supabaseConfig';

export { BUCKET, FILE_NAME, objectPath, objectPublicUrl, supabaseConfigFromEnv, type SupabaseConfig } from './supabaseConfig';

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
        client.storage.from(BUCKET).upload(path, body, { contentType: asset.type, upsert: false, cacheControl: '60' }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })
      ]);
      if (res.error) {
        if (isDuplicate(res.error as never)) return { ok: false, code: 'collision' };
        const status = Number((res.error as { statusCode?: string }).statusCode ?? 0);
        return status >= 400 && status < 500 ? { ok: false, code: 'upload' } : 'retry';
      }
      return { ok: true, url: client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, ttlMs: SHARE_TTL_MS };
    } catch { return 'retry'; } // network down / timeout
    finally { clearTimeout(timer); }
  };

  /**
   * Starts (or re-confirms) the session's 10-minute life on the server clock. Idempotent: the ORIGINAL expiry is kept, so a retry or the
   * second file never extends it. 'expired' = the 10 minutes are over (nothing more may be stored); 'denied' = 4xx (e.g. setup.sql not run).
   */
  const register = async (sessionId: string): Promise<'ok' | 'expired' | 'denied' | 'retry'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        client.rpc('register_share_session', { p_id: sessionId }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })
      ]);
      if (res.error) { const status = Number(res.status ?? 0); return status >= 400 && status < 500 ? 'denied' : 'retry'; }
      return res.data ? 'ok' : 'expired';
    } catch { return 'retry'; }
    finally { clearTimeout(timer); }
  };

  return {
    async upload(sessionId, file, asset, signal, opts) {
      const path = objectPath(sessionId, file);
      let reg: Awaited<ReturnType<typeof register>> = 'retry';
      for (let i = 0; i <= delays.length; i++) {
        if (signal?.aborted) return { ok: false, code: 'upload' };
        reg = await register(sessionId);
        if (reg !== 'retry') break;
        if (i < delays.length) await sleep(delays[i]);
      }
      if (reg !== 'ok') return { ok: false, code: 'upload' }; // never store a file the 10-minute cleanup would not know about
      let r: StoreResult | 'retry' = 'retry';
      for (let i = 0; i <= delays.length; i++) {
        if (signal?.aborted) return { ok: false, code: 'upload' };
        r = await attempt(path, asset);
        if (r !== 'retry') break;
        if (i < delays.length) await sleep(delays[i]);
      }
      if (r === 'retry') return { ok: false, code: 'upload' };
      if (!r.ok && r.code === 'collision' && opts?.allowExisting) {
        // Our OWN earlier attempt at this very file (a timed-out upload that landed, or a retry after "unreachable") is not a clash.
        // Nothing is overwritten; it only counts when the public link serves exactly our byte length.
        const url = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        try {
          const head = await doFetch(url, { method: 'HEAD', cache: 'no-store', signal });
          if (head.ok && Number(head.headers.get('content-length')) === asset.bytes.length) return { ok: true, url, ttlMs: SHARE_TTL_MS };
        } catch { /* cannot confirm: treat as the clash it might be */ }
        return r;
      }
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
