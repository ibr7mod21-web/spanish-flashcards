// Cloud sync with a private GitHub repo (contents API).
// - Pure part: merge rules, file format, base64, status text (tested in Node).
// - Client: createSync({...}) talks to GitHub through an injected fetch, so it is tested with a fake GitHub.
// The token lives only in localStorage under TOKEN_KEY. It is never written into the data file,
// the export, the status text or any log.
(function (root) {
  'use strict';

  const Sched = typeof module !== 'undefined' && module.exports ? require('./scheduler.js') : root.Scheduler;

  const REPO = 'ibr7mod21-web/tridioma-data';
  const FILE = 'progress.json';
  const API = 'https://api.github.com';
  const TOKEN_KEY = 'sf.sync.token';
  const STATE_KEY = 'sf.sync.state';

  // ---------- merge (pure) ----------

  function disputeKey(d) { return String((d && d.answer) || '').trim().toLowerCase(); }

  // Union of two disputed lists for one card: one entry per answer (case-insensitive), earliest date kept.
  function unionDisputed(a, b) {
    const byKey = new Map();
    for (const d of [].concat(a || [], b || [])) {
      if (!d || !disputeKey(d)) continue;
      const k = disputeKey(d);
      const prev = byKey.get(k);
      if (!prev || String(d.date) < String(prev.date)) byKey.set(k, { answer: String(d.answer).trim(), date: d.date });
    }
    return [...byKey.values()].sort((x, y) => (String(x.date) < String(y.date) ? -1 : 1));
  }

  // Per card: the record with the newer lastSeen wins (ties: local). Disputed answers: union.
  function mergeCards(local, remote) {
    const out = {};
    const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    for (const id of ids) {
      const l = local && local[id];
      const r = remote && remote[id];
      if (!l || !r) { out[id] = Object.assign({}, l || r); continue; }
      const winner = (r.lastSeen || 0) > (l.lastSeen || 0) ? r : l;
      const merged = Object.assign({}, winner);
      const disputed = unionDisputed(l.disputed, r.disputed);
      if (disputed.length) merged.disputed = disputed; else delete merged.disputed;
      out[id] = merged;
    }
    return out;
  }

  // Studied: union, earliest timestamp.
  function mergeStudied(local, remote) {
    const out = Object.assign({}, remote || {});
    for (const [id, t] of Object.entries(local || {})) out[id] = id in out ? Math.min(out[id], t) : t;
    return out;
  }

  function emptyData() { return { cards: {}, studied: {}, settings: null, settingsUpdatedAt: 0 }; }

  // local/remote: { cards, studied, settings, settingsUpdatedAt }. remote may be null (no file yet).
  function mergeData(local, remote) {
    const l = Object.assign(emptyData(), local || {});
    const r = Object.assign(emptyData(), remote || {});
    const useRemoteSettings = r.settings && (r.settingsUpdatedAt || 0) > (l.settingsUpdatedAt || 0);
    return {
      cards: mergeCards(l.cards, r.cards),
      studied: mergeStudied(l.studied, r.studied),
      settings: useRemoteSettings ? Object.assign({}, r.settings) : (l.settings ? Object.assign({}, l.settings) : r.settings),
      settingsUpdatedAt: useRemoteSettings ? r.settingsUpdatedAt : (l.settings ? l.settingsUpdatedAt || 0 : r.settingsUpdatedAt || 0),
    };
  }

  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
      return o;
    }
    return v;
  }

  // Same synced content? (ignores file metadata like updatedAt)
  function sameData(a, b) {
    const pick = (d) => { const x = Object.assign(emptyData(), d || {}); return { cards: x.cards, studied: x.studied, settings: x.settings, settingsUpdatedAt: x.settingsUpdatedAt }; };
    return JSON.stringify(canonical(pick(a))) === JSON.stringify(canonical(pick(b)));
  }

  // ---------- file format (pure) ----------

  // progress.json = the Export JSON plus settings. Built only from these fields: never the token.
  function buildFile(data, deckVersion, now) {
    const d = Object.assign(emptyData(), data);
    return {
      exportedAt: new Date(now).toISOString(),
      deckVersion,
      cards: d.cards,
      studied: d.studied,
      disputed: Sched.collectDisputed(d.cards),
      settings: d.settings,
      settingsUpdatedAt: d.settingsUpdatedAt || 0,
    };
  }

  function parseFile(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    return {
      cards: o.cards && typeof o.cards === 'object' ? o.cards : {},
      studied: o.studied && typeof o.studied === 'object' ? o.studied : {},
      settings: o.settings && typeof o.settings === 'object' ? o.settings : null,
      settingsUpdatedAt: Number(o.settingsUpdatedAt) || 0,
    };
  }

  // UTF-8 safe base64 (GitHub contents API).
  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- status text (pure) ----------

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }

  // state: { connected, syncing, lastSync, pending, offline, error }
  function statusText(state, now) {
    const s = state || {};
    if (!s.connected) return 'Not connected';
    if (s.syncing) return 'Syncing…';
    if (s.error) return 'Error: ' + s.error;
    if (s.offline) return 'Offline, will retry';
    if (s.pending) return 'Changes waiting to sync';
    if (s.lastSync) return 'Synced ' + ago(now - s.lastSync);
    return 'Connected, not synced yet';
  }

  // Messages never include the token or the response body.
  function httpError(status) {
    if (status === 401) return 'token not accepted (expired or deleted?)';
    if (status === 403) return 'token can’t read or write tridioma-data';
    if (status === 404) return 'tridioma-data not found for this token';
    return 'GitHub returned ' + status;
  }

  // ---------- client ----------

  // opts: { storage, fetchFn, getLocal(), setLocal(merged), deckVersion(), onChange(state), now() }
  function createSync(opts) {
    const storage = opts.storage;
    const now = opts.now || (() => Date.now());
    const fetchFn = opts.fetchFn;
    let running = null;
    let again = false;

    function readState() {
      try { return Object.assign({ lastSync: 0, pending: false }, JSON.parse(storage.getItem(STATE_KEY) || '{}')); } catch (e) { return { lastSync: 0, pending: false }; }
    }
    let state = Object.assign(readState(), { syncing: false, offline: false, error: '' });

    function token() { try { return storage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
    function publicState() { return Object.assign({}, state, { connected: !!token() }); }
    function update(patch) {
      Object.assign(state, patch);
      try { storage.setItem(STATE_KEY, JSON.stringify({ lastSync: state.lastSync, pending: state.pending })); } catch (e) { /* ignore */ }
      if (opts.onChange) opts.onChange(publicState());
    }

    function headers(tok) {
      return { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    }
    const fileUrl = `${API}/repos/${REPO}/contents/${FILE}`;

    async function pull(tok) {
      const res = await fetchFn(fileUrl, { headers: headers(tok), cache: 'no-store' });
      if (res.status === 404) return { data: null, sha: null };
      if (!res.ok) throw Object.assign(new Error(httpError(res.status)), { http: res.status });
      const body = await res.json();
      return { data: parseFile(JSON.parse(b64decode(body.content))), sha: body.sha };
    }

    async function push(tok, data, sha) {
      const body = {
        message: 'Sync progress ' + new Date(now()).toISOString(),
        content: b64encode(JSON.stringify(buildFile(data, opts.deckVersion ? opts.deckVersion() : null, now()), null, 1)),
      };
      if (sha) body.sha = sha;
      return fetchFn(fileUrl, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers(tok)), body: JSON.stringify(body) });
    }

    async function runOnce() {
      const tok = token();
      if (!tok) { update({ syncing: false }); return publicState(); }
      update({ syncing: true, error: '', offline: false });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const remote = await pull(tok);
          const merged = mergeData(opts.getLocal(), remote.data);
          opts.setLocal(merged);
          if (remote.data && sameData(merged, remote.data)) break; // nothing new to send
          const res = await push(tok, merged, remote.sha);
          if (res.ok) break;
          // 409: someone else wrote since our pull (sha mismatch). 422: file appeared without our sha.
          if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
          throw Object.assign(new Error(res.status === 409 || res.status === 422 ? 'another device saved at the same time; will retry' : httpError(res.status)), { http: res.status });
        }
        update({ syncing: false, pending: false, lastSync: now(), offline: false, error: '' });
      } catch (e) {
        if (e && e.http) update({ syncing: false, pending: true, error: e.message });
        else update({ syncing: false, pending: true, offline: true }); // network failure: try again later
      }
      return publicState();
    }

    // Never throws; overlapping calls are coalesced into one more run.
    function sync() {
      if (running) { again = true; return running; }
      running = (async () => {
        let result;
        do { again = false; result = await runOnce(); } while (again);
        running = null;
        return result;
      })();
      return running;
    }

    function markPending() { update({ pending: true }); }

    // Check the token can see the repo before saving it.
    async function connect(tok) {
      tok = String(tok || '').trim();
      if (!tok) return { ok: false, message: 'Paste your token first.' };
      let res;
      try {
        res = await fetchFn(`${API}/repos/${REPO}`, { headers: headers(tok), cache: 'no-store' });
      } catch (e) {
        return { ok: false, message: 'No connection. Try again when you’re online.' };
      }
      if (!res.ok) return { ok: false, message: 'Error: ' + httpError(res.status) };
      try { storage.setItem(TOKEN_KEY, tok); } catch (e) { return { ok: false, message: 'Couldn’t save the token on this device.' }; }
      update({ error: '', offline: false, pending: true });
      return { ok: true, message: 'Connected' };
    }

    function disconnect() {
      try { storage.removeItem(TOKEN_KEY); storage.removeItem(STATE_KEY); } catch (e) { /* ignore */ }
      state = { lastSync: 0, pending: false, syncing: false, offline: false, error: '' };
      if (opts.onChange) opts.onChange(publicState());
    }

    return { sync, markPending, connect, disconnect, state: publicState, isConnected: () => !!token() };
  }

  const api = {
    REPO, FILE, TOKEN_KEY, STATE_KEY,
    unionDisputed, mergeCards, mergeStudied, mergeData, sameData, buildFile, parseFile,
    b64encode, b64decode, statusText, createSync,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sync = api;
})(typeof self !== 'undefined' ? self : this);
