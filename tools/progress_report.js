#!/usr/bin/env node
// Tutor report from the synced progress.json in the private tridioma-data repo.
//
//   node tools/progress_report.js                 # pulls progress.json with `gh` (must be signed in)
//   node tools/progress_report.js --file x.json   # use a local file instead (e.g. a manual export)
//
// Prints plain text to paste to the tutor: cards per box, accuracy, categories mastered,
// the 20 weakest cards with the wrong answers, and disputed ("I was right") answers.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const S = require('../scheduler.js');

const REPO = 'ibr7mod21-web/tridioma-data';
const FILE = 'progress.json';
const MASTERED_BOX = 4; // box 4+ = 8+ days between reviews

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '?' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Pure: data = parsed progress.json (or an export), deck = deck.json. Returns the report text.
function buildReport(data, deck, now) {
  const cards = (data && data.cards) || {};
  const index = {};
  for (const cat of deck.categories) for (const c of cat.cards) index[c.id] = { card: c, cat };
  const lines = [];
  const out = (s = '') => lines.push(s);

  const allIds = Object.keys(index);
  out(`TRIDIOMA PROGRESS REPORT · ${fmtDate(now)}`);
  out(`Last synced ${data.exportedAt ? fmtDate(data.exportedAt) : '?'} · deck v${deck.version}, ${allIds.length} cards`);
  out();

  // Cards per box
  const perBox = [0, 0, 0, 0, 0, 0];
  let unseen = 0, c = 0, cl = 0, w = 0;
  for (const id of allIds) {
    const s = cards[id];
    if (!s) { unseen++; continue; }
    perBox[Math.min(S.MAX_BOX, s.box || 0)]++;
    c += s.correct || 0; cl += s.close || 0; w += s.wrong || 0;
  }
  out('CARDS PER BOX (box 0 = just missed … box 5 = reviewed every 16 days)');
  out(`  Not seen yet: ${unseen}`);
  perBox.forEach((n, i) => out(`  Box ${i} (${S.INTERVALS[i]} day${S.INTERVALS[i] === 1 ? '' : 's'}): ${n}`));
  out();

  const total = c + cl + w;
  out('ACCURACY');
  out(total
    ? `  ${Math.round(((c + cl) / total) * 100)}% right (${c + cl} of ${total} answers; ${cl} had only an accent/ñ missing)`
    : '  No answers yet');
  out();

  // Categories
  out(`CATEGORIES (mastered = every card at box ${MASTERED_BOX}+)`);
  const mastered = [];
  for (const cat of deck.categories) {
    const seen = cat.cards.filter((x) => cards[x.id]).length;
    const strong = cat.cards.filter((x) => (cards[x.id] && cards[x.id].box) >= MASTERED_BOX).length;
    const isMastered = strong === cat.cards.length;
    if (isMastered) mastered.push(cat.name);
    out(`  ${cat.name.padEnd(18)} ${String(seen).padStart(2)}/${cat.cards.length} seen · ${String(strong).padStart(2)} strong${isMastered ? ' · MASTERED' : ''}`);
  }
  out(`  Mastered: ${mastered.length ? mastered.join(', ') : 'none yet'}`);
  out();

  // Weakest
  const weak = S.weakQueue(deck.categories, cards, 20);
  out('20 WEAKEST CARDS (most recent miss first)');
  if (!weak.length) out('  None — no recent misses.');
  weak.forEach((id, i) => {
    const s = cards[id];
    const { card } = index[id];
    const wrote = (s.lastWrongAnswers || []).filter((a) => a && a !== '—');
    out(`  ${String(i + 1).padStart(2)}. ${card.en} → ${card.es}   [box ${s.box}, wrong ${s.wrong || 0}×, close ${s.close || 0}×]` +
      (wrote.length ? `   wrote: ${wrote.join(', ')}` : ''));
  });
  out();

  // Disputed
  const disputed = S.collectDisputed(cards);
  out('DISPUTED ANSWERS ("I was right" — please check; real synonyms can be added to the deck)');
  if (!disputed.length) out('  None.');
  for (const d of disputed) {
    const hit = index[d.cardId];
    const label = hit ? `${hit.card.en} → ${hit.card.es}${hit.card.alt ? ' (also: ' + hit.card.alt.join(', ') + ')' : ''}` : d.cardId;
    out(`  ${label}: "${d.answer}" (${fmtDate(d.date)})`);
  }
  return lines.join('\n');
}

function loadRemote() {
  const b64 = execFileSync('gh', ['api', `repos/${REPO}/contents/${FILE}`, '--jq', '.content'], { encoding: 'utf8' });
  return JSON.parse(Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8'));
}

if (require.main === module) {
  const deck = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deck.json'), 'utf8'));
  const i = process.argv.indexOf('--file');
  let data;
  try {
    data = i > -1 ? JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')) : loadRemote();
  } catch (e) {
    console.error(i > -1
      ? 'Could not read ' + process.argv[i + 1] + ': ' + e.message
      : `Could not download ${FILE} from ${REPO}. Is gh signed in, and has the app synced at least once?`);
    process.exit(1);
  }
  console.log(buildReport(data, deck, Date.now()));
}

module.exports = { buildReport };
