// Pure grading functions. Works in the browser (window.Grading) and in Node (module.exports).
(function (root) {
  'use strict';

  const CORRECT = 'correct';
  const CLOSE = 'close';
  const WRONG = 'wrong';

  // lowercase, strip ¿?¡!., , collapse spaces, trim
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFC')
      .toLowerCase()
      .replace(/[¿?¡!.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // á→a, é→e, í→i, ó→o, ú→u, ñ→n, ü→u (and any other combining mark)
  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  }

  // Numeric value of a number card: optional `n` field, else trailing digits of the id (num-06 → 6).
  function cardNumber(card) {
    if (typeof card.n === 'number') return card.n;
    const m = /(\d+)$/.exec(card.id || '');
    return m ? parseInt(m[1], 10) : null;
  }

  // Returns { result: 'correct'|'close'|'wrong', expected: string }
  // `expected` is the spelling to show the user (the matched accepted form, or card.es).
  function grade(answer, card, categoryId) {
    const given = normalize(answer);
    const accepted = [card.es].concat(card.alt || []);

    if (given) {
      for (const form of accepted) {
        if (normalize(form) === given) return { result: CORRECT, expected: form };
      }
      if (categoryId === 'numbers' && /^\d+$/.test(given)) {
        const n = cardNumber(card);
        if (n !== null && parseInt(given, 10) === n) return { result: CORRECT, expected: card.es };
      }
      const bare = stripDiacritics(given);
      for (const form of accepted) {
        if (stripDiacritics(normalize(form)) === bare) return { result: CLOSE, expected: form };
      }
    }
    return { result: WRONG, expected: card.es };
  }

  const api = { CORRECT, CLOSE, WRONG, normalize, stripDiacritics, cardNumber, grade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Grading = api;
})(typeof self !== 'undefined' ? self : this);
