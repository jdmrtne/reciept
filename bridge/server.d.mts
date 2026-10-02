import type { Server } from 'node:http';
export function isPrivateHost(h: string): boolean;
export function corsOrigin(allowOrigins: string[] | undefined, requestOrigin: string | undefined): string | null;
export function createBridge(o?: { allowPorts?: number[]; allowOrigins?: string[]; log?: (m: string) => void; powershell?: (script: string, env?: Record<string, string>) => Promise<string>; shareStore?: ShareStore | null }): Server;
export interface ShareStore { root: string; ttlMs: number; valid(id: unknown, name: unknown): boolean; put(id: string, name: string, buf: Buffer): Promise<void>; get(id: string, name: string): Promise<{ buf: Buffer; type: string; expiresAt: number } | null>; sweep(): Promise<number>; has(id: string, name: string): Promise<boolean> }
