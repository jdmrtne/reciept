/**
 * What this running copy of the app is, and how to compare it with what is published.
 * The constants are compiled in by vite.config.ts (scripts/version-plugin.mjs); the typeof guards keep tests and tools that
 * do not apply that config from crashing.
 */
/** One release and what changed in it (release-history.txt). */
export interface HistoryEntry { version: string; notes: string }
export interface BuildInfo { version: string; build: string; builtAt: string; /** Every release up to this build, newest first (compiled in), so the booth can list all the versions an update skipped, offline. */ history?: HistoryEntry[]; /** What changed in this build (release-notes.txt, compiled in), so the booth can tell the owner after an update without any network. */ notes?: string }

interface Parsed { nums: [number, number, number]; pre: string[] | null }

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v: unknown): Parsed | null {
  if (typeof v !== 'string') return null;
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null };
}

/** Normalised display form: "v1.2.3". */
export const showVersion = (v: string): string => { const p = parseVersion(v); return p ? `v${v.trim().replace(/^v/, '')}` : v; };

const cmpId = (a: string, b: string): number => {
  const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an) return -1; // numeric identifiers rank below text ones (semver 2.0)
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Semver order: negative if a < b, 0 if equal, positive if a > b; null when either is not a version number. A pre-release ranks below its release. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return Math.sign(x.nums[i] - y.nums[i]);
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const c = cmpId(x.pre[i], y.pre[i]);
    if (c) return c;
  }
  return 0;
}

/**
 * Is the published build newer than the installed one? Version number first (semver). When the numbers are equal the
 * build decides, so a deploy that forgot to bump package.json still shows up as an update on every device:
 *   - different build ids: newer unless the dates prove it is older (missing dates: trust the different id);
 *   - same id (or both unknown/"local"): only a later build time counts.
 * Returns null when the version numbers cannot be compared.
 */
export function compareBuilds(latest: { version: string; build: string | null; builtAt: string | null }, installed: BuildInfo): number | null {
  const byVersion = compareVersions(latest.version, installed.version);
  if (byVersion !== 0) return byVersion;
  const t = (v: string | null): number => (v ? Date.parse(v) : NaN);
  const a = t(latest.builtAt), b = t(installed.builtAt);
  const datesKnown = Number.isFinite(a) && Number.isFinite(b);
  const known = (id: string | null): id is string => !!id && id !== 'local';
  if (known(latest.build) && known(installed.build) && latest.build !== installed.build) return datesKnown ? Math.sign(a - b) : 1;
  if (known(latest.build) && known(installed.build)) return 0; // same commit: a redeploy of identical files is not an update
  return datesKnown ? Math.sign(a - b) : 0;
}

const HISTORY_LIMIT = 40;

/** Release history from a build or a version.json: only entries with a real version number and text, newest first, bounded. */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const e of raw.slice(0, HISTORY_LIMIT)) {
    if (!e || typeof e !== 'object') continue;
    const { version, notes } = e as Record<string, unknown>;
    if (typeof version !== 'string' || !parseVersion(version) || typeof notes !== 'string' || !notes.trim()) continue;
    out.push({ version: version.trim().replace(/^v/, ''), notes: notes.trim().slice(0, 800) });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}

/** The releases a device skipped: newer than `from` (null = all), up to and including `to`, newest first. */
export function historySince(history: HistoryEntry[] | undefined, from: string | null, to: string): HistoryEntry[] {
  return (history ?? []).filter((e) => (from === null || (compareVersions(e.version, from) ?? 0) > 0) && (compareVersions(e.version, to) ?? 1) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}

// Defined after the helpers above: building it parses the compiled-in history, which needs them initialised.
export const INSTALLED: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  build: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'local',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '',
  notes: typeof __APP_NOTES__ === 'string' ? __APP_NOTES__ : '',
  history: typeof __APP_HISTORY__ !== 'undefined' ? sanitizeHistory(__APP_HISTORY__) : []
};

export interface ManifestFile { url: string; size: number }

/** The published description of the newest build (dist/version.json). Only `version` is required: any host can serve a minimal one. */
export interface UpdateManifest {
  version: string;
  build: string | null;
  builtAt: string | null;
  notes: string | null;
  /** Every release up to this one, newest first (empty when the host publishes none). */
  history: HistoryEntry[];
  /** Same-origin files a device downloads for this build, with sizes. Empty = no byte-level progress, only a busy indicator. */
  files: ManifestFile[];
  totalBytes: number | null;
}

export class ManifestError extends Error {}

const FILE_LIMIT = 2000;

export function parseManifest(raw: unknown, origin: string): UpdateManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError('THE UPDATE SOURCE ANSWERED, BUT NOT WITH A VERSION FILE (version.json)');
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !parseVersion(r.version)) throw new ManifestError(`THE VERSION FILE HAS NO VALID VERSION NUMBER (EXPECTED LIKE 1.2.3, GOT ${JSON.stringify(r.version ?? null)})`);
  const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const files: ManifestFile[] = [];
  if (Array.isArray(r.files)) {
    for (const f of r.files.slice(0, FILE_LIMIT)) {
      if (!f || typeof f !== 'object') continue;
      const { url, size } = f as Record<string, unknown>;
      if (typeof url !== 'string' || typeof size !== 'number' || !Number.isFinite(size) || size < 0) continue;
      try {
        const u = new URL(url, origin);
        if (u.origin === origin) files.push({ url: u.href, size });
      } catch { /* an unusable entry is skipped; progress just covers fewer files */ }
    }
  }
  return {
    version: r.version.trim(),
    build: str(r.build, 40),
    builtAt: str(r.builtAt, 40),
    notes: str(r.notes, 800),
    history: sanitizeHistory(r.history),
    files,
    totalBytes: files.length ? files.reduce((n, f) => n + f.size, 0) : null
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
