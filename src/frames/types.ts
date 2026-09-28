export type Rule = 'dashed' | 'solid' | 'double';
/** Text may use tokens: {EVENT} {DATE} {TIME} {YEAR} {SERIAL}. Users never edit frame text. Units: reference dots @58mm. */
export interface TextLine { text: string; size: number; y: number; weight?: 400 | 700; ls?: number; align?: 'left' | 'center' | 'right' } // y = vertical centre, fraction of band
export interface Block { lines: TextLine[]; rule?: Rule; barcode?: { y: number; h: number } }
export type Decor = 'corners' | 'stars' | 'notches' | 'slot-border' | 'slot-border-double';
export interface FrameDef {
  id: string; name: string;
  headerHeight: number; footerHeight: number;
  border: { style: 'none' | 'solid' | 'double' | 'dashed'; width: number; inset: number };
  header: Block; footer: Block; decor?: Decor[];
}
export interface FrameCtx { event: string; date: string; time: string; year: string; serial: string }

/** Renderer-independent drawing list. SVG (editor) and canvas (Phase 8 renderer) both draw these. */
export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; dash?: string }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; sw: number; dash?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { k: 'poly'; pts: [number, number][]; fill?: string }
  | { k: 'text'; x: number; y: number; text: string; size: number; weight: number; anchor: 'start' | 'middle' | 'end'; ls: number };
