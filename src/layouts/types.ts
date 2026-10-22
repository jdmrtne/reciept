/** All lengths in "reference dots" at 58mm paper (384 dots wide). The engine scales them to any paper width. */
export type Arrangement =
  | { kind: 'grid'; columns: number; rows: number; slotAspect: number } // slotAspect = width / height
  | { kind: 'manual'; heightRatio: number; slots: { x: number; y: number; w: number; h: number }[] }; // manual: 0..1 of canvas width

export interface LayoutDef {
  id: string;
  name: string;
  arrangement: Arrangement;
  padding: number;
  gap: number;
  border: number; // outer border thickness (0 = none)
  headerHeight: number; // reserved band for frame header (Phase 5 fills it)
  footerHeight: number;
  background: '#fff' | '#000';
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface ResolvedLayout {
  id: string;
  width: number;
  height: number;
  slots: Rect[];
  header: Rect | null;
  footer: Rect | null;
  border: number;
  background: string;
}
