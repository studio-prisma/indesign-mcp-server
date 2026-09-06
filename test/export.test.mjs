/**
 * Export and preflight, plus the property names they came out of.
 *
 * Every one of these tools used to set a name InDesign 21.5 does not have.
 * A missing property is not ignored — it aborts the whole call — so the tool
 * looked broken for reasons unrelated to what it was asked to do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { parses } from './harness.mjs';
import { autoCaptureResult } from '../lib/indesign-driver.js';
import * as exporters from '../lib/export-tools.js';

// Under the home directory on purpose: file operations are confined to
// buildAllowedDirs(), which is home plus INDESIGN_ALLOWED_DIRS. os.tmpdir()
// sits under home on Windows but not on Linux, so a temp path passes here
// and is refused on CI. Nothing is written - only the script text is built.
const BASE = os.homedir();
const PDF = path.join(BASE, 'probe.pdf');
const EPUB = path.join(BASE, 'probe.epub');
const TMP = BASE;
const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

const CASES = [
  ['exportPDF', { filePath: PDF }],
  ['exportPDF', { filePath: PDF, preset: 'PressQuality', pageRange: '1-2' }],
  ['exportPDF', { filePath: PDF, cropMarks: true, bleedMarks: true, includeBleed: true, includeSlug: true }],
  ['exportImages', { folderPath: TMP, format: 'PNG', resolution: 72 }],
  ['exportImages', { folderPath: TMP, format: 'JPG', resolution: 300, jpegQuality: 'MAXIMUM' }],
  ['exportImages', { folderPath: TMP, format: 'PNG', transparentBackground: true, pageRange: '1' }],
  ['exportEPUB', { filePath: EPUB }],
  ['exportEPUB', { filePath: EPUB, fixedLayout: true }],
  ['preflightDocument', {}],
  ['preflightDocument', { profile: 'Basis', maxIssues: 5 }],
];

for (const [name, args] of CASES) {
  test(`${name} ${JSON.stringify(args).slice(0, 40)}: parseable`, () => {
    const res = parses(autoCaptureResult(exporters[name](args)));
    assert.ok(res.ok, `${name}: ${res.message}`);
  });
}

// ------------------------------------------------------------- regressions

test('the PDF names this version does not have are gone', () => {
  const script = exporters.exportPDF({
    filePath: PDF, bleedMarks: true, includeBleed: true, includeSlug: true,
  });
  for (const dead of ['includeBleedMarks', 'includeSlugArea', 'outputIntention']) {
    assert.doesNotMatch(script, new RegExp(dead),
      `${dead} does not exist on pdfExportPreferences and aborts the call`);
  }
  assert.match(script, /pdfExportPreferences\.bleedMarks/);
  assert.match(script, /pdfExportPreferences\.includeSlugWithPDF/);
  assert.match(script, /pdfExportPreferences\.useDocumentBleedWithPDF/);
});

test('image export uses exportResolution and useDocumentBleeds', () => {
  for (const format of ['PNG', 'JPG']) {
    const script = exporters.exportImages({ folderPath: TMP, format, resolution: 300, includeBleed: true });
    assert.match(script, /\.exportResolution = 300/,
      `${format}: resolution is exportResolution, not resolution`);
    assert.doesNotMatch(script, /ExportPreferences\.resolution\s*=/,
      `${format}: .resolution does not exist here`);
    assert.match(script, /\.useDocumentBleeds = true/,
      `${format}: bleed is useDocumentBleeds, not useDocumentBleedWithPDF`);
    assert.doesNotMatch(script, /(jpeg|png)ExportPreferences\.useDocumentBleedWithPDF/,
      `${format}: that name belongs to the PDF preferences`);
  }
});

test('EPUB export touches no preferences object', () => {
  // app.epubExportPreferences does not exist in this version at all.
  const script = exporters.exportEPUB({ filePath: EPUB });
  assert.doesNotMatch(script, /epubExportPreferences/);
  assert.match(script, /ExportFormat\.EPUB/);
  assert.match(script, /no scriptable EPUB preferences/,
    'the response should say why nothing can be configured');
});

test('preflight uses the app collection, waits, and reads aggregatedResults', () => {
  const script = exporters.preflightDocument({});
  assert.match(script, /app\.preflightProcesses\.add\(doc,/,
    'the collection is on app and takes the document');
  assert.doesNotMatch(script, /doc\.preflightProcesses/,
    'documents have no preflightProcesses collection');
  assert.match(script, /waitForProcess\(\)/,
    'the process is asynchronous; without waiting the results are read too early');
  assert.match(script, /aggregatedResults/);
  assert.doesNotMatch(script, /preflightResultsData/,
    'that property does not exist');
});

// ------------------------------------------------------------ argument guards

test('presets and formats are checked against the allow-list', () => {
  assert.throws(
    () => exporters.exportPDF({ filePath: PDF, preset: 'PressQuality; app.quit()' }),
    /Invalid value/
  );
  assert.throws(
    () => exporters.exportImages({ folderPath: TMP, format: 'PNG; app.quit()' }),
    /Invalid value/
  );
  assert.throws(
    () => exporters.exportImages({ folderPath: TMP, jpegQuality: 'HIGH; app.quit()' }),
    /Invalid value/
  );
});

test('resolution is bounded', () => {
  assert.throws(() => exporters.exportImages({ folderPath: TMP, resolution: 5 }), /out of range/);
  assert.throws(() => exporters.exportImages({ folderPath: TMP, resolution: 9999 }), /out of range/);
  assert.throws(() => exporters.exportImages({ folderPath: TMP, resolution: BREAKOUT }), /Invalid number/);
});

test('a path outside the allowed directories is refused, on either platform', () => {
  // This is what broke the first version of this suite: /tmp is inside the
  // home directory on Windows and outside it on Linux.
  const outsideHome = process.platform === 'win32' ? 'D:' + BS + 'nope.pdf' : '/tmp/nope.pdf';
  assert.throws(
    () => exporters.exportPDF({ filePath: outsideHome }),
    /Access denied/,
    'export must stay inside the allowed directories'
  );
});

test('paths outside the allowed directories are refused', () => {
  const outside = process.platform === 'win32'
    ? 'C:' + BS + 'Windows' + BS + 'System32' + BS + 'x.pdf'
    : '/etc/x.pdf';
  assert.throws(() => exporters.exportPDF({ filePath: outside }), /Access denied/);
  assert.throws(() => exporters.exportEPUB({ filePath: outside }), /Access denied/);
});

test('a page range stays data', () => {
  const script = exporters.exportPDF({ filePath: PDF, pageRange: BREAKOUT });
  assert.ok(parses(script).ok);
  const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/);
});

test('a profile name stays data and unknown ones list the alternatives', () => {
  const script = exporters.preflightDocument({ profile: BREAKOUT });
  assert.ok(parses(script).ok);
  const withoutStrings = script.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  assert.doesNotMatch(withoutStrings, /app\s*\.\s*quit/);
  assert.match(script, /Available:/);
});

test('exports report a missing file instead of assuming success', () => {
  for (const script of [
    exporters.exportPDF({ filePath: PDF }),
    exporters.exportEPUB({ filePath: EPUB }),
  ]) {
    assert.match(script, /no error but produced no file/,
      'an export that writes nothing must say so');
  }
  assert.match(
    exporters.exportImages({ folderPath: TMP }),
    /no error but wrote no file/
  );
});
