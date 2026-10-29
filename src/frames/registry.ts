import type { Bands, FrameDef, TextLine } from './types';
import { resolveLayout } from '../layouts/engine';
import { getLayout } from '../layouts/registry';
import { customAsset, customFrameById, customFrameDefs, customHasLayout, isCustomFrameId } from './custom/runtime';

const T = (text: string, size: number, y: number, o: Partial<TextLine> = {}): TextLine => ({ text, size, y, weight: 400, ls: 2, align: 'center', ...o });
const B = (text: string, size: number, y: number, o: Partial<TextLine> = {}) => T(text, size, y, { weight: 700, ...o });
const L = { align: 'left' as const }, R = { align: 'right' as const };
const none = { style: 'none' as const, width: 0, inset: 0 };
const line = (w: number) => ({ style: 'solid' as const, width: w, inset: 6 });
const dbl = (w: number) => ({ style: 'double' as const, width: w, inset: 6 });

/**
 * `prints` = what the frame's own text already shows for the active event (EP-2 duplicate prevention; see FramePrints). Frames without the
 * field print none of it. Keep it in step with the {EVENT}/{DATE}/{TIME}/{THANKS} tokens used in header/footer (frames/prints.test.ts enforces it).
 * Add a frame = add an entry (pure data, all monochrome line art: black ink on white paper, hand-drawn ornaments in frames/art.ts). Vector-defined; bitmap art can later go in src/assets/frames. */
export const FRAMES: FrameDef[] = [
  { id: 'classic-receipt', name: 'Classic Receipt', prints: { event: true, date: true, time: true, thankYou: true }, headerHeight: 64, footerHeight: 92, border: none,
    header: { lines: [B('{EVENT}', 26, .42, { ls: 6 }), T('SELF-SERVICE PHOTO STATION', 9, .85)], rule: 'dashed' },
    footer: { lines: [T('DATE', 10, .14, L), T('{DATE}', 10, .14, R), T('TIME', 10, .3, L), T('{TIME}', 10, .3, R), B('{THANKS}', 16, .52, { ls: 5 })], rule: 'dashed', barcode: { y: .7, h: .28 } } },
  { id: 'minimal-receipt', name: 'Minimal Receipt', prints: { event: true, date: true, time: true }, headerHeight: 36, footerHeight: 44, border: none,
    header: { lines: [T('{EVENT}', 11, .5, { ls: 6 })], rule: 'solid' },
    footer: { lines: [T('{DATE}  {TIME}', 10, .5, { ls: 3 })], rule: 'solid' } },
  { id: 'retro-receipt', name: 'Retro Receipt', prints: { date: true }, headerHeight: 76, footerHeight: 84, border: dbl(2), decor: ['corners'], ornaments: [{ at: 'header', y: .4, size: 22, left: 'sparkle', right: 'sparkle' }],
    header: { lines: [B('RETRO BOOTH', 24, .4, { ls: 4 }), T('EST. {YEAR}', 10, .8, { ls: 5 })], rule: 'double' },
    footer: { lines: [B('COME AGAIN SOON', 13, .28), T('{DATE}', 10, .55, { ls: 3 })], rule: 'double', barcode: { y: .68, h: .28 } } },
  { id: 'ticket-stub', name: 'Ticket / Stub', prints: { event: true, date: true, time: true }, headerHeight: 70, footerHeight: 88, border: line(2), decor: ['notches'], ornaments: [{ at: 'header', y: .42, size: 26, left: 'star', right: 'star' }],
    header: { lines: [B('ADMIT ONE', 28, .42, { ls: 5 }), T('{EVENT} PHOTO PASS', 10, .85)], rule: 'dashed' },
    footer: { lines: [T('NO. {SERIAL}', 12, .18, { ls: 3 }), T('{DATE}  {TIME}', 10, .38, { ls: 3 })], rule: 'dashed', barcode: { y: .54, h: .4 } } },
  { id: 'wanted-bounty', name: 'Wanted / Bounty', headerHeight: 124, footerHeight: 96, border: dbl(3), decor: ['torn', 'nails', 'stars', 'slot-border-double'], ornaments: [{ at: 'footer', y: .56, size: 30, left: 'bones', right: 'bones' }],
    header: { lines: [B('WANTED', 68, .4, { ls: 2 }), T('FOR MISCHIEF ON THE HIGH SEAS', 9, .73, { ls: 1 })], rule: 'double' },
    footer: { lines: [B('BOUNTY', 16, .2, { ls: 8 }), B('1,000,000', 34, .56, { ls: 2 }), T('REWARD PAID IN FULL', 8, .9)], rule: 'double' } },
  // Full-colour poster frame: geometry comes from frames/wanted.ts, so it works with every layout. Header/footer heights only reserve the bands.
  { id: 'straw-hat-wanted', name: 'STRAW HAT WANTED', headerHeight: 92, footerHeight: 150, border: none, decor: ['wanted-poster'],
    header: { lines: [] }, footer: { lines: [] } },
  { id: 'birthday', name: 'Birthday', prints: { date: true }, headerHeight: 80, footerHeight: 70, border: none, decor: ['stars'], ornaments: [{ at: 'header', y: .4, size: 34, left: 'balloon', right: 'party-hat' }],
    header: { lines: [B('HAPPY', 13, .18, { ls: 8 }), B('BIRTHDAY', 30, .55, { ls: 3 })], rule: 'dashed' },
    footer: { lines: [T('MAKE A WISH', 12, .3, { ls: 4 }), T('{DATE}', 10, .68, { ls: 3 })], rule: 'dashed' } },
  { id: 'graduation', name: 'Graduation', prints: { date: true }, headerHeight: 76, footerHeight: 76, border: line(2), ornaments: [{ at: 'header', y: .5, size: 34, left: 'cap', right: 'star' }],
    header: { lines: [T('CLASS OF', 12, .25, { ls: 8 }), B('{YEAR}', 34, .68, { ls: 4 })], rule: 'solid' },
    footer: { lines: [B('CONGRATULATIONS', 14, .3), T('{DATE}', 10, .7, { ls: 3 })], rule: 'solid' } },
  { id: 'friends', name: 'Friends', prints: { date: true }, headerHeight: 80, footerHeight: 72, border: none, decor: ['stars'], ornaments: [{ at: 'header', y: .36, size: 26, left: 'smile', right: 'heart' }],
    header: { lines: [B('BEST FRIENDS', 24, .36, { ls: 3 }), T('SINCE FOREVER', 10, .66, { ls: 4 })], rule: 'dashed' },
    footer: { lines: [B('FOREVER', 16, .3, { ls: 8 }), T('{DATE}', 10, .68, { ls: 3 })], rule: 'dashed' } },
  { id: 'couple', name: 'Couple', prints: { date: true }, headerHeight: 76, footerHeight: 76, border: line(2), ornaments: [{ at: 'header', y: .45, size: 32, left: 'heart', right: 'heart' }, { at: 'footer', y: .3, size: 18, left: 'sparkle', right: 'sparkle' }],
    header: { lines: [B('YOU + ME', 32, .45, { ls: 5 }), T('A LOVE STORY', 9, .85, { ls: 6 })], rule: 'dashed' },
    footer: { lines: [T('FOREVER & ALWAYS', 12, .3, { ls: 3 }), T('{DATE}', 10, .68, { ls: 3 })], rule: 'dashed' } },
  { id: 'event', name: 'Event', prints: { event: true, date: true, time: true }, headerHeight: 76, footerHeight: 88, border: line(2), decor: ['slot-border'],
    header: { lines: [B('{EVENT}', 28, .42, { ls: 5 }), T('OFFICIAL PHOTO PASS', 10, .8, { ls: 3 })], rule: 'dashed' },
    footer: { lines: [T('{DATE}  {TIME}', 10, .16, { ls: 3 }), T('NO. {SERIAL}', 10, .88, { ls: 3 })], rule: 'dashed', barcode: { y: .32, h: .38 } } }
];

/**
 * Image (PNG overlay) frames. Add one = drop PNGs in src/assets/frames/<dir>/ (named by layout id, see frames/assets.ts) + one entry here.
 * `bands` only reserves caption/header room; the layout engine still decides every photo slot. headerHeight/footerHeight are the
 * defaults for all layouts, `image.bands[layoutId]` overrides one layout. Tune these to the artwork you export.
 */
const imageFrame = (id: string, name: string, dir: string, bands: Bands, per?: Partial<Record<string, Bands>>): FrameDef =>
  ({ id, name, type: 'image', image: { dir, bands: per, padding: bands.padding }, headerHeight: bands.headerHeight, footerHeight: bands.footerHeight, border: none, header: { lines: [] }, footer: { lines: [] } });

// Bands/padding are sized to the designs in design-src/ (border width, header + caption room). Rebuild artwork with `npm run build-frames`.
export const IMAGE_FRAMES: FrameDef[] = [
  imageFrame('kawaii', 'Kawaii Cats', 'kawaii', { headerHeight: 20, footerHeight: 20, padding: 44 }),
  imageFrame('retro-film', 'Retro Film', 'retro', { headerHeight: 20, footerHeight: 30, padding: 50 }),
  imageFrame('better-together', 'Better Together', 'better-together', { headerHeight: 44, footerHeight: 56 }),
  imageFrame('kawaii-pets', 'Kawaii Pets', 'kawaii-pets', { padding: 45, headerHeight: 0, footerHeight: 9 }),
  imageFrame('just-us', 'Just Us', 'just-us', { padding: 28, headerHeight: 44, footerHeight: 44 }),
  imageFrame('retro-memories', 'Retro Memories', 'retro-memories', { padding: 29, headerHeight: 7, footerHeight: 51 }),
  imageFrame('halloween', 'Halloween', 'halloween', { padding: 48, headerHeight: 0, footerHeight: 18 }),
  imageFrame('pink-you-me', 'You & Me', 'pink-you-me', { padding: 50, headerHeight: 0, footerHeight: 15 }),
  imageFrame('stay-real', 'Stay Real', 'stay-real', { padding: 56, headerHeight: 0, footerHeight: 19 }),
  imageFrame('summer-vibes', 'Summer Vibes', 'summer-vibes', { padding: 57, headerHeight: 0, footerHeight: 29 }),
  imageFrame('neon-gaming', 'Neon Gaming', 'neon-gaming', { padding: 54, headerHeight: 0, footerHeight: 18 }),
  // Procedural vintage-manga page (scripts/frames-manga.mjs): irregular inked panel windows cut inside each slot, cream paper, screentone, speed lines.
  imageFrame('manga-panel', 'Manga Panel', 'manga', { padding: 14, headerHeight: 0, footerHeight: 0 }),
  // Colourful sticker collage (scripts/frames-pop.mjs): original stickers cut out of design-src/pop-stickers/, moved/scaled/repeated per layout, never stretched.
  imageFrame('pop-stickers', 'Pop Stickers', 'pop-stickers', { padding: 56, headerHeight: 36, footerHeight: 18 }),
  // Authentic inked manga page (scripts/frames-slice.mjs drawPlanned from design-src/manga-comic.png). Separate from 'manga-panel'.
  imageFrame('manga-comic', 'Manga Comic', 'manga-comic', { padding: 44, headerHeight: 8, footerHeight: 54 })
];
FRAMES.push(...IMAGE_FRAMES);

/** Every frame except the frame-locked ones: the universe the generic frame x layout suites cover. */
export const STANDARD_FRAMES: FrameDef[] = FRAMES.filter((f) => !f.onlyLayouts);

export const DEFAULT_FRAME = 'classic-receipt';
/** Built-in frames first, then owner-uploaded custom frames (frames/custom/runtime.ts, empty unless some are stored); unknown ids fall back to the default. */
export const getFrame = (id: string | null): FrameDef => FRAMES.find((f) => f.id === id) ?? customFrameById(id) ?? FRAMES[0];
export const isImageFrame = (f: FrameDef) => f.type === 'image' && !!f.image;

/** A layout that belongs to a frame-locked family is only valid with that frame; every other pair is unchanged. */
const lockOf = (layoutId: string) => FRAMES.find((f) => f.onlyLayouts?.includes(layoutId));
export const isFrameAllowed = (frameId: string | null, layoutId: string): boolean => {
  const lock = lockOf(layoutId), f = getFrame(frameId);
  if (isCustomFrameId(frameId) && !customFrameById(frameId)) return false; // a deleted custom frame is never allowed, so frameForLayout falls back to the default
  if (isCustomFrameId(f.id)) return !lock && customHasLayout(f.id, layoutId); // a custom frame is offered only on the layouts it has art for
  return lock ? lock.id === f.id : !f.onlyLayouts;
};
export const framesForLayout = (layoutId: string): FrameDef[] => [...FRAMES, ...customFrameDefs()].filter((f) => isFrameAllowed(f.id, layoutId));
/** The frame to use when a layout is chosen: the current one if it is allowed there, else the layout's own frame, else the default. */
export const frameForLayout = (layoutId: string, current: string | null): string =>
  current && isFrameAllowed(current, layoutId) ? current : lockOf(layoutId)?.id ?? DEFAULT_FRAME;

/** Header/footer band heights for this frame on this layout (image frames may override per layout). */
export const getFrameBands = (f: FrameDef, layoutId: string): Bands => f.image?.bands?.[layoutId] ?? { headerHeight: f.headerHeight, footerHeight: f.footerHeight, ...(f.image?.padding !== undefined ? { padding: f.image.padding } : {}) };

const PLAIN: FrameDef = { id: '_plain', name: 'Plain', headerHeight: 0, footerHeight: 0, border: { style: 'solid', width: 2, inset: 6 }, header: { lines: [] }, footer: { lines: [] } };
/** The vector definition to DRAW for a frame: itself, or (image frame without artwork) its fallback / a thin plain border. */
export const vectorFrameOf = (f: FrameDef): FrameDef => (isImageFrame(f) ? FRAMES.find((v) => v.id === f.image!.fallback && !isImageFrame(v)) ?? PLAIN : f);

/** Layout geometry with the frame's header/footer bands applied. Use this everywhere (editor, renderer). */
export function resolveFramed(layoutId: string, frameId: string | null, width = 384) {
  const f = getFrame(frameId), custom = isCustomFrameId(f.id) ? customAsset(f.id, layoutId) : null;
  // A custom frame's art dictates its own photo slots (detected transparent windows), exactly like the NCL pass layouts: a manual arrangement
  // (fractions of the art width, heightRatio = art height / width). The art IS the whole design, so no padding, border or bands.
  if (custom) return resolveLayout({ ...getLayout(layoutId), arrangement: { kind: 'manual', heightRatio: custom.meta.heightRatio, slots: custom.meta.slots }, padding: 0, border: 0, headerHeight: 0, footerHeight: 0 }, width, { headerHeight: 0, footerHeight: 0, padding: 0 });
  return resolveLayout(getLayout(layoutId), width, getFrameBands(f, layoutId));
}
