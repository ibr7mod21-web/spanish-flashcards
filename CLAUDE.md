# Spanish Flashcards (PWA)

Personal Spanish flashcard web app for the owner's iPhone, installed to the home screen.
The owner has limited programming experience: explain any manual step in plain, numbered steps.

## Goal
An English word is shown; the user answers in Spanish by typing or by iOS keyboard dictation; the app grades it.
Spaced repetition (Leitner) so new and missed words come back and mastered words fade out.
Dialect: general Latin American-neutral Spanish (Duolingo style).

## Stack
- Plain HTML/CSS/JS. No framework, no build step, no npm dependencies.
- Files: `index.html`, `app.js`, `grading.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`, `deck.json`.
- `tests/grading.test.js`: run with `node tests/grading.test.js`.
- `tools/make_icons.py`: regenerates the PNG icons (pure Python, no dependencies).
- Local preview: `python3 -m http.server 8000`, then open http://localhost:8000
- Hosting: GitHub Pages, public repo `spanish-flashcards`. All paths are **relative** (the site lives under `/spanish-flashcards/`).

## Offline / service worker
- `sw.js` precaches the app shell (cache-first).
- `deck.json` is **network-first with cache fallback**, so deck edits arrive on the next launch with internet.
- **Bump `CACHE_VERSION` in `sw.js` on every app change** (any change to html/css/js/icons/manifest). Old caches are deleted on activate.
- Deck-only changes don't need a cache bump, but bump `version` in deck.json.

## Deck schema
```
{ version, dialect, categories: [ { id, name, cards: [ { id, en, es, alt?: [], ar? } ] } ] }
```
- Card ids are permanent; progress is keyed by id. **Never renumber or reuse ids.** New cards get new ids.
- `alt`: other accepted answers. `ar`: Arabic hint shown after answering.
- Number cards (category id `numbers`): the numeric value is taken from the trailing digits of the id (`num-06` → 6), or from an optional `n` field if present.

## Screens
1. **Home**: category list with due/new counts, plus "Review all due" button.
2. **Card**: English word large. Text input with `autocapitalize="off" autocorrect="off" spellcheck="false" lang="es"`. Check button; Enter submits. After answering, the button becomes Next (Enter also advances). "Show answer" counts as wrong.
3. **Stats**: cards per box, overall accuracy, 15 weakest cards (most recent misses), Export and Import.

## Grading (`grading.js`, pure functions, works in browser and Node)
- Normalize: lowercase, trim, collapse spaces, strip `¿?¡!.,`
- Equals `es` or any `alt` → CORRECT (green)
- Equal after removing diacritics (á→a, é→e, í→i, ó→o, ú→u, ñ→n, ü→u) → CLOSE (amber), show the correct spelling
- Number cards: a digit answer equal to the number → CORRECT, and show the spelled form (iOS dictation writes digits)
- Otherwise → WRONG (red), show the answer
- After any answer, show the `ar` hint if present.

## Scheduler (Leitner, in `app.js`)
- Boxes 0–5, intervals `[0, 1, 2, 4, 8, 16]` days (due = start of today + interval).
- CORRECT or CLOSE → box+1 (max 5). WRONG → box 0, and requeue the card 3–5 cards later in the same session.
- Session = due cards (lowest box first) + up to 8 new cards, max 20 total.
- Per card: `box, due, seen, correct, close, wrong, lastWrongAnswers` (last 3), `lastSeen`, plus `lastWrongAt` (used to rank "weakest").

## Storage
- localStorage, every read/write wrapped in try/catch. Keys: `sf.progress.v1` (`{ [cardId]: stats }`), `sf.tipShown`.
- Export: `{exportedAt, deckVersion, cards: {id: stats}}` → copy to clipboard + iOS share sheet (`navigator.share`), fallback: selectable text box.
- Import: paste JSON to restore progress (iOS can clear web storage).

## Voice
iOS does NOT allow the Web Speech API in home-screen web apps. Voice = iOS keyboard dictation.
**Do not build an in-app mic button.** A one-time tip says: "Add a Spanish keyboard and tap its mic to answer by voice."

## Design
Mobile-first, iPhone safe areas (`viewport-fit=cover` + `env(safe-area-inset-*)`), large type, big tap targets (≥44px),
light and dark mode via `prefers-color-scheme`, minimal and clean. Input font-size ≥16px so iOS doesn't zoom.
