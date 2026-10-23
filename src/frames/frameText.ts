import { EVENT_LIMITS, cleanText, finalText } from '../config/events';
import { FRAMES } from './registry';
import type { Block, FrameCtx, FrameDef } from './types';

/**
 * Owner-editable text inside the built-in vector frames (ADMIN > Frame text). Pure, DOM-free.
 * Stored as `BoothSettings.frameText`: frameId -> lineKey -> text, differences only. lineKey = `header.<i>` / `footer.<i>` (index into the
 * frame's own header/footer lines). Absent = built-in text. '' = the line is hidden (its band height stays reserved).
 */
export const EDITABLE_TEXT_FRAMES = ['classic-receipt', 'minimal-receipt', 'retro-receipt', 'ticket-stub', 'birthday', 'graduation', 'friends', 'couple', 'event'] as const;
export type FrameTextOverrides = Record<string, Record<string, string>>;
/** Tokens the frame text understands. Anything else in braces is removed when drawn. */
export const FRAME_TOKENS = ['EVENT', 'DATE', 'TIME', 'YEAR', 'SERIAL', 'THANKS'] as const;

const editable = (id: string) => (EDITABLE_TEXT_FRAMES as readonly string[]).includes(id);
export const editableFrameDefs = (): FrameDef[] => EDITABLE_TEXT_FRAMES.map((id) => FRAMES.find((f) => f.id === id)!).filter(Boolean);
const frameDef = (id: string) => (editable(id) ? FRAMES.find((f) => f.id === id) : undefined);

export type LinePart = 'header' | 'footer';
export const lineKey = (part: LinePart, i: number) => `${part}.${i}`;
/** Every valid line key of an editable frame, header lines first. */
export function frameTextKeys(frameId: string): string[] {
  const f = frameDef(frameId);
  return f ? [...f.header.lines.map((_, i) => lineKey('header', i)), ...f.footer.lines.map((_, i) => lineKey('footer', i))] : [];
}
/** The built-in text of one line (tokens unfilled), or undefined for an unknown frame/key. */
export function defaultLineText(frameId: string, key: string): string | undefined {
  const f = frameDef(frameId), m = /^(header|footer)\.(\d+)$/.exec(key);
  return f && m ? f[m[1] as LinePart].lines[Number(m[2])]?.text : undefined;
}
/** Owner-facing name of a line: position and role ("FOOTER LINE 2 (RIGHT)"). */
export function lineLabel(frameId: string, key: string): string {
  const f = frameDef(frameId), m = /^(header|footer)\.(\d+)$/.exec(key);
  const l = f && m ? f[m[1] as LinePart].lines[Number(m[2])] : undefined;
  if (!m || !l) return key.toUpperCase();
  return `${m[1].toUpperCase()} LINE ${Number(m[2]) + 1}${l.align === 'left' ? ' (LEFT)' : l.align === 'right' ? ' (RIGHT)' : ''}`;
}

/** Most lines that can ever be stored: the safety cap behind the key whitelist (hand-edited storage cannot grow it). */
export const FRAME_TEXT_MAX_LINES = 48;

/**
 * STORED-level repair (runs on every ADMIN keystroke, so like `cleanText` it does NOT trim): non-object -> {}; unknown frames, keys and
 * non-strings dropped; text sanitised and capped at `EVENT_LIMITS.lineMax`; values equal to the built-in text dropped; '' kept (hidden).
 * Deterministic order, so it is idempotent.
 */
export function normalizeFrameText(raw: unknown): FrameTextOverrides {
  const out: FrameTextOverrides = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  let n = 0;
  for (const id of EDITABLE_TEXT_FRAMES) {
    const lines = src[id];
    if (!lines || typeof lines !== 'object' || Array.isArray(lines)) continue;
    for (const key of frameTextKeys(id)) {
      const v = (lines as Record<string, unknown>)[key];
      if (typeof v !== 'string' || n >= FRAME_TEXT_MAX_LINES) continue;
      const text = cleanText(v, EVENT_LIMITS.lineMax);
      if (text === defaultLineText(id, key)) continue;
      (out[id] ??= {})[key] = text;
      n++;
    }
  }
  return out;
}

/** FINAL level (what a customer's stamp captures): every stored line trimmed. A blank line stays '' (hidden). */
export function finalFrameText(stored: unknown): FrameTextOverrides {
  const out: FrameTextOverrides = {};
  for (const [id, lines] of Object.entries(normalizeFrameText(stored)))
    out[id] = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, finalText(v)]));
  return out;
}

/** The override for one line of a frame in this stamp, or undefined (= built-in text). */
export function lineOverride(ctx: FrameCtx, frameId: string, part: LinePart, i: number): string | undefined {
  return editable(frameId) ? ctx.frameText?.[frameId]?.[lineKey(part, i)] : undefined;
}
export type { Block };
