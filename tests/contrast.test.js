// Run: node tests/contrast.test.js
// Reads the colour tokens from styles.css (light :root and the dark-mode :root) and checks WCAG contrast.
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('\n}\n', darkStart));
const light = tokens(lightBlock);
const dark = Object.assign({}, light, tokens(darkBlock));
light['white'] = dark['white'] = '#ffffff';

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum] — 4.5 for body text, 3 for large/bold UI text and non-text marks.
const PAIRS = [
  ['white', 'grad-from', 4.5], ['white', 'grad-to', 4.5],
  ['text', 'bg', 4.5], ['text', 'surface', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5],
  ['correct', 'correct-bg', 4.5], ['close', 'close-bg', 4.5], ['wrong', 'wrong-bg', 4.5],
  ['text', 'correct-bg', 4.5], ['text', 'close-bg', 4.5], ['text', 'wrong-bg', 4.5],
  ['muted', 'correct-bg', 4.5], ['muted', 'close-bg', 4.5], ['muted', 'wrong-bg', 4.5],
  ['correct', 'surface', 4.5], ['close', 'surface', 4.5], ['wrong', 'surface', 4.5],
  ['correct', 'bg', 3], ['close', 'bg', 3], ['wrong', 'bg', 3], // input borders
];

let failed = 0;
for (const [mode, t] of [['light', light], ['dark', dark]]) {
  console.log(mode);
  for (const [fg, bg, min] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`  FAIL missing token --${fg} or --${bg}`); failed++; continue; }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${fg.padEnd(8)} on ${bg.padEnd(10)} ${r.toFixed(2).padStart(5)}:1 (min ${min})`);
  }
}
console.log(`\n${failed ? failed + ' failed' : 'all contrast checks passed'}`);
process.exit(failed ? 1 : 0);
