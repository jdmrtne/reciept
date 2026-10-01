export type Rule = 'dashed' | 'solid' | 'double';
/** Text may use tokens: {EVENT} {DATE} {TIME} {YEAR} {SERIAL}. Users never edit frame text. Units: reference dots @58mm. */
export interface TextLine { text: string; size: number; y: number; weight?: 400 | 700; ls?: number; align?: 'left' | 'center' | 'right' } // y = vertical centre, fraction of band
export interface Block { lines: TextLine[]; rule?: Rule; barcode?: { y: number; h: number } }
export type Decor = 'corners' | 'stars' | 'notches' | 'slot-border' | 'slot-border-double' | 'torn' | 'nails' | 'sketch-border' | 'wanted-poster';
/** Hand-drawn ornaments (see frames/art.ts). Drawn as line art inside the header/footer band, left and right of the text. */
export type Orn = 'star' | 'heart' | 'balloon' | 'party-hat' | 'cap' | 'smile' | 'bones' | 'sparkle' | 'anchor';
export interface Ornaments { at: 'header' | 'footer'; y: number; size: number; left?: Orn; right?: Orn } // y = fraction of band
/** Bands (reference dots @58mm) a frame reserves above/below the photo slots. */
export interface Bands { headerHeight: number; footerHeight: number; padding?: number } // padding = outer margin override (the artwork's border width)
/**
 * Bitmap-art frame (PNG overlay with TRANSPARENT photo windows). Assets are discovered by convention:
 * src/assets/frames/<dir>/<layoutId>.png (single, strip-2, strip-3, strip-4, grid-2x2, classic) and an optional <dir>/default.png.
 * The layout engine still owns the slot geometry; `bands` only reserves room for the artwork's caption/header areas.
 */
export interface ImageFrameDef {
  dir: string;
  /** Outer margin (reference dots) for every layout: the artwork's border width. Default: the layout's own padding. */
  padding?: number;
  /** Per-layout band overrides; layouts not listed use the frame's headerHeight/footerHeight. */
  bands?: Partial<Record<string, Bands>>;
  /** Vector frame id drawn when no artwork exists for this layout (default: a plain thin border). */
  fallback?: string;
}
export interface FrameDef {
  id: string; name: string;
  type?: 'vector' | 'image'; // default 'vector'
  image?: ImageFrameDef;      // present when type === 'image'
  headerHeight: number; footerHeight: number;
  border: { style: 'none' | 'solid' | 'double' | 'dashed'; width: number; inset: number };
  header: Block; footer: Block; decor?: Decor[]; ornaments?: Ornaments[];
}
export interface FrameCtx { event: string; date: string; time: string; year: string; serial: string }

/** Renderer-independent drawing list. SVG (editor) and canvas (Phase 8 renderer) both draw these. */
export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; dash?: string }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; sw: number; dash?: string; c?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { k: 'poly'; pts: [number, number][]; fill?: string }
  | { k: 'path'; cmds: PathCmd[]; stroke?: string; fill?: string; sw?: number; eo?: boolean } // stroke 'none' = fill only; eo = even-odd fill (holes)
  | { k: 'text'; x: number; y: number; text: string; size: number; weight: number; anchor: 'start' | 'middle' | 'end'; ls: number;
    c?: string; font?: 'display'; fit?: number }; // c = ink colour (default black); fit = squeeze/stretch the glyphs to exactly this width (anchor 'start', ls 0)

/** Absolute path commands only (M L Q C Z): drawn identically by SVG (pathD) and canvas (drawPrims), no Path2D needed. */
export type PathCmd = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number] | ['C', number, number, number, number, number, number] | ['Z'];
export const pathD = (c: PathCmd[]) => c.map((q) => q.map((v, i) => (i === 0 ? v : Math.round((v as number) * 100) / 100)).join(' ')).join(' ');
