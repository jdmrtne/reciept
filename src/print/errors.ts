/** Everything the UI can be told about a failed print. Adapters throw PrinterError; anything else becomes 'failed'. */
export type PrinterErrorCode = 'disconnected' | 'unavailable' | 'failed' | 'unsupported' | 'connection-lost' | 'paper';

export class PrinterError extends Error {
  constructor(public readonly code: PrinterErrorCode, message?: string, public readonly cause?: unknown) {
    super(message ?? code);
    this.name = 'PrinterError';
  }
}

/** Short, plain-language copy for customers. No jargon, no codes. */
export const PRINTER_MESSAGES: Record<PrinterErrorCode, { title: string; hint: string }> = {
  disconnected: { title: 'PRINTER NOT CONNECTED', hint: 'Check that the printer is on, then try again.' },
  unavailable: { title: 'PRINTER NOT AVAILABLE', hint: 'The printer could not be reached. Try again in a moment.' },
  failed: { title: 'PRINT DIDN\u2019T WORK', hint: 'Something went wrong while printing. Try again.' },
  unsupported: { title: 'PRINTING NOT SUPPORTED', hint: 'This device can\u2019t print here. Please ask the host for help.' },
  'connection-lost': { title: 'CONNECTION LOST', hint: 'The printer disconnected while printing. Try again.' },
  paper: { title: 'CHECK THE PAPER', hint: 'The printer is out of paper or its cover is open.' }
};

export const toPrinterError = (e: unknown): PrinterError =>
  e instanceof PrinterError ? e : new PrinterError('failed', e instanceof Error ? e.message : String(e), e);
