import { newSessionId, newShareId } from './id';
import { createSupabaseStore, supabaseConfigFromEnv } from './supabase';
import type { ShareStore } from './service';

let cached: { store: ShareStore | null } | undefined;
/** The cloud store when the Supabase env vars are present, else null (the print-bridge sharing from docs/SHARE.md is used). */
export function getShareStore(): ShareStore | null {
  if (!cached) { const cfg = supabaseConfigFromEnv(); cached = { store: cfg ? createSupabaseStore(cfg) : null }; }
  return cached.store;
}
/** Session id format matching the active backend. */
export const makeSessionId = () => (getShareStore() ? newSessionId() : newShareId());
