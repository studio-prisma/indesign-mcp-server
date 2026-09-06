/**
 * Shapes and sections — the object types and document structure the generic
 * layer cannot reach, because creating something is not one of its allowed
 * methods and never should be.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as shapes from '../lib/shape-tools.js';
import * as flow from '../lib/flow-tools.js';

const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  [shapes, 'createPolygon', { x: 10, y: 10, width: 40, height: 40 }],
  [shapes, 'createPolygon', { x: 10, y: 10, width: 40, height: 40, sides: 3 }],
  [shapes, 'createPolygon', { x: 0, y: 0, width: 60, height: 60, sides: 5, starInset: 45, fillColor: 'Black', rotation: 30 }],
  [shapes, 'createLine', { x1: 10, y1: 10, x2: 90, y2: 10 }],
  [shapes, 'createLine', { x1: 10, y1: 10, x2: 90, y2: 60, strokeWidth: 3, strokeType: 'Dashed' }],
  [shapes, 'createAnchoredFrame', { width: 20, height: 20, characterOffset: 12, content: 'Note' }],
  [shapes, 'createAnchoredFrame', { width: 20, height: 20, position: 'ABOVE_LINE', yOffset: 3 }],
  [shapes, 'createAnchoredFrame', { width: 20, height: 20, imagePath: path.join(os.homedir(), 'logo.png') }],
  [flow, 'createSection', {}],
  [flow, 'createSection', { pageIndex: 4, pageNumberStyle: 'LOWER_ROMAN', pageNumberStart: 1 }],
  [flow, 'createSection', { continueNumbering: true, sectionPrefix: 'A', includeSectionPrefix: true, marker: 'Appendix' }],
  [flow, 'listSections', {}],
];

for (const [mod, name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 46)}: parseable`, () => {
    const res = parses(autoCaptureResult(mod[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// ------------------------------------------------------------- geometry

test('a polygon gets as many corners as it was asked for', () => {
  for (const sides of [3, 6, 12]) {
    const script = shapes.createPolygon({ x: 0, y: 0, width: 50, height: 50, sides });
    const corners = (script.match(/\["[-\d.]+mm", "[-\d.]+mm"\]/g) || []).length;
    assert.equal(corners, sides, `${sides} sides produced ${corners} corners`);
  }
});

test('a star inset doubles the corners', () => {
  const script = shapes.createPolygon({ x: 0, y: 0, width: 50, height: 50, sides: 5, starInset: 40 });
  const corners = (script.match(/\["[-\d.]+mm", "[-\d.]+mm"\]/g) || []).length;
  assert.equal(corners, 10, 'a five-pointed star needs ten corners');
  assert.match(script, /Star with 10 corner/);
});

test('the corners sit inside the box they were given', () => {
  const script = shapes.createPolygon({ x: 20, y: 30, width: 40, height: 60, sides: 8 });
  const nums = [...script.matchAll(/\["([-\d.]+)mm", "([-\d.]+)mm"\]/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(nums.length, 8);
  for (const [x, y] of nums) {
    assert.ok(x >= 19.9 && x <= 60.1, `x out of the box: ${x}`);
    assert.ok(y >= 29.9 && y <= 90.1, `y out of the box: ${y}`);
  }
});

test('a line has exactly two points', () => {
  const script = shapes.createLine({ x1: 5, y1: 5, x2: 95, y2: 45 });
  const pts = (script.match(/\["[-\d.]+mm", "[-\d.]+mm"\]/g) || []).length;
  assert.equal(pts, 2);
});

// ------------------------------------------------------------- behaviour

test('an anchored frame is created on the insertion point', () => {
  // move() and duplicate() to an insertion point are refused by InDesign 21.5,
  // so creation is the only route. If this ever changes to move(), the tool
  // stops working and nothing else would notice.
  const script = shapes.createAnchoredFrame({ width: 10, height: 10, content: 'x' });
  assert.match(script, /insertionPoints\[\d+\]\.textFrames\.add\(\)/);
  assert.match(script, /anchoredObjectSettings/);
  assert.match(script, /AnchorPosition\.INLINE_POSITION/);
  assert.doesNotMatch(script, /\.move\(/, 'move() to an insertion point does not work');
});

test('an anchored image uses a rectangle and checks the artwork arrived', () => {
  const script = shapes.createAnchoredFrame({
    width: 10, height: 10, imagePath: path.join(os.homedir(), 'logo.png'),
  });
  assert.match(script, /insertionPoints\[\d+\]\.rectangles\.add\(\)/);
  assert.match(script, /allGraphics\.length === 0/, 'a silent import failure must be caught');
});

test('a new shape has no stroke unless one was asked for', () => {
  for (const [name, args] of [
    ['createPolygon', { x: 0, y: 0, width: 10, height: 10 }],
    ['createAnchoredFrame', { width: 10, height: 10 }],
  ]) {
    assert.match(
      shapes[name](args),
      /strokeColor = doc\.swatches\.itemByName\("None"\)/,
      `${name} leaves InDesign's default 1 pt stroke on the frame`
    );
  }
});

test('a section reports the page names, not just success', () => {
  const script = flow.createSection({ pageIndex: 2, pageNumberStyle: 'LOWER_ROMAN' });
  assert.match(script, /Page names now/, 'the numbering is the thing being changed');
  assert.match(script, /PageNumberStyle\.LOWER_ROMAN/);
});

test('a second section on the same page updates rather than duplicating', () => {
  const script = flow.createSection({ pageIndex: 0 });
  assert.match(script, /existing/, 'sections.add on a page that already starts one raises');
});

// ------------------------------------------------------------- refusals

test('page number styles are checked against what 21.5 actually has', () => {
  assert.ok(flow.PAGE_NUMBER_STYLES.includes('LOWER_ROMAN'));
  // Both appear in older references and are gone. Offering them would abort
  // the whole call, which looks like the tool doing nothing.
  assert.ok(!flow.PAGE_NUMBER_STYLES.includes('KATAKANA_MODERN'));
  assert.ok(!flow.PAGE_NUMBER_STYLES.includes('FULL_WIDTH_ARABIC'));
  assert.throws(
    () => flow.createSection({ pageNumberStyle: 'KATAKANA_MODERN' }),
    /Invalid value/
  );
});

test('anchor positions come from AnchorPosition, which is the one that exists', () => {
  assert.deepEqual(shapes.ANCHOR_POSITIONS, ['INLINE_POSITION', 'ABOVE_LINE', 'ANCHORED']);
  assert.throws(
    () => shapes.createAnchoredFrame({ width: 10, height: 10, position: 'ANCHORED; app.quit()' }),
    /Invalid value/
  );
});

test('numeric arguments are validated', () => {
  assert.throws(() => shapes.createPolygon({ x: 0, y: 0, width: 10, height: 10, sides: 2 }), /out of range/);
  assert.throws(() => shapes.createPolygon({ x: 0, y: 0, width: 10, height: 10, sides: 1000 }), /out of range/);
  assert.throws(() => shapes.createLine({ x1: BREAKOUT, y1: 0, x2: 10, y2: 10 }), /Invalid/);
  assert.throws(() => flow.createSection({ pageIndex: '0]; app.quit(); //' }), /Invalid index/);
});

test('names stay data', () => {
  for (const script of [
    shapes.createPolygon({ x: 0, y: 0, width: 10, height: 10, fillColor: BREAKOUT }),
    shapes.createLine({ x1: 0, y1: 0, x2: 10, y2: 10, strokeType: BREAKOUT }),
    shapes.createAnchoredFrame({ width: 10, height: 10, content: BREAKOUT }),
    flow.createSection({ sectionPrefix: BREAKOUT, marker: BREAKOUT }),
  ]) {
    assert.ok(parses(autoCaptureResult(script)).ok, 'escaped payload broke the script');
    const withoutStrings = script
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit\s*\(/, 'app.quit() escaped its string');
  }
});

// ------------------------------------------------- the order that matters

/**
 * Weight before colour, everywhere.
 *
 * The other order looks identical and silently does nothing: assigning
 * strokeWeight after strokeColor pulls the item defaults back, and the object
 * keeps the stroke it was supposed to lose. Reproduced against InDesign 21.5
 * on rectangles, polygons and text frames. 2.1.0 shipped the wrong order and
 * the fix had no effect at all.
 */
function assertWeightFirst(script, what) {
  const weight = script.search(/\.strokeWeight\s*=/);
  const colour = script.search(/\.strokeColor\s*=/);
  assert.notEqual(weight, -1, `${what}: no stroke weight assigned`);
  assert.notEqual(colour, -1, `${what}: no stroke colour assigned`);
  assert.ok(
    weight < colour,
    `${what}: strokeColor is assigned before strokeWeight, which silently ` +
    'restores the item default'
  );
}

test('every generated stroke reset sets the weight first', async () => {
  for (const [name, args] of [
    ['createPolygon', { x: 0, y: 0, width: 10, height: 10 }],
    ['createPolygon', { x: 0, y: 0, width: 10, height: 10, strokeColor: 'Black', strokeWidth: 2 }],
    ['createLine', { x1: 0, y1: 0, x2: 10, y2: 10 }],
    ['createAnchoredFrame', { width: 10, height: 10 }],
    ['createAnchoredFrame', { width: 10, height: 10, strokeColor: 'Black' }],
  ]) {
    assertWeightFirst(shapes[name](args), name);
  }

  const style = await import('../lib/style-tools.js');
  assertWeightFirst(
    style.formatObject({ objectIndex: 0, strokeColor: 'None', strokeWeight: 0 }),
    'formatObject'
  );

  const { runTool } = await import('./harness.mjs');
  for (const method of ['createRectangle', 'createEllipse', 'createTextFrame']) {
    const { script } = await runTool(method, {
      content: 'x', x: 0, y: 0, width: 10, height: 10,
      strokeColor: 'Black', strokeWidth: 1, fontSize: 12,
      fontFamily: 'Helvetica Neue', fontStyle: 'Regular', textColor: 'Black',
      alignment: 'LEFT_ALIGN', pageIndex: 0,
    });
    if (script) assertWeightFirst(script, method);
  }
});
