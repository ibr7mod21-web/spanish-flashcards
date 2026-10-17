// Run: node tests/sync.test.js
const assert = require('node:assert/strict');
const Sync = require('../sync.js');

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const T1 = '2026-10-17T09:00:00.000Z';
const T2 = '2026-10-18T09:00:00.000Z';
const card = (lastSeen, box, extra) => Object.assign({ box, due: 0, seen: 1, correct: 0, close: 0, wrong: 0, lastSeen }, extra || {});
const TOKEN = 'github_pat_TEST_ONLY_not_a_real_token_1234567890';

// ---------- merge ----------

test('newer lastSeen wins per card', () => {
  const m = Sync.mergeCards({ a: card(200, 3), b: card(100, 1) }, { a: card(100, 1), b: card(300, 4) });
  assert.equal(m.a.box, 3);
  assert.equal(m.b.box, 4);
});

test('tie on lastSeen keeps the local record', () => {
  const m = Sync.mergeCards({ a: card(100, 2) }, { a: card(100, 5) });
  assert.equal(m.a.box, 2);
});

test('cards on only one side are kept', () => {
  const m = Sync.mergeCards({ a: card(1, 1) }, { b: card(2, 2) });
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b']);
});

test('disputed answers: union, no duplicates, earliest date kept', () => {
  const l = card(300, 2, { disputed: [{ answer: 'colorada', date: T2 }, { answer: 'roja', date: T2 }] });
  const r = card(100, 1, { disputed: [{ answer: 'Colorada ', date: T1 }, { answer: 'bermejo', date: T1 }] });
  const m = Sync.mergeCards({ a: l }, { a: r });
  assert.equal(m.a.box, 2); // newer record still wins…
  assert.deepEqual(m.a.disputed, [ // …but keeps the other side's disputes
    { answer: 'Colorada', date: T1 }, { answer: 'bermejo', date: T1 }, { answer: 'roja', date: T2 },
  ]);
});

test('empty remote (no file yet) → local data unchanged', () => {
  const local = { cards: { a: card(5, 2) }, studied: { a: 1 }, settings: { sound: false, autoSpeak: true }, settingsUpdatedAt: 10 };
  assert.deepEqual(Sync.mergeData(local, null), local);
  assert.ok(Sync.sameData(Sync.mergeData(local, null), local));
});

test('empty local (fresh install) → takes everything from remote', () => {
  const remote = { cards: { a: card(5, 4) }, studied: { a: 7 }, settings: { sound: false, autoSpeak: false }, settingsUpdatedAt: 50 };
  const m = Sync.mergeData({ cards: {}, studied: {}, settings: { sound: true, autoSpeak: true }, settingsUpdatedAt: 0 }, remote);
  assert.deepEqual(m.cards, remote.cards);
  assert.deepEqual(m.studied, remote.studied);
  assert.deepEqual(m.settings, remote.settings); // never-changed local settings lose to synced ones
});

test('settings: the newer change wins', () => {
  const a = { settings: { sound: false, autoSpeak: true }, settingsUpdatedAt: 200 };
  const b = { settings: { sound: true, autoSpeak: false }, settingsUpdatedAt: 100 };
  assert.deepEqual(Sync.mergeData(a, b).settings, a.settings);
  assert.deepEqual(Sync.mergeData(b, a).settings, a.settings);
});

test('studied: union, earliest time', () => {
  assert.deepEqual(Sync.mergeStudied({ a: 5, b: 9 }, { a: 3, c: 1 }), { a: 3, b: 9, c: 1 });
});

test('merge is order-independent for content (except ties)', () => {
  const x = { cards: { a: card(1, 1), b: card(9, 3) }, studied: { a: 1 } };
  const y = { cards: { a: card(5, 2), c: card(2, 1) }, studied: { c: 4 } };
  assert.ok(Sync.sameData(Sync.mergeData(x, y), Sync.mergeData(y, x)));
});

// ---------- file format ----------

test('base64 round-trips accents and Arabic', () => {
  const s = JSON.stringify({ es: 'miércoles ñ ¿?', ar: 'الأربعاء' });
  assert.equal(Sync.b64decode(Sync.b64encode(s)), s);
});

test('progress.json = export fields + settings, with a disputed list', () => {
  const f = Sync.buildFile({ cards: { 'col-01': card(1, 1, { disputed: [{ answer: 'colorada', date: T1 }] }) }, studied: {}, settings: { sound: true, autoSpeak: false }, settingsUpdatedAt: 5 }, 4, Date.parse(T2));
  assert.deepEqual(Object.keys(f).sort(), ['cards', 'deckVersion', 'disputed', 'exportedAt', 'settings', 'settingsUpdatedAt', 'studied']);
  assert.deepEqual(f.disputed, [{ cardId: 'col-01', answer: 'colorada', date: T1 }]);
  assert.deepEqual(Sync.parseFile(f).settings, { sound: true, autoSpeak: false });
});

// ---------- status text ----------

test('status text', () => {
  const now = Date.parse(T2);
  assert.equal(Sync.statusText({ connected: false }, now), 'Not connected');
  assert.equal(Sync.statusText({ connected: true, lastSync: now - 120000 }, now), 'Synced 2 min ago');
  assert.equal(Sync.statusText({ connected: true, offline: true, pending: true }, now), 'Offline, will retry');
  assert.equal(Sync.statusText({ connected: true, error: 'token not accepted (expired or deleted?)' }, now), 'Error: token not accepted (expired or deleted?)');
  assert.equal(Sync.statusText({ connected: true, syncing: true }, now), 'Syncing…');
});

// ---------- client against a fake GitHub ----------

function fakeStorage() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

// A tiny in-memory GitHub contents API. hooks.beforePut can simulate another device writing first.
function fakeGitHub({ file = null, offline = false, status = null, hooks = {} } = {}) {
  const gh = { file, sha: file ? 'sha0' : null, n: 0, puts: 0, requests: [] };
  gh.fetch = async (url, init = {}) => {
    gh.requests.push({ url, init });
    if (gh.offline || offline) throw new TypeError('Failed to fetch');
    const reply = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body });
    if (status) return reply(status, {});
    if (url.endsWith('/repos/' + Sync.REPO)) return reply(200, { private: true });
    if (!init.method) return gh.file ? reply(200, { sha: gh.sha, content: Sync.b64encode(JSON.stringify(gh.file)) }) : reply(404, {});
    if (init.method === 'PUT') {
      if (hooks.beforePut) hooks.beforePut(gh);
      const body = JSON.parse(init.body);
      if ((body.sha || null) !== gh.sha) return reply(gh.sha ? 409 : 422, {});
      gh.file = JSON.parse(Sync.b64decode(body.content));
      gh.sha = 'sha' + ++gh.n;
      gh.puts++;
      return reply(gh.file ? 200 : 201, { content: { sha: gh.sha } });
    }
    return reply(400, {});
  };
  return gh;
}

function client(gh, local, storage = fakeStorage()) {
  const box = { local, states: [] };
  const sync = Sync.createSync({
    storage, fetchFn: gh.fetch, now: () => Date.parse(T2), deckVersion: () => 4,
    getLocal: () => box.local, setLocal: (m) => { box.local = m; }, onChange: (s) => box.states.push(s),
  });
  return { sync, box, storage };
}

test('connect: checks the token, then stores it only in storage', async () => {
  const gh = fakeGitHub();
  const { sync, storage } = client(gh, { cards: {} });
  assert.equal((await sync.connect('')).ok, false);
  const r = await sync.connect(TOKEN);
  assert.equal(r.ok, true);
  assert.equal(storage.getItem(Sync.TOKEN_KEY), TOKEN);
  assert.equal(gh.requests[0].init.headers.Authorization, 'Bearer ' + TOKEN);
});

test('connect with a bad token: not stored, message has no token', async () => {
  const gh = fakeGitHub({ status: 401 });
  const { sync, storage } = client(gh, { cards: {} });
  const r = await sync.connect(TOKEN);
  assert.equal(r.ok, false);
  assert.equal(storage.getItem(Sync.TOKEN_KEY), null);
  assert.ok(!r.message.includes(TOKEN));
  assert.match(r.message, /^Error: token not accepted/);
});

test('first sync with no file yet: creates progress.json from local data', async () => {
  const gh = fakeGitHub();
  const { sync } = client(gh, { cards: { a: card(5, 2) }, studied: {}, settings: { sound: true, autoSpeak: true }, settingsUpdatedAt: 0 });
  await sync.connect(TOKEN);
  const s = await sync.sync();
  assert.equal(gh.puts, 1);
  assert.equal(gh.file.cards.a.box, 2);
  assert.equal(s.pending, false);
  assert.equal(s.lastSync, Date.parse(T2));
});

test('pull + merge: newer remote cards arrive locally, local news is pushed', async () => {
  const gh = fakeGitHub({ file: Sync.buildFile({ cards: { a: card(900, 5), b: card(1, 1) } }, 4, 0) });
  const { sync, box } = client(gh, { cards: { a: card(100, 1), b: card(500, 3) } });
  await sync.connect(TOKEN);
  await sync.sync();
  assert.equal(box.local.cards.a.box, 5); // from remote
  assert.equal(gh.file.cards.b.box, 3); // from local
});

test('nothing changed → no write', async () => {
  const data = { cards: { a: card(5, 2) }, studied: {}, settings: { sound: true, autoSpeak: true }, settingsUpdatedAt: 3 };
  const gh = fakeGitHub({ file: Sync.buildFile(data, 4, 0) });
  const { sync } = client(gh, JSON.parse(JSON.stringify(data)));
  await sync.connect(TOKEN);
  await sync.sync();
  assert.equal(gh.puts, 0);
});

test('409 conflict: re-pull, merge and retry once — nobody loses data', async () => {
  let first = true;
  const gh = fakeGitHub({
    file: Sync.buildFile({ cards: { a: card(1, 1) } }, 4, 0),
    hooks: {
      beforePut(g) { // another device saves card c between our pull and our push
        if (!first) return;
        first = false;
        g.file = Sync.buildFile({ cards: { a: card(1, 1), c: card(700, 4) } }, 4, 0);
        g.sha = 'other-device';
      },
    },
  });
  const { sync, box } = client(gh, { cards: { b: card(600, 2) } });
  await sync.connect(TOKEN);
  const s = await sync.sync();
  assert.equal(s.error, '');
  assert.deepEqual(Object.keys(gh.file.cards).sort(), ['a', 'b', 'c']);
  assert.ok(box.local.cards.c);
  assert.equal(gh.puts, 1);
});

test('conflict twice in a row: stops, keeps changes pending', async () => {
  const gh = fakeGitHub({ file: Sync.buildFile({ cards: {} }, 4, 0), hooks: { beforePut(g) { g.sha = 'moved-' + Math.random(); } } });
  const { sync } = client(gh, { cards: { b: card(600, 2) } });
  await sync.connect(TOKEN);
  const s = await sync.sync();
  assert.equal(s.pending, true);
  assert.match(Sync.statusText(s, 0), /^Error: another device saved/);
});

test('offline: marks pending and says it will retry; never throws', async () => {
  const gh = fakeGitHub();
  const { sync } = client(gh, { cards: { a: card(5, 2) } });
  await sync.connect(TOKEN);
  gh.offline = true;
  const s = await sync.sync();
  assert.equal(s.pending, true);
  assert.equal(s.offline, true);
  assert.equal(Sync.statusText(s, 0), 'Offline, will retry');
  gh.offline = false; // back online: the next sync sends it
  const s2 = await sync.sync();
  assert.equal(s2.pending, false);
  assert.equal(gh.puts, 1);
});

test('expired token: error status, pending kept, no token in the message', async () => {
  const gh = fakeGitHub();
  const { sync, storage } = client(gh, { cards: { a: card(5, 2) } });
  await sync.connect(TOKEN);
  gh.fetch = fakeGitHub({ status: 401 }).fetch;
  const { sync: s2 } = client(gh, { cards: {} }, storage);
  const st = await s2.sync();
  assert.equal(st.pending, true);
  assert.ok(!Sync.statusText(st, 0).includes(TOKEN));
});

test('not connected: sync does nothing and makes no requests', async () => {
  const gh = fakeGitHub();
  const { sync } = client(gh, { cards: {} });
  const s = await sync.sync();
  assert.equal(s.connected, false);
  assert.equal(gh.requests.length, 0);
});

test('disconnect deletes the token and sync state', async () => {
  const gh = fakeGitHub();
  const { sync, storage } = client(gh, { cards: { a: card(1, 1) } });
  await sync.connect(TOKEN);
  await sync.sync();
  sync.disconnect();
  assert.equal(storage.getItem(Sync.TOKEN_KEY), null);
  assert.equal(storage.getItem(Sync.STATE_KEY), null);
  assert.equal(sync.isConnected(), false);
});

test('the token never appears in progress.json or in the sync state', async () => {
  const gh = fakeGitHub();
  const { sync, storage } = client(gh, { cards: { a: card(5, 2) }, settings: { sound: true, autoSpeak: true } });
  await sync.connect(TOKEN);
  await sync.sync();
  assert.ok(!JSON.stringify(gh.file).includes(TOKEN));
  assert.ok(!gh.requests.some((r) => String(r.init.body || '').includes(TOKEN)));
  assert.ok(!String(storage.getItem(Sync.STATE_KEY)).includes(TOKEN));
});

test('overlapping sync calls are coalesced (one at a time)', async () => {
  const gh = fakeGitHub();
  const { sync } = client(gh, { cards: { a: card(5, 2) } });
  await sync.connect(TOKEN);
  await Promise.all([sync.sync(), sync.sync(), sync.sync()]);
  assert.equal(gh.puts, 1);
});

(async () => {
  console.log('sync.js');
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
