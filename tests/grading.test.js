// Run: node tests/grading.test.js
const assert = require('node:assert/strict');
const { grade, normalize } = require('../grading.js');

const wed = { id: 'days-03', en: 'Wednesday', es: 'miércoles' };
const sat = { id: 'days-06', en: 'Saturday', es: 'sábado', ar: 'السبت' };
const one = { id: 'num-01', en: 'one', es: 'uno', alt: ['un', 'una'] };
const six = { id: 'num-06', en: 'six', es: 'seis' };
const sixteen = { id: 'num-16', en: 'sixteen', es: 'dieciséis', alt: ['diez y seis'] };
const year = { id: 'x-01', en: 'year', es: 'año' };
const sept = { id: 'mon-09', en: 'September', es: 'septiembre', alt: ['setiembre'] };

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function is(answer, card, cat, result, expected) {
  const r = grade(answer, card, cat);
  assert.equal(r.result, result, `"${answer}" → ${r.result}, wanted ${result}`);
  if (expected !== undefined) assert.equal(r.expected, expected);
}

console.log('grading.js');

test('exact match', () => is('miércoles', wed, 'days', 'correct', 'miércoles'));
test('exact match, capitalised (dictation)', () => is('Miércoles', wed, 'days', 'correct'));
test('missing accent: miercoles → close', () => is('miercoles', wed, 'days', 'close', 'miércoles'));
test('missing accent: sabado → close', () => is('sabado', sat, 'days', 'close', 'sábado'));
test('ñ missing: ano → close, shows año', () => is('ano', year, 'x', 'close', 'año'));
test('ñ present: año → correct', () => is('año', year, 'x', 'correct'));
test('alt answer: diez y seis → correct', () => is('diez y seis', sixteen, 'numbers', 'correct', 'diez y seis'));
test('alt answer: una → correct', () => is('una', one, 'numbers', 'correct'));
test('alt answer: setiembre → correct', () => is('setiembre', sept, 'months', 'correct'));
test('main answer without accent: dieciseis → close', () => is('dieciseis', sixteen, 'numbers', 'close', 'dieciséis'));
test('digit on number card: 6 → correct, shows seis', () => is('6', six, 'numbers', 'correct', 'seis'));
test('digit with punctuation: "16." → correct', () => is('16.', sixteen, 'numbers', 'correct', 'dieciséis'));
test('wrong digit on number card: 7 → wrong', () => is('7', six, 'numbers', 'wrong', 'seis'));
test('digit on non-number category → wrong', () => is('6', six, 'days', 'wrong'));
test('wrong answer → wrong, shows answer', () => is('martes', wed, 'days', 'wrong', 'miércoles'));
test('empty answer → wrong', () => is('   ', wed, 'days', 'wrong'));
test('extra spaces: "  diez   y  seis " → correct', () => is('  diez   y  seis ', sixteen, 'numbers', 'correct'));
test('punctuation: "¡Seis!" → correct', () => is('¡Seis!', six, 'numbers', 'correct'));
test('punctuation: "¿miércoles?" → correct', () => is('¿miércoles?', wed, 'days', 'correct'));
test('punctuation + missing accent: "Miercoles." → close', () => is('Miercoles.', wed, 'days', 'close'));
test('decomposed accent (NFD input) → correct', () => is('miércoles', wed, 'days', 'correct'));
test('normalize()', () => assert.equal(normalize('  ¿Diez,  y   SEIS?! '), 'diez y seis'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
