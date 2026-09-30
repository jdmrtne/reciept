import type { Server } from 'node:http';
import type { ShareStore } from './server.mjs';
export const ID_RE: RegExp;
export const FILE_TYPES: Record<string, string>;
export const MAX_FILE_BYTES: number;
export const DEFAULT_TTL_MS: number;
export function looksLike(name: string, buf: Buffer): boolean;
export function createShareStore(o: { dir: string; ttlMs?: number; now?: () => number }): ShareStore;
export function createShareServer(store: ShareStore): Server;
