#!/usr/bin/env python3
"""Phase 5 spec numbers: stub vertical budget per ticket, QR target, 3:4 geometry, printed lengths. Read-only."""
import importlib.util, json, os, sys
import numpy as np
here = os.path.dirname(os.path.abspath(__file__)); spec = importlib.util.spec_from_file_location('m', os.path.join(here, 'ncl-measure.py')); m = importlib.util.module_from_spec(spec); sys.argv = ['x']; spec.loader.exec_module(m)
UNIT = 812 / 384                      # ref px per layout unit (ticket height 812 px = 384 units)
lay = json.load(open(os.path.join(m.REF_DIR, 'layout-data.json')))
TARGETS = {'S96 (37 modules, 2 dpm, 58mm: exactly the real URL)': 96, 'S104 (41 modules: URL up to ~106 chars)': 104, 'S141 (37 modules at 3 dpm)': 141}
MIN_MARGIN = 40
print('ref px per unit', round(UNIT, 4), '| QR safe side needed = minSide + 2*3 units')
for n in (1, 2, 3, 4):
    g = m.load_ref(n); H, W = g.shape; dark = g < 128; boxes = m.find_boxes(dark)
    col = dark[:, int(W * .6):].sum(0).copy()
    for (bx, by, bw, bh) in boxes: col[max(0, bx - 8 - int(W * .6)):max(0, bx + bw + 8 - int(W * .6))] = 0
    lx = int(W * .6) + int(np.argmax(col)); x0, x1 = lx + 8, W - 6
    sub = dark[:, x0:x1]; rr = m.runs(sub.any(1), 3); qx0, qy0, qx1, qy1 = lay[f'pass-{n}']['refQr']
    items = []
    for a, b in rr:
        cols = np.where(sub[a:b + 1].any(0))[0]; items.append(dict(y0=a, y1=b, h=b - a + 1, x0=int(cols.min() + x0), x1=int(cols.max() + x0), qr=(a <= qy0 <= b)))
    qi = [i for i, it in enumerate(items) if it['qr']][0]
    top, bot = items[0]['y0'], H - 1 - items[-1]['y1']
    above, below = items[qi - 1], items[qi + 1]
    free_now = below['y0'] - above['y1'] - 1; safe_now = free_now - 5          # script: sa = (top+3, bot-2)
    content = sum(it['h'] for i, it in enumerate(items) if i != qi); gaps = [items[i + 1]['y0'] - items[i]['y1'] - 1 for i in range(len(items) - 1) if i != qi - 1 and i != qi]
    print(f'\n=== ref-{n}: stub line x={lx}, stub items x range {min(i["x0"] for i in items)}..{max(i["x1"] for i in items)} (width {max(i["x1"] for i in items) - min(i["x0"] for i in items) + 1})')
    for i, it in enumerate(items): print(f'  {i:2d} y {it["y0"]:3d}..{it["y1"]:3d} h {it["h"]:3d} x {it["x0"]}..{it["x1"]}{"  <-- reference QR picture" if it["qr"] else ""}')
    print(f'  margins top {top} bottom {bot}; gaps between items (excl. the two QR gaps): {gaps}  (min {min(gaps)}, mean {np.mean(gaps):.1f})')
    print(f'  QR free gap now {free_now} px; safe side now {safe_now} px = {safe_now / UNIT:.1f} units; content (no QR) {content} px')
    for lab, S in TARGETS.items():
        F = round(S * UNIT) + 5; need = F - free_now; avail_m = max(0, top - MIN_MARGIN) + max(0, bot - MIN_MARGIN)
        left = need - avail_m; ng = len(gaps)
        verdict = 'margins alone suffice' if left <= 0 else f'margins give {avail_m}, still {left} px: take {left / ng:.1f} px from each of {ng} gaps (mean gap {np.mean(gaps):.1f} -> {np.mean(gaps) - left / ng:.1f})'
        print(f'  {lab}: need free gap {F} px (+{need}); {verdict}')
print('\n=== 3:4 geometry (ticket height 812 stays) ===')
BOX_W_OUT, BOX_H_OUT, STROKE, INSET = 380, 504, 4, 4   # outer outline px; window = outer - 2*4 -> 372 x 496 = exactly 3:4
win_w, win_h = BOX_W_OUT - 2 * INSET, BOX_H_OUT - 2 * INSET
print(f'outer {BOX_W_OUT}x{BOX_H_OUT} ({BOX_W_OUT / BOX_H_OUT:.4f}), window {win_w}x{win_h} ({win_w / win_h:.4f}), slot (window +2.5 px/side under the stroke) {win_w + 5}x{win_h + 5} ({(win_w + 5) / (win_h + 5):.4f}); y 130..634')
dot_mm = 25.4 / 203
for n in (1, 2, 3):
    g = m.load_ref(n); H, W = g.shape; boxes = m.find_boxes(g < 128); old = sum(b[2] for b in boxes); new = W + n * BOX_W_OUT - old
    L = lambda dots: new / 812 * dots
    print(f'pass-{n}: {n} box(es), old box widths {[b[2] for b in boxes]}, ticket {W} -> {new} px (+{new - W}), aspect {new / 812:.3f} (was {W / 812:.3f}), art {1152}x{round(new * 1152 / 812)}, units tall {round(new * 1152 / 812 / 3)}; printed length 58mm {L(384):.0f} dots = {L(384) * dot_mm:.1f} mm; 80mm {L(576):.0f} dots = {L(576) * dot_mm:.1f} mm  (was {W / 812 * 384:.0f} dots / {W / 812 * 384 * dot_mm:.1f} mm @58)')
u = 384 / 812
print(f'window on paper at 58mm: {win_w * u:.0f} x {win_h * u:.0f} dots = {win_w * u * dot_mm:.1f} x {win_h * u * dot_mm:.1f} mm; 80mm: {win_w * 576 / 812 * dot_mm:.1f} x {win_h * 576 / 812 * dot_mm:.1f} mm')
print('landscape camera frame width shown by a 3:4 box: 4:3 camera %.0f%%, 16:9 camera %.0f%%' % (75 / (4 / 3), 75 / (16 / 9)))
