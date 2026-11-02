import { customRecords, deleteCustomFrame, initCustomFrames } from './runtime';
import { deleteEventLayoutRecord, eventLayoutRecords, initEventLayouts } from './eventRuntime';
import { framesOfEvent } from './groups';
import { layoutsOfEvent } from './eventLayouts';

/**
 * Deleting an event takes ITS frames and ITS layouts with it (and only those). Frames first, then layouts. It stops at the first one
 * that refuses to go and says which kind, so the caller can keep the event: whatever is left is still that event's own.
 */
export type DeleteEventContentsResult = { ok: true; frames: number; layouts: number } | { ok: false; failed: 'frame' | 'layout' };

export interface DeleteEventContentsDeps {
  init(): Promise<unknown>;
  frames(): ReturnType<typeof customRecords>;
  layouts(): ReturnType<typeof eventLayoutRecords>;
  deleteFrame(id: string): Promise<{ ok: boolean }>;
  deleteLayout(id: string): Promise<{ ok: boolean }>;
}
const REAL: DeleteEventContentsDeps = {
  init: () => Promise.all([initCustomFrames(), initEventLayouts()]),
  frames: customRecords, layouts: eventLayoutRecords, deleteFrame: deleteCustomFrame, deleteLayout: deleteEventLayoutRecord
};

export async function deleteEventContents(eventId: string, deps: DeleteEventContentsDeps = REAL): Promise<DeleteEventContentsResult> {
  await deps.init(); // no-op once loaded; makes sure both lists are complete before they are used
  let frames = 0, layouts = 0;
  for (const f of framesOfEvent(deps.frames(), eventId)) {
    if (!(await deps.deleteFrame(f.id)).ok) return { ok: false, failed: 'frame' };
    frames++;
  }
  for (const l of layoutsOfEvent(deps.layouts(), eventId)) {
    if (!(await deps.deleteLayout(l.id)).ok) return { ok: false, failed: 'layout' };
    layouts++;
  }
  return { ok: true, frames, layouts };
}
