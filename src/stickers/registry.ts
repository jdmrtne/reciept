/** Data-driven stickers. Each is monochrome SVG markup in a 100×100 box. Add a sticker = add an entry (or point `svg` at loaded asset markup from src/assets/stickers). */
export interface StickerDef { id: string; category: string; name: string; svg: string }

export const CATEGORIES = ['Hearts', 'Stars', 'Cute', 'Celebration', 'Food', 'Expressions', 'Decorative', 'Seasonal'] as const;

const H = 'M50 88 C10 58 6 30 28 20 C40 15 48 22 50 30 C52 22 60 15 72 20 C94 30 90 58 50 88Z';
const star = (n: number, R: number, r: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R;
    return `${(50 + rr * Math.cos(a)).toFixed(1)},${(52 + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
const face = (extra: string) => `<circle cx="50" cy="50" r="42" fill="#fff" stroke="#000" stroke-width="6"/>${extra}`;
const smile = '<path d="M30 60 Q50 82 70 60" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/>';
const W = 'fill="none" stroke="#fff" stroke-linecap="round"';

export const STICKERS: StickerDef[] = [
  { id: 'heart', category: 'Hearts', name: 'Heart', svg: `<path d="${H}"/>` },
  { id: 'heart-outline', category: 'Hearts', name: 'Heart outline', svg: `<path d="${H}" fill="#fff" stroke="#000" stroke-width="7" stroke-linejoin="round"/>` },
  { id: 'hearts-two', category: 'Hearts', name: 'Two hearts', svg: `<g transform="translate(0 20) scale(.62)"><path d="${H}"/></g><g transform="translate(40 2) scale(.55)"><path d="${H}" fill="#fff" stroke="#000" stroke-width="10" stroke-linejoin="round"/></g>` },

  { id: 'star', category: 'Stars', name: 'Star', svg: `<polygon points="${star(5, 46, 20)}" stroke="#000" stroke-width="4" stroke-linejoin="round"/>` },
  { id: 'star-outline', category: 'Stars', name: 'Star outline', svg: `<polygon points="${star(5, 44, 20)}" fill="#fff" stroke="#000" stroke-width="7" stroke-linejoin="round"/>` },
  { id: 'sparkle', category: 'Stars', name: 'Sparkle', svg: '<path d="M50 4 Q56 44 96 50 Q56 56 50 96 Q44 56 4 50 Q44 44 50 4Z"/>' },

  { id: 'cat', category: 'Cute', name: 'Cat', svg: `<path d="M20 45 L24 12 L42 28 Q50 26 58 28 L76 12 L80 45 Q84 80 50 84 Q16 80 20 45Z"/><circle cx="38" cy="52" r="5" fill="#fff"/><circle cx="62" cy="52" r="5" fill="#fff"/><path d="M44 66 Q50 72 56 66" ${W} stroke-width="3"/>` },
  { id: 'bunny', category: 'Cute', name: 'Bunny', svg: `<ellipse cx="36" cy="24" rx="9" ry="22"/><ellipse cx="64" cy="24" rx="9" ry="22"/><circle cx="50" cy="64" r="27"/><circle cx="41" cy="60" r="4" fill="#fff"/><circle cx="59" cy="60" r="4" fill="#fff"/><path d="M46 72 Q50 77 54 72" ${W} stroke-width="3"/>` },
  { id: 'cloud', category: 'Cute', name: 'Cloud', svg: `<path d="M26 74 Q6 74 8 56 Q10 42 26 44 Q28 22 50 24 Q70 22 74 42 Q94 40 92 60 Q90 74 74 74Z"/><circle cx="40" cy="54" r="3.5" fill="#fff"/><circle cx="60" cy="54" r="3.5" fill="#fff"/><path d="M45 62 Q50 67 55 62" ${W} stroke-width="3"/>` },

  { id: 'balloon', category: 'Celebration', name: 'Balloon', svg: '<ellipse cx="50" cy="40" rx="26" ry="32"/><path d="M46 72 L54 72 L50 79Z"/><path d="M50 79 Q42 88 50 96" fill="none" stroke="#000" stroke-width="3"/><ellipse cx="40" cy="28" rx="5" ry="9" fill="#fff" transform="rotate(20 40 28)"/>' },
  { id: 'party-hat', category: 'Celebration', name: 'Party hat', svg: `<path d="M50 10 L82 90 L18 90Z"/><path d="M36 52 H64 M27 72 H73" ${W} stroke-width="5"/><circle cx="50" cy="10" r="7"/>` },
  { id: 'gift', category: 'Celebration', name: 'Gift', svg: '<rect x="14" y="42" width="72" height="46"/><rect x="8" y="28" width="84" height="16"/><rect x="45" y="28" width="10" height="60" fill="#fff"/><path d="M50 28 Q30 2 26 18 Q30 30 50 28Z M50 28 Q70 2 74 18 Q70 30 50 28Z"/>' },

  { id: 'donut', category: 'Food', name: 'Donut', svg: `<path fill-rule="evenodd" d="M10 50 A40 40 0 1 0 90 50 A40 40 0 1 0 10 50Z M38 50 A12 12 0 1 0 62 50 A12 12 0 1 0 38 50Z"/><path d="M28 30 L36 24 M62 22 L70 28 M76 54 L84 52 M22 62 L30 68 M60 78 L66 84" ${W} stroke-width="4"/>` },
  { id: 'ice-cream', category: 'Food', name: 'Ice cream', svg: `<path d="M30 52 L50 96 L70 52Z"/><path d="M40 62 L56 84 M52 58 L62 74" ${W} stroke-width="3"/><circle cx="50" cy="34" r="25" stroke="#fff" stroke-width="5"/><path d="M22 46 Q50 62 78 46" fill="none" stroke="#fff" stroke-width="4"/><ellipse cx="41" cy="24" rx="4" ry="7" fill="#fff"/>` },
  { id: 'coffee', category: 'Food', name: 'Coffee', svg: '<path d="M18 36 H72 V64 Q72 84 45 84 Q18 84 18 64Z"/><path d="M72 42 H80 Q92 42 92 54 Q92 66 72 64" fill="none" stroke="#000" stroke-width="6"/><path d="M34 28 Q28 20 34 12 M50 28 Q44 20 50 12" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/>' },

  { id: 'smile', category: 'Expressions', name: 'Smile', svg: face(`<circle cx="36" cy="42" r="5"/><circle cx="64" cy="42" r="5"/>${smile}`) },
  { id: 'cool', category: 'Expressions', name: 'Cool', svg: face(`<rect x="18" y="34" width="28" height="18" rx="5"/><rect x="54" y="34" width="28" height="18" rx="5"/><path d="M46 40 H54" stroke="#000" stroke-width="4"/>${smile}`) },
  { id: 'wow', category: 'Expressions', name: 'Wow', svg: face('<circle cx="36" cy="42" r="6"/><circle cx="64" cy="42" r="6"/><ellipse cx="50" cy="68" rx="9" ry="12"/>') },

  { id: 'banner', category: 'Decorative', name: 'Banner', svg: '<path d="M4 30 H22 V66 H4 L12 48Z M96 30 H78 V66 H96 L88 48Z"/><rect x="20" y="24" width="60" height="44"/><path d="M28 46 H72" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 5"/>' },
  { id: 'arrow', category: 'Decorative', name: 'Arrow', svg: '<path d="M8 40 H62 V18 L94 50 L62 82 V60 H8Z"/>' },
  { id: 'crown', category: 'Decorative', name: 'Crown', svg: '<path d="M12 78 L8 30 L32 52 L50 20 L68 52 L92 30 L88 78Z"/><path d="M12 88 H88" stroke="#000" stroke-width="8"/><circle cx="50" cy="62" r="5" fill="#fff"/><circle cx="28" cy="66" r="4" fill="#fff"/><circle cx="72" cy="66" r="4" fill="#fff"/>' },

  { id: 'snowflake', category: 'Seasonal', name: 'Snowflake', svg: '<g fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M50 8 V92 M14 29 L86 71 M14 71 L86 29"/><path d="M42 16 L50 24 L58 16 M42 84 L50 76 L58 84"/></g>' },
  { id: 'pumpkin', category: 'Seasonal', name: 'Pumpkin', svg: `<ellipse cx="50" cy="58" rx="40" ry="32"/><path d="M46 28 Q46 14 60 10" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/><path d="M36 46 L44 58 L28 58Z M64 46 L72 58 L56 58Z" fill="#fff"/><path d="M34 70 Q50 84 66 70" ${W} stroke-width="5"/>` },
  { id: 'leaf', category: 'Seasonal', name: 'Leaf', svg: `<path d="M12 88 Q8 30 50 12 Q92 10 88 50 Q80 88 12 88Z"/><path d="M14 86 Q44 56 70 34" ${W} stroke-width="4"/>` }
];

export const getSticker = (id: string) => STICKERS.find((s) => s.id === id) ?? STICKERS[0];

/** For canvas/print renderers: draw this as an Image. */
export const stickerDataUrl = (id: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${getSticker(id).svg}</svg>`);
