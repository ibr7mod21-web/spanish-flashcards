(function () {
  'use strict';

  const { grade, CORRECT, WRONG } = window.Grading;

  const PROGRESS_KEY = 'sf.progress.v1';
  const TIP_KEY = 'sf.tipShown';
  const INTERVALS = [0, 1, 2, 4, 8, 16]; // days, indexed by box
  const MAX_BOX = INTERVALS.length - 1;
  const SESSION_MAX = 20;
  const SESSION_NEW = 8;
  const DAY = 86400000;

  const $ = (id) => document.getElementById(id);

  // ---------- storage (all access wrapped in try/catch) ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  let deck = null;
  let cardIndex = {}; // id → { card, cat }
  let progress = readJSON(PROGRESS_KEY, {});
  if (!progress || typeof progress !== 'object') progress = {};

  function saveProgress() { writeJSON(PROGRESS_KEY, progress); }

  // ---------- scheduler ----------
  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function isDue(stats, now) { return stats && stats.due <= now; }

  function cardsIn(catId) {
    return catId
      ? deck.categories.filter((c) => c.id === catId)
      : deck.categories;
  }

  function counts(catId) {
    const now = Date.now();
    let due = 0, fresh = 0;
    for (const cat of cardsIn(catId)) {
      for (const card of cat.cards) {
        const s = progress[card.id];
        if (!s) fresh++;
        else if (isDue(s, now)) due++;
      }
    }
    return { due, fresh };
  }

  // Due cards (lowest box first) + up to 8 new cards, max 20 total.
  function buildQueue(catId) {
    const now = Date.now();
    const due = [];
    const fresh = [];
    for (const cat of cardsIn(catId)) {
      for (const card of cat.cards) {
        const s = progress[card.id];
        if (!s) fresh.push(card.id);
        else if (isDue(s, now)) due.push(card.id);
      }
    }
    due.sort((a, b) => progress[a].box - progress[b].box || progress[a].due - progress[b].due);
    const queue = due.slice(0, SESSION_MAX);
    const room = Math.min(SESSION_NEW, SESSION_MAX - queue.length);
    return queue.concat(fresh.slice(0, Math.max(0, room)));
  }

  function newStats() {
    return { box: 0, due: 0, seen: 0, correct: 0, close: 0, wrong: 0, lastWrongAnswers: [], lastSeen: 0, lastWrongAt: 0 };
  }

  function record(id, result, answer) {
    const s = Object.assign(newStats(), progress[id] || {});
    const now = Date.now();
    s.seen++;
    s.lastSeen = now;
    if (result === WRONG) {
      s.wrong++;
      s.box = 0;
      s.due = now;
      s.lastWrongAt = now;
      s.lastWrongAnswers = [answer.trim() || '—'].concat(s.lastWrongAnswers || []).slice(0, 3);
    } else {
      if (result === CORRECT) s.correct++; else s.close++;
      s.box = Math.min(MAX_BOX, s.box + 1);
      s.due = startOfToday() + INTERVALS[s.box] * DAY;
    }
    progress[id] = s;
    saveProgress();
  }

  // ---------- screens ----------
  const screens = ['home', 'card', 'done', 'stats'];
  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
    window.scrollTo(0, 0);
  }

  // ---------- home ----------
  function renderHome() {
    const list = $('cat-list');
    list.innerHTML = '';
    for (const cat of deck.categories) {
      const { due, fresh } = counts(cat.id);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat';
      btn.innerHTML =
        '<span class="cat-name"></span><span class="counts">' +
        (due ? `<span class="pill due">${due} due</span>` : '') +
        (fresh ? `<span class="pill">${fresh} new</span>` : '') +
        (!due && !fresh ? '<span class="pill">✓ done</span>' : '') +
        '</span>';
      btn.querySelector('.cat-name').textContent = cat.name;
      btn.addEventListener('click', () => startSession(cat.id));
      li.appendChild(btn);
      list.appendChild(li);
    }
    const all = counts(null);
    const reviewBtn = $('review-all');
    reviewBtn.textContent = all.due ? `Review all due (${all.due})` : 'Review all due';
    reviewBtn.disabled = all.due === 0;
    $('deck-note').textContent = all.due ? '' : 'Nothing due right now. Pick a category to learn new words.';
    show('home');
  }

  // ---------- session ----------
  let session = null;

  function startSession(catId) {
    let queue;
    if (catId === null) {
      // "Review all due": due cards only, lowest box first.
      const now = Date.now();
      queue = Object.keys(cardIndex)
        .filter((id) => isDue(progress[id], now))
        .sort((a, b) => progress[a].box - progress[b].box || progress[a].due - progress[b].due)
        .slice(0, SESSION_MAX);
    } else {
      queue = buildQueue(catId);
    }
    if (!queue.length) { renderHome(); return; }
    session = { queue, pos: 0, total: queue.length, tally: { correct: 0, close: 0, wrong: 0 }, answered: false };
    show('card');
    maybeShowTip();
    showCard();
  }

  function current() { return cardIndex[session.queue[session.pos]]; }

  function showCard() {
    const { card, cat } = current();
    session.answered = false;
    $('word').textContent = card.en;
    $('card-cat').textContent = cat.name;
    $('progress').textContent = `${Math.min(session.pos + 1, session.queue.length)} / ${session.queue.length}`;
    const input = $('answer');
    input.value = '';
    input.readOnly = false;
    input.className = '';
    $('action').textContent = 'Check';
    $('reveal').hidden = false;
    $('feedback').hidden = true;
    input.focus();
  }

  const VERDICT = { correct: 'Correct', close: 'Almost — check the accents', wrong: 'Not quite' };

  function check(reveal) {
    const { card, cat } = current();
    const input = $('answer');
    const answer = reveal ? '' : input.value;
    if (!reveal && !answer.trim()) { input.focus(); return; }

    const r = grade(answer, card, cat.id);
    record(card.id, r.result, answer);
    session.tally[r.result]++;
    session.answered = true;

    if (r.result === WRONG) {
      // Requeue 3–5 cards later in this session.
      const offset = 3 + Math.floor(Math.random() * 3);
      const at = Math.min(session.pos + 1 + offset, session.queue.length);
      session.queue.splice(at, 0, card.id);
    }

    input.readOnly = true;
    input.className = r.result;
    const fb = $('feedback');
    fb.className = 'feedback ' + r.result;
    $('verdict').textContent = reveal ? 'Answer' : VERDICT[r.result];
    $('expected').textContent = r.expected;
    const showYours = !reveal && r.result !== CORRECT;
    $('yours').textContent = showYours ? `You wrote: ${answer.trim()}` : '';
    $('hint').textContent = card.ar || '';
    fb.hidden = false;
    $('action').textContent = 'Next';
    $('reveal').hidden = true;
    $('progress').textContent = `${session.pos + 1} / ${session.queue.length}`;
    input.focus(); // keep the keyboard up so Enter → Next
  }

  function next() {
    session.pos++;
    if (session.pos >= session.queue.length) finishSession();
    else showCard();
  }

  function finishSession() {
    $('answer').blur();
    const t = session.tally;
    $('summary').innerHTML =
      `<div class="g"><b>${t.correct}</b>correct</div>` +
      `<div class="a"><b>${t.close}</b>close</div>` +
      `<div class="r"><b>${t.wrong}</b>missed</div>`;
    session = null;
    show('done');
  }

  // ---------- one-time voice tip ----------
  function maybeShowTip() {
    $('voice-tip').hidden = !!readJSON(TIP_KEY, false);
  }

  // ---------- stats ----------
  function renderStats() {
    const ids = Object.keys(cardIndex);
    const perBox = [0, 0, 0, 0, 0, 0];
    let unseen = 0, c = 0, cl = 0, w = 0;
    for (const id of ids) {
      const s = progress[id];
      if (!s) { unseen++; continue; }
      perBox[Math.min(MAX_BOX, s.box || 0)]++;
      c += s.correct || 0; cl += s.close || 0; w += s.wrong || 0;
    }
    const total = c + cl + w;
    $('accuracy').innerHTML = total
      ? `${Math.round(((c + cl) / total) * 100)}% <small>${c + cl} of ${total} answers (${cl} close)</small>`
      : '— <small>no answers yet</small>';

    const cols = [['New', unseen]].concat(perBox.map((n, i) => [`Box ${i}`, n]));
    const max = Math.max(1, ...cols.map((x) => x[1]));
    $('boxes').innerHTML = cols
      .map(([label, n]) =>
        `<div class="box"><span class="n">${n}</span><div class="bar-fill" style="height:${(n / max) * 80}%"></div><span class="lbl">${label.replace('Box ', '')}</span></div>`)
      .join('');

    const weak = ids
      .filter((id) => progress[id] && progress[id].wrong > 0)
      .sort((a, b) => (progress[b].lastWrongAt || 0) - (progress[a].lastWrongAt || 0))
      .slice(0, 15);
    const ol = $('weak');
    ol.innerHTML = '';
    if (!weak.length) {
      ol.innerHTML = '<li class="muted">No misses yet.</li>';
    }
    for (const id of weak) {
      const { card } = cardIndex[id];
      const s = progress[id];
      const li = document.createElement('li');
      const es = document.createElement('span');
      es.className = 'es';
      es.lang = 'es';
      es.textContent = card.es;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${card.en} · missed ${s.wrong}× · box ${s.box}` +
        (s.lastWrongAnswers && s.lastWrongAnswers.length ? ` · you wrote: ${s.lastWrongAnswers.join(', ')}` : '');
      li.append(es, meta);
      ol.appendChild(li);
    }

    $('export-box').hidden = true;
    $('import-box').hidden = true;
    show('stats');
  }

  // ---------- export / import ----------
  async function doExport() {
    const text = JSON.stringify({ exportedAt: new Date().toISOString(), deckVersion: deck.version, cards: progress }, null, 1);
    const box = $('export-text');
    box.value = text;
    $('export-box').hidden = false;
    $('import-box').hidden = true;

    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // Not awaited before share() so the share sheet still sees the tap.
        navigator.clipboard.writeText(text).then(() => { copied = true; setExportMsg(copied); }, () => {});
      }
    } catch (e) { /* ignore */ }
    setExportMsg(false);

    try {
      if (navigator.share) {
        await navigator.share({ title: 'Flashcards progress', text });
      }
    } catch (e) { /* user cancelled or not allowed: the text box is the fallback */ }
  }

  function setExportMsg(copied) {
    $('export-msg').textContent = copied
      ? 'Copied to clipboard. The same text is below.'
      : 'Select all of the text below and copy it, or use the share sheet.';
  }

  function doImport() {
    const msg = $('import-msg');
    msg.className = 'small';
    let data;
    try {
      data = JSON.parse($('import-text').value);
    } catch (e) {
      msg.textContent = 'That is not valid JSON. Paste the whole exported text.';
      msg.classList.add('err');
      return;
    }
    if (!data || typeof data.cards !== 'object' || data.cards === null) {
      msg.textContent = 'No "cards" found in that text.';
      msg.classList.add('err');
      return;
    }
    let n = 0;
    for (const [id, s] of Object.entries(data.cards)) {
      if (!s || typeof s !== 'object' || typeof s.box !== 'number') continue;
      progress[id] = Object.assign(newStats(), s);
      n++;
    }
    if (!writeJSON(PROGRESS_KEY, progress)) {
      msg.textContent = 'Could not save to this device’s storage.';
      msg.classList.add('err');
      return;
    }
    msg.textContent = `Restored progress for ${n} card${n === 1 ? '' : 's'}.`;
    msg.classList.add('ok');
    $('import-text').value = '';
  }

  // ---------- wiring ----------
  function wire() {
    $('review-all').addEventListener('click', () => startSession(null));
    $('to-stats').addEventListener('click', renderStats);
    $('stats-back').addEventListener('click', renderHome);
    $('card-back').addEventListener('click', () => { $('answer').blur(); session = null; renderHome(); });
    $('done-home').addEventListener('click', renderHome);

    $('answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!session) return;
      if (session.answered) next(); else check(false);
    });
    $('reveal').addEventListener('click', () => { if (session && !session.answered) check(true); });

    $('tip-close').addEventListener('click', () => {
      writeJSON(TIP_KEY, true);
      $('voice-tip').hidden = true;
      $('answer').focus();
    });

    $('export').addEventListener('click', doExport);
    $('export-text').addEventListener('focus', (e) => e.target.select());
    $('import-open').addEventListener('click', () => {
      $('import-box').hidden = false;
      $('export-box').hidden = true;
      $('import-msg').textContent = '';
    });
    $('import-go').addEventListener('click', doImport);
  }

  // ---------- boot ----------
  async function loadDeck() {
    // The service worker serves deck.json network-first with cache fallback.
    const res = await fetch('deck.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function boot() {
    wire();
    try {
      deck = await loadDeck();
    } catch (e) {
      document.body.innerHTML = '<main class="screen"><h1>Couldn’t load the deck</h1><p class="muted">Connect to the internet once and reopen the app.</p></main>';
      return;
    }
    cardIndex = {};
    for (const cat of deck.categories) {
      for (const card of cat.cards) cardIndex[card.id] = { card, cat };
    }
    renderHome();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  boot();
})();
