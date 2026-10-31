import { cleanName, NAME_MAX } from './store';
import { createEventLayoutRecord } from './eventRuntime';
import { prepareEventLayoutUpload } from './upload';

/**
 * Event layouts: "ADD LAYOUT" as ONE all-or-nothing step.
 *   1. the picture is checked first (`prepareEventLayoutUpload`: file header, decode, windows found, 1 to LIMITS.maxWindows): a bad picture creates nothing;
 *   2. the layout and its picture are written as ONE record in ONE transaction. There is no second step to fail, so an empty
 *      "NO PICTURES" layout cannot exist and nothing has to be cleaned up.
 * Never throws. Errors are plain sentences for the owner. (The old addEventFrame stays in use by the UI until Phase 5.)
 */
/** The sentence shown when a layout has no usable name (add and rename). */
export const NAME_REQUIRED = `Type a name for the layout, up to ${NAME_MAX} characters.`;

export type AddEventLayoutResult =
  | { ok: true; layoutId: string; name: string; eventId: string; windows: number; warnings: string[] }
  | { ok: false; errors: string[] };

export interface AddEventLayoutDeps {
  prepare: typeof prepareEventLayoutUpload;
  create: typeof createEventLayoutRecord;
}
const REAL: AddEventLayoutDeps = { prepare: prepareEventLayoutUpload, create: createEventLayoutRecord };

export async function addEventLayout(input: { eventId: string; name: string; file: Blob | null | undefined }, deps: AddEventLayoutDeps = REAL): Promise<AddEventLayoutResult> {
  const name = cleanName(input.name);
  if (!name) return { ok: false, errors: [NAME_REQUIRED] };
  if (!input.eventId) return { ok: false, errors: ['Pick an event first.'] };
  if (!input.file) return { ok: false, errors: ['Choose a picture for the layout.'] };
  try {
    const prepared = await deps.prepare(input.file);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    const made = await deps.create({ name, eventId: input.eventId, art: prepared.art });
    if (!made.ok) return { ok: false, errors: [made.message] };
    return { ok: true, layoutId: made.value.id, name: made.value.name, eventId: made.value.eventId, windows: made.value.art.slots.length, warnings: prepared.warnings };
  } catch {
    return { ok: false, errors: ['The layout could not be saved. Please try again.'] };
  }
}
