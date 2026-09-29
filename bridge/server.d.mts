import type { Server } from 'node:http';
export function isPrivateHost(h: string): boolean;
export function corsOrigin(allowOrigins: string[] | undefined, requestOrigin: string | undefined): string | null;
export function createBridge(o?: { allowPorts?: number[]; allowOrigins?: string[]; log?: (m: string) => void; powershell?: (script: string, env?: Record<string, string>) => Promise<string> }): Server;
