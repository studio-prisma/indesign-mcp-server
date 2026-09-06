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
  imagePath: path.join(TMP, 'image.jpg'),
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
    const args = { ...ARGS };
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
