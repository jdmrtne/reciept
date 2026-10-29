import { cleanName, NAME_MAX } from './store';
import { createCustomFrame, deleteCustomFrame, setCustomLayoutArt } from './runtime';
import { prepareUpload } from './upload';
import type { CustomLayoutId } from './types';

/**
 * Event frame groups: "ADD FRAME" as ONE all-or-nothing step.
 *   1. the picture is checked first (`prepareUpload`): a bad picture creates nothing;
 *   2. the frame is created inside the event (special, with `eventId`);
 *   3. the picture is saved on it. If this fails the new, empty frame is deleted again, so no "NO PICTURES" ghost stays in the group.
 * Never throws. Errors are plain sentences for the owner.
 */
export type AddEventFrameResult =
  | { ok: true; frameId: string; name: string; layoutId: CustomLayoutId; windows: number; warnings: string[] }
  | { ok: false; errors: string[] };

export interface AddEventFrameDeps {
  prepare: typeof prepareUpload;
  create: typeof createCustomFrame;
  setArt: typeof setCustomLayoutArt;
  remove: typeof deleteCustomFrame;
}
const REAL: AddEventFrameDeps = { prepare: prepareUpload, create: createCustomFrame, setArt: setCustomLayoutArt, remove: deleteCustomFrame };

export async function addEventFrame(input: { eventId: string; name: string; layoutId: CustomLayoutId; file: Blob | null | undefined }, deps: AddEventFrameDeps = REAL): Promise<AddEventFrameResult> {
  const name = cleanName(input.name);
  if (!name) return { ok: false, errors: [`Type a name for the frame, up to ${NAME_MAX} characters.`] };
  if (!input.eventId) return { ok: false, errors: ['Pick an event first.'] };
  if (!input.file) return { ok: false, errors: ['Choose a picture for the frame.'] };
  try {
    const prepared = await deps.prepare(input.layoutId, input.file);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    const made = await deps.create(name, true, input.eventId);
    if (!made.ok) return { ok: false, errors: [made.message] };
    const id = made.value.id;
    const saved = await deps.setArt(id, input.layoutId, prepared.art);
    if (!saved.ok) {
      const undone = await deps.remove(id);
      return { ok: false, errors: undone.ok ? [saved.message] : [saved.message, 'The new frame could not be removed again. Open it in the grid and press DELETE FRAME.'] };
    }
    return { ok: true, frameId: id, name: made.value.name, layoutId: input.layoutId, windows: prepared.art.windows.length, warnings: prepared.warnings };
  } catch {
    return { ok: false, errors: ['The frame could not be saved. Please try again.'] };
  }
}
