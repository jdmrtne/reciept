/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Supabase project URL (safe to expose). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key (safe to expose). NEVER a service_role / secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Where installed booths look for the latest version (ADMIN > Updates). Default: this site's own /version.json. */
  readonly VITE_UPDATE_URL?: string;
}

/** Compiled in by vite.config.ts (scripts/version-plugin.mjs). Undefined only where the config is not applied. */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __APP_BUILT_AT__: string;
declare const __APP_NOTES__: string;
declare const __APP_HISTORY__: { version: string; notes: string }[];
