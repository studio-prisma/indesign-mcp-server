/**
 * Layout tools: script generation and argument handling.
 *
 * Same contract as the other suites — the generated ExtendScript must parse,
 * stay ES3, and never carry an argument value as code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runTool, parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as layout from '../lib/layout-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  ['inspectPage', { pageIndex: 0 }],
  ['checkLayout', { pageIndex: 0, ignoreOverlapBelowMm: 1 }],
  ['moveObject', { pageIndex: 0, objectIndex: 0, x: 20, y: 30 }],
  ['moveObject', { pageIndex: 0, objectIndex: 0, dx: -5, dy: 2.5 }],
  ['resizeObject', { pageIndex: 0, objectIndex: 0, width: 80, height: 40 }],
  ['deleteObject', { pageIndex: 0, objectIndex: 0, confirmDestructive: true }],
  ['arrangeObject', { pageIndex: 0, objectIndex: 0, position: 'BRING_TO_FRONT' }],
  ['fitFrame', { pageIndex: 0, objectIndex: 0, fitOption: 'PROPORTIONALLY' }],
];

for (const [name, args] of CASES) {
  test(`${name}: produces parseable ExtendScript`, () => {
    const script = layout[name](args);
    const res = parses(autoCaptureResult(script));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

test('every builder rejects a non-numeric objectIndex', () => {
  for (const name of ['moveObject', 'resizeObject', 'deleteObject', 'fitFrame']) {
    assert.throws(
      () => layout[name]({ objectIndex: '0]; app.quit(); //' }),
      /Invalid index/,
      `${name} accepted a payload as objectIndex`
    );
  }
  assert.throws(
    () => layout.arrangeObject({ objectIndex: '0]; app.quit(); //', position: 'BRING_TO_FRONT' }),
    /Invalid index/
  );
});

test('arrange_object rejects a position outside the allow-list', () => {
  assert.throws(
    () => layout.arrangeObject({ objectIndex: 0, position: 'BRING_TO_FRONT; app.quit()' }),
    /Invalid value/
  );
});

test('fit_frame rejects a fitOption outside the allow-list', () => {
  assert.throws(
    () => layout.fitFrame({ objectIndex: 0, fitOption: 'PROPORTIONALLY; app.quit()' }),
    /Invalid value/
  );
});

test('coordinates reject non-numeric payloads', () => {
  assert.throws(() => layout.moveObject({ objectIndex: 0, x: BREAKOUT }), /Invalid number/);
  assert.throws(() => layout.resizeObject({ objectIndex: 0, width: BREAKOUT }), /Invalid number/);
  assert.throws(
    () => layout.checkLayout({ ignoreOverlapBelowMm: BREAKOUT }),
    /Invalid number/
  );
});

// --------------------------------------------------------------- via server

test('inspect_page and check_layout reach the server without arguments', async () => {
  for (const method of ['inspectPage', 'checkLayout']) {
    const { error, script } = await runTool(method, {});
    assert.ok(!error, `${method} threw: ${error && error.message}`);
    assert.ok(script, `${method} produced no script`);
    assert.ok(parses(autoCaptureResult(script)).ok);
  }
});

test('delete_object refuses without confirmDestructive', async () => {
  const { error, script } = await runTool('deleteObject', { objectIndex: 0 });
  assert.ok(error, 'delete_object ran without confirmation');
  assert.equal(script, null, 'a script was produced despite refusing');
});

test('place_image reports a failed import instead of claiming success', async () => {
  const { error, script } = await runTool('placeImage', {
    imagePath: os.tmpdir() + '/does-not-matter.svg',
    pageIndex: 0, x: 10, y: 10, width: 50, height: 50,
  });
  if (error) return;                       // path rejection is a valid outcome
  // The generated script must check for artwork and be able to say so.
  assert.match(script, /allGraphics\.length === 0/,
    'place_image does not verify that the import produced artwork');
  assert.match(script, /ERROR: no artwork imported/,
    'place_image has no failure path for an empty import');
  assert.match(script, /FILL_PROPORTIONALLY/,
    'place_image does not handle every fit option it accepts');
});

// ------------------------------------------------------------ unit guardrail

test('a point size that looks like millimetres gets a note, not an error', async () => {
  const { error, script } = await runTool('createTextFrame', {
    content: 'x', x: 10, y: 10, width: 50, height: 20, pageIndex: 0,
    fontSize: 10, fontFamily: 'Helvetica Neue', alignment: 'LEFT_ALIGN',
  });
  assert.ok(!error, 'a small point size must not be rejected');
  assert.ok(script, 'no script produced');
});

test('the unit note fires only for implausibly small point sizes', async () => {
  const { loadServer } = await import('./harness.mjs');
  const { server } = await loadServer();
  assert.equal(server.noteIfSuspiciousFontSize('ok', 12), 'ok', '12 pt must pass silently');
  assert.equal(server.noteIfSuspiciousFontSize('ok', 4), 'ok', '4 pt is the threshold');
  assert.match(server.noteIfSuspiciousFontSize('ok', 3), /very small/, '3 pt should be flagged');
  assert.match(server.noteIfSuspiciousFontSize('ok', 3), /8\.5/, 'should suggest the mm conversion');
  assert.equal(server.noteIfSuspiciousFontSize('ok', undefined), 'ok', 'absent size must pass');
});
