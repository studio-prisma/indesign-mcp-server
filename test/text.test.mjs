/**
 * Text tools: reading and searching.
 *
 * The regression that matters here: caseSensitive and wholeWord must be set
 * on findChangeTextOptions, never on findTextPreferences. The latter has no
 * such properties, and every call that touched them raised
 * "Object does not support the property or method 'caseSensitive'".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as text from '../lib/text-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  ['getTextContent', {}],
  ['getTextContent', { scope: 'document' }],
  ['getTextContent', { scope: 'page', pageIndex: 1 }],
  ['getTextContent', { scope: 'frame', pageIndex: 0, frameIndex: 2 }],
  ['getTextContent', { scope: 'selection' }],
  ['getTextContent', { scope: 'document', maxLength: 500, normalizeSpaces: false }],
  ['findText', { query: 'Muster' }],
  ['findText', { query: 'Muster', caseSensitive: true, wholeWord: true }],
  ['findText', { query: '\\d+', useGrep: true }],
  ['findText', { query: 'x', includeMasterPages: true, includeHiddenLayers: true }],
  ['findReplaceText', { findText: 'alt', replaceText: 'neu' }],
  ['findReplaceText', { findText: 'alt', replaceText: 'neu', caseSensitive: true }],
  ['findReplaceText', { findText: 'alt', replaceText: '', preview: true }],
  ['findReplaceText', { findText: '\\s+', replaceText: ' ', useGrep: true }],
];

for (const [name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 42)}: parseable`, () => {
    const res = parses(autoCaptureResult(text[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// ------------------------------------------------------------- the regression

test('caseSensitive is never set on findTextPreferences', () => {
  for (const args of [
    { findText: 'a', replaceText: 'b', caseSensitive: true },
    { findText: 'a', replaceText: 'b', wholeWord: true },
  ]) {
    const script = text.findReplaceText(args);
    assert.doesNotMatch(
      script, /findTextPreferences\s*\.\s*(caseSensitive|wholeWord)/,
      'setting these on findTextPreferences raises at runtime'
    );
    assert.match(
      script, /findChangeTextOptions\s*\.\s*(caseSensitive|wholeWord)/,
      'they belong on findChangeTextOptions'
    );
  }
  const search = text.findText({ query: 'a', caseSensitive: true, wholeWord: true });
  assert.doesNotMatch(search, /findTextPreferences\s*\.\s*(caseSensitive|wholeWord)/);
  assert.match(search, /findChangeTextOptions\s*\.\s*caseSensitive/);
});

test('GREP never gets a caseSensitive option', () => {
  // findChangeGrepOptions has no caseSensitive in InDesign 21.5.
  const script = text.findText({ query: 'a', useGrep: true });
  assert.doesNotMatch(script, /findChangeGrepOptions\s*\.\s*caseSensitive/);
});

test('GREP plus caseSensitive is refused, with the workaround named', () => {
  assert.throws(
    () => text.findReplaceText({ findText: 'a', replaceText: 'b', useGrep: true, caseSensitive: true }),
    /\(\?i\)/,
    'the error should name the (?i) workaround'
  );
});

test('find and replace reset every preference object', () => {
  for (const script of [
    text.findText({ query: 'a' }),
    text.findReplaceText({ findText: 'a', replaceText: 'b' }),
  ]) {
    for (const pref of ['findTextPreferences', 'changeTextPreferences',
      'findGrepPreferences', 'changeGrepPreferences']) {
      assert.match(
        script, new RegExp(pref + '\\s*=\\s*NothingEnum'),
        `${pref} is not reset - leftovers change the next call`
      );
    }
  }
});

// ------------------------------------------------------------ argument guards

test('scope is checked against the allow-list', () => {
  assert.throws(() => text.getTextContent({ scope: 'page; app.quit()' }), /Invalid value/);
});

test('scope frame without a frameIndex is refused, and says what to use', () => {
  assert.throws(() => text.getTextContent({ scope: 'frame' }), /scope 'page'/);
});

test('an empty search term is refused', () => {
  assert.throws(() => text.findReplaceText({ findText: '', replaceText: 'x' }), /must not be empty/);
  assert.throws(() => text.findReplaceText({ replaceText: 'x' }), /must not be empty/);
});

test('search terms stay data', () => {
  for (const script of [
    text.findText({ query: BREAKOUT }),
    text.findReplaceText({ findText: BREAKOUT, replaceText: BREAKOUT }),
  ]) {
    assert.ok(parses(script).ok, 'payload broke the script');
    const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/, 'query escaped its literal');
  }
});

test('numeric limits are validated', () => {
  assert.throws(() => text.findText({ query: 'a', maxHits: BREAKOUT }), /Invalid number/);
  assert.throws(() => text.findText({ query: 'a', contextChars: 999 }), /out of range/);
  assert.throws(() => text.getTextContent({ maxLength: BREAKOUT }), /Invalid number/);
});

test('reading text does not depend on hasOwnProperty', () => {
  // DOM objects expose properties through the host bridge, so hasOwnProperty
  // reports false for contents and the selection branch never fired.
  const script = text.getTextContent({ scope: 'selection' });
  // The call, not the word - the comment above the code names it too.
  assert.doesNotMatch(script, /\.\s*hasOwnProperty\s*\(/);
  assert.match(script, /typeof sel\.contents === "string"/);
});

test('an empty result explains itself instead of returning nothing', () => {
  const script = text.getTextContent({ scope: 'document' });
  assert.match(script, /No text found/);
  assert.match(script, /story object\(s\)/, 'should report what it did look at');
});
