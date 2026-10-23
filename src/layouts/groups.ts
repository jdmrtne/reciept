import { LAYOUTS } from './registry';
import { resolveLayout } from './engine';
import type { LayoutDef, LayoutGroupInfo } from './types';

/** A set of layouts shown as one card on CHOOSE YOUR STRIP. */
export interface LayoutGroup extends LayoutGroupInfo { layouts: LayoutDef[] }

/** One card of the picker grid: an ordinary layout, or a group that opens a modal. */
export type LayoutEntry = { kind: 'layout'; layout: LayoutDef } | { kind: 'group'; group: LayoutGroup };

/**
 * Pure: turns a layout list into the picker's cards, keeping the list's order. An ungrouped layout stays itself; layouts sharing a
 * `group.id` collapse into ONE group entry placed where the group's first member was, its layouts in list order (the first member's
 * `group.name` wins if members disagree). Adding another group = give its layouts the same `group: { id, name }`; nothing else to edit.
 */
export function groupedLayouts(layouts: readonly LayoutDef[] = LAYOUTS): LayoutEntry[] {
  const out: LayoutEntry[] = [];
  const groups = new Map<string, LayoutGroup>();
  for (const layout of layouts) {
    const g = layout.group;
    if (!g) { out.push({ kind: 'layout', layout }); continue; }
    const have = groups.get(g.id);
    if (have) { have.layouts.push(layout); continue; }
    const group: LayoutGroup = { id: g.id, name: g.name, layouts: [layout] };
    groups.set(g.id, group);
    out.push({ kind: 'group', group });
  }
  return out;
}

/** How many photos a layout takes (slot count of the resolved layout). */
export const photoCount = (layout: LayoutDef): number => resolveLayout(layout).slots.length;

/** "1 PHOTO" / "4 PHOTOS" */
export const photoCountLabel = (n: number): string => `${n} PHOTO${n === 1 ? '' : 'S'}`;
