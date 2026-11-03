// Build-time version stamping for the in-app updater (src/pwa/updater.ts, ADMIN > Updates).
//  1. `versionDefines()` gives the app its own version/build, compiled into the bundle.
//  2. `versionManifestPlugin()` writes dist/version.json after `vite build`: the file the Updates card reads to learn what is published.
// The version number comes from package.json. To publish an update: bump it (npm version patch), push, let the host deploy.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PRECACHE = /\.(js|css|html|svg|png|webp|woff2)$/i; // same families vite.config.ts precaches
const SKIP = /^(sw\.js|workbox-[^/]*\.js|version\.json)$/i;
const NOTES_FILE = 'release-notes.txt';
const NOTES_MAX = 800;

export function readVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return String(pkg.version ?? '0.0.0');
}

/** Short id of the commit being built: the host's env var first, then git, then "local". Informational only; never used to decide whether an update exists. */
export function readBuildId(root, env = process.env) {
  const fromEnv = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || env.CF_PAGES_COMMIT_SHA || env.COMMIT_REF;
  if (fromEnv) return String(fromEnv).slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'local'; }
  catch { return 'local'; }
}

export function readNotes(root, env = process.env) {
  const raw = env.RELEASE_NOTES || (existsSync(join(root, NOTES_FILE)) ? readFileSync(join(root, NOTES_FILE), 'utf8') : '');
  return String(raw).trim().slice(0, NOTES_MAX);
}

export function versionDefines(root, builtAt = new Date().toISOString()) {
  return {
    __APP_VERSION__: JSON.stringify(readVersion(root)),
    __APP_BUILD__: JSON.stringify(readBuildId(root)),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
    __APP_NOTES__: JSON.stringify(readNotes(root))
  };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Everything a device downloads for an update, with sizes, so the Updates card can show honest byte progress. */
export function listFiles(outDir) {
  return walk(outDir)
    .map((p) => ({ rel: relative(outDir, p).split(sep).join('/'), size: statSync(p).size }))
    .filter((f) => PRECACHE.test(f.rel) && !SKIP.test(f.rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1))
    .map((f) => ({ url: `/${f.rel}`, size: f.size }));
}

export function buildManifest({ root, outDir, builtAt }) {
  const files = listFiles(outDir);
  const manifest = {
    schema: 1,
    name: 'receipt-photobooth',
    version: readVersion(root),
    build: readBuildId(root),
    builtAt,
    files,
    totalBytes: files.reduce((n, f) => n + f.size, 0)
  };
  const notes = readNotes(root);
  if (notes) manifest.notes = notes;
  return manifest;
}

export function versionManifestPlugin(root = process.cwd(), builtAt = new Date().toISOString()) {
  let outDir = join(root, 'dist');
  return {
    name: 'photobooth-version-manifest',
    apply: 'build',
    configResolved(config) { outDir = join(config.root, config.build.outDir); },
    closeBundle: {
      order: 'post',
      handler() {
        if (!existsSync(outDir)) return;
        writeFileSync(join(outDir, 'version.json'), JSON.stringify(buildManifest({ root, outDir, builtAt })));
      }
    }
  };
}
