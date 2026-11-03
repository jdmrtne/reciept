import type { Plugin } from 'vite';
export function readVersion(root: string): string;
export function readBuildId(root: string, env?: Record<string, string | undefined>): string;
export function readNotes(root: string, env?: Record<string, string | undefined>): string;
export function versionDefines(root: string, builtAt?: string): Record<'__APP_VERSION__' | '__APP_BUILD__' | '__APP_BUILT_AT__' | '__APP_NOTES__', string>;
export function listFiles(outDir: string): { url: string; size: number }[];
export function buildManifest(o: { root: string; outDir: string; builtAt: string }): Record<string, unknown>;
export function versionManifestPlugin(root?: string, builtAt?: string): Plugin;
