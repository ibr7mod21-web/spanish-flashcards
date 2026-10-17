"""Check, print and add one Core 2000 batch to deck.json.

    python3 tools/add_core_batch.py 01            # check against the rules + deck, print the review table
    python3 tools/add_core_batch.py 01 --write    # same, then append category core-01 and its ids

Batch files: tools/core/core-NN.tsv  (en, es, alts, ar, n). See CLAUDE.md "Core 2000".
"""
import json
import os
import sys
import unicodedata

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DECK = os.path.join(ROOT, 'deck.json')
KNOWN = os.path.join(ROOT, 'tests', 'known-ids.txt')
SKIP = {  # pure grammar words: never cards
    'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'de', 'del', 'a', 'al', 'en', 'y', 'e', 'o', 'u',
    'que', 'se', 'le', 'les', 'me', 'te', 'nos', 'os', 'su', 'sus', 'por', 'para', 'con', 'ni', 'pues', 'haber',
}


def bare(s):
    s = unicodedata.normalize('NFD', s.strip().lower())
    return ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')


def load_batch(nn):
    path = os.path.join(ROOT, 'tools', 'core', f'core-{nn}.tsv')
    rows = []
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('#'):
            continue
        cols = line.split('\t') + [''] * 5
        en, es, alts, ar, n = (c.strip() for c in cols[:5])
        rows.append({'en': en, 'es': es, 'alt': [a.strip() for a in alts.split(',') if a.strip()], 'ar': ar, 'n': n})
    return rows


def low(s):
    return unicodedata.normalize('NFC', s.strip().lower())


# Returns (problems, notes). Same word = same letters and accents. Words that differ only by an accent
# (si/sí, el/él, que/qué) are real, different words: reported as notes, not problems.
def check(rows, deck, nn):
    problems, notes = [], []
    cat_id = f'core-{nn}'
    old_es, old_en, old_bare = {}, {}, {}
    for cat in deck['categories']:
        if cat['id'] == cat_id:
            continue
        for c in cat['cards']:
            for f in [c['es']] + c.get('alt', []):
                old_es.setdefault(low(f), c['id'])
                old_bare.setdefault(bare(f), (c['id'], f))
            old_en[c['en'].lower()] = c['id']
    seen_es, seen_en, seen_bare = {}, {}, {}
    for i, r in enumerate(rows, 1):
        tag = f"{i:03d} {r['es']}"
        if not (r['en'] and r['es'] and r['ar']):
            problems.append(f'{tag}: missing en / es / ar')
        if not any('؀' <= ch <= 'ۿ' for ch in r['ar']):
            problems.append(f'{tag}: ar is not Arabic script')
        if low(r['es']) in SKIP:
            problems.append(f'{tag}: grammar word, skip it')
        if r['es'][:1].isupper():
            problems.append(f'{tag}: looks like a proper noun')
        if low(r['es']) in old_es:
            problems.append(f"{tag}: already in the deck ({old_es[low(r['es'])]})")
        elif bare(r['es']) in old_bare:
            notes.append(f"{tag}: differs only by an accent from {old_bare[bare(r['es'])][1]} ({old_bare[bare(r['es'])][0]})")
        if r['en'].lower() in old_en:
            problems.append(f"{tag}: English \"{r['en']}\" already used by {old_en[r['en'].lower()]} — add a clarifier")
        if r['en'].lower() in seen_en:
            problems.append(f"{tag}: English \"{r['en']}\" repeated in this batch")
        for f in [r['es']] + r['alt']:
            if low(f) in seen_es and seen_es[low(f)][0] != i:
                problems.append(f'{tag}: "{f}" also used by batch row {seen_es[low(f)][0]:03d}')
            elif bare(f) in seen_bare and seen_bare[bare(f)][0] != i:
                notes.append(f'{tag}: "{f}" differs only by an accent from row {seen_bare[bare(f)][0]:03d} ({seen_bare[bare(f)][1]})')
            seen_es.setdefault(low(f), (i, f))
            seen_bare.setdefault(bare(f), (i, f))
        seen_en[r['en'].lower()] = i
        if r['es'].split(' ')[0] in ('el', 'la', 'los', 'las') and ' ' in r['es']:
            problems.append(f'{tag}: noun with an article')
    if len(rows) != 100:
        problems.append(f'batch has {len(rows)} words, expected 100')
    return problems, notes


def table(rows, nn):
    out = [f'| id | en | es | alt | ar |', '|---|---|---|---|---|']
    for i, r in enumerate(rows, 1):
        out.append(f"| core-{nn}-{i:03d} | {r['en']} | {r['es']} | {', '.join(r['alt'])} | {r['ar']} |")
    return '\n'.join(out)


def write(rows, deck, nn):
    cat_id = f'core-{nn}'
    if any(c['id'] == cat_id for c in deck['categories']):
        raise SystemExit(f'{cat_id} is already in the deck (ids are permanent; edit cards in place instead)')
    lo = (int(nn) - 1) * 100 + 1
    cat = {'id': cat_id, 'name': f'Core {lo}–{lo + 99}', 'cards': []}
    for i, r in enumerate(rows, 1):
        c = {'id': f'{cat_id}-{i:03d}', 'en': r['en'], 'es': r['es']}
        if r['alt']:
            c['alt'] = r['alt']
        if r['n']:
            c['n'] = int(r['n'])
        c['ar'] = r['ar']
        cat['cards'].append(c)
    deck['categories'].append(cat)
    deck['version'] += 1

    lines = ['{', f'  "version": {deck["version"]},', f'  "dialect": {json.dumps(deck["dialect"])},', '  "categories": [']
    for ci, k in enumerate(deck['categories']):
        lines += ['    {', f'      "id": {json.dumps(k["id"])},', f'      "name": {json.dumps(k["name"], ensure_ascii=False)},']
        if 'arLabel' in k:
            lines.append(f'      "arLabel": {json.dumps(k["arLabel"])},')
        lines.append('      "cards": [')
        for i, c in enumerate(k['cards']):
            body = ', '.join(f'{json.dumps(a)}: {json.dumps(b, ensure_ascii=False)}' for a, b in c.items())
            lines.append('        { ' + body + ' }' + (',' if i < len(k['cards']) - 1 else ''))
        lines += ['      ]', '    }' + (',' if ci < len(deck['categories']) - 1 else '')]
    lines += ['  ]', '}']
    with open(DECK, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    with open(KNOWN, 'a', encoding='utf-8') as f:
        f.write(''.join(f"{cat_id} {c['id']}\n" for c in cat['cards']))
    print(f"added {cat_id} ({len(cat['cards'])} cards); deck version {deck['version']}")


def main():
    nn = sys.argv[1].zfill(2)
    rows = load_batch(nn)
    deck = json.load(open(DECK, encoding='utf-8'))
    problems, notes = check(rows, deck, nn)
    if '--table' in sys.argv or '--write' not in sys.argv:
        print(table(rows, nn))
    print('\nProblems:' if problems else '\nChecks: all passed')
    for p in problems:
        print('  ' + p)
    if notes:
        print('Notes (fine, but worth knowing):')
        for n in notes:
            print('  ' + n)
    if '--write' in sys.argv:
        if problems:
            raise SystemExit('not written: fix the problems first')
        write(rows, deck, nn)


main()
