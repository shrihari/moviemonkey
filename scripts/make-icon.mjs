// Renders the app icon from src/assets/monkey.svg and regenerates every size
// Tauri needs (macOS .icns, Windows .ico, Linux/Store PNGs, iOS/Android).
//
//   npm run icon
//   node scripts/make-icon.mjs --preview out.png [--width 600] [--face none]
//
// --preview renders one PNG and leaves the app's icons alone. --width is the
// monkey's width on the 1024px canvas; --face is its face colour ("none" lets
// the tile's gold show through).
//
// The tile is a full-bleed golden squircle on Apple's macOS grid (824px shape
// on a 1024px canvas, with a soft drop shadow), so macOS shows it as-is
// instead of boxing it in a grey tile. Rendering uses headless Chrome.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COLORS = {
  top: '#FCCF35', // golden yellow, close to the UI accent (#FFCB3D)
  bottom: '#F5B819',
  face: 'none', // the monkey's face: "none" lets the tile's gold show through
};
let MONKEY_WIDTH = 660; // of the 1024px canvas (the tile itself is 824px)

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const preview = opt('--preview');
if (opt('--width')) MONKEY_WIDTH = Number(opt('--width'));
if (opt('--face')) COLORS.face = opt('--face');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
].find((p) => !p.startsWith('/') || existsSync(p));

const svg = readFileSync('src/assets/monkey.svg', 'utf8');
const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)[0];
// The face artwork without its yellow circle.
const face = svg
  .match(/<g id="Group-3-Copy-3"[\s\S]*?<\/g>\s*<\/g>\s*<\/g>\s*<\/g>\s*<\/g>/)[0]
  .replace(/(id="Path-4-Copy-2" fill=")[^"]*"/, `$1${COLORS.face}"`);

// Apple-style squircle: a superellipse (n = 5), 824px wide, centred in 1024.
const n = 5;
const half = 412;
const pts = [];
for (let i = 0; i < 720; i++) {
  const t = (2 * Math.PI * i) / 720;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = 512 + half * Math.sign(c) * Math.abs(c) ** (2 / n);
  const y = 512 + half * Math.sign(s) * Math.abs(s) ** (2 / n);
  pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
}
const squircle = `M${pts.join(' L')} Z`;

const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head>
<body><svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
${defs}
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${COLORS.top}"/><stop offset="1" stop-color="${COLORS.bottom}"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="38%" r="60%">
    <stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.28"/>
  </filter>
  <filter id="faceShadow" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#7a4a00" flood-opacity="0.22"/>
  </filter>
</defs>
<path d="${squircle}" fill="url(#bg)" filter="url(#shadow)"/>
<path d="${squircle}" fill="url(#glow)"/>
<path d="${squircle}" fill="none" stroke="#000" stroke-opacity="0.06" stroke-width="2"/>
<g id="m" filter="url(#faceShadow)">${face}</g>
</svg>
<script>
  // Centre the monkey at the requested width.
  const m = document.getElementById('m'), b = m.getBBox(), s = ${MONKEY_WIDTH} / b.width;
  m.setAttribute('transform', 'translate(' + (512 - (b.x + b.width / 2) * s) + ',' + (528 - (b.y + b.height / 2) * s) + ') scale(' + s + ')');
</script></body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'mm-icon-'));
const page = join(dir, 'icon.html');
writeFileSync(page, html);
const source = preview ?? 'src-tauri/icons/icon-source.png';
execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    '--window-size=1024,1024',
    '--virtual-time-budget=2000',
    `--screenshot=${source.startsWith('/') ? source : join(process.cwd(), source)}`,
    `file://${page}`,
  ],
  { stdio: 'ignore' },
);
console.log(`rendered ${source}`);
if (!preview) execFileSync('npx', ['tauri', 'icon', source], { stdio: 'inherit' });
