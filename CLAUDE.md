# Tridioma (PWA)

**Tridioma** (tri + idioma: Arabic, English, Spanish). Mascot: a geometric raven.
Personal Spanish flashcard web app for the owner's iPhone, installed to the home screen.
The owner has limited programming experience: explain any manual step in plain, numbered steps.

## Goal
An English word is shown; the user answers in Spanish by typing or by iOS keyboard dictation; the app grades it.
Spaced repetition (Leitner) so new and missed words come back and mastered words fade out.
Dialect: general Latin American-neutral Spanish (Duolingo style).

## Stack
- Plain HTML/CSS/JS. No framework, no build step, no npm dependencies.
- Files: `index.html`, `app.js` (UI), `grading.js`, `scheduler.js`, `feedback.js`, `settings.js`, `sync.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`, `deck.json`.
- Pure logic lives in `grading.js`, `scheduler.js`, `settings.js`, the merge/format half of `sync.js` and `pickVoice` in `feedback.js`; each works in the browser (`window.X`) and Node (`module.exports`).
- Tests: `for f in tests/*.test.js; do node "$f" || break; done`. Add tests for any new pure logic.
- `tests/html.test.js`: ids in index.html must be unique and every `$('id')` in app.js must exist. (A duplicate `id="weak"` once made Stats overwrite the Home "Weak words" button and broke every Home button.)
- New script files must also be added to `SHELL` in `sw.js`.
- `tools/make_icons.py`: the raven logo lives here (one set of polygons). Writes `icons/icon.svg`, `icons/raven-white.svg` (header logo) and the PNG icons, using headless Google Chrome to rasterize. Run `python3 tools/make_icons.py` after changing the raven.
- Local preview: `python3 -m http.server 8000`, then open http://localhost:8000
- Hosting: GitHub Pages, public repo `spanish-flashcards` (kept despite the rebrand: renaming the repo changes the URL, and a new URL means new, empty storage on the phone). All paths are **relative** (the site lives under `/spanish-flashcards/`).

## Offline / service worker
- `sw.js` precaches the app shell (cache-first).
- `deck.json` is **network-first with cache fallback**, so deck edits arrive on the next launch with internet.
- **Bump `CACHE_VERSION` in `sw.js` on every app change** (any change to html/css/js/icons/manifest). Old caches are deleted on activate.
- Deck-only changes don't need a cache bump, but bump `version` in deck.json.

## Deck schema
```
{ version, dialect, categories: [ { id, name, arLabel?, cards: [ { id, en, es, alt?: [], ar? } ] } ] }
```
- Card ids are permanent; progress is keyed by id. **Never renumber or reuse ids.** New cards get new ids.
- `tests/known-ids.txt` lists every published id (`category id`). Append new ids there; never delete or edit lines. The deck test fails if an id disappears or moves category.
- `alt` only for synonyms that are right in general Latin American use (e.g. rojo/colorado, morado/violeta/púrpura, esposo/marido); skip regional or context-only words. Tests check existing alts are kept and that no alt is another card's answer in the same category.
- Ambiguous English gets a clarifier in brackets, e.g. `orange (color)` / `orange (fruit)`; English prompts must be unique (tested).
- Categories (id prefix): days, numbers, months, colors (`col-`), family (`fam-`), food (`food-`), verbs (`verb-`), travel (`trav-`), house (`house-`), health (`hlth-`), feelings (`feel-`), time (`time-`), verbs2 (`verb2-`), arabic (`arab-`).
- `arLabel` (category, optional): text shown above the Arabic on the Study card back and the quiz reveal. Only `arabic` (Arabic origins) uses it: `"From Arabic:"`, and its `ar` is the Arabic **source** word exactly as given by the owner (not a translation).
- Adjectives accept the feminine form as an `alt` (tested for feelings/health).
- **Person nouns** (doctor, neighbor, teacher, friend, mayor…) accept the feminine form as an `alt` (médico → médica/doctora, vecino → vecina, alcalde → alcaldesa), in Core and the rest of the deck. Exception: pairs that already have separate male/female cards (family: brother/sister, cousin (male)/(female), uncle/aunt…). Invariable nouns (turista, persona) need nothing.
- Before adding words: check against every existing `es` and `alt` (accent-insensitive) and skip duplicates; tests block a new card repeating an older card's Spanish. Verbs' `ar` uses the Arabic dictionary form (past, 3rd person masc.). Arabic-origin Spanish words show the Arabic root (azúcar → السكر, aceite → الزيت, arroz → الرز).
- `alt`: other accepted answers. `ar`: Arabic translation (every card has one; `tests/deck.test.js` enforces it). Months use the يناير…ديسمبر names.
- Number cards (category id `numbers`): the numeric value is taken from the trailing digits of the id (`num-06` → 6), or from an optional `n` field if present.

## Screens
1. **Home**: "Review all due", then **Custom quiz** and **Weak words** (count badge; disabled with "No weak words yet" when there are none), then the category list with due/new counts and **Study** / **Quiz** buttons.
   - **Custom quiz** screen: category checkboxes (Select all / Clear), count 10 / 20 / 30 / All; random mix via `customQueue`, due or not; results update the schedule normally. Last choice saved in `sf.custom.v1`.
   - **Weak words**: `weakQueue`, max 20, most recent miss first, ignores due dates.
   - Category with nothing due or new: button reads **Practice anyway**, with "All caught up · next review in X days" (`nextReviewDays`). Practice = up to 20 random cards from the category, scored with the practice rule.
2. **Card** (quiz): English word large. Text input with `autocapitalize="off" autocorrect="off" spellcheck="false" lang="es"`. Check button; Enter submits. After answering, the button becomes Next (Enter also advances). "Show answer" counts as wrong. On a typed WRONG answer, an **I was right** link regrades it as CORRECT (`disputeResult`, from the stats before the miss), drops the requeued copy, and stores `{answer, date}` in the card's `disputed` list.
3. **End of session**: plain heading "Session complete" / "Practice complete" with the score (right = correct + close), tiles, then **Home** (primary) and **Practice again** (practice round on the same cards).
4. **Study**: flip cards (front: English only; back: Spanish large + Arabic smaller below, `lang="ar" dir="rtl"`; auto-speaks on flip). Swipe left/right or Next/Back, Shuffle. End: "Quiz me on these" quizzes that category (if nothing is due/new there, a practice round).
5. **Stats** (stats only): cards per box, overall accuracy, 15 weakest cards (most recent misses).
6. **Settings** (gear icon in the Home header): Learning → **New words per session** 5 / 10 / 15 / 20 (default 10, `newPerSession`); Sound effects, Auto-speak in Study; **Cloud sync** (token field, Connect, status, Sync now, Disconnect); Backup with Export progress / Import progress and "Last export: <date>" (kept as the emergency backup).

## Grading (`grading.js`, pure functions, works in browser and Node)
- Normalize: lowercase, trim, collapse spaces, strip `¿?¡!.,`
- Equals `es` or any `alt` → CORRECT (teal)
- Equal after removing diacritics (á→a, é→e, í→i, ó→o, ú→u, ñ→n, ü→u) → CLOSE (amber), show the correct spelling
- Number cards: a digit answer equal to the number → CORRECT, and show the spelled form (iOS dictation writes digits)
- Otherwise → WRONG (red), show the answer
- After any answer, show the `ar` hint if present.

## Scheduler (Leitner, `scheduler.js`)
- Boxes 0–5, intervals `[0, 1, 2, 4, 8, 16]` days (due = start of today + interval).
- CORRECT or CLOSE → box+1 (max 5). WRONG → box 0, and requeue the card 3–5 cards later in the same session.
- Session = due cards (lowest box first) + up to `newPerSession` new cards (setting, default 10; `buildQueue(..., newMax)`), max 20 total. New cards already **studied** fill the new-card slots first.
- Per card: `box, due, seen, correct, close, wrong, lastWrongAnswers` (last 3), `lastSeen`, plus `lastWrongAt` (ranks Stats "weakest"), `recent` (last 3 results, newest first) and `lastMissAt` (last CLOSE or WRONG).
- **Practice rule** (`applyResult(..., { practice: true })`): WRONG still drops to box 0 / due now and counts as a miss; CORRECT/CLOSE count toward stats but don't change box or due date. Used by Practice anyway, Practice again and Study → quiz when nothing is due.
- **Weak** (`isWeak`): `wrong > 0 && box <= 1`, OR a CLOSE/WRONG in `recent`. Older stats without `recent` still match the first rule; ranking falls back to `lastWrongAt`.

## Storage
- localStorage, every read/write wrapped in try/catch. Keys: `sf.progress.v1` (`{ [cardId]: stats }`), `sf.studied.v1` (`{ [cardId]: timestamp }`, kept separate so studied cards still count as new), `sf.settings.v1` (`{sound, autoSpeak, newPerSession}`; each key validated against `Settings.SCHEMA`), `sf.lastExport.v1` (ISO date), `sf.custom.v1` (`{cats, count}`), `sf.tipShown`.
- Export: `{exportedAt, deckVersion, cards: {id: stats}, studied, disputed: [{cardId, answer, date}]}` (`collectDisputed`; for the tutor to review and turn into real `alt`s) → copy to clipboard + iOS share sheet (`navigator.share`), fallback: selectable text box.
- Import: paste JSON to restore progress (iOS can clear web storage).

## Voice
iOS does NOT allow the Web Speech API in home-screen web apps. Voice = iOS keyboard dictation.
**Do not build an in-app mic button.** A one-time tip says: "Add a Spanish keyboard and tap its mic to answer by voice."

## Feedback (`feedback.js`)
- Sounds: Web Audio oscillators, no audio files (ding / two-note / thud / fanfare). AudioContext is unlocked on the first tap (iOS). `navigator.audioSession.type = 'ambient'` so it mixes with music and respects the silent switch.
- **No haptics.** iOS has no `navigator.vibrate`; the hidden `<input switch>` label-click trick is undocumented and did nothing in the home-screen app on the owner's iPhone, so it was removed (don't add a setting that can't be verified to work).
- **Settings** (`settings.js`): always read with `Settings.get(storage, key)` at the moment of use; never cache them in app state. Unknown/old keys (e.g. `haptics`) are dropped.
- iOS audio unlock: only `touchend` / `click` / `keydown` count as gestures for audio (not `pointerdown`/`touchstart`); `unlockAudio()` runs on each until the AudioContext is `running`.
- Speech: only `cancel()` when `speaking || pending` — on iOS, cancel() immediately before speak() can drop the utterance.
- Pronunciation: `speechSynthesis` (allowed in home-screen apps, unlike speech *recognition*). Voice preference es-MX → es-US → es-419 → any es-*. Quiz: **never auto-speaks**, 🔊 button only. Study: auto-speaks on flip (toggle `autoSpeak`), 🔊 replays.

## Design
Mobile-first, iPhone safe areas (`viewport-fit=cover` + `env(safe-area-inset-*)`), large type, big tap targets (≥44px),
light and dark mode via `prefers-color-scheme`, minimal and clean. Input font-size ≥16px so iOS doesn't zoom.
Small animations (slide-in, answer flash, pop-in, shake, progress bar, card flip); all disabled under `prefers-reduced-motion`.

## Brand colours (`styles.css` tokens)
- Primary: deep blue → violet gradient (`--grad`, #1e40af → #6d28d9; dark mode #2547c9 → #7c3aed) on the header band, primary buttons, progress bars, due pills. White text on it.
- Header band runs under the status bar (`apple-mobile-web-app-status-bar-style: black-translucent`).
- Feedback: CORRECT teal (`--correct`), CLOSE amber (`--close`), WRONG red (`--wrong`), each with a `-bg` and `-flash` variant.
- `tests/contrast.test.js` reads the tokens from styles.css and checks WCAG AA in light and dark; keep it passing when changing colours.

## Cloud sync (`sync.js`)
- Private repo **`ibr7mod21-web/tridioma-data`**, one file **`progress.json`**: the Export JSON (`exportedAt, deckVersion, cards, studied, disputed`) plus `settings` and `settingsUpdatedAt`.
- Auth: a GitHub **fine-grained token** with access to only tridioma-data, permission Contents: Read and write, nothing else. Pasted in Settings, checked with `GET /repos/…`, then stored **only** in localStorage under `sf.sync.token`.
- **The token must never** appear in this public repo, the code, logs, status text, the export, or progress.json. `tests/sync.test.js` checks the file/requests/state; `tests/secrets.test.js` scans every tracked file for token-shaped strings. Disconnect deletes it.
- When: on app open (`boot` and `visibilitychange` → visible), after each session ends (finish, or leaving mid-session with answers), after leaving Study, after settings change, after Import, and when the device comes back `online`. Always in the background; never blocks the UI.
- Flow (`createSync().sync()`): GET file (404 = none yet) → `mergeData(local, remote)` → apply locally (re-merged with current local, so an answer given meanwhile isn't lost) → PUT with the file's `sha` only if something changed. On 409/422 (another device wrote since the GET): re-pull, merge, retry once. Network failure → `pending` + "Offline, will retry".
- **Merge rules** (`mergeData`): per card, the record with the newer `lastSeen` wins (tie → local); `disputed` = union, one entry per answer (case-insensitive), earliest date; `studied` = union, earliest time; settings = the side with the newer `settingsUpdatedAt` (set by `Settings.set`).
- Sync state (`lastSync`, `pending`) in `sf.sync.state`. GitHub's API is cross-origin, so the service worker doesn't touch these requests.

## Tutor report
- `node tools/progress_report.js` downloads progress.json from tridioma-data with `gh` (the Mac's gh login, not the phone's token) and prints a plain-text report to paste to the tutor: cards per box, accuracy, categories (mastered = every card at box 4+), the 20 weakest cards (`weakQueue`) with the wrong answers typed, and disputed "I was right" answers.
- `node tools/progress_report.js --file export.json` does the same from a manual export.
- When the owner asks for "the tutor report", run it and give them the output.

## Core 2000
The ~2,000 most common Spanish words, general Latin American Spanish, added in batches of 100.
- **Categories**: `core-01` "Core 1–100", `core-02` "Core 101–200", … `core-20`. Card ids `core-NN-NNN` (e.g. `core-01-001`), permanent like all ids.
- **Order**: lemma frequency, based on Mark Davies' *A Frequency Dictionary of Spanish* (Corpus del Español) as remembered, nudged toward spoken use (e.g. usted, tú, bueno rank a little higher than in written-only lists). It is approximate within a few ranks; that's fine. Each batch = the next 100 **eligible** words in that order, so a word skipped by the rules below doesn't leave a gap.
- **Skip**: words already anywhere in the deck (same spelling as any `es` or `alt`); proper nouns; pure grammar words that make bad flashcards (articles, de, a, en, y, o, que, se, object pronouns le/lo/me/te/nos, su, por, para, con, ni, pues, the auxiliary haber). **Keep** useful function words (sin, entre, aunque, también, porque, cuando, si, muy, más) and subject pronouns.
- Words that differ only by an accent are different words and both allowed (si/sí, el/él, que/qué); the checker notes them.
- **Form**: verbs as infinitives; nouns without the article; adjectives masculine with the feminine (and apocopated forms: buen, gran, primer, algún) as `alt`; person nouns with the feminine as `alt`.
- **Clarifiers** in brackets when the English is ambiguous or already used: "time (occurrence)" vez / "time (duration)" tiempo, "to know (a person, a place)" conocer, "you (formal)" / "you (informal)", "when (not a question)", "what? (question)".
- **Alts**: real general-LatAm synonyms only (volver/regresar, aquí/acá, conseguir/lograr/obtener). Number words get `n` (their value).
- **Arabic**: every card has an accurate Modern Standard Arabic `ar`; verbs in dictionary form (past, 3rd person masc.); possessives shown with an example (ـي (مثل: بيتي)).
- **Workflow** for each batch:
  1. Write `tools/core/core-NN.tsv` (columns: en, es, alts, ar, n).
  2. `python3 tools/add_core_batch.py NN` → checks the rules against the whole deck and prints the review table (id, en, es, alt, ar). Show the owner the table for the tutor **before** adding.
  3. `python3 tools/add_core_batch.py NN --write` → appends the category, bumps the deck version, appends ids to `tests/known-ids.txt`.
  4. Add `'core-NN': 100` to the counts in `tests/deck.test.js`, run all tests, bump `CACHE_VERSION` if app code changed, commit and push, print the deck summary.
- Done so far: core-01.

