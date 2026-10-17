(function () {
  'use strict';

  const { grade, CORRECT, WRONG } = window.Grading;
  const S = window.Scheduler;
  const FX = window.Feedback;

  const PROGRESS_KEY = 'sf.progress.v1';
  const STUDIED_KEY = 'sf.studied.v1';
  const SETTINGS_KEY = 'sf.settings.v1';
  const CUSTOM_KEY = 'sf.custom.v1';
  const TIP_KEY = 'sf.tipShown';

  const $ = (id) => document.getElementById(id);
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ---------- storage (all access wrapped in try/catch) ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const v = raw ? JSON.parse(raw) : fallback;
      // Keep the stored value only if it has the same kind as the fallback (object vs boolean).
      if (v === null || typeof v !== typeof fallback) return fallback;
      return v;
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
  let studied = readJSON(STUDIED_KEY, {}); // id → timestamp first flipped in study mode
  const settings = Object.assign({ sound: true, haptics: true, autoSpeak: true }, readJSON(SETTINGS_KEY, {}));

  function saveProgress() { writeJSON(PROGRESS_KEY, progress); }

  function cardsIn(catId) {
    return catId ? deck.categories.filter((c) => c.id === catId) : deck.categories;
  }

  function counts(catId) {
    const now = Date.now();
    let due = 0, fresh = 0;
    for (const cat of cardsIn(catId)) {
      for (const card of cat.cards) {
        const s = progress[card.id];
        if (!s) fresh++;
        else if (S.isDue(s, now)) due++;
      }
    }
    return { due, fresh };
  }

  // ---------- feedback helpers ----------
  function feedback(kind) {
    if (settings.sound) FX.play(kind);
    if (settings.haptics) FX.haptic(kind);
  }
  function say(text) { FX.speak(text); }

  // Restart a CSS animation class on an element.
  function animate(el, cls) {
    if (reducedMotion.matches) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function flash(kind) {
    const el = $('flash');
    el.className = '';
    animate(el, 'flash-' + kind);
  }

  // ---------- screens ----------
  const screens = ['home', 'card', 'study', 'done', 'stats', 'custom'];
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
      li.className = 'cat';
      li.innerHTML =
        '<div class="cat-top"><span class="cat-name"></span><span class="counts">' +
        (due ? `<span class="pill due">${due} due</span>` : '') +
        (fresh ? `<span class="pill">${fresh} new</span>` : '') +
        (!due && !fresh ? '<span class="pill">✓ done</span>' : '') +
        '</span></div>' +
        '<div class="cat-actions">' +
        '<button type="button" class="secondary" data-act="study">Study</button>' +
        '<button type="button" class="primary" data-act="quiz">Quiz</button>' +
        '</div>';
      li.querySelector('.cat-name').textContent = cat.name;
      li.querySelector('[data-act="study"]').addEventListener('click', () => startStudy(cat.id));
      const quiz = li.querySelector('[data-act="quiz"]');
      quiz.disabled = !due && !fresh;
      quiz.addEventListener('click', () => startSession(cat.id));
      list.appendChild(li);
    }
    const all = counts(null);
    const reviewBtn = $('review-all');
    reviewBtn.textContent = all.due ? `Review all due (${all.due})` : 'Review all due';
    reviewBtn.disabled = all.due === 0;
    $('deck-note').textContent = all.due ? '' : 'Nothing due right now. Study or quiz a category to learn new words.';

    const weak = S.weakQueue(deck.categories, progress, Infinity).length;
    $('weak').disabled = weak === 0;
    $('weak-count').textContent = String(weak);
    $('weak-count').hidden = weak === 0;
    $('weak-sub').textContent = weak ? (weak > S.WEAK_MAX ? `Top ${S.WEAK_MAX} recent misses` : 'Recent misses first') : 'No weak words yet';
    show('home');
  }

  // ---------- quiz session ----------
  let session = null;

  // catId null = "Review all due". practiceIds: quiz these cards without changing progress.
  function startSession(catId, practiceIds) {
    const now = Date.now();
    let queue;
    if (practiceIds) queue = practiceIds.slice(0, S.SESSION_MAX);
    else if (catId === null) queue = S.reviewAllQueue(deck.categories, progress, now);
    else queue = S.buildQueue(cardsIn(catId), progress, studied, now);
    startQueue(queue, { practice: !!practiceIds });
  }

  // Run a quiz over these card ids. practice: don't change progress.
  function startQueue(queue, { practice = false } = {}) {
    if (!queue.length) { renderHome(); return; }
    session = { queue, pos: 0, practice, tally: { correct: 0, close: 0, wrong: 0 }, answered: false };
    show('card');
    maybeShowTip();
    showCard();
  }

  // ---------- custom quiz ----------
  const custom = Object.assign({ cats: null, count: 20 }, readJSON(CUSTOM_KEY, {}));

  function renderCustom() {
    const valid = new Set(deck.categories.map((c) => c.id));
    // First visit: everything selected. Later: last selection (minus categories that no longer exist).
    const selected = new Set((custom.cats || [...valid]).filter((id) => valid.has(id)));
    const ul = $('custom-cats');
    ul.innerHTML = '';
    for (const cat of deck.categories) {
      const li = document.createElement('li');
      li.innerHTML = '<label class="check"><input type="checkbox"><span class="check-name"></span><span class="muted small"></span></label>';
      const box = li.querySelector('input');
      box.value = cat.id;
      box.checked = selected.has(cat.id);
      box.addEventListener('change', saveCustom);
      li.querySelector('.check-name').textContent = cat.name;
      li.querySelector('.muted').textContent = `${cat.cards.length} cards`;
      ul.appendChild(li);
    }
    for (const r of document.querySelectorAll('input[name="custom-count"]')) r.checked = r.value === String(custom.count);
    updateCustomStart();
    show('custom');
  }

  function customSelection() {
    return [...document.querySelectorAll('#custom-cats input:checked')].map((b) => b.value);
  }

  function saveCustom() {
    custom.cats = customSelection();
    const r = document.querySelector('input[name="custom-count"]:checked');
    custom.count = !r || r.value === 'all' ? 'all' : Number(r.value);
    writeJSON(CUSTOM_KEY, custom);
    updateCustomStart();
  }

  function updateCustomStart() {
    const ids = customSelection();
    const available = deck.categories.filter((c) => ids.includes(c.id)).reduce((n, c) => n + c.cards.length, 0);
    const n = custom.count === 'all' ? available : Math.min(custom.count, available);
    const btn = $('custom-start');
    btn.disabled = n === 0;
    btn.textContent = n ? `Start · ${n} card${n === 1 ? '' : 's'}` : 'Pick at least one category';
  }

  function startCustom() {
    const ids = customSelection();
    startQueue(S.customQueue(deck.categories.filter((c) => ids.includes(c.id)), custom.count));
  }

  function current() { return cardIndex[session.queue[session.pos]]; }

  function updateProgress() {
    const done = session.pos + (session.answered ? 1 : 0);
    $('progress').textContent = `${Math.min(session.pos + 1, session.queue.length)} / ${session.queue.length}`;
    $('progress-fill').style.width = `${(done / session.queue.length) * 100}%`;
  }

  function showCard() {
    const { card, cat } = current();
    session.answered = false;
    $('word').textContent = card.en;
    $('card-cat').textContent = session.practice ? `${cat.name} · practice` : cat.name;
    const input = $('answer');
    input.value = '';
    input.readOnly = false;
    input.className = '';
    $('action').textContent = 'Check';
    $('reveal').hidden = false;
    $('feedback').hidden = true;
    updateProgress();
    animate($('prompt'), 'slide-in');
    input.focus();
  }

  const VERDICT = { correct: 'Correct', close: 'Almost — check the accents', wrong: 'Not quite' };

  function check(reveal) {
    const { card, cat } = current();
    const input = $('answer');
    const answer = reveal ? '' : input.value;
    if (!reveal && !answer.trim()) { input.focus(); return; }

    const r = grade(answer, card, cat.id);
    // Feedback first, while we are still inside the tap/keypress (iOS needs the user gesture).
    // No auto-speak in the quiz: the 🔊 button replays on demand.
    feedback(r.result);

    if (!session.practice) {
      progress[card.id] = S.applyResult(progress[card.id], r.result, answer, Date.now());
      saveProgress();
    }
    session.tally[r.result]++;
    session.answered = true;

    if (r.result === WRONG) {
      session.queue.splice(S.requeueIndex(session.pos, session.queue.length), 0, card.id);
    }

    input.readOnly = true;
    input.className = r.result;
    if (r.result === WRONG && !reveal) animate(input, 'shake');
    flash(r.result);
    const fb = $('feedback');
    fb.className = 'feedback ' + r.result;
    $('verdict').textContent = reveal ? 'Answer' : VERDICT[r.result];
    $('expected').textContent = r.expected;
    const showYours = !reveal && r.result !== CORRECT;
    $('yours').textContent = showYours ? `You wrote: ${answer.trim()}` : '';
    $('hint').textContent = card.ar || '';
    fb.hidden = false;
    animate(fb, 'pop-in');
    $('action').textContent = 'Next';
    $('reveal').hidden = true;
    updateProgress();
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
    $('done-note').textContent = session.practice ? 'Practice round: your schedule was not changed.' : '';
    session = null;
    show('done');
    animate($('summary'), 'pop-in');
    feedback('fanfare');
  }

  // ---------- study mode ----------
  let study = null;

  function startStudy(catId) {
    const cat = cardsIn(catId)[0];
    study = { catId, order: cat.cards.map((c) => c.id), pos: 0, flipped: false, shuffled: false };
    $('shuffle').setAttribute('aria-pressed', 'false');
    $('study-cat').textContent = cat.name;
    show('study');
    showStudyCard(0);
  }

  function showStudyCard(dir) {
    const { card } = cardIndex[study.order[study.pos]];
    study.flipped = false;
    $('study-deck').hidden = false;
    $('study-end').hidden = true;
    $('flip').classList.remove('flipped');
    $('study-en').textContent = card.en;
    $('study-es').textContent = card.es;
    $('study-ar').textContent = card.ar || '';
    $('study-progress').textContent = `${study.pos + 1} / ${study.order.length}`;
    $('study-fill').style.width = `${((study.pos + 1) / study.order.length) * 100}%`;
    $('study-prev').disabled = study.pos === 0;
    $('study-next').textContent = study.pos === study.order.length - 1 ? 'Finish ›' : 'Next ›';
    if (dir) animate($('flip'), dir > 0 ? 'slide-in' : 'slide-in-back');
  }

  function flipStudy() {
    const id = study.order[study.pos];
    study.flipped = !study.flipped;
    $('flip').classList.toggle('flipped', study.flipped);
    if (study.flipped) {
      if (!studied[id]) { studied[id] = Date.now(); writeJSON(STUDIED_KEY, studied); }
      if (settings.autoSpeak) say(cardIndex[id].card.es);
    }
  }

  function studyStep(dir) {
    if (!study) return;
    const nextPos = study.pos + dir;
    if (nextPos < 0) return;
    if (nextPos >= study.order.length) { endStudy(); return; }
    study.pos = nextPos;
    showStudyCard(dir);
  }

  function endStudy() {
    const n = study.order.length;
    $('study-deck').hidden = true;
    $('study-end').hidden = false;
    $('study-progress').textContent = `${n} / ${n}`;
    $('study-end-text').textContent = `You went through ${n} card${n === 1 ? '' : 's'} in ${cardIndex[study.order[0]].cat.name}.`;
    animate($('study-end'), 'pop-in');
  }

  function quizFromStudy() {
    const { catId, order } = study;
    const queue = S.buildQueue(cardsIn(catId), progress, studied, Date.now());
    study = null;
    // Nothing due or new in this category: run a practice round on the studied cards instead.
    if (queue.length) startSession(catId);
    else startSession(catId, S.shuffle(order));
  }

  function toggleShuffle() {
    const cat = cardsIn(study.catId)[0];
    study.shuffled = !study.shuffled;
    study.order = study.shuffled ? S.shuffle(cat.cards.map((c) => c.id)) : cat.cards.map((c) => c.id);
    study.pos = 0;
    $('shuffle').setAttribute('aria-pressed', String(study.shuffled));
    showStudyCard(1);
  }

  // Tap flips; horizontal swipe goes next (left) / back (right).
  function wireSwipe() {
    const el = $('flip');
    let x0 = null, y0 = null, swiped = false;
    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
    el.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped = true;
        studyStep(dx < 0 ? 1 : -1);
      }
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
    el.addEventListener('click', () => {
      if (swiped) { swiped = false; return; }
      if (study) flipStudy();
    });
  }

  // ---------- one-time voice tip ----------
  function maybeShowTip() {
    $('voice-tip').hidden = !!readJSON(TIP_KEY, false);
  }

  // ---------- stats ----------
  function renderStats() {
    $('set-sound').checked = settings.sound;
    $('set-haptics').checked = settings.haptics;
    $('set-speak').checked = settings.autoSpeak;

    const ids = Object.keys(cardIndex);
    const perBox = [0, 0, 0, 0, 0, 0];
    let unseen = 0, c = 0, cl = 0, w = 0;
    for (const id of ids) {
      const s = progress[id];
      if (!s) { unseen++; continue; }
      perBox[Math.min(S.MAX_BOX, s.box || 0)]++;
      c += s.correct || 0; cl += s.close || 0; w += s.wrong || 0;
    }
    const total = c + cl + w;
    $('accuracy').innerHTML = total
      ? `${Math.round(((c + cl) / total) * 100)}% <small>${c + cl} of ${total} answers (${cl} close)</small>`
      : '— <small>no answers yet</small>';

    const cols = [['New', unseen]].concat(perBox.map((n, i) => [String(i), n]));
    const max = Math.max(1, ...cols.map((x) => x[1]));
    $('boxes').innerHTML = cols
      .map(([label, n]) =>
        `<div class="box"><span class="n">${n}</span><div class="bar-fill" style="height:${(n / max) * 80}%"></div><span class="lbl">${label}</span></div>`)
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

  function wireSettings() {
    const map = { 'set-sound': 'sound', 'set-haptics': 'haptics', 'set-speak': 'autoSpeak' };
    for (const [id, key] of Object.entries(map)) {
      $(id).addEventListener('change', (e) => {
        settings[key] = e.target.checked;
        writeJSON(SETTINGS_KEY, settings);
        // Preview what was just switched on.
        if (settings[key] && key === 'sound') FX.play('correct');
        if (settings[key] && key === 'autoSpeak') say('hola');
      });
    }
  }

  // ---------- export / import ----------
  async function doExport() {
    const text = JSON.stringify({ exportedAt: new Date().toISOString(), deckVersion: deck.version, cards: progress, studied }, null, 1);
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
        await navigator.share({ title: 'Tridioma progress', text });
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
      progress[id] = Object.assign(S.newStats(), s);
      n++;
    }
    if (data.studied && typeof data.studied === 'object') {
      for (const [id, t] of Object.entries(data.studied)) if (typeof t === 'number') studied[id] = t;
      writeJSON(STUDIED_KEY, studied);
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
    // iOS: audio can only start inside a user gesture, so unlock it on the first tap or key.
    const unlock = () => {
      FX.unlockAudio();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);

    $('review-all').addEventListener('click', () => startSession(null));
    $('weak').addEventListener('click', () => startQueue(S.weakQueue(deck.categories, progress)));
    $('to-custom').addEventListener('click', renderCustom);
    $('custom-back').addEventListener('click', renderHome);
    $('custom-all').addEventListener('click', () => {
      for (const b of document.querySelectorAll('#custom-cats input')) b.checked = true;
      saveCustom();
    });
    $('custom-none').addEventListener('click', () => {
      for (const b of document.querySelectorAll('#custom-cats input')) b.checked = false;
      saveCustom();
    });
    for (const r of document.querySelectorAll('input[name="custom-count"]')) r.addEventListener('change', saveCustom);
    $('custom-start').addEventListener('click', startCustom);
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
    $('speak').addEventListener('click', () => {
      if (session) say(current().card.es);
      $('answer').focus();
    });

    $('tip-close').addEventListener('click', () => {
      writeJSON(TIP_KEY, true);
      $('voice-tip').hidden = true;
      $('answer').focus();
    });

    // Study
    wireSwipe();
    $('study-back').addEventListener('click', () => { study = null; renderHome(); });
    $('study-prev').addEventListener('click', () => studyStep(-1));
    $('study-next').addEventListener('click', () => studyStep(1));
    $('study-speak').addEventListener('click', () => { if (study) say(cardIndex[study.order[study.pos]].card.es); });
    $('shuffle').addEventListener('click', () => { if (study) toggleShuffle(); });
    $('study-quiz').addEventListener('click', quizFromStudy);
    $('study-again').addEventListener('click', () => { study.pos = 0; showStudyCard(1); });
    document.addEventListener('keydown', (e) => {
      if ($('study').hidden || !study || !$('study-end').hidden) return;
      if (e.key === 'ArrowRight') studyStep(1);
      else if (e.key === 'ArrowLeft') studyStep(-1);
    });

    // Stats
    wireSettings();
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
