// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPlan } from './plan';
import { infoBlock } from './info';
import { buildSnapshot } from '../editor/model';
import { FRAMES, framesForLayout, resolveFramed } from '../frames/registry';
import { LAYOUTS } from '../layouts/registry';
import { makeCtx } from '../frames/prims';
import { qrMatrix } from '../share/qr';

/** The app prints NO details text below any frame (event name, date/time, thank-you, "Printed by Memorys"): infoBlock is off by default. */
describe('no text block under any frame (default)', () => {
  const ctx = makeCtx('PHOTOBOOTH');
  it('the switch is off', () => expect(infoBlock.on).toBe(false));
  it('every frame x layout x paper width has no info command, and the paper ends with the frame (no QR)', () => {
    for (const l of LAYOUTS) for (const f of framesForLayout(l.id)) for (const w of [384, 576]) {
      const plan = buildPlan(buildSnapshot(l.id, [], f.id), ctx, w);
      expect(plan.cmds.some((c) => c.op === 'info'), `${f.id}/${l.id}/${w}`).toBe(false);
      expect(plan.unitsH, `${f.id}/${l.id}`).toBe(resolveFramed(l.id, f.id).height);
    }
  });
  it('with a QR the paper is the frame plus the QR strip only, still no info command', () => {
    const qr = { matrix: qrMatrix('https://example.com/p/abc') };
    for (const f of FRAMES.filter((x) => !x.onlyLayouts)) {
      const plan = buildPlan(buildSnapshot('strip-3', [], f.id), ctx, 384, qr);
      expect(plan.cmds.some((c) => c.op === 'info'), f.id).toBe(false);
      expect(plan.cmds.some((c) => c.op === 'qr'), f.id).toBe(true);
    }
  });
});
