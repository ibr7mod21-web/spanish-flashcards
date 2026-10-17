// Run: node tests/html.test.js
// Static checks on index.html and app.js: ids are unique, and every $('id') the app uses exists.
// (A duplicate id="weak" once made the Stats screen overwrite the Home "Weak words" button.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

console.log('index.html / app.js');

test('every id in index.html is unique', () => {
  const seen = new Set();
  const dupes = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(dupes, []);
});

test("every $('id') used in app.js exists in index.html", () => {
  const used = [...new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) => !ids.includes(id));
  assert.deepEqual(missing, []);
});

test('every screen has a header bar, and every non-home screen a way back', () => {
  const screens = [...html.matchAll(/<main id="([\w-]+)" class="screen"[\s\S]*?<\/main>/g)];
  assert.ok(screens.length >= 6);
  for (const [block, id] of screens) {
    assert.ok(block.includes('<header class="bar">'), `${id} has no header`);
    if (id !== 'home' && id !== 'done') assert.ok(/id="[\w-]*back"/.test(block), `${id} has no back button`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
