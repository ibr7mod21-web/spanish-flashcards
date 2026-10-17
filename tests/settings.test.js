// Run: node tests/settings.test.js
const assert = require('node:assert/strict');
const Settings = require('../settings.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// Minimal localStorage stand-in.
function fakeStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
// Storage that throws, like Safari private mode or a full quota.
const brokenStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
};

console.log('settings.js');

test('defaults when nothing is stored: sound on, auto-speak on', () => {
  assert.deepEqual(Settings.read(fakeStorage()), { sound: true, autoSpeak: true });
});

test('set() saves to storage and get() reads it back', () => {
  const st = fakeStorage();
  assert.equal(Settings.set(st, 'sound', false), true);
  assert.equal(Settings.get(st, 'sound'), false);
  assert.deepEqual(JSON.parse(st.data[Settings.KEY]), { sound: false, autoSpeak: true });
});

test('get() reads storage at call time (no startup cache)', () => {
  const st = fakeStorage();
  assert.equal(Settings.get(st, 'autoSpeak'), true);
  st.setItem(Settings.KEY, JSON.stringify({ sound: true, autoSpeak: false })); // changed behind its back
  assert.equal(Settings.get(st, 'autoSpeak'), false);
});

test('turning one setting off leaves the other alone', () => {
  const st = fakeStorage();
  Settings.set(st, 'autoSpeak', false);
  Settings.set(st, 'sound', false);
  Settings.set(st, 'autoSpeak', true);
  assert.deepEqual(Settings.read(st), { sound: false, autoSpeak: true });
});

test('old "haptics" key and unknown keys are dropped', () => {
  const st = fakeStorage({ [Settings.KEY]: JSON.stringify({ sound: false, haptics: true, extra: 1 }) });
  assert.deepEqual(Settings.read(st), { sound: false, autoSpeak: true });
  Settings.set(st, 'autoSpeak', false);
  assert.deepEqual(JSON.parse(st.data[Settings.KEY]), { sound: false, autoSpeak: false });
});

test('non-boolean values fall back to the default', () => {
  const st = fakeStorage({ [Settings.KEY]: JSON.stringify({ sound: 'no', autoSpeak: 0 }) });
  assert.deepEqual(Settings.read(st), { sound: true, autoSpeak: true });
});

test('corrupt JSON → defaults', () => {
  assert.deepEqual(Settings.read(fakeStorage({ [Settings.KEY]: '{not json' })), { sound: true, autoSpeak: true });
  assert.deepEqual(Settings.read(fakeStorage({ [Settings.KEY]: 'true' })), { sound: true, autoSpeak: true });
});

test('storage that throws → defaults, and set() reports failure', () => {
  assert.deepEqual(Settings.read(brokenStorage), { sound: true, autoSpeak: true });
  assert.equal(Settings.set(brokenStorage, 'sound', false), false);
  assert.deepEqual(Settings.read(null), { sound: true, autoSpeak: true });
});

test('unknown setting names are rejected', () => {
  assert.throws(() => Settings.get(fakeStorage(), 'haptics'));
  assert.throws(() => Settings.set(fakeStorage(), 'volume', 1));
});

test('set() stores a real boolean', () => {
  const st = fakeStorage();
  Settings.set(st, 'sound', 0);
  assert.equal(Settings.get(st, 'sound'), false);
  Settings.set(st, 'sound', 'yes');
  assert.equal(Settings.get(st, 'sound'), true);
});

test('last export date: none → null, then the saved ISO date', () => {
  const st = fakeStorage();
  assert.equal(Settings.getLastExport(st), null);
  Settings.setLastExport(st, Date.UTC(2026, 9, 18, 9, 30));
  assert.equal(Settings.getLastExport(st), '2026-10-18T09:30:00.000Z');
});

test('last export date: junk or broken storage → null', () => {
  assert.equal(Settings.getLastExport(fakeStorage({ [Settings.LAST_EXPORT_KEY]: 'yesterday-ish' })), null);
  assert.equal(Settings.getLastExport(brokenStorage), null);
  assert.equal(Settings.setLastExport(brokenStorage, Date.now()), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
