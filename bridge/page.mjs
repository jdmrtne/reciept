// The customer-facing result page for bridge mode: what a phone opens after scanning the ONE QR code (`/p/<id>`).
// Server-rendered, no JavaScript, same-origin images, so it works on any phone and survives a flaky connection.
// (Supabase mode serves the equivalent page from the booth app itself: src/digital/DigitalPhotoPage.tsx. Keep the copy in step.)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
*{box-sizing:border-box}html,body{margin:0}
body{background:#f5f5f5;color:#2b2b2b;font:16px/1.5 'Courier New',ui-monospace,monospace;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
main{max-width:560px;margin:0 auto;padding:20px 16px 40px;display:flex;flex-direction:column;gap:18px}
h1{margin:8px 0 0;text-align:center;letter-spacing:.14em;font-size:24px;color:#111}
h2{margin:0;text-align:center;letter-spacing:.14em;font-size:16px;color:#111}
.note,.hint{margin:0;text-align:center;color:#6b6b6b}.hint{font-size:13px}
.card{background:#fff;border:2.5px solid #111;border-radius:14px;box-shadow:3px 3px 0 #111;padding:14px;display:flex;flex-direction:column;gap:12px}
img{display:block;width:100%;height:auto;border-radius:8px;background:#f5f5f5}
a.btn{display:flex;align-items:center;justify-content:center;min-height:56px;padding:0 1.6em;border:2.5px solid #111;border-radius:255px 15px 225px 15px/15px 225px 15px 255px;background:#fff;color:#111;font-weight:700;letter-spacing:.1em;text-decoration:none;box-shadow:3px 3px 0 #111}
a.btn:active{transform:translate(3px,3px);box-shadow:none;background:#f5f5f5}
`;

const shell = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;

/** `ok`: at least one of color/gif is true. Links are relative (same origin: the share server). */
export function photoPageHtml(id, { color, gif }) {
  const card = (label, file, alt, dl, btn) => `<section class="card" aria-label="${esc(label)}"><h2>${esc(label.toUpperCase())}</h2>
<img src="/s/${esc(id)}/${file}" alt="${esc(alt)}"><a class="btn" href="/s/${esc(id)}/${file}?download=${dl}" download="${dl}">${btn}</a></section>`;
  return shell('Your photo', `<h1>YOUR PHOTO</h1>
${color ? card('Color photo', 'photo.jpg', 'Your color photo', 'photobooth.jpg', 'DOWNLOAD IMAGE') : '<p class="note">The color photo is not available.</p>'}
${gif ? card('Animated GIF', 'photo.gif', 'Your animated GIF', 'photobooth.gif', 'DOWNLOAD GIF') : '<p class="note">The animated GIF is not available.</p>'}
<p class="hint">Tip: if a download does not go to your gallery, press and hold the picture and choose Save.</p>`);
}

export const notFoundHtml = () => shell('Photo not found', '<h1>PHOTO NOT FOUND</h1><p class="note">This digital photo is no longer available.</p>');
export const errorHtml = () => shell('Could not load', '<h1>COULD NOT LOAD</h1><p class="note">Something went wrong while loading your photo. Please try again in a moment.</p>');
