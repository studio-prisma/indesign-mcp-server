/**
 * The generic property access, and above all its boundaries.
 *
 * These tools reach every property of every object, which is the point. What
 * they must not become is a second execute_indesign_code: nothing a caller
 * sends may end up as a statement. Most of this file tests that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as g from '../lib/generic-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

/** Strip string literals, then look for anything executable. */
function noCodeEscaped(script, what) {
  assert.ok(parses(script).ok, `${what}: script does not parse`);
  const withoutStrings = script
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit\s*\(/, `${what}: app.quit() escaped`);
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*system\s*\(/, `${what}: app.system() escaped`);
}

// ------------------------------------------------------------- happy path

const CASES = [
  ['inspectObject', { target: { kind: 'document' } }],
  ['inspectObject', { target: { kind: 'pageItem', objectIndex: 0 } }],
  ['inspectObject', { target: { kind: 'pageItem', objectIndex: 0 }, properties: ['fillColor', 'geometricBounds'] }],
  ['inspectObject', { target: { kind: 'textFrame', frameIndex: 0 }, properties: ['contents', 'overflows'] }],
  ['inspectObject', { target: { kind: 'story', storyIndex: 0 } }],
  ['inspectObject', { target: { kind: 'paragraph', storyIndex: 0, itemIndex: 2 } }],
  ['inspectObject', { target: { kind: 'cell', tableIndex: 0, row: 1, column: 2 } }],
  ['inspectObject', { target: { kind: 'swatch', name: 'Black' } }],
  ['inspectObject', { target: { kind: 'paragraphStyle', name: 'Basis' } }],
  ['inspectObject', { target: { kind: 'application' } }],
  ['setProperties', { target: { kind: 'pageItem', objectIndex: 0 }, properties: { rotationAngle: 45 } }],
  ['setProperties', {
    target: { kind: 'pageItem', objectIndex: 0 },
    properties: {
      'transparencySettings.blendingSettings.opacity': 50,
      'transparencySettings.dropShadowSettings.size': { measure: 3 },
      fillColor: { swatch: 'Black' },
      visible: true,
      name: 'Kasten',
    },
  }],
  ['setProperties', {
    target: { kind: 'paragraph', storyIndex: 0, itemIndex: 0 },
    properties: { justification: { enum: 'Justification.CENTER_ALIGN' }, leftIndent: 5 },
  }],
  ['setProperties', {
    target: { kind: 'pageItem', objectIndex: 0 },
    properties: { geometricBounds: [10, 10, 50, 90] },
  }],
  ['callMethod', { target: { kind: 'pageItem', objectIndex: 0 }, method: 'bringToFront' }],
  ['callMethod', { target: { kind: 'pageItem', objectIndex: 0 }, method: 'fit', args: [{ enum: 'FitOptions.PROPORTIONALLY' }] }],
  ['callMethod', { target: { kind: 'pageItem', objectIndex: 0 }, method: 'move', args: [[20, 30]] }],
];

for (const [name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 50)}: parseable`, () => {
    const res = parses(autoCaptureResult(g[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// --------------------------------------------------- what must be refused

test('a property path cannot carry code', () => {
  for (const bad of [
    'name; app.quit()',
    'foo()',
    'pages[0]',
    'a b',
    'name /* */ ',
    '__proto__.x',      // starts with an underscore, not a plain name
    '',
    'a.'.repeat(8) + 'b', // too deep
  ]) {
    assert.throws(
      () => g.setProperties({ target: { kind: 'document' }, properties: { [bad]: 1 } }),
      /Invalid property path/,
      `path accepted: ${JSON.stringify(bad)}`
    );
  }
});

test('an enum reference cannot carry code', () => {
  for (const bad of [
    'Justification.CENTER_ALIGN; app.quit()',
    'app.quit()',
    'A.B.C',
    'A',
    'A.B()',
  ]) {
    assert.throws(
      () => g.setProperties({
        target: { kind: 'document' },
        properties: { x: { enum: bad } },
      }),
      /Invalid enum/,
      `enum accepted: ${JSON.stringify(bad)}`
    );
  }
});

test('only allow-listed methods can be called', () => {
  for (const bad of ['quit', 'doScript', 'eval', 'fit; app.quit()', 'system']) {
    assert.throws(
      () => g.callMethod({ target: { kind: 'document' }, method: bad }),
      /Invalid value/,
      `method accepted: ${JSON.stringify(bad)}`
    );
  }
  assert.ok(!g.ALLOWED_METHODS.includes('doScript'));
  assert.ok(!g.ALLOWED_METHODS.includes('quit'));
  assert.ok(!g.ALLOWED_METHODS.includes('eval'));
});

test('the target kind is checked against the allow-list', () => {
  assert.throws(
    () => g.inspectObject({ target: { kind: 'document; app.quit()' } }),
    /Invalid value/
  );
});

test('target indices are validated', () => {
  assert.throws(
    () => g.inspectObject({ target: { kind: 'pageItem', objectIndex: '0]; app.quit(); //' } }),
    /Invalid index/
  );
  assert.throws(
    () => g.inspectObject({ target: { kind: 'cell', tableIndex: BREAKOUT, row: 0, column: 0 } }),
    /Invalid index/
  );
});

test('string values stay data', () => {
  noCodeEscaped(
    g.setProperties({ target: { kind: 'pageItem', objectIndex: 0 }, properties: { name: BREAKOUT } }),
    'string value'
  );
  noCodeEscaped(
    g.setProperties({
      target: { kind: 'pageItem', objectIndex: 0 },
      properties: { fillColor: { swatch: BREAKOUT } },
    }),
    'swatch name'
  );
  noCodeEscaped(
    g.inspectObject({ target: { kind: 'swatch', name: BREAKOUT } }),
    'target name'
  );
});

test('unsupported value shapes are refused rather than guessed', () => {
  for (const bad of [() => {}, Symbol('x'), { unknown: 'thing' }, { enum: 5 }]) {
    assert.throws(
      () => g.setProperties({ target: { kind: 'document' }, properties: { x: bad } }),
      /Unsupported value|Invalid enum/,
      `value accepted: ${String(bad)}`
    );
  }
});

test('a measure carries its unit and is validated', () => {
  const script = g.setProperties({
    target: { kind: 'pageItem', objectIndex: 0 },
    properties: { 'transparencySettings.dropShadowSettings.size': { measure: 3, unit: 'mm' } },
  });
  assert.match(script, /"3mm"/);
  assert.throws(
    () => g.setProperties({
      target: { kind: 'document' },
      properties: { x: { measure: 3, unit: 'mm; app.quit()' } },
    }),
    /Invalid unit/
  );
});

test('call arguments are typed like property values', () => {
  assert.throws(
    () => g.callMethod({ target: { kind: 'document' }, method: 'fit', args: [{ enum: 'A.B; app.quit()' }] }),
    /Invalid enum/
  );
  assert.throws(
    () => g.callMethod({ target: { kind: 'document' }, method: 'fit', args: 'not-an-array' }),
    /must be an array/
  );
  noCodeEscaped(
    g.callMethod({ target: { kind: 'document' }, method: 'save', args: [BREAKOUT] }),
    'call argument'
  );
});

test('bulk limits keep one call bounded', () => {
  const many = {};
  for (let i = 0; i < 41; i++) many['prop' + i] = 1;
  assert.throws(
    () => g.setProperties({ target: { kind: 'document' }, properties: many }),
    /at most 40/
  );
  assert.throws(
    () => g.setProperties({ target: { kind: 'document' }, properties: {} }),
    /at least one/
  );
  assert.throws(
    () => g.callMethod({ target: { kind: 'document' }, method: 'fit', args: [1, 2, 3, 4, 5, 6, 7] }),
    /at most six/
  );
});

// ----------------------------------------------------------- behaviour

test('each assignment is guarded on its own', () => {
  // One name this version lacks must not take the others with it.
  const script = g.setProperties({
    target: { kind: 'pageItem', objectIndex: 0 },
    properties: { rotationAngle: 45, cornerRadius: 5 },
  });
  assert.equal((script.match(/try \{/g) || []).length >= 2, true,
    'assignments are not individually guarded');
  assert.match(script, /failed\.push/);
  assert.match(script, /does not have raises rather than being/,
    'the response should explain what a failure means');
});

test('inspect without properties lists what an object offers', () => {
  const script = g.inspectObject({ target: { kind: 'pageItem', objectIndex: 0 } });
  assert.match(script, /for \(var k in obj\)/, 'should enumerate');
  assert.match(script, /readable properties/);
  assert.match(script, /set_properties/, 'and point at how to change them');
});

test('a name that does not resolve lists the alternatives', () => {
  const script = g.inspectObject({ target: { kind: 'swatch', name: 'Nonexistent' } });
  assert.match(script, /Available:/);
});

test('target kinds cover the objects a layout is made of', () => {
  for (const kind of ['document', 'page', 'pageItem', 'textFrame', 'story',
    'paragraph', 'table', 'cell', 'layer', 'swatch', 'paragraphStyle']) {
    assert.ok(g.TARGET_KINDS.includes(kind), `${kind} missing`);
  }
  assert.equal(g.TARGET_KINDS.length, 18);
});
