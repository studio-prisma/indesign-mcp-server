/**
 * Checks that every tool method produces parseable ExtendScript, including
 * the result assignment the driver adds.
 *
 * `node --check index.js` only validates the server, never the generated
 * script text — a broken template would otherwise surface inside InDesign.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { runTool, parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';

// Path arguments stay platform-neutral so the test also runs on macOS.
const TMP = os.tmpdir();

// One argument set; each method destructures what it needs.
const ARGS = {
  content: 'Test content',
  text: 'Test content',
  markdownText: '# Heading\n\nParagraph',
  findText: 'old',
  replaceText: 'new',
  x: 10, y: 10, width: 100, height: 50,
  pageIndex: 0, frameIndex: 0, objectIndex: 0, tableIndex: 0,
  startIndex: 0, endIndex: 5,
  fontSize: 12, fontFamily: 'Helvetica Neue', fontStyle: 'Regular',
  textColor: 'Black', fillColor: 'Paper', strokeColor: 'Black',
  strokeWidth: 1, cornerRadius: 2, transparency: 0,
  alignment: 'LEFT_ALIGN', fitOption: 'PROPORTIONALLY',
  colorModel: 'PROCESS', colorSpace: 'CMYK', colorValues: [0, 0, 0, 100],
  name: 'Test style', styleName: 'Test style', baseStyle: 'Base',
  swatchName: 'Test colour', property: 'fill',
  layerName: 'Test layer', color: 'RED',
  preset: 'A4', orientation: 'Portrait', pages: 1,
  marginTop: 20, marginBottom: 20, marginLeft: 20, marginRight: 20,
  bleed: 3, slug: 0, facingPages: false,
  rows: 2, columns: 2, headerRows: 0, footerRows: 0,
  data: [['a', 'b'], ['c', 'd']],
  tracking: 0, leading: 14, spaceBefore: 0, spaceAfter: 0,
  maxObjects: 10, maxLength: 0, normalizeSpaces: true,
  jpegQuality: 80, resolution: 300, imageFormat: 'PNG', format: 'PNG',
  pageRange: 'all', version: 'EPUB3', profile: 'Base',
  recordRange: 'all', includeImages: true,
  filePath: path.join(TMP, 'test.indd'),
  folderPath: TMP,
  outputFolder: TMP,
  dataSource: path.join(TMP, 'data.csv'),
  imagePath: path.join(os.homedir(), 'image.jpg'),
  x1: 10, y1: 10, x2: 90, y2: 60,
  sides: 6, starInset: 0, characterOffset: 3, rotation: 0,
  pageNumberStart: 1, pageNumberStyle: 'ARABIC', continueNumbering: false,
  confirmDestructive: true,
};

// Every method that builds a script.
const METHODS = [
  'getDocumentInfo', 'createDocument', 'openDocument', 'saveDocument', 'closeDocument',
  'addPage', 'deletePage', 'duplicatePage', 'navigateToPage', 'getSelectedObjects',
  'getTextContent', 'listTextFrames', 'analyzeEmbeddedObjects', 'insertMarkdownText',
  'fixTypographyInSelection', 'findTypographyIssues', 'listGrepSearches',
  'cleanImportedText', 'analyzeTextProblems', 'createTextFrame', 'editTextFrame',
  'findReplaceText', 'placeImage', 'createRectangle', 'createEllipse',
  'createParagraphStyle', 'createCharacterStyle', 'modifyCharacterStyle',
  'modifyParagraphStyle', 'modifyObjectStyle', 'createObjectStyle', 'applyObjectStyle',
  'applyParagraphStyle', 'listStyles', 'createColorSwatch', 'listColorSwatches',
  'applyColor', 'exportPDF', 'exportImages', 'exportEPUB', 'packageDocument',
  'viewDocument', 'createTable', 'populateTable', 'createLayer', 'setActiveLayer',
  'listLayers', 'preflightDocument', 'zoomToPage', 'dataMerge',
  'createPolygon', 'createLine', 'createAnchoredFrame',
  'createSection', 'listSections', 'exportIDML',
];

for (const method of METHODS) {
  test(`${method}: produces parseable ExtendScript`, async () => {
    const { error, script } = await runTool(method, { ...ARGS });

    // A rejected argument is a valid outcome — a programming error is not.
    if (error) {
      assert.ok(
        !/is not a function|Cannot read propert|is not defined/.test(error.message),
        `${method} failed on a programming error: ${error.message}`
      );
      return;
    }
    assert.ok(script, `${method} produced no script`);

    const res = parses(autoCaptureResult(script));
    assert.ok(res.ok, `${method}: script does not parse — ${res.message}`);
  });
}

test('autoCaptureResult assigns a return value', async () => {
  const { script } = await runTool('createDocument', { ...ARGS });
  assert.match(
    autoCaptureResult(script),
    /__result__\s*=/,
    'no __result__ assigned — the tool would return nothing'
  );
});

test('autoCaptureResult handles a multi-line trailing expression', () => {
  const src = [
    'var doc = app.documents.add();',
    '"Created: " + doc.name + ", " +',
    'doc.pages.length + " pages";',
  ].join('\n');
  const wrapped = autoCaptureResult(src);
  const res = parses(wrapped);
  assert.ok(res.ok, 'multi-line trailing expression breaks: ' + res.message);
  assert.match(wrapped, /__result__ = "Created: "/);
});

test('autoCaptureResult leaves scripts that set __result__ alone', () => {
  const src = '__result__ = "fixed";';
  assert.equal(autoCaptureResult(src), src);
});

// ------------------------------------------------- the default 1 pt stroke

/**
 * InDesign gives every newly created page item the application's default
 * stroke, 1 pt black. A caller who wants a stroke names one, so an unrequested
 * stroke is the server putting something on the page that nobody asked for:
 * invisible on a dark ground, a box around the element on a light one, and
 * visible in print long after it stopped being noticeable on screen.
 */
const CREATORS = ['createTextFrame', 'createRectangle', 'createEllipse',
  'createTable', 'placeImage'];

test('a new frame carries no stroke unless one was asked for', async () => {
  for (const method of CREATORS) {
    // place_image validates its path against INDESIGN_ALLOWED_DIRS, which
    // defaults to the home directory. os.tmpdir() sits under home on some
    // machines and outside it on the CI runners, so the path has to come from
    // homedir() or this test passes locally and fails in CI.
    const args = { ...ARGS, imagePath: path.join(os.homedir(), 'stroke-test.jpg') };
    delete args.strokeColor;

    const { error, script } = await runTool(method, args);
    assert.ok(script, `${method} produced no script: ${error && error.message}`);
    assert.match(
      script,
      /strokeColor = doc\.swatches\.itemByName\("None"\)/,
      `${method} leaves InDesign's default 1 pt stroke on the frame`
    );
  }
});

test('a stroke that was asked for is still applied', async () => {
  for (const method of ['createRectangle', 'createEllipse']) {
    const { script } = await runTool(method, { ...ARGS, strokeColor: 'Black' });
    assert.match(
      script,
      /strokeColor = doc\.swatches\.itemByName\("Black"\)/,
      `${method} ignores the stroke colour it was given`
    );
    assert.doesNotMatch(
      script,
      /strokeColor = doc\.swatches\.itemByName\("None"\)/,
      `${method} clears a stroke the caller explicitly asked for`
    );
  }
});

test('the stroke reset cannot take a name from outside this file', async () => {
  // clearDefaultStroke is module-private; what is testable from here is that
  // every generated reset names a plain identifier and nothing else.
  const { script } = await runTool('createRectangle',
    { ...ARGS, strokeColor: undefined });
  const resets = script.match(/(\w+)\.strokeColor = doc\.swatches\.itemByName\("None"\)/g) || [];
  assert.ok(resets.length > 0, 'no reset emitted');
  for (const r of resets) {
    assert.match(r, /^[A-Za-z_][A-Za-z0-9_]*\.strokeColor/, `suspicious target: ${r}`);
  }
});

// ------------------------------------------------------- undo and resources

/**
 * One tool call is one undo step. DoScript takes five arguments for that, and
 * the two-argument form leaves the history full of InDesign's own labels for
 * each internal operation - undoing one call then means clicking undo an
 * unknown number of times.
 */
test('the driver groups a script into one named undo step', async () => {
  const src = await fs.promises.readFile(
    new URL('../lib/indesign-driver.js', import.meta.url), 'utf8');

  assert.match(src, /UNDO_ENTIRE_SCRIPT = 1699963733/,
    'the undo mode must be the value read out of InDesign, not a guess');
  assert.match(src, /DoScript\(\$script, \$\{ID_JAVASCRIPT\}, @\(\), \$\{UNDO_ENTIRE_SCRIPT\}/,
    'withArguments has to be @() - $null raises inside the COM interop');
  assert.match(src, /undo mode entire script undo name/,
    'macOS needs the same grouping');
});

test('the undo tool itself runs ungrouped', async () => {
  const src = await fs.promises.readFile(
    new URL('../index.js', import.meta.url), 'utf8');
  assert.match(src, /flow\.undoSteps\(args\), \{ undoName: null \}/,
    'InDesign refuses doc.undo() inside a script recorded as one undo step');
});

test('an undo label cannot carry anything but a name', async () => {
  const { withUndoLabel } = await import('../lib/indesign-driver.js');
  // The label reaches a PowerShell string literal. It comes from the tool
  // name, never from a caller, and this keeps it that way.
  assert.equal(typeof withUndoLabel, 'function');
  const src = await fs.promises.readFile(
    new URL('../lib/indesign-driver.js', import.meta.url), 'utf8');
  assert.match(src, /replace\(\/\[\^A-Za-z0-9 _\.-\]\/g, ''\)/,
    'anything outside the character set must be dropped, not escaped');
});

test('the resources say the things a tool description cannot', async () => {
  const guide = await import('../lib/guide.js');
  assert.equal(guide.RESOURCES.length, 2);
  for (const r of guide.RESOURCES) {
    assert.ok(r.uri.startsWith('indesign://'), `odd uri: ${r.uri}`);
    assert.ok(guide.readResource(r.uri), `${r.uri} has no content`);
  }
  assert.equal(guide.readResource('indesign://nothing'), null);

  // The five traps this server exists to explain. If one drops out of the
  // guide, the model has no way to learn it.
  for (const needle of [
    /front to back/i,
    /millimetres/i,
    /verify-api/,
    /modal dialog/i,
    /one undo step/i,
  ]) {
    assert.match(guide.GUIDE, needle, `the guide no longer mentions ${needle}`);
  }
});

test('the tool index lists tools that exist', async () => {
  const guide = await import('../lib/guide.js');
  const src = await fs.promises.readFile(
    new URL('../index.js', import.meta.url), 'utf8');
  const real = new Set([...src.matchAll(/name: '([a-z_0-9]+)',/g)].map((m) => m[1]));
  const listed = [...guide.TOOL_INDEX.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]);
  assert.ok(listed.length > 40, `only ${listed.length} tools listed`);
  for (const name of listed) {
    if (name.startsWith('npm')) continue;
    assert.ok(real.has(name), `the index names a tool that does not exist: ${name}`);
  }
});

test('the server version comes from the manifest', async () => {
  const src = await fs.promises.readFile(
    new URL('../index.js', import.meta.url), 'utf8');
  assert.match(src, /version: VERSION/, 'a second version literal drifts out of date');
  assert.doesNotMatch(src, /version: '1\.0\.0'/);
});
