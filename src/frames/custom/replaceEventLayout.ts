import { setEventLayoutRecordArt, eventLayoutById } from './eventRuntime';
import { prepareEventLayoutUpload } from './upload';

/**
 * Event layouts: "REPLACE PICTURE" as ONE all-or-nothing step, like addEventLayout. The new picture is checked first (a bad picture
 * changes nothing), then the stored record gets the new picture and windows in one transaction. A saved QR spot belonged to the old
 * picture, so the store drops it; `hadQrSpot` tells the screen to say so. Never throws. Errors are plain sentences for the owner.
 */
export type ReplaceEventLayoutResult =
  | { ok: true; windows: number; hadQrSpot: boolean; warnings: string[] }
  | { ok: false; errors: string[] };

export interface ReplaceEventLayoutDeps {
  prepare: typeof prepareEventLayoutUpload;
  setArt: typeof setEventLayoutRecordArt;
  byId: typeof eventLayoutById;
}
const REAL: ReplaceEventLayoutDeps = { prepare: prepareEventLayoutUpload, setArt: setEventLayoutRecordArt, byId: eventLayoutById };

export async function replaceEventLayoutArt(id: string, file: Blob | null | undefined, deps: ReplaceEventLayoutDeps = REAL): Promise<ReplaceEventLayoutResult> {
  if (!file) return { ok: false, errors: ['Choose a picture for the layout.'] };
  const before = deps.byId(id);
  if (!before) return { ok: false, errors: ['That layout no longer exists.'] };
  try {
    const prepared = await deps.prepare(file);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    const saved = await deps.setArt(id, prepared.art);
    if (!saved.ok) return { ok: false, errors: [saved.message] };
    return { ok: true, windows: saved.value.art.slots.length, hadQrSpot: !!before.art.qr, warnings: prepared.warnings };
  } catch {
    return { ok: false, errors: ['The picture could not be saved. Please try again.'] };
  }
}
