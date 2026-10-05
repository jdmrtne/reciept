// Per-design settings for the slice builder. thr/sat = how "white" the window paper is; cutA/cutB = plain rows (design px) where the
// top band ends / bottom band starts; paper = colour between photos; stroke = divider line between photos.
export const SLICED = {
  'kawaii-pets':    { dir: 'kawaii-pets',    thr: 248, sat: 22, cutA: 372, cutB: 928,  paper: 'rgb(254,204,29)',  stroke: { color: 'rgb(255,243,170)', w: 8 }, r: 22 },
  'retro-memories': { dir: 'retro-memories', thr: 250, sat: 10, cutA: 190, cutB: 1050, paper: 'rgb(247,241,230)', stroke: { color: 'rgb(30,30,30)', w: 6 }, r: 4 },
  halloween:        { dir: 'halloween',      thr: 248, sat: 22, cutA: 450, cutB: 700,  paper: 'rgb(48,10,110)',   stroke: { color: 'rgb(255,138,20)', w: 8 }, r: 36 },
  'pink-you-me':    { dir: 'pink-you-me',    thr: 248, sat: 22, cutA: 335, cutB: 775,  paper: 'rgb(253,206,226)', stroke: { color: 'rgb(222,40,95)', w: 6 }, r: 28 },
  'summer-vibes':   { dir: 'summer-vibes',   thr: 248, sat: 22, cutA: 495, cutB: 630,  paper: 'rgb(54,150,240)',  stroke: { color: 'rgb(30,120,230)', w: 8 }, r: 30 },
  'neon-gaming':    { dir: 'neon-gaming',    thr: 205, sat: 20, cutA: 540, cutB: 720,  paper: 'rgb(4,4,30)',      stroke: { color: 'rgb(0,200,255)', w: 6 }, r: 4 },
  'stay-real':      { dir: 'stay-real',      thr: 244, sat: 14, cutA: 380, cutB: 830,  paper: 'rgb(10,10,10)',    stroke: { color: 'rgb(235,235,235)', w: 6 }, r: 0, erode: 12, inset: 34 }
};

// "Slice & plan" designs (see drawPlanned in frames-slice.mjs): the design's rows are in px of the knocked-out master in design-src/.
// manga-comic: master = design-src/manga-comic.png (2x of the reference, cropped to its ink border).
export const PLANNED = {
  'manga-comic': { dir: 'manga-comic', thr: 240, sat: 24, paper: 'rgb(255,255,255)', stroke: { color: 'rgb(12,12,12)', w: 9 }, r: 0, fringe: 3, open: 14, inset: { L: 44, R: 90 },
    tCut: 732, bCut: 1942,
    sides: { L: { headEnd: 1462, divStart: 1382, tile: [1572, 1942] }, R: { headEnd: 1602, divStart: 1512, tile: [1632, 1942] } } }
};
