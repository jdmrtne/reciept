import { SESSION_ID_RE, SHARE_ID_RE } from './id';
import { objectPublicUrl, type SupabaseConfig } from './supabaseConfig';
import type { ShareFile } from './url';

/** What the result page shows for one QR: one id → the colour image and the GIF (either may be missing). */
export interface DigitalPhoto {
  id: string;
  coloredImage: string | null; // public URL of the stored colour JPEG, or null when it is not there
  gif: string | null;          // public URL of the stored GIF, or null when it is not there
  createdAt: string | null;    // booth-local `YYYY-MM-DDTHH:MM:SS`, when the id carries a time (Supabase ids); else null
  status: 'active';            // a session whose files are gone is not "inactive": it simply does not resolve (notfound)
}
export type DigitalLookup =
  | { state: 'ok'; photo: DigitalPhoto }
  | { state: 'notfound' }   // bad/unknown id, deleted or expired: "no longer available"
  | { state: 'error' };     // storage/network trouble: worth a retry, not a "gone"

/** Where a backend keeps the files, derived from the id alone, so no database row is needed. */
export interface DigitalSource {
  assetUrl(id: string, file: ShareFile): string;
  /** Same file with a `Content-Disposition: attachment` hint so phones SAVE it instead of opening it (works cross-origin, unlike <a download>). */
  downloadUrl(id: string, file: ShareFile, name: string): string;
}

export const isPhotoId = (id: string) => SHARE_ID_RE.test(id) || SESSION_ID_RE.test(id);

export const createdAtFromId = (id: string): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
};

/** Supabase Storage: the same public links the booth uploaded to (`?download=<name>` is Supabase's attachment switch). */
export const supabaseSource = (cfg: SupabaseConfig): DigitalSource => ({
  assetUrl: (id, file) => objectPublicUrl(cfg, id, file),
  downloadUrl: (id, file, name) => `${objectPublicUrl(cfg, id, file)}?download=${encodeURIComponent(name)}`
});

type Probe = 'yes' | 'no' | 'unknown';
async function probe(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Probe> {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', cache: 'no-store', signal });
    if (r.ok) return 'yes';
    return r.status >= 500 ? 'unknown' : 'no'; // 404 (Supabase also answers 400) = not stored; 5xx = the store is struggling, not "gone"
  } catch { return 'unknown'; }
}

/**
 * Resolves one id into what can be shown. Never throws. Both files missing (4xx) = notfound; trouble reaching storage with
 * nothing confirmed = error; otherwise ok with whatever exists. An asset whose probe was inconclusive is still offered
 * (the <img> falls back if it really fails), so a flaky HEAD never hides a photo that is there.
 */
export async function lookupDigitalPhoto(id: string, source: DigitalSource | null, fetchImpl: typeof fetch = (i, o) => fetch(i, o), signal?: AbortSignal): Promise<DigitalLookup> {
  if (!isPhotoId(id) || !source) return { state: 'notfound' };
  const [color, gif] = await Promise.all((['photo.jpg', 'photo.gif'] as const).map((f) => probe(source.assetUrl(id, f), fetchImpl, signal)));
  if (color === 'no' && gif === 'no') return { state: 'notfound' };
  if (color !== 'yes' && gif !== 'yes' && (color === 'unknown' || gif === 'unknown')) return { state: 'error' };
  return {
    state: 'ok',
    photo: { id, coloredImage: color === 'no' ? null : source.assetUrl(id, 'photo.jpg'), gif: gif === 'no' ? null : source.assetUrl(id, 'photo.gif'), createdAt: createdAtFromId(id), status: 'active' }
  };
}
