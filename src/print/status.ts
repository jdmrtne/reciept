import type { PrinterErrorCode } from './errors';

/**
 * ESC/POS real-time status (DLE EOT n). Hardware-agnostic: any transport that can WRITE these bytes and READ one byte back.
 * Bit meanings follow the Epson ESC/POS spec that most 58/80mm printers copy — VERIFY ON THE REAL PRINTER (clones deviate).
 */
export const STATUS_QUERY = { printer: [0x10, 0x04, 0x01], offline: [0x10, 0x04, 0x02], paper: [0x10, 0x04, 0x04] } as const;

export interface StatusBytes { printer?: number; offline?: number; paper?: number } // undefined = printer did not answer

export interface StatusReading {
  /** Blocking problem, or null if none was reported. */
  error: PrinterErrorCode | null;
  /** Roll is nearly empty (still prints). */
  nearEnd: boolean;
  /** True when the printer answered none of the queries (many cheap ones don't) — never treated as an error. */
  unknown: boolean;
}

export function interpretStatus(s: StatusBytes): StatusReading {
  const unknown = s.printer === undefined && s.offline === undefined && s.paper === undefined;
  let error: PrinterErrorCode | null = null;
  if (s.paper !== undefined && s.paper & 0x60) error = 'paper'; // paper roll end sensor
  else if (s.offline !== undefined && s.offline & 0x24) error = 'paper'; // cover open (0x04) / stopped for paper end (0x20)
  else if (s.offline !== undefined && s.offline & 0x40) error = 'failed'; // an error occurred
  else if (s.printer !== undefined && s.printer & 0x08) error = 'unavailable'; // offline
  return { error, nearEnd: s.paper !== undefined && (s.paper & 0x0c) !== 0, unknown };
}
