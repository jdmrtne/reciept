#!/usr/bin/env python3
"""
Builds src/assets/frames/ncl-boarding-pass/pass-{1,2,3,4}.png from the four reference tickets in design-src/ncl-boarding-pass/.
  1. cleans the scan noise (levels), keeping every glyph / airplane / barcode / rule pixel of the reference;
  2. makes the photo-box interiors (and their "3:4 PHOTO BOX n" labels) transparent;
  3. blanks the reference QR picture (the app draws the real session QR into the declared safe area);
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

def clean(a):
    """Levels: scan paper (~249) -> 255, ink (~0) -> 0; keeps the anti-aliased edges."""
    return np.clip((a.astype(np.float32) - 70) / (205 - 70), 0, 1) * 255

def find_boxes(dark):
    lab, _ = ndi.label(dark, structure=np.ones((3, 3)))
    out = []
    for i, s in enumerate(ndi.find_objects(lab)):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h > 200 and 150 < w < 400 and (lab[s] == i + 1).sum() < 0.1 * h * w:
            out.append((s[1].start, s[0].start, w, h))
    return sorted(out)

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
    stub_x0 = int(W * 0.77)
    qx0, qy0, qx1, qy1 = find_qr(dark, stub_x0)
    g = clean(ref)
    # erase the reference QR picture (with a 6 px halo) -> flat paper
    g[qy0 - 6:qy1 + 7, qx0 - 6:qx1 + 7] = 255
    alpha = np.full(g.shape, 255, np.uint8)
    for (x, y, w, h) in boxes:
        alpha[y + INSET_WINDOW:y + h - INSET_WINDOW, x + INSET_WINDOW:x + w - INSET_WINDOW] = 0
    # QR safe area: the empty rows of the stub column above/below the erased QR, full stub width inside the page
    col0, col1 = stub_x0 + 30, W - 12
    ink = (g[:, col0:col1] < 160).any(axis=1)
    cy = (qy0 + qy1) // 2
    top = cy
    while top > 0 and not ink[top]: top -= 1
    bot = cy
    while bot < H - 1 and not ink[bot]: bot += 1
    sa = (col0, top + 3, col1, bot - 2)      # x0, y0, x1, y1 in reference px (ink-free by construction)

    # rotate 90 degrees clockwise: (x, y) -> (H - y, x)
    def rot_rect(x0, y0, x1, y1):
        return (H - y1, x0, H - y0, x1)
    rg = np.rot90(g, k=-1); ra = np.rot90(alpha, k=-1)
    s = W_ART / H
    out_h = int(round(W * s))
    img = Image.fromarray(np.dstack([rg, rg, rg, ra]).astype(np.uint8), 'RGBA')
    # scale colour and alpha separately (premultiplied-safe): gray by Lanczos then re-sharpen, alpha nearest-ish
    gray = Image.fromarray(rg.astype(np.uint8)).resize((W_ART, out_h), Image.LANCZOS)
    gg = np.array(gray).astype(np.float32) / 255
    gg = np.clip((gg - 0.5) * 2.2 + 0.5, 0, 1)             # crisp edges after upscaling
    al = np.array(Image.fromarray(ra).resize((W_ART, out_h), Image.NEAREST))
    out = np.dstack([gg * 255] * 3 + [al]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, f'pass-{n}.png'), optimize=True)

    slots = []
    for (x, y, w, h) in boxes:
        x0, y0, x1, y1 = rot_rect(x + INSET_SLOT, y + INSET_SLOT, x + w - INSET_SLOT, y + h - INSET_SLOT)
        slots.append([round(x0 * s / 3), round(y0 * s / 3), round((x1 - x0) * s / 3), round((y1 - y0) * s / 3)])  # layout units @384
    # reading order on the paper: the ticket's left-to-right becomes bottom-to-top, so box 1 is the LOWEST slot; keep ticket order (box 1 first)
    rx0, ry0, rx1, ry1 = rot_rect(*sa)
    result[f'pass-{n}'] = dict(
        artPx=[W_ART, out_h], heightRatio=round(out_h / W_ART, 4), unitsHeight=round(out_h / 3),
        slotsUnits=slots,
        qrSafeArea=dict(x=round(rx0 / H, 4), y=round(ry0 / W, 4), w=round((rx1 - rx0) / H, 4), h=round((ry1 - ry0) / W, 4)),
        qrSafeAreaUnits=[round(rx0 * s / 3, 1), round(ry0 * s / 3, 1), round((rx1 - rx0) * s / 3, 1), round((ry1 - ry0) * s / 3, 1)],
        refQr=[qx0, qy0, qx1, qy1], boxesRef=boxes)
print(json.dumps(result, indent=1))
json.dump(result, open(os.path.join(SRC, 'layout-data.json'), 'w'), indent=1)
