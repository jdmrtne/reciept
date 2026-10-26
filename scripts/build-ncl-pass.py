#!/usr/bin/env python3
"""
Builds src/assets/frames/ncl-boarding-pass/pass-{1,2,3,4}.png from the four reference tickets in design-src/ncl-boarding-pass/.
  1. cleans the scan noise (levels), keeping every glyph / airplane / barcode / rule pixel of the reference;
  2. makes the photo-box interiors (and their "3:4 PHOTO BOX n" labels) transparent;
  3. blanks the reference QR picture (the app draws the real session QR into the declared safe area);
  3b. ticket 4 only: adds the one missing full stop of its bottom-right tagline (see the comment in the loop);
  3c. tickets 1-3: recomposes the ticket with three/two/one TRUE 3:4 photo boxes (380 x 504 outer, drawn 3.4 px outline; the rest is reference pixels shifted);
  3d. all four: re-spaces the right-hand stub so the QR safe area reaches 104 units (see QR_FREE_GAP, SHIFT);
  4. rotates the ticket 90 degrees clockwise (it prints sideways along the roll) and scales it to 1152 px wide (3x the 384-unit canvas).
Prints the layout data (slot units, height ratio, QR safe area) that is pasted into src/layouts/registry.ts / src/frames/registry.ts.
Usage: python3 scripts/build-ncl-pass.py   (needs Pillow, numpy, scipy)
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'design-src/ncl-boarding-pass')
OUT = os.path.join(ROOT, 'src/assets/frames/ncl-boarding-pass')
W_ART = 1152          # artwork px across the paper = 3 px per layout unit
INSET_WINDOW = 4      # ref px: window = box outer edge inset by the stroke (3 px) + 1
INSET_SLOT = 1.5      # ref px: slot reaches under the stroke so no paper hairline can show
BOX_W, BOX_H, BOX_Y, STROKE = 380, 504, 130, 3.4   # passes 1-3: ONE outer box, window = outer - 2*INSET_WINDOW = 372 x 496 = exactly 3:4
QR_FREE_GAP = 226     # ref px of ink-free rows around the QR (safe side 221 px = 104.5 units: 41 modules at 2 dots/module on 58 mm)
SHIFT = {1: (-24, 24), 2: (-30, 30), 3: (-32, 33), 4: (0, 36)}   # (items above QR, items below QR) vertical shift in ref px
P4_GAP_CUTS = (2, 2, 2, 2, 3)   # pass 4 only: extra px taken from its five largest gaps above the QR

def clean(a):
    """Levels: scan paper (~249) -> 255, ink (~0) -> 0; keeps the anti-aliased edges."""
    return np.clip((a.astype(np.float32) - 70) / (205 - 70), 0, 1) * 255

def draw_box(g, x, y, w, h, t):
    """Antialiased rectangle outline (outer box x,y,w,h; stroke t px) drawn as ink on gray array g."""
    def cov(a, b, n):
        i = np.arange(n); return np.clip(np.minimum(b, i + 1) - np.maximum(a, i), 0, 1)
    H, W = g.shape; cx = lambda a, b: cov(a, b, W); cy = lambda a, b: cov(a, b, H)
    ring = np.outer(cy(y, y + h), cx(x, x + w)) - np.outer(cy(y + t, y + h - t), cx(x + t, x + w - t))
    np.minimum(g, 255 * (1 - ring), out=g)

def find_boxes(dark):
    lab, _ = ndi.label(dark, structure=np.ones((3, 3)))
    out = []
    for i, s in enumerate(ndi.find_objects(lab)):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h > 200 and 150 < w < 400 and (lab[s] == i + 1).sum() < 0.1 * h * w:
            out.append((s[1].start, s[0].start, w, h))
    return sorted(out)

def runs_of(mask, gap):
    idx = np.where(mask)[0]; out, st, pv = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - pv > gap: out.append((int(st), int(pv))); st = i
        pv = i
    out.append((int(st), int(pv))); return out

def find_qr(dark, stub_x0):
    d = ndi.binary_dilation(dark, iterations=5)
    lab, _ = ndi.label(d)
    for i, s in enumerate(ndi.find_objects(lab)):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if s[1].start > stub_x0 and 120 < w < 190 and 120 < h < 190 and abs(w - h) < 25:
            return (s[1].start + 5, s[0].start + 5, s[1].stop - 5, s[0].stop - 5)  # undo the dilation
    raise SystemExit('QR not found')

result = {}
for n in (1, 2, 3, 4):
    ref = np.array(Image.open(os.path.join(SRC, f'ref-{n}-photo.png')).convert('L'))
    H, W = ref.shape
    dark = ref < 128
    boxes = find_boxes(dark)
    assert len(boxes) == n, (n, boxes)
    # stub line = the dashed vertical rule (a solid box edge is not it)
    col = dark[:, int(W * .6):].sum(0).copy()
    for (bx, by, bw, bh) in boxes: col[max(0, bx - 8 - int(W * .6)):max(0, bx + bw + 8 - int(W * .6))] = 0
    lx = int(W * .6) + int(np.argmax(col))
    qx0, qy0, qx1, qy1 = find_qr(dark, lx)
    g = clean(ref)
    if n == 4:
        # Reference 4 is the only ticket whose bottom-right tagline ends "OFFICIALLY RECEIPTED" WITHOUT the final period (the header line,
        # the stub line and tickets 1-3 have it). A 4 x 4 px dot (stem width 3 px) is added after the final D (right edge x=1414) on the baseline (y=741).
        # This is the ONE glyph in the family that is not a reference pixel.
        assert (g[736:742, 1418:1432] > 245).all(), 'tagline period position is no longer blank: re-measure'
        g[738:742, 1423:1427] = 0
    g[qy0 - 6:qy1 + 7, qx0 - 6:qx1 + 7] = 255          # erase the reference QR picture (6 px halo)

    # ---- stub items (row runs right of the dashed stub line), measured on the reference ----
    sx0, sx1 = lx + 8, W - 6
    rr = runs_of(dark[:, sx0:sx1].any(1), 3)
    qi = [i for i, (a, b) in enumerate(rr) if a <= qy0 <= b][0]
    shift_up, shift_dn = SHIFT[n]
    shifts = []
    above_gaps = [rr[i + 1][0] - rr[i][1] - 1 for i in range(qi - 1)]
    cuts = [0] * len(above_gaps)
    if n == 4:
        for k, gi in enumerate(sorted(range(len(above_gaps)), key=lambda i: -above_gaps[i])[:5]): cuts[gi] = P4_GAP_CUTS[k]
    for i in range(len(rr)):
        if i < qi: shifts.append(shift_up + (0 if n != 4 else sum(cuts[i:])))   # pass 4: the stack above compresses towards the top margin... see below
        elif i == qi: shifts.append(0)
        else: shifts.append(shift_dn)
    if n == 4:  # top margin stays 34: first item fixed, every later item moves up by the cuts above it
        shifts = [-sum(cuts[:i]) if i < qi else (0 if i == qi else shift_dn) for i in range(len(rr))]

    # ---- compose the canvas ----
    if n <= 3:
        x0b = boxes[0][0]; gaps = [boxes[i + 1][0] - (boxes[i][0] + boxes[i][2]) for i in range(n - 1)]
        right = boxes[-1][0] + boxes[-1][2]
        newx = [x0b]
        for gp in gaps: newx.append(newx[-1] + BOX_W + gp)
        delta = (newx[-1] + BOX_W) - right
        Wn = W + delta
        cg = np.full((H, Wn), 255.0, np.float32); cg[:, :x0b] = g[:, :x0b]; cg[:, newx[-1] + BOX_W:] = g[:, right:]
        newboxes = [(x, BOX_Y, BOX_W, BOX_H) for x in newx]
        for (x, y, w, h) in newboxes: draw_box(cg, x, y, w, h, STROKE)
        lxn = lx + delta
    else:
        delta, Wn, cg, newboxes, lxn = 0, W, g.copy(), boxes, lx
    sxn0, sxn1 = lxn + 8, Wn - 6
    # ---- re-space the stub: clear the strip area, paste each item strip at its new rows (the QR item is blank paper) ----
    src = cg.copy(); cg[:, sxn0:sxn1] = 255
    for i, (a, b) in enumerate(rr):
        if i == qi: continue
        cg[a - 2 + shifts[i]:b + 3 + shifts[i], sxn0:sxn1] = src[a - 2:b + 3, sxn0:sxn1]
    # free gap around the QR after the move
    a_end = rr[qi - 1][1] + shifts[qi - 1]; b_start = rr[qi + 1][0] + shifts[qi + 1]
    free = b_start - a_end - 1
    assert free >= QR_FREE_GAP, (n, free)
    alpha = np.full(cg.shape, 255, np.uint8)
    for (x, y, w, h) in newboxes:
        alpha[y + INSET_WINDOW:y + h - INSET_WINDOW, x + INSET_WINDOW:x + w - INSET_WINDOW] = 0
    g = cg
    # QR safe area: the ink-free rows of the stub column between the item above and the item below the (erased) QR
    col0, col1 = lxn + 22, Wn - 12
    ink = (g[:, col0:col1] < 160).any(axis=1)
    cy = (a_end + b_start) // 2
    top = cy
    while top > 0 and not ink[top]: top -= 1
    bot = cy
    while bot < H - 1 and not ink[bot]: bot += 1
    sa = (col0, top + 3, col1, bot - 2)
    W_ = Wn
    rot_rect = lambda x0, y0, x1, y1: (H - y1, x0, H - y0, x1)
    rg = np.rot90(g, k=-1); ra = np.rot90(alpha, k=-1)
    s = W_ART / H
    out_h = int(round(W_ * s))
    gray = Image.fromarray(np.clip(rg, 0, 255).astype(np.uint8)).resize((W_ART, out_h), Image.LANCZOS)
    gg = np.array(gray).astype(np.float32) / 255
    gg = np.clip((gg - 0.5) * 2.2 + 0.5, 0, 1)
    al = np.array(Image.fromarray(ra).resize((W_ART, out_h), Image.NEAREST))
    out = np.dstack([gg * 255] * 3 + [al]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, f'pass-{n}.png'), optimize=True)

    slots = []
    for (x, y, w, h) in newboxes:
        x0, y0, x1, y1 = rot_rect(x + INSET_SLOT, y + INSET_SLOT, x + w - INSET_SLOT, y + h - INSET_SLOT)
        slots.append([round(x0 * s / 3), round(y0 * s / 3), round((x1 - x0) * s / 3), round((y1 - y0) * s / 3)])
    rx0, ry0, rx1, ry1 = rot_rect(*sa)
    result[f'pass-{n}'] = dict(
        artPx=[W_ART, out_h], heightRatio=round(out_h / W_ART, 4), unitsHeight=round(out_h / 3),
        slotsUnits=slots,
        qrSafeArea=dict(x=round(rx0 / H, 4), y=round(ry0 / W_, 4), w=round((rx1 - rx0) / H, 4), h=round((ry1 - ry0) / W_, 4)),
        qrSafeAreaUnits=[round(rx0 * s / 3, 1), round(ry0 * s / 3, 1), round((rx1 - rx0) * s / 3, 1), round((ry1 - ry0) * s / 3, 1)],
        refQr=[qx0, qy0, qx1, qy1], boxesRef=boxes, ticketPx=[W_, H], boxesNew=newboxes, qrFreeGapPx=int(free))
print(json.dumps(result, indent=1))
json.dump(result, open(os.path.join(SRC, 'layout-data.json'), 'w'), indent=1)
