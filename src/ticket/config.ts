import type { FrameCtx } from '../frames/types';
import { DEFAULT_EVENT_NAME, DEFAULT_THANK_YOU } from '../config/events';

/**
 * LANDSCAPE EVENT TICKETS: the ONE place the ticket's shape and default wording are configured.
 *
 * Shape: the canvas is always UNITS_W (384) units wide like every other layout, so the print is exactly the printable paper width
 * (384 dots @58mm, 576 dots @80mm) and `width > height` holds on every paper. The height follows from TICKET_ASPECT (width / height).
 * Change TICKET_ASPECT here and every template, preview, QR safe area and print follows (tests check 1.3 to 1.7; the stub needs about 290 units of height to keep every line, below that it drops the plane and verse first).
 * The image is NEVER rotated: ESC/POS prints it as is, and the system-dialog adapter prints it at `<paper mm> auto` (print/adapters/system.ts).
 */
export const TICKET_FRAME_ID = 'boarding-pass';
export const TICKET_UNITS_W = 384;
export const TICKET_ASPECT = 1.3;
export const TICKET_UNITS_H = Math.round(TICKET_UNITS_W / TICKET_ASPECT);
/** Share of the width taken by the detachable stub (the right-hand end of every ticket). */
export const TICKET_STUB_FRAC = 0.23;
/** Smallest text (reference dots @58mm): the project's thermal legibility floor (docs/PRINTING.md). */
export const TICKET_MIN_TEXT = 9;
/** One barcode module in units: 4/3 units = exactly 2 dots on 80mm paper (576 dots), so the bars stay crisp. */
export const BARCODE_MODULE = 4 / 3;

export interface TicketInfo {
  code: string; title: string; date: string; venue: string; verse: string; secondary: string;
  brand: string; tagline: string; label: string;
  /** Value encoded in the Code 128 barcode (the event identifier). Digits-only, even length = compact set C. */
  barcode: string;
}

/** Defaults requested for the J146 NCL event. Edit here, or override through the owner's event profile (see resolveTicketInfo). */
export const TICKET_DEFAULTS: Readonly<TicketInfo> = Object.freeze({
  code: 'J146 NCL', title: '20th Anniversary', date: 'OCT 24, 2026', venue: 'DURIAN ST CALOOCAN', verse: 'EPHESIANS 4:11-13', secondary: 'BUILD UP',
  brand: 'MEMORYS', tagline: 'YOUR MOMENTS, OFFICIALLY RECEIPTED.', label: 'EVENT BOARDING PASS', barcode: '146020'
});

/**
 * Ticket wording = TICKET_DEFAULTS, overridden by the owner's existing event profile (config/events.ts, ADMIN) where the owner set something:
 *   code      <- profile name   (ignored while it is still the untouched default "PHOTOBOOTH")
 *   title     <- profile header
 *   date / venue / verse <- detail lines 1 / 2 / 3
 *   secondary <- thank-you      (ignored while it is still the untouched default "THANK YOU")
 * No new settings screen and no new stored field. Without `ctx.info` (picker thumbnails) the defaults are used.
 */
export function resolveTicketInfo(ctx: FrameCtx): TicketInfo {
  const d = TICKET_DEFAULTS, p = ctx.info;
  const name = (ctx.event || '').trim();
  const pick = (v: unknown, dflt: string) => (typeof v === 'string' && v.trim() ? v.trim() : dflt);
  const details = Array.isArray(p?.details) ? p!.details : [];
  const thanks = (p?.thankYou ?? '').trim();
  return {
    ...d,
    code: name && name !== DEFAULT_EVENT_NAME ? name : d.code,
    title: pick(p?.header, d.title),
    date: pick(details[0], d.date), venue: pick(details[1], d.venue), verse: pick(details[2], d.verse),
    secondary: thanks && thanks !== DEFAULT_THANK_YOU ? thanks : d.secondary
  };
}
