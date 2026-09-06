/**
 * Appearance tools, plus the two name regressions they came out of:
 * a rectangle has no cornerRadius, and Justification has no JUSTIFY.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as style from '../lib/style-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  ['formatObject', { objectIndex: 0, fillColor: 'Black' }],
  ['formatObject', { objectIndex: 0, fillColor: 'None', strokeColor: 'None' }],
  ['formatObject', { objectIndex: 0, strokeColor: 'Black', strokeWeight: 2, strokeAlignment: 'INSIDE_ALIGNMENT' }],
  ['formatObject', { objectIndex: 0, opacity: 50, fillTint: 40 }],
  ['formatObject', { objectIndex: 0, cornerRadius: 5 }],
  ['formatObject', { objectIndex: 0, cornerRadius: 3, cornerStyle: 'BEVEL_CORNER' }],
  ['applyShadow', { objectIndex: 0 }],
  ['applyShadow', { objectIndex: 0, enabled: false }],
  ['applyShadow', { objectIndex: 0, opacity: 60, xOffset: 1, yOffset: 1, blur: 2 }],
  ['transformContent', { objectIndex: 0, scale: 120 }],
  ['transformContent', { objectIndex: 0, scaleX: 110, scaleY: 90 }],
  ['transformContent', { objectIndex: 0, offsetX: -5, offsetY: 3 }],
  ['transformContent', { objectIndex: 0, rotation: 15 }],
  ['formatText', { frameIndex: 0, fontSize: 18 }],
  ['formatText', { frameIndex: 0, fontFamily: 'Helvetica Neue', fontStyle: 'Bold' }],
  ['formatText', { frameIndex: 0, alignment: 'FULLY_JUSTIFIED', leading: 20, tracking: 10 }],
  ['formatText', { frameIndex: 0, textColor: 'Black', allCaps: true }],
];

for (const [name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 44)}: parseable`, () => {
    const res = parses(autoCaptureResult(style[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// ------------------------------------------------------------- regressions

test('rounded corners never use a cornerRadius property', () => {
  // A rectangle has no cornerRadius; each corner carries its own.
  const script = style.formatObject({ objectIndex: 0, cornerRadius: 5 });
  assert.doesNotMatch(script, /item\.cornerRadius\s*=/);
  for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    assert.match(script, new RegExp(corner + 'CornerRadius'), `${corner} not set`);
    assert.match(script, new RegExp(corner + 'CornerOption'), `${corner} option not set`);
  }
});

test('create_rectangle no longer uses cornerRadius either', () => {
  const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /rect\.cornerRadius\s*=/,
    'a rectangle has no cornerRadius property; the call raises at runtime');
  assert.match(src, /topLeftCornerRadius/);
});

test('no tool schema offers JUSTIFY', () => {
  // Justification has LEFT_ALIGN, CENTER_ALIGN, RIGHT_ALIGN and four
  // _JUSTIFIED members - offering JUSTIFY means the validator rejects a
  // value the tool itself suggested.
  const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'JUSTIFY'/);
  assert.match(src, /'FULLY_JUSTIFIED'/);
});

test('format_text accepts every justified value the schema offers', () => {
  for (const a of ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN',
    'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED']) {
    assert.doesNotThrow(
      () => style.formatText({ frameIndex: 0, alignment: a }),
      `${a} is offered in the schema but rejected`
    );
  }
});

// ------------------------------------------------------------ argument guards

test('every tool refuses a call that changes nothing', () => {
  assert.throws(() => style.formatObject({ objectIndex: 0 }), /at least one of/);
  assert.throws(() => style.transformContent({ objectIndex: 0 }), /at least one of/);
  assert.throws(() => style.formatText({ frameIndex: 0 }), /at least one of/);
});

test('enums are checked', () => {
  assert.throws(
    () => style.formatObject({ objectIndex: 0, cornerRadius: 2, cornerStyle: 'ROUNDED_CORNER; app.quit()' }),
    /Invalid value/
  );
  assert.throws(
    () => style.formatObject({ objectIndex: 0, strokeAlignment: 'INSIDE_ALIGNMENT; app.quit()' }),
    /Invalid value/
  );
  assert.throws(
    () => style.formatText({ frameIndex: 0, alignment: 'JUSTIFY' }),
    /Invalid value/,
    'JUSTIFY must still be rejected - it does not exist in InDesign'
  );
});

test('numeric ranges are enforced', () => {
  assert.throws(() => style.formatObject({ objectIndex: 0, opacity: 150 }), /out of range/);
  assert.throws(() => style.formatObject({ objectIndex: 0, fillTint: -5 }), /out of range/);
  assert.throws(() => style.formatObject({ objectIndex: 0, strokeWeight: BREAKOUT }), /Invalid number/);
  assert.throws(() => style.transformContent({ objectIndex: 0, scale: BREAKOUT }), /Invalid number/);
});

test('swatch names stay data', () => {
  const script = style.formatObject({ objectIndex: 0, fillColor: BREAKOUT });
  assert.ok(parses(script).ok);
  const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/);
});

test('an unknown swatch lists what the document has', () => {
  const script = style.formatObject({ objectIndex: 0, fillColor: 'Nonexistent' });
  assert.match(script, /Available:/, 'a mistyped swatch should say what exists');
  assert.match(script, /list_color_swatches/, 'and point at the tool that lists them');
});

test('transform_content explains itself on a frame without artwork', () => {
  const script = style.transformContent({ objectIndex: 0, scale: 120 });
  assert.match(script, /holds no artwork/);
  assert.match(script, /transform_object/, 'should point at the tool for the frame itself');
});

test('the enum lists match what InDesign 21.5 reports', () => {
  assert.equal(style.CORNER_OPTIONS.length, 6);
  assert.ok(style.CORNER_OPTIONS.includes('FANCY_CORNER'));
  assert.equal(style.STROKE_ALIGNMENT.length, 3);
  assert.equal(style.ANCHOR_POINTS.length, 9);
});
