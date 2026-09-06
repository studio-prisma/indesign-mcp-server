/**
 * End-to-end test against a running InDesign.
 *
 * Chain: create a document -> place text -> export PDF -> verify the text ->
 * close the document again.
 *
 * Deliberately not via the close_document tool: that one operates on
 * app.activeDocument and closes with SaveOptions.NO. If another document is
 * in front when it runs — one somebody is working on, say — it hits that one.
 * Instead the document created here carries a label; only documents with that
 * label are closed, and the document count is compared before and after.
 *
 * Usage:  node scripts/e2e.mjs [output directory]
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, index, num, enumOf, ALLOWED } from '../lib/jsx-safe.js';

const OUT_DIR = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'indesign-mcp-e2e'));
fs.mkdirSync(OUT_DIR, { recursive: true });

const PDF = path.join(OUT_DIR, 'e2e-test.pdf');
const TEXT = 'MCP end-to-end ' + new Date().toISOString().slice(0, 19);
const LABEL = 'MCP-E2E';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);

/**
 * Abort the test. Throws rather than calling process.exit(), so the finally
 * block still runs and the created document does not stay open.
 */
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };

/**
 * Verify the text inside the PDF.
 *
 * InDesign embeds font subsets: the character codes in the content stream are
 * not ASCII, so the plain text is not there even after decompression. Proper
 * decoding needs the ToUnicode CMap. Rather than reimplement that, use pypdf
 * when available; without it, fall back to a weaker, honestly labelled check.
 */
function textInPdf(file, needle) {
  const py = spawnSync('python', ['-c', [
    'import sys, pypdf',
    'r = pypdf.PdfReader(sys.argv[1])',
    'print("".join(p.extract_text() or "" for p in r.pages))',
  ].join('\n'), file], { encoding: 'utf8' });

  if (py.status === 0) {
    return { kind: 'strong', hit: py.stdout.includes(needle), text: py.stdout.trim().slice(0, 200) };
  }
  const raw = fs.readFileSync(file, 'latin1');
  return {
    kind: 'weak',
    hit: /\/Type\s*\/Page\b/.test(raw) && /\/Font\b/.test(raw),
    text: '(pypdf unavailable — structure checked only)',
  };
}

console.log('Platform  :', platformInfo.mode);
console.log('Output dir:', OUT_DIR);
console.log('');

const countBefore = Number(String(await executeInDesignScript('__result__ = app.documents.length;')).trim());
if (!Number.isInteger(countBefore)) {
  console.error('Could not read the document count.');
  process.exit(1);
}
ok('documents open before: ' + countBefore);

let created = false;
let failure = null;

try {
  // --- 1. create the document ---------------------------------------------
  const r1 = await executeInDesignScript(`
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = ${measure(210)};
    doc.documentPreferences.pageHeight = ${measure(297)};
    doc.label = ${str(LABEL)};
    __result__ = doc.name;
  `);
  created = true;
  ok('document created (A4): ' + String(r1).trim());

  // --- 2. text frame -------------------------------------------------------
  const r2 = await executeInDesignScript(`
    var doc = app.activeDocument;
    if (doc.label !== ${str(LABEL)}) {
      __result__ = "ABORT: the active document is not the one we created";
    } else {
      var page = doc.pages[${index(0)}];
      var tf = page.textFrames.add();
      tf.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(60)}, ${measure(190)}];
      tf.contents = ${str(TEXT)};
      tf.parentStory.characters.everyItem().pointSize = ${num(18)};
      tf.parentStory.paragraphs.everyItem().justification =
        Justification.${enumOf('LEFT_ALIGN', ALLOWED.alignment)};
      __result__ = "text frame: " + tf.contents;
    }
  `);
  if (/ABORT/.test(r2)) fail(String(r2).trim());
  ok(String(r2).trim());

  // --- 3. export the PDF ---------------------------------------------------
  if (fs.existsSync(PDF)) fs.unlinkSync(PDF);
  const r3 = await executeInDesignScript(`
    var doc = app.activeDocument;
    if (doc.label !== ${str(LABEL)}) {
      __result__ = "ABORT: the active document is not the one we created";
    } else {
      var f = new File(${str(PDF.replace(/\\/g, '/'))});
      doc.exportFile(ExportFormat.PDF_TYPE, f, false);
      __result__ = "exported to " + f.fsName;
    }
  `);
  if (/ABORT/.test(r3)) fail(String(r3).trim());
  ok(String(r3).trim());

  // --- 4. check the PDF ----------------------------------------------------
  if (!fs.existsSync(PDF)) fail('the PDF was not created: ' + PDF);
  const size = fs.statSync(PDF).size;
  if (size < 500) fail('the PDF is suspiciously small: ' + size + ' bytes');
  ok('PDF present: ' + size + ' bytes');

  const proof = textInPdf(PDF, TEXT);
  if (!proof.hit) {
    fail('text not verifiable in the PDF (' + proof.kind + '): "' + TEXT + '"\n         read: ' + proof.text);
  }
  ok(proof.kind === 'strong'
    ? 'text verified in the PDF: "' + TEXT + '"'
    : 'PDF structure plausible — text check only weak: ' + proof.text);

} catch (e) {
  failure = e;
} finally {
  // --- 5. clean up: close only what we created ----------------------------
  if (created) {
    try {
      const r5 = await executeInDesignScript(`
        var closed = 0;
        for (var i = app.documents.length - 1; i >= 0; i--) {
          if (app.documents[i].label === ${str(LABEL)}) {
            app.documents[i].close(SaveOptions.NO);
            closed++;
          }
        }
        __result__ = "closed: " + closed + ", open: " + app.documents.length;
      `);
      ok(String(r5).trim());

      const countAfter = Number(String(await executeInDesignScript('__result__ = app.documents.length;')).trim());
      if (countAfter !== countBefore) {
        console.error('\nWARNING: document count differs — before ' + countBefore + ', after ' + countAfter);
        process.exitCode = 1;
      } else {
        ok('state restored (' + countAfter + ' documents)');
      }
    } catch (e) {
      console.error('\nCleanup failed — please check in InDesign:', e.message);
      process.exitCode = 1;
    }
  }
}

if (failure) {
  console.error('\nFAILED: ' + failure.message);
  process.exit(1);
}

console.log('\nResult: chain completed.');
console.log('PDF:', PDF);
