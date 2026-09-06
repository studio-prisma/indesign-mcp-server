/**
 * Arrange and flow tools: script generation and argument handling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as arrange from '../lib/arrange-tools.js';
import * as flow from '../lib/flow-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  [arrange, 'alignObjects', { objectIndices: [0, 1], alignment: 'LEFT_EDGES' }],
  [arrange, 'alignObjects', { objectIndices: [0], alignment: 'HORIZONTAL_CENTERS', relativeTo: 'PAGE_BOUNDS' }],
  [arrange, 'distributeObjects', { objectIndices: [0, 1, 2], distribution: 'HORIZONTAL_SPACE' }],
  [arrange, 'distributeObjects', { objectIndices: [0, 1, 2], distribution: 'VERTICAL_SPACE', spacing: 5 }],
  [arrange, 'groupObjects', { objectIndices: [0, 1], name: 'Header' }],
  [arrange, 'ungroupObjects', { objectIndex: 0 }],
  [arrange, 'transformObject', { objectIndex: 0, rotation: 45 }],
  [arrange, 'transformObject', { objectIndex: 0, scaleX: 120, scaleY: 120 }],
  [arrange, 'transformObject', { objectIndex: 0, flipHorizontal: true }],
  [flow, 'threadTextFrames', { frames: [{ pageIndex: 0, frameIndex: 0 }, { pageIndex: 0, frameIndex: 1 }] }],
  [flow, 'threadTextFrames', { pageIndex: 0, readingOrder: true }],
  [flow, 'setTextFrameOptions', { frameIndex: 0, columns: 2, columnGutter: 4, inset: 3 }],
  [flow, 'setTextFrameOptions', { frameIndex: 0, verticalJustification: 'CENTER_ALIGN' }],
  [flow, 'setTextWrap', { objectIndex: 0, mode: 'BOUNDING_BOX_TEXT_WRAP', offset: 3 }],
  [flow, 'setTextWrap', { objectIndex: 0, mode: 'NONE' }],
  [flow, 'listMasterPages', {}],
  [flow, 'applyMasterPage', { pageIndex: 1, masterName: 'A-Master' }],
  [flow, 'applyMasterPage', { pageIndex: 1, masterName: '' }],
  [flow, 'insertPageNumber', { frameIndex: 0, onMaster: true, masterName: 'A-Master', prefix: 'Page ' }],
  [flow, 'listLinks', {}],
  [flow, 'updateLinks', { onlyOutOfDate: true }],
  [flow, 'undoSteps', { steps: 2 }],
];

for (const [mod, name, args] of CASES) {
  const label = JSON.stringify(args).slice(0, 46);
  test(`${name} ${label}: parseable ExtendScript`, () => {
    const res = parses(autoCaptureResult(mod[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// ------------------------------------------------------------ argument guards

test('align rejects an alignment outside the allow-list', () => {
  assert.throws(
    () => arrange.alignObjects({ objectIndices: [0, 1], alignment: 'LEFT_EDGES; app.quit()' }),
    /Invalid value/
  );
});

test('align rejects a payload in the index list', () => {
  assert.throws(
    () => arrange.alignObjects({ objectIndices: [0, '1]; app.quit(); //'], alignment: 'LEFT_EDGES' }),
    /Invalid index/
  );
});

test('align to ITEM_BOUNDS needs two objects, and says why', () => {
  assert.throws(
    () => arrange.alignObjects({ objectIndices: [0], alignment: 'LEFT_EDGES' }),
    /at least two objects/
  );
});

test('distribute across ITEM_BOUNDS needs three objects', () => {
  assert.throws(
    () => arrange.distributeObjects({ objectIndices: [0, 1], distribution: 'HORIZONTAL_SPACE' }),
    /at least three objects/
  );
});

test('group needs two objects', () => {
  assert.throws(() => arrange.groupObjects({ objectIndices: [0] }), /at least two objects/);
});

test('group escapes the name', () => {
  const script = arrange.groupObjects({ objectIndices: [0, 1], name: BREAKOUT });
  assert.ok(parses(script).ok, 'payload broke the script');
  const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/, 'name escaped its literal');
});

test('transform rejects a call that changes nothing', () => {
  assert.throws(() => arrange.transformObject({ objectIndex: 0 }), /at least one of/);
});

test('transform rejects non-numeric values', () => {
  assert.throws(() => arrange.transformObject({ objectIndex: 0, rotation: BREAKOUT }), /Invalid number/);
  assert.throws(() => arrange.transformObject({ objectIndex: 0, scaleX: BREAKOUT }), /Invalid number/);
});

test('threading needs at least two frames', () => {
  assert.throws(() => flow.threadTextFrames({ frames: [{ frameIndex: 0 }] }), /at least two/);
  assert.throws(() => flow.threadTextFrames({ frames: [] }), /at least two/);
});

test('threading rejects a payload in a frame reference', () => {
  assert.throws(
    () => flow.threadTextFrames({ frames: [{ frameIndex: 0 }, { frameIndex: '1]; app.quit()' }] }),
    /Invalid index/
  );
});

test('text frame options reject a call that changes nothing', () => {
  assert.throws(() => flow.setTextFrameOptions({ frameIndex: 0 }), /at least one of/);
});

test('text frame options reject a bad vertical justification', () => {
  assert.throws(
    () => flow.setTextFrameOptions({ frameIndex: 0, verticalJustification: 'TOP_ALIGN; app.quit()' }),
    /Invalid value/
  );
});

test('text wrap rejects a mode outside the allow-list', () => {
  assert.throws(
    () => flow.setTextWrap({ objectIndex: 0, mode: 'CONTOUR; app.quit()' }),
    /Invalid value/
  );
});

test('apply_master_page escapes the master name', () => {
  const script = flow.applyMasterPage({ pageIndex: 0, masterName: BREAKOUT });
  assert.ok(parses(script).ok);
  const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/);
});

test('undo bounds the number of steps', () => {
  assert.throws(() => flow.undoSteps({ steps: 0 }), /out of range/);
  assert.throws(() => flow.undoSteps({ steps: 999 }), /out of range/);
  assert.throws(() => flow.undoSteps({ steps: BREAKOUT }), /Invalid number/);
});

test('the enum lists match what InDesign 21.5 reports', () => {
  assert.equal(arrange.ALIGN_OPTIONS.length, 6);
  assert.equal(arrange.DISTRIBUTE_OPTIONS.length, 8);
  assert.equal(arrange.ALIGN_BOUNDS.length, 6);
  assert.ok(arrange.ALIGN_BOUNDS.includes('BLEED_BOUNDS'));
  assert.ok(arrange.DISTRIBUTE_OPTIONS.includes('HORIZONTAL_SPACE'));
  assert.equal(flow.VERTICAL_JUSTIFICATION.length, 4);
  assert.equal(flow.TEXT_WRAP_MODES.length, 5);
});

test('reading-order threading needs no frame list', () => {
  const script = flow.threadTextFrames({ pageIndex: 0, readingOrder: true });
  assert.ok(parses(script).ok);
  assert.match(script, /frames\.sort/, 'frames are not sorted by position');
  assert.match(script, /Math\.abs\(ab\[0\] - bb\[0\]\) > 5/, 'no same-line tolerance');
});

test('the explicit form still says why a list is needed', () => {
  assert.throws(
    () => flow.threadTextFrames({ frames: [{ frameIndex: 0 }] }),
    /readingOrder/,
    'the error should point at the simpler option'
  );
});
