/**
 * End-to-end test for export and preflight against a running InDesign.
 *
 * All four of these used to fail on a property this version no longer has,
 * so the test checks that a file actually arrives — not just that the call
 * returned without an error.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as exporters from '../lib/export-tools.js';

const LABEL = 'MCP-E2E-EXPORT';
const DIR = path.join(os.tmpdir(), 'indesign-mcp-e2e-export');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };
const run = async (s) => String(await executeInDesignScript(s));
const noError = (out, what) => { if (/ERROR/.test(out)) fail(what + ': ' + out); return out; };

console.log('Platform :', platformInfo.mode);
console.log('Output   :', DIR);
console.log('');

const countBefore = Number((await run('__result__ = app.documents.length;')).trim());
ok('documents open before: ' + countBefore);

let created = false;
let failure = null;

try {
  const built = await run(`
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = ${measure(210)};
    doc.documentPreferences.pageHeight = ${measure(297)};
    doc.documentPreferences.pagesPerDocument = 2;
    doc.documentPreferences.documentBleedTopOffset = ${measure(3)};
    doc.label = ${str(LABEL)};
    for (var p = 0; p < doc.pages.length; p++) {
      var t = doc.pages[p].textFrames.add();
      t.geometricBounds = [${measure(30)}, ${measure(20)}, ${measure(90)}, ${measure(190)}];
      t.contents = "Export-Testseite " + (p + 1);
      t.parentStory.characters.everyItem().pointSize = ${num(28)};
    }
    __result__ = doc.pages.length + " pages";
  `);
  created = true;
  ok('document built: ' + built.trim());

  // --- PDF ----------------------------------------------------------------
  const pdf = path.join(DIR, 'test.pdf');
  const pdfOut = noError(
    await run(exporters.exportPDF({ filePath: pdf, preset: 'HighQualityPrint' })),
    'export_pdf'
  );
  if (!fs.existsSync(pdf)) fail('no PDF on disk: ' + pdfOut);
  ok('export_pdf: ' + Math.round(fs.statSync(pdf).size / 1024) + ' KB — ' + pdfOut.split('|')[2].trim());

  // Marks and bleed - these are the properties that used to be wrong.
  const pdfMarks = path.join(DIR, 'marks.pdf');
  const marksOut = noError(
    await run(exporters.exportPDF({
      filePath: pdfMarks, cropMarks: true, bleedMarks: true,
      registrationMarks: true, includeBleed: true, includeSlug: true,
    })),
    'export_pdf with marks'
  );
  if (!fs.existsSync(pdfMarks)) fail('no marked PDF on disk');
  if (fs.statSync(pdfMarks).size <= fs.statSync(pdf).size) {
    fail('the PDF with marks and bleed is not larger — the settings had no effect');
  }
  ok('export_pdf with marks and bleed: '
    + Math.round(fs.statSync(pdfMarks).size / 1024) + ' KB, larger than without');

  // --- images -------------------------------------------------------------
  const pngDir = path.join(DIR, 'png');
  const pngOut = noError(
    await run(exporters.exportImages({ folderPath: pngDir, format: 'PNG', resolution: 72 })),
    'export_images PNG'
  );
  const pngs = fs.existsSync(pngDir) ? fs.readdirSync(pngDir).filter((f) => f.endsWith('.png')) : [];
  if (pngs.length === 0) fail('no PNG written: ' + pngOut);
  ok('export_images PNG: ' + pngs.length + ' file(s), ' + pngs[0]);

  const jpgDir = path.join(DIR, 'jpg');
  const jpgOut = noError(
    await run(exporters.exportImages({
      folderPath: jpgDir, format: 'JPG', resolution: 150, jpegQuality: 'HIGH',
    })),
    'export_images JPEG'
  );
  const jpgs = fs.existsSync(jpgDir) ? fs.readdirSync(jpgDir).filter((f) => f.endsWith('.jpg')) : [];
  if (jpgs.length === 0) fail('no JPEG written: ' + jpgOut);
  ok('export_images JPEG: ' + jpgs.length + ' file(s) at 150 dpi');

  // Resolution has to make a difference - that property was the broken one.
  const hiDir = path.join(DIR, 'png-hi');
  noError(
    await run(exporters.exportImages({ folderPath: hiDir, format: 'PNG', resolution: 300 })),
    'export_images 300 dpi'
  );
  const hi = fs.readdirSync(hiDir).filter((f) => f.endsWith('.png'));
  const loSize = fs.statSync(path.join(pngDir, pngs[0])).size;
  const hiSize = fs.statSync(path.join(hiDir, hi[0])).size;
  if (hiSize <= loSize) {
    fail(`300 dpi (${hiSize}) is not larger than 72 dpi (${loSize}) — exportResolution had no effect`);
  }
  ok('export_images: 300 dpi is ' + Math.round(hiSize / loSize) + 'x the 72 dpi file — resolution works');

  // --- EPUB ---------------------------------------------------------------
  const epub = path.join(DIR, 'test.epub');
  const epubOut = noError(await run(exporters.exportEPUB({ filePath: epub })), 'export_epub');
  if (!fs.existsSync(epub)) fail('no EPUB on disk: ' + epubOut);
  ok('export_epub: ' + Math.round(fs.statSync(epub).size / 1024) + ' KB');

  // --- preflight ----------------------------------------------------------
  const pre = noError(await run(exporters.preflightDocument({})), 'preflight_document');
  if (!/Preflight with profile/.test(pre)) fail('preflight did not report: ' + pre);
  ok('preflight_document: ' + pre.split('\n')[0].trim());

  const preBad = await run(exporters.preflightDocument({ profile: 'Gibtsnicht' }));
  if (!/Available:/.test(preBad)) fail('an unknown profile should list the real ones: ' + preBad);
  ok('preflight_document: unknown profile lists what exists');

} catch (e) {
  failure = e;
} finally {
  if (created) {
    try {
      const cleanup = await run(`
        var closed = 0;
        for (var i = app.documents.length - 1; i >= 0; i--) {
          if (app.documents[i].label === ${str(LABEL)}) {
            app.documents[i].close(SaveOptions.NO);
            closed++;
          }
        }
        __result__ = "closed: " + closed + ", open: " + app.documents.length;
      `);
      ok(cleanup.trim());
      const countAfter = Number((await run('__result__ = app.documents.length;')).trim());
      if (countAfter !== countBefore) {
        console.error('\nWARNING: document count differs — before ' + countBefore + ', after ' + countAfter);
        process.exitCode = 1;
      } else {
        ok('state restored (' + countAfter + ' documents)');
      }
    } catch (e) {
      console.error('\nCleanup failed — check InDesign:', e.message);
      process.exitCode = 1;
    }
  }
}

if (failure) {
  console.error('\nFAILED: ' + failure.message);
  process.exit(1);
}
console.log('\nResult: export and preflight verified against InDesign.');
