/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Supabase project URL (safe to expose). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key (safe to expose). NEVER a service_role / secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
