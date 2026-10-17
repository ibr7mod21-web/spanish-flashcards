// Pure Leitner scheduling functions. Works in the browser (window.Scheduler) and in Node (module.exports).
(function (root) {
  'use strict';

  const INTERVALS = [0, 1, 2, 4, 8, 16]; // days, indexed by box
  const MAX_BOX = INTERVALS.length - 1;
  const SESSION_MAX = 20;
  const SESSION_NEW = 10; // default; the app passes the "New words per session" setting
  const WEAK_MAX = 20;
  const RECENT = 3; // attempts kept in stats.recent
  const DAY = 86400000;

  function startOfDay(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function isDue(stats, now) { return !!stats && stats.due <= now; }

  function byBoxThenDue(progress) {
    return (a, b) => progress[a].box - progress[b].box || progress[a].due - progress[b].due;
  }

  // Quiz queue for the given categories: due cards (lowest box first) + up to newMax new cards, max 20.
  // New cards that were studied (in study mode) fill the new-card slots first.
  function buildQueue(categories, progress, studied, now, newMax) {
    const due = [];
    const freshStudied = [];
    const freshOther = [];
    for (const cat of categories) {
      for (const card of cat.cards) {
        const s = progress[card.id];
        if (!s) (studied && studied[card.id] ? freshStudied : freshOther).push(card.id);
        else if (isDue(s, now)) due.push(card.id);
      }
    }
    due.sort(byBoxThenDue(progress));
    const queue = due.slice(0, SESSION_MAX);
    const room = Math.max(0, Math.min(newMax || SESSION_NEW, SESSION_MAX - queue.length));
    return queue.concat(freshStudied.concat(freshOther).slice(0, room));
  }

  // "Review all due": due cards only, lowest box first, max 20.
  function reviewAllQueue(categories, progress, now) {
    const due = [];
    for (const cat of categories) {
      for (const card of cat.cards) if (isDue(progress[card.id], now)) due.push(card.id);
    }
    return due.sort(byBoxThenDue(progress)).slice(0, SESSION_MAX);
  }

  function newStats() {
    return {
      box: 0, due: 0, seen: 0, correct: 0, close: 0, wrong: 0,
      lastWrongAnswers: [], lastSeen: 0, lastWrongAt: 0,
      recent: [],     // last 3 results, newest first: 'correct' | 'close' | 'wrong'
      lastMissAt: 0,  // time of the last CLOSE or WRONG
    };
  }

  // Returns updated stats for one answer. result: 'correct' | 'close' | 'wrong'.
  // practice: CORRECT/CLOSE still count (seen, correct/close, recent) but don't move the box or due date;
  // WRONG still drops the card to box 0. So practice can't be used to game the schedule.
  function applyResult(prev, result, answer, now, { practice = false } = {}) {
    const s = Object.assign(newStats(), prev || {});
    s.lastWrongAnswers = (s.lastWrongAnswers || []).slice();
    s.recent = [result].concat(s.recent || []).slice(0, RECENT);
    s.seen++;
    s.lastSeen = now;
    if (result !== 'correct') s.lastMissAt = now;
    if (result === 'wrong') {
      s.wrong++;
      s.box = 0;
      s.due = now;
      s.lastWrongAt = now;
      s.lastWrongAnswers = [String(answer || '').trim() || '—'].concat(s.lastWrongAnswers).slice(0, 3);
    } else {
      if (result === 'correct') s.correct++; else s.close++;
      if (!practice) {
        s.box = Math.min(MAX_BOX, (s.box || 0) + 1);
        s.due = startOfDay(now) + INTERVALS[s.box] * DAY;
      }
    }
    return s;
  }

  // Whole days until the earliest scheduled review among cards that have been seen (null if none).
  function nextReviewDays(categories, progress, now) {
    let min = Infinity;
    for (const cat of categories) {
      for (const card of cat.cards) {
        const s = progress[card.id];
        if (s && s.due < min) min = s.due;
      }
    }
    if (min === Infinity) return null;
    return Math.max(0, Math.round((startOfDay(min) - startOfDay(now)) / DAY));
  }

  // "I was right": the stats as if the answer had been CORRECT, plus a disputed-answer record.
  // prev: the stats from *before* the WRONG answer was applied.
  function disputeResult(prev, answer, now, opts) {
    const s = applyResult(prev, 'correct', answer, now, opts);
    s.disputed = (s.disputed || []).concat([{ answer: String(answer).trim(), date: new Date(now).toISOString() }]);
    return s;
  }

  // Every disputed answer, oldest first, for the export: [{ cardId, answer, date }].
  function collectDisputed(progress) {
    const out = [];
    for (const [cardId, s] of Object.entries(progress || {})) {
      for (const d of (s && s.disputed) || []) out.push({ cardId, answer: d.answer, date: d.date });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Weak: missed and still in box 0–1, or a CLOSE/WRONG among the last 3 attempts.
  function isWeak(stats) {
    if (!stats) return false;
    if ((stats.wrong || 0) > 0 && (stats.box || 0) <= 1) return true;
    return (stats.recent || []).some((r) => r === 'close' || r === 'wrong');
  }

  function lastMiss(stats) { return stats.lastMissAt || stats.lastWrongAt || 0; }

  // Weak cards in the given categories, most recent miss first, max 20. Ignores due dates.
  function weakQueue(categories, progress, limit) {
    const ids = [];
    for (const cat of categories) {
      for (const card of cat.cards) if (isWeak(progress[card.id])) ids.push(card.id);
    }
    ids.sort((a, b) => lastMiss(progress[b]) - lastMiss(progress[a]));
    return ids.slice(0, limit || WEAK_MAX);
  }

  // Custom quiz: a random mix of every card in the given categories, due or not.
  // count: a number, or 'all'.
  function customQueue(categories, count, rng) {
    const ids = shuffle(categories.flatMap((cat) => cat.cards.map((c) => c.id)), rng);
    return count === 'all' ? ids : ids.slice(0, count);
  }

  // Where to re-insert a missed card: 3–5 cards later, clamped to the end of the queue.
  function requeueIndex(pos, length, rng) {
    const offset = 3 + Math.floor((rng || Math.random)() * 3);
    return Math.min(pos + 1 + offset, length);
  }

  // Fisher–Yates; returns a new array.
  function shuffle(list, rng) {
    const r = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const api = {
    INTERVALS, MAX_BOX, SESSION_MAX, SESSION_NEW, WEAK_MAX, DAY,
    startOfDay, isDue, buildQueue, reviewAllQueue, newStats, applyResult, requeueIndex, shuffle,
    isWeak, weakQueue, customQueue, nextReviewDays, disputeResult, collectDisputed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof self !== 'undefined' ? self : this);
