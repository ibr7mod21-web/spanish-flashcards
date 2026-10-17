// User settings, read from storage every time they are used (never cached at startup).
// Pure apart from the storage object passed in, so it is tested in Node with a fake storage.
// Works in the browser (window.Settings) and in Node (module.exports).
(function (root) {
  'use strict';

  const KEY = 'sf.settings.v1';
  const LAST_EXPORT_KEY = 'sf.lastExport.v1';
  const UPDATED_KEY = 'sf.settings.updatedAt'; // ms; lets cloud sync keep the newer settings
  const DEFAULTS = Object.freeze({ sound: true, autoSpeak: true });

  // Known keys with boolean values only; anything else (old "haptics", junk) falls back to defaults.
  function parse(raw) {
    const out = Object.assign({}, DEFAULTS);
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
    if (data && typeof data === 'object') {
      for (const k of Object.keys(DEFAULTS)) if (typeof data[k] === 'boolean') out[k] = data[k];
    }
    return out;
  }

  function read(storage) {
    try { return parse(storage ? storage.getItem(KEY) : null); } catch (e) { return Object.assign({}, DEFAULTS); }
  }

  function get(storage, key) {
    if (!(key in DEFAULTS)) throw new Error('Unknown setting: ' + key);
    return read(storage)[key];
  }

  // Returns true if saved.
  function set(storage, key, value, now) {
    if (!(key in DEFAULTS)) throw new Error('Unknown setting: ' + key);
    const s = read(storage);
    s[key] = !!value;
    try {
      storage.setItem(KEY, JSON.stringify(s));
      storage.setItem(UPDATED_KEY, String(now || Date.now()));
      return true;
    } catch (e) { return false; }
  }

  function getUpdatedAt(storage) {
    try { const n = Number(storage ? storage.getItem(UPDATED_KEY) : 0); return Number.isFinite(n) ? n : 0; } catch (e) { return 0; }
  }

  // Replace all settings at once (used when cloud sync brings newer settings).
  function replace(storage, values, updatedAt) {
    const s = parse(JSON.stringify(values || {}));
    try {
      storage.setItem(KEY, JSON.stringify(s));
      storage.setItem(UPDATED_KEY, String(updatedAt || 0));
      return true;
    } catch (e) { return false; }
  }

  function getLastExport(storage) {
    try {
      const v = storage ? storage.getItem(LAST_EXPORT_KEY) : null;
      return v && !isNaN(Date.parse(v)) ? v : null;
    } catch (e) { return null; }
  }

  function setLastExport(storage, date) {
    try { storage.setItem(LAST_EXPORT_KEY, new Date(date).toISOString()); return true; } catch (e) { return false; }
  }

  const api = { KEY, LAST_EXPORT_KEY, UPDATED_KEY, DEFAULTS, parse, read, get, set, getUpdatedAt, replace, getLastExport, setLastExport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Settings = api;
})(typeof self !== 'undefined' ? self : this);
