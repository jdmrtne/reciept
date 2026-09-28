import type { Server } from 'node:http';
export function isPrivateHost(h: string): boolean;
export function createBridge(o?: { allowPorts?: number[]; log?: (m: string) => void; powershell?: (script: string, env?: Record<string, string>) => Promise<string> }): Server;
