import { cleanName } from './store';
import { createEventLayoutRecord } from './eventRuntime';
import { CUSTOM_LAYOUT_IDS } from './validate';
import type { EventLayoutDef } from './eventLayouts';
import type { CustomFrameDef, CustomLayoutArt, CustomLayoutId } from './types';

/**
 * EL-6: copy an OLD event special frame (one picture per standard layout) into event layouts (one layout per picture).
 * NON DESTRUCTIVE (design rule 8): the frame and its pictures are never changed or deleted, and the new layouts start HIDDEN, so guests see
 * exactly what they saw before until the owner shows them. Each layout is ONE record in ONE transaction (like addEventLayout). The source
 * picture is remembered (`convertedFrom`), so pressing the button again only copies what is missing. Never throws.
 */
export const convertKey = (frameId: string, layoutId: string): string => `${frameId}:${layoutId}`;

export interface ConvertItem { key: string; layoutId: CustomLayoutId; name: string; art: CustomLayoutArt }
export interface ConvertPlan { items: ConvertItem[]; total: number; done: number }

/** What is left to copy for one frame: its pictures in the usual layout order, minus those already copied. Pure. */
export function planConversion(frame: CustomFrameDef, existing: readonly Pick<EventLayoutDef, 'convertedFrom'>[], layoutName: (layoutId: string) => string): ConvertPlan {
  const copied = new Set(existing.map((d) => d.convertedFrom).filter((k): k is string => !!k));
  const pics = CUSTOM_LAYOUT_IDS.filter((l) => !!frame.layouts[l]);
  const items = pics.filter((l) => !copied.has(convertKey(frame.id, l))).map((l): ConvertItem => ({ key: convertKey(frame.id, l), layoutId: l, name: cleanName(`${frame.name} ${layoutName(l)}`) ?? layoutName(l), art: frame.layouts[l]! }));
  return { items, total: pics.length, done: pics.length - items.length };
}

export interface ConvertResult { created: string[]; skipped: number; failed: string[] }
export interface ConvertDeps { create: typeof createEventLayoutRecord }
const REAL: ConvertDeps = { create: createEventLayoutRecord };

export async function convertEventFrame(frame: CustomFrameDef, eventId: string, existing: readonly Pick<EventLayoutDef, 'convertedFrom'>[], layoutName: (layoutId: string) => string, deps: ConvertDeps = REAL): Promise<ConvertResult> {
  const plan = planConversion(frame, existing, layoutName), out: ConvertResult = { created: [], skipped: plan.done, failed: [] };
  if (!eventId) { out.failed = plan.items.map((i) => i.name); return out; }
  for (const it of plan.items) {
    try {
      const r = await deps.create({ name: it.name, eventId, art: it.art, enabled: false, convertedFrom: it.key });
      if (r.ok) out.created.push(r.value.name); else out.failed.push(it.name);
    } catch { out.failed.push(it.name); }
  }
  return out;
}
