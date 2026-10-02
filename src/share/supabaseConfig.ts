import type { ShareFile } from './url';

// The pure half of the Supabase backend (names, paths, public URLs, env parsing). No client import, so the phone-side result
// page can use it without downloading the Supabase SDK.

export const BUCKET = 'photobooth-media';
/** Storage layout: photos/<sessionId>/color.jpg and photos/<sessionId>/animation.gif (one folder per session, never overwritten). */
export const FILE_NAME: Record<ShareFile, string> = { 'photo.jpg': 'color.jpg', 'photo.gif': 'animation.gif' };
export const objectPath = (sessionId: string, file: ShareFile) => `photos/${sessionId}/${FILE_NAME[file]}`;
/** Public link of one stored file. Pure (no client needed), so the phone-side result page can build it from the id alone. */
export const objectPublicUrl = (cfg: SupabaseConfig, sessionId: string, file: ShareFile) => `${cfg.url}/storage/v1/object/public/${BUCKET}/${objectPath(sessionId, file)}`;

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
