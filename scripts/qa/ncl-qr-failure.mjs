// Reproduces the QR placement arithmetic of src/qr/placement.ts with the REAL share URL forms (no vitest, no app code).
// Run: NODE_PATH=<dir with node_modules/qrcode-generator> node scripts/qa/ncl-qr-failure.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');
const BASE = 'https://reciept-beta.vercel.app';
const ids = { 'supabase YYYYMMDD-HHMMSS-<20hex>': '20261024-103045-a8f32c0d19e4b7a65f10', '32-hex newShareId': 'a8f32c0d19e4b7a65f10c3d29b7e4a61' };
const QUIET = 4, MARGIN = 3, MIN_DPM = 2, W = 384;
const mods = (text, ec) => { const q = qrcode(0, ec); q.addData(text, 'Byte'); q.make(); return q.getModuleCount(); };
const minSide = (m, paperDots, dpm = MIN_DPM) => Math.ceil(((m + 2 * QUIET) * dpm * W) / paperDots);
const lay = JSON.parse(fs.readFileSync(new URL('../../design-src/ncl-boarding-pass/layout-data.json', import.meta.url)));
console.log('URL / length / modules(M) / modules(L)');
const rows = [];
for (const [label, id] of Object.entries(ids)) {
  const url = `${BASE}/p/${id}`; const m = mods(url, 'M'), l = mods(url, 'L'); rows.push({ label, m, l });
  console.log(`${label}: ${url.length} chars, M=${m}, L=${l}`);
}
console.log('\nminSide units (needs safe-area min side >= minSide + 2*margin(3))');
console.log('modules ec  | 58mm(384) min,need | 80mm(576) min,need | 58mm @3dpm min,need');
for (const [mm, ec] of [[37, 'M'], [41, 'M'], [33, 'L'], [37, 'L']]) {
  const f = (d, dpm) => { const s = minSide(mm, d, dpm); return `${s},${s + 2 * MARGIN}`; };
  console.log(`${String(mm).padStart(3)} ${ec}      | ${f(384, 2).padEnd(18)} | ${f(576, 2).padEnd(18)} | ${f(384, 3)}`);
}
console.log('\nsafe area per pass (units @384, paper space): min side, verdict for each real URL form');
for (const [k, v] of Object.entries(lay)) {
  const [, , w, h] = v.qrSafeAreaUnits, side = Math.min(w, h);
  const verdict = (m, d) => (side >= minSide(m, d) + 2 * MARGIN ? 'OK  ' : 'FAIL');
  const line = rows.map((r) => `${r.label.split(' ')[0]} M=${r.m}: 58mm ${verdict(r.m, 384)} 80mm ${verdict(r.m, 576)}`).join(' | ');
  console.log(`${k}: safe ${w} x ${h}, min side ${side}  ->  ${line}`);
}
console.log('\nreference QR picture side (units): ' + Object.entries(lay).map(([k, v]) => `${k} ${((v.refQr[2] - v.refQr[0]) * 384 / 812).toFixed(1)}x${((v.refQr[3] - v.refQr[1]) * 384 / 812).toFixed(1)}`).join(', '));
console.log('modules the reference QR could hold at 2 dots/module on 58mm incl 8 quiet: ' + Math.floor(68 / 2 - 8));
