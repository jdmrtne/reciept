#!/usr/bin/env python3
"""Reusable NCL pass measurements (reading orientation, ticket height 812 px = paper width).
  ref N            : boxes, gaps, x-blocks, stub vertical budget of design-src/.../ref-N-photo.png (or --src PATH)
  art N            : same on the shipped src/assets/frames/ncl-boarding-pass/pass-N.png turned back (windows from alpha)
  compare N        : ink recall/precision of shipped art vs reference outside windows and QR zone, box ratios, border thickness
  montage OUT N..  : stacked PNG, reference above, art below, for the listed passes
Usage: python3 scripts/qa/ncl-measure.py ref 1 | art 3 | compare 1 | montage out.png 1 2 3 [--art-dir DIR] [--ref-dir DIR]"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
REF_DIR = os.path.join(ROOT, 'design-src/ncl-boarding-pass')
ART_DIR = os.path.join(ROOT, 'src/assets/frames/ncl-boarding-pass')
for i, a in enumerate(sys.argv):
    if a == '--art-dir': ART_DIR = sys.argv[i + 1]
    if a == '--ref-dir': REF_DIR = sys.argv[i + 1]

def load_ref(n): return np.array(Image.open(os.path.join(REF_DIR, f'ref-{n}-photo.png')).convert('L'))
def load_art(n, ref_shape):
    """Shipped art turned back to reading orientation, resized to the reference size. Returns gray, windows mask (True = transparent)."""
    im = np.array(Image.open(os.path.join(ART_DIR, f'pass-{n}.png')).convert('RGBA'))
    g, a = np.rot90(im[..., 0], k=1), np.rot90(im[..., 3], k=1)    # undo the 90 deg clockwise turn
    return g, a
def runs(mask, gap):
    """Index runs of True separated by at least `gap` False."""
    idx = np.where(mask)[0]
    if not len(idx): return []
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - p > gap: out.append((int(s), int(p))); s = i
        p = i
    out.append((int(s), int(p))); return out
def find_boxes(dark, min_h=200, w_rng=(150, 560)):
    lab, _ = ndi.label(dark, structure=np.ones((3, 3))); out = []
    for i, s in enumerate(ndi.find_objects(lab)):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h > min_h and w_rng[0] < w < w_rng[1] and (lab[s] == i + 1).sum() < 0.1 * h * w: out.append((s[1].start, s[0].start, w, h))
    return sorted(out)
def stroke(dark, x, y, w, h):
    """Border thickness: dark run length across the left and top edge midpoints, and right/bottom."""
    def run(line, start, rev=False):
        L = line[::-1] if rev else line; k = 0
        while k < len(L) and not L[k]: k += 1   # skip to ink
        c = 0
        while k + c < len(L) and L[k + c]: c += 1
        return c
    yy, xx = y + h // 2, x + w // 2
    return dict(left=run(dark[yy, x - 8:x + 12], 0), right=run(dark[yy, x + w - 12:x + w + 8], 0), top=run(dark[y - 8:y + 12, xx], 0), bottom=run(dark[y + h - 12:y + h + 8, xx], 0))

def describe(g, boxes, name):
    H, W = g.shape; dark = g < 128
    colsum = dark[:, int(W * .6):].sum(0).copy()
    for (bx, by, bw, bh) in boxes: colsum[max(0, bx - 8 - int(W * .6)):max(0, bx + bw + 8 - int(W * .6))] = 0   # a solid box edge is not the stub line
    lx = int(W * .6) + int(np.argmax(colsum))   # the dashed vertical stub line
    print(f'== {name}: {W}x{H} px, stub line x={lx} (dark rows {colsum.max()})')
    print('boxes (x,y,w,h | ratio w/h | x1):')
    for i, (x, y, w, h) in enumerate(boxes): print(f'  {i+1}: {x},{y},{w},{h}  {w/h:.3f}  right={x+w}  stroke={stroke(dark, x, y, w, h)}')
    for i in range(len(boxes) - 1): print(f'  gap {i+1}-{i+2}: {boxes[i+1][0] - (boxes[i][0] + boxes[i][2])} px')
    # x blocks: column ink runs over the whole ticket excluding the stub line itself
    d = dark.copy(); d[:, lx - 4:lx + 5] = False
    cr = runs(d.any(0), 10); print('x blocks (ink column runs, gap>10):', cr)
    # left block, verse block, stub: row-run budgets
    def budget(label, x0, x1, ymin=0, ymax=H):
        sub = dark[ymin:ymax, x0:x1]; rr = runs(sub.any(1), 3); print(f'-- {label} x[{x0},{x1}] row runs (y0,y1,h | ink x0..x1):')
        for a, b in rr:
            cols = np.where(sub[a:b + 1].any(0))[0]; print(f'   y {a+ymin:4d}..{b+ymin:4d} h={b-a+1:3d}  x {cols.min()+x0}..{cols.max()+x0} (w {cols.max()-cols.min()+1})')
        if rr: print(f'   top margin {rr[0][0]+ymin}, bottom margin {H-(rr[-1][1]+ymin)-1}')
    b0 = boxes[0][0] if boxes else lx
    if n_boxes_left(boxes): budget('left block', 0, b0 - 6)
    if boxes and boxes[-1][0] + boxes[-1][2] + 6 < lx - 6: budget('verse+MEMORYS block', boxes[-1][0] + boxes[-1][2] + 6, lx - 6)
    budget('stub', lx + 8, W - 6)
def n_boxes_left(b): return True

def cmd_ref(n):
    g = load_ref(n); boxes = find_boxes(g < 128, w_rng=(150, 400) if n < 4 else (150, 400)); describe(g, boxes, f'ref-{n}')
    if n == 4:  # pass-4 header boxes are landscape: widths 324..351, height 270
        pass
def cmd_art(n):
    g, a = load_art(n, None); H, W = g.shape; win = a < 128
    lab, k = ndi.label(win); wins = []
    for s in ndi.find_objects(lab):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h > 100 and w > 100: wins.append((s[1].start, s[0].start, w, h))
    wins = sorted(wins); print(f'== art pass-{n}: shipped {Image.open(os.path.join(ART_DIR, f"pass-{n}.png")).size} -> reading {W}x{H} (scale {H/812:.4f} of 812)')
    for i, (x, y, w, h) in enumerate(wins): print(f'  window {i+1}: x={x} y={y} w={w} h={h}  ratio w/h={w/h:.4f}')
    sc = H / 812; gg = np.array(Image.fromarray(g).resize((int(round(W / sc)), 812), Image.LANCZOS))
    boxes = find_boxes(gg < 128, w_rng=(150, 560)); print('  box outlines in 812 scale:'); 
    for i, (x, y, w, h) in enumerate(boxes): print(f'   {i+1}: {x},{y},{w},{h} ratio {w/h:.3f} stroke {stroke(gg < 128, x, y, w, h)}')
def cmd_compare(n):
    ref = load_ref(n); H, W = ref.shape; g, a = load_art(n, ref.shape)
    sc = g.shape[0] / H; art = np.array(Image.fromarray(g).resize((int(round(g.shape[1] / sc)), H), Image.LANCZOS)); al = np.array(Image.fromarray(a).resize((art.shape[1], H), Image.NEAREST))
    if art.shape[1] != W: print(f'!! width differs: ref {W}, art {art.shape[1]} (expected after a recompose); comparing top-left aligned crop'); w = min(W, art.shape[1]); art, al, ref = art[:, :w], al[:, :w], ref[:, :w]
    boxes = find_boxes(ref < 128); ign = np.zeros(ref.shape, bool)
    for (x, y, w, h) in boxes: ign[y:y + h, x:x + w] = True        # photo windows and their labels
    lay = json.load(open(os.path.join(REF_DIR, 'layout-data.json'))).get(f'pass-{n}', {})
    if lay.get('refQr'): qx0, qy0, qx1, qy1 = lay['refQr']; ign[qy0 - 8:qy1 + 9, qx0 - 8:qx1 + 9] = True
    rd, ad = (ref < 128) & ~ign, (art < 128) & ~ign
    tol = ndi.binary_dilation(rd, iterations=4); tol2 = ndi.binary_dilation(ad, iterations=4)
    print(f'compare pass-{n}: ink recall {(ad & tol2 | rd & ~ad & False).sum() and (rd & tol2).sum() / rd.sum():.4f}  precision {(ad & tol).sum() / ad.sum():.4f}  (ref ink {rd.sum()}, art ink {ad.sum()}, tol 4 px)')
def cmd_montage(out, ns):
    tiles = []
    for n in ns:
        r = Image.open(os.path.join(REF_DIR, f'ref-{n}-photo.png')).convert('L'); g, a = load_art(n, None)
        art = Image.fromarray(g).convert('L'); alpha = Image.fromarray(a)
        bg = Image.new('RGB', art.size, (255, 200, 200)); bg.paste(Image.merge('RGB', [art] * 3), mask=alpha)    # windows show pink
        bg = bg.resize((int(round(art.width * 812 / art.height)), 812), Image.LANCZOS); tiles += [r.convert('RGB'), bg]
    Wm = max(t.width for t in tiles); Hm = sum(t.height + 6 for t in tiles); M = Image.new('RGB', (Wm, Hm), (120, 120, 120)); y = 0
    for t in tiles: M.paste(t, (0, y)); y += t.height + 6
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True); M.save(out); print('montage', out, M.size)
if __name__ == '__main__':
    c = sys.argv[1]; args = [a for a in sys.argv[2:] if not a.startswith('--') and not os.path.isdir(a)]
    if c == 'ref': [cmd_ref(int(n)) for n in args]
    elif c == 'art': [cmd_art(int(n)) for n in args]
    elif c == 'compare': [cmd_compare(int(n)) for n in args]
    elif c == 'montage': cmd_montage(args[0], [int(n) for n in args[1:]])

# ---------------- verify: new art vs references after the 3:4 / stub fix ----------------
def _reading(n, W_ticket):
    g, a = load_art(n, None); sc = g.shape[0] / 812
    Wn = int(round(g.shape[1] / sc))
    return (np.array(Image.fromarray(g).resize((Wn, 812), Image.LANCZOS)), np.array(Image.fromarray(a).resize((Wn, 812), Image.NEAREST)))
def _pr(rd, ad, tol=4):
    t1 = ndi.binary_dilation(ad, iterations=tol); t2 = ndi.binary_dilation(rd, iterations=tol)
    return (rd & t1).sum() / max(1, rd.sum()), (ad & t2).sum() / max(1, ad.sum())
def cmd_verify(n, base_dir=None):
    ref = load_ref(n); H, W = ref.shape; art, al = _reading(n, W); Wn = art.shape[1]; delta = Wn - W
    rb = find_boxes(ref < 128); rdark, adark = ref < 128, art < 128
    col = rdark[:, int(W * .6):].sum(0).copy()
    for (bx, by, bw, bh) in rb: col[max(0, bx - 8 - int(W * .6)):max(0, bx + bw + 8 - int(W * .6))] = 0
    lx = int(W * .6) + int(np.argmax(col)); print(f'--- pass-{n}: ticket {W} -> {Wn} (+{delta})')
    lab, k = ndi.label(al < 128); wins = sorted((s[1].start, s[0].start, s[1].stop - s[1].start, s[0].stop - s[0].start) for s in ndi.find_objects(lab) if s[0].stop - s[0].start > 100)
    for i, (x, y, w, h) in enumerate(wins): print(f'  window {i+1}: {w}x{h} ratio {w/h:.4f}  (err vs 3:4: {abs(w - 0.75 * h):.2f} px)')
    if n <= 3:
        sizes = {(w, h) for (_, _, w, h) in wins}; print(f'  all windows same size: {len(sizes) == 1}  sizes {sizes}')
        nb = find_boxes(adark, w_rng=(150, 560)); st = []
        for (x, y, w, h) in nb:
            ink = (255 - art.astype(float)) / 255; ys = slice(y + h // 4, y + 3 * h // 4); xs = slice(x + w // 4, x + 3 * w // 4)
            st.append((ink[ys, x - 4:x + 10].sum(1).mean() + ink[ys, x + w - 10:x + w + 4].sum(1).mean() + ink[y - 4:y + 10, xs].sum(0).mean() + ink[y + h - 10:y + h + 4, xs].sum(0).mean()) / 4)
        print(f'  outlines {[(w, h) for (_, _, w, h) in nb]} mean stroke {np.mean(st):.2f} px (ref mean 3.25 to 3.43)')
        x0b, right = rb[0][0], rb[-1][0] + rb[-1][2]
        r, p = _pr(rdark[:, :x0b], adark[:, :x0b]); print(f'  slab A (left block, x<{x0b}) recall {r:.4f} precision {p:.4f}')
        r, p = _pr(rdark[:, right:lx - 6], adark[:, right + delta:lx + delta - 6]); print(f'  slab B verse/MEMORYS block recall {r:.4f} precision {p:.4f}')
        r, p = _pr(rdark[:, lx - 5:lx + 6], adark[:, lx + delta - 5:lx + delta + 6]); print(f'  stub dashed line recall {r:.4f} precision {p:.4f}')
    else:
        r, p = _pr(rdark[:, :lx - 6], adark[:, :lx - 6]); print(f'  everything left of the stub line: recall {r:.4f} precision {p:.4f}')
        if base_dir:
            old = np.array(Image.open(os.path.join(base_dir, 'pass-4.png')).convert('RGBA'))[..., 3]; cur = np.array(Image.open(os.path.join(ART_DIR, 'pass-4.png')).convert('RGBA'))[..., 3]
            print(f'  window alpha identical to pre-fix art: {old.shape == cur.shape and (old == cur).all()}')
    sa = json.load(open(os.path.join(REF_DIR, 'layout-data.json')))[f'pass-{n}']
    # stub items: match each reference row-run strip to the art by vertical offset
    sx0, sx1 = lx + 8, W - 6; rr = runs(rdark[:, sx0:sx1].any(1), 3); worst = (1, 1); offs = []
    for (a, b) in rr:
        strip = rdark[a:b + 1, sx0:sx1]
        if strip.shape[0] > 100 and strip.sum() > 0 and a <= sa['refQr'][1] <= b: continue     # the erased reference QR picture
        best = None
        for off in range(-70, 71):
            if a + off < 0 or b + off >= H: continue
            c = adark[a + off:b + 1 + off, sx0 + delta:sx1 + delta]; r, p = _pr(strip, c, tol=1)
            if best is None or r + p > best[0] + best[1]: best = (r, p, off)
        offs.append(best[2]); worst = (min(worst[0], best[0]), min(worst[1], best[1]))
    print(f'  stub items matched: {len(offs)}, offsets {offs}, worst recall {worst[0]:.4f} precision {worst[1]:.4f}')
    # safe area flat paper in the shipped art (paper space = art px)
    im = np.array(Image.open(os.path.join(ART_DIR, f'pass-{n}.png')).convert('RGBA')); Ha, Wa = im.shape[:2]; q = sa['qrSafeArea']
    x0, y0, x1, y1 = int(q['x'] * Wa), int(q['y'] * Ha), int((q['x'] + q['w']) * Wa), int((q['y'] + q['h']) * Ha)
    reg = im[y0:y1, x0:x1]; print(f'  QR safe area {sa["qrSafeAreaUnits"]} units: min gray {reg[..., 0].min()}, min alpha {reg[..., 3].min()} (flat paper if 255/255); side {min(sa["qrSafeAreaUnits"][2:]):.1f} units')
if __name__ == '__main__' and sys.argv[1] == 'verify':
    bd = sys.argv[sys.argv.index('--base') + 1] if '--base' in sys.argv else None
    for a in sys.argv[2:]:
        if a.isdigit(): cmd_verify(int(a), bd)
