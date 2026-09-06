/**
 * Effects, gradients, table formatting and paragraph settings.
 *
 * Property and enum names verified against InDesign 21.5 — including one that
 * does not exist: cells use VerticalJustification, there is no
 * CellVerticalJustification.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as fx from '../lib/effect-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  ['applyEffect', { objectIndex: 0 }],
  ['applyEffect', { objectIndex: 0, effect: 'OUTER_GLOW', size: 4, opacity: 70 }],
  ['applyEffect', { objectIndex: 0, effect: 'BASIC_FEATHER', size: 3 }],
  ['applyEffect', { objectIndex: 0, effect: 'INNER_SHADOW', distance: 2, angle: 135 }],
  ['applyEffect', { objectIndex: 0, effect: 'BEVEL_EMBOSS', size: 2 }],
  ['applyEffect', { objectIndex: 0, effect: 'DROP_SHADOW', enabled: false }],
  ['applyEffect', { objectIndex: 0, blendMode: 'MULTIPLY', objectOpacity: 80 }],
  ['applyEffect', { objectIndex: 0, effect: 'OUTER_GLOW', effectColor: 'Black' }],
  ['createGradient', { name: 'Verlauf', stops: [{ color: 'Black' }, { color: 'Paper' }] }],
  ['createGradient', {
    name: 'Radial', type: 'RADIAL',
    stops: [{ color: 'Black', location: 0 }, { color: 'Paper', location: 100 }],
    objectIndex: 0, angle: 45,
  }],
  ['createGradient', {
    name: 'Drei', stops: [{ color: 'Black' }, { color: 'Paper' }, { color: 'Black' }],
  }],
  ['formatTable', { fillColor: 'Black', fillTint: 20 }],
  ['formatTable', { tableIndex: 1, borderWeight: 1, borderColor: 'Black' }],
  ['formatTable', { rowRange: 'header', fillColor: 'Black', verticalAlign: 'CENTER_ALIGN' }],
  ['formatTable', { rowRange: 'range', firstRow: 1, lastRow: 3, cellInset: 2 }],
  ['formatTable', { columnWidths: [40, 60, 40], headerRows: 1 }],
  ['formatParagraph', { frameIndex: 0, leftIndent: 5, spaceBefore: 2 }],
  ['formatParagraph', { frameIndex: 0, hyphenation: false, keepLinesTogether: true }],
  ['formatParagraph', { frameIndex: 0, firstLineIndent: 4, rightIndent: 3, spaceAfter: 1 }],
];

for (const [name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 44)}: parseable`, () => {
    const res = parses(autoCaptureResult(fx[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// -------------------------------------------------------------- API names

test('cells use VerticalJustification, not CellVerticalJustification', () => {
  // The latter does not exist; referencing it aborts the script.
  const script = fx.formatTable({ verticalAlign: 'CENTER_ALIGN' });
  assert.doesNotMatch(script, /CellVerticalJustification/);
  assert.match(script, /VerticalJustification\.CENTER_ALIGN/);
});

test('feather uses FeatherMode, glows use applied', () => {
  assert.match(fx.applyEffect({ objectIndex: 0, effect: 'BASIC_FEATHER' }),
    /featherSettings[\s\S]*FeatherMode\.STANDARD/);
  assert.match(fx.applyEffect({ objectIndex: 0, effect: 'OUTER_GLOW' }),
    /outerGlowSettings[\s\S]*applied = true/);
  assert.match(fx.applyEffect({ objectIndex: 0, effect: 'DROP_SHADOW' }),
    /dropShadowSettings[\s\S]*ShadowMode\.DROP/);
});

test('options an effect does not support are guarded, not fatal', () => {
  // A feather has no distance; setting it must not abort the call.
  const script = fx.applyEffect({ objectIndex: 0, effect: 'BASIC_FEATHER', distance: 3 });
  assert.match(script, /try \{ fx\.distance/, 'unsupported options must be guarded');
  assert.match(script, /skipped\.push/, 'and reported as skipped');
});

test('gradients use GradientType and stopColor', () => {
  const script = fx.createGradient({ name: 'g', type: 'RADIAL', stops: [{ color: 'Black' }, { color: 'Paper' }] });
  assert.match(script, /GradientType\.RADIAL/);
  assert.match(script, /stop\.stopColor/);
  assert.match(script, /stop\.location/);
});

// ------------------------------------------------------------ argument guards

test('effect and blend mode are checked against the allow-list', () => {
  assert.throws(() => fx.applyEffect({ objectIndex: 0, effect: 'DROP_SHADOW; app.quit()' }), /Invalid value/);
  assert.throws(() => fx.applyEffect({ objectIndex: 0, blendMode: 'MULTIPLY; app.quit()' }), /Invalid value/);
});

test('a gradient needs at least two stops', () => {
  assert.throws(() => fx.createGradient({ name: 'g', stops: [{ color: 'Black' }] }), /at least two/);
  assert.throws(() => fx.createGradient({ name: 'g', stops: [] }), /at least two/);
  assert.throws(() => fx.createGradient({ name: 'g' }), /at least two/);
});

test('stop locations are bounded', () => {
  assert.throws(
    () => fx.createGradient({ name: 'g', stops: [{ color: 'Black', location: -5 }, { color: 'Paper' }] }),
    /out of range/
  );
  assert.throws(
    () => fx.createGradient({ name: 'g', stops: [{ color: 'Black', location: BREAKOUT }, { color: 'Paper' }] }),
    /Invalid number/
  );
});

test('table and paragraph tools refuse a call that changes nothing', () => {
  assert.throws(() => fx.formatTable({}), /at least one of/);
  assert.throws(() => fx.formatParagraph({ frameIndex: 0 }), /at least one of/);
});

test('table row range is checked', () => {
  assert.throws(() => fx.formatTable({ fillColor: 'Black', rowRange: 'all; app.quit()' }), /Invalid value/);
  assert.throws(() => fx.formatTable({ verticalAlign: 'TOP_ALIGN; app.quit()' }), /Invalid value/);
});

test('swatch and gradient names stay data', () => {
  for (const script of [
    fx.applyEffect({ objectIndex: 0, effectColor: BREAKOUT }),
    fx.createGradient({ name: BREAKOUT, stops: [{ color: BREAKOUT }, { color: 'Paper' }] }),
    fx.formatTable({ fillColor: BREAKOUT }),
  ]) {
    assert.ok(parses(script).ok, 'payload broke the script');
    const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/);
  }
});

test('a table index out of range explains itself', () => {
  const script = fx.formatTable({ tableIndex: 5, fillColor: 'Black' });
  assert.match(script, /out of range/);
  assert.match(script, /holds no tables/, 'and covers the empty case too');
});

test('the enum lists match what InDesign 21.5 reports', () => {
  assert.equal(fx.EFFECT_TYPES.length, 9);
  assert.equal(fx.BLEND_MODES.length, 16);
  assert.equal(fx.GRADIENT_TYPES.length, 2);
  assert.equal(fx.CELL_VERTICAL.length, 4);
  assert.ok(fx.BLEND_MODES.includes('LUMINOSITY'));
});
