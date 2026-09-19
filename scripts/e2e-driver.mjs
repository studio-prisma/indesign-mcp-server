/**
 * End-to-end test for the driver itself: text encoding and undo grouping.
 *
 * These are the two things test/driver.test.mjs cannot check, because both
 * only go wrong once a real InDesign is on the other end — whether the text a
 * script carries survives the trip, and whether doc.undo() still works under
 * the undo mode the ungrouped path selects.
 *
 * Like the other e2e scripts it labels the document it creates and closes only
 * that one, so a document open in parallel cannot be affected.
 */

import { executeInDesignScript, platformInfo, withUndoLabel } from '../lib/indesign-driver.js';
import { str } from '../lib/jsx-safe.js';
import * as flow from '../lib/flow-tools.js';

const LABEL = 'MCP-E2E-DRIVER';

// Umlauts, sharp s, an em dash, a currency sign outside Latin-1 and a tick.
// The last two would survive neither CP1252 nor Latin-1 as a single character.
const SAMPLE = 'SAYNER HÜTTE äöüß € — ✓';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };

const tool = (name, script) => withUndoLabel(name, () => executeInDesignScript(script));
const read = (expr) => executeInDesignScript(`__result__ = ${expr};`, { undoName: null })
  .then((r) => String(r).trim());

const codes = (s) => [...s].map((c) => c.charCodeAt(0)).join(',');

console.log('Platform :', platformInfo.mode);
console.log('');

let created = false;
let failure = null;

try {
  await tool('create_document', `
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = "210mm";
    doc.documentPreferences.pageHeight = "297mm";
    doc.label = ${str(LABEL)};
    __result__ = doc.name;
  `);
  created = true;
  ok('test document created');

  // ------------------------------------------------------------- encoding

  // Into the document and back out again, compared by charCode rather than by
  // eye: mojibake and the real thing look alike in a terminal.
  await tool('create_text_frame', `
    var doc = app.activeDocument;
    var tf = doc.pages[0].textFrames.add();
    tf.geometricBounds = ["10mm", "10mm", "60mm", "190mm"];
    tf.contents = ${str(SAMPLE)};
    __result__ = tf.contents.length;
  `);

  const roundTrip = await read('app.activeDocument.pages[0].textFrames[0].contents');
  if (roundTrip !== SAMPLE) {
    fail(
      'text did not survive the round trip\n' +
      '      sent     : ' + JSON.stringify(SAMPLE) + '\n' +
      '      got back : ' + JSON.stringify(roundTrip) + '\n' +
      '      sent     : ' + codes(SAMPLE) + '\n' +
      '      got back : ' + codes(roundTrip)
    );
  }
  ok('text round trip byte-exact: ' + JSON.stringify(SAMPLE));

  // Same question asked of the document itself, so a symmetric corruption on
  // the way out and back in cannot hide it.
  const inDoc = await read(
    '(function () { var s = app.activeDocument.pages[0].textFrames[0].contents, c = [];' +
    ' for (var i = 0; i < s.length; i++) c.push(s.charCodeAt(i)); return c.join(","); })()'
  );
  if (inDoc !== codes(SAMPLE)) {
    fail('charCodes in the document are ' + inDoc + ', expected ' + codes(SAMPLE));
  }
  ok('charCodes read out of the document match: ' + inDoc);

  // ----------------------------------------------------------- undo groups

  for (const n of [1, 2, 3]) {
    await tool('create_rectangle', `
      var r = app.activeDocument.pages[0].rectangles.add();
      r.geometricBounds = ["${60 + n * 20}mm", "10mm", "${75 + n * 20}mm", "60mm"];
      __result__ = app.activeDocument.pages[0].rectangles.length;
    `);
  }
  const stepName = await read('app.activeDocument.undoName');
  if (stepName !== 'create_rectangle') {
    fail(`the last undo step is named "${stepName}", not after the tool that made it`);
  }
  ok('one undo step per call, named after the tool');

  // The ungrouped path: doc.undo() has to work from inside a script that is
  // itself running under DoScript. It does under SCRIPT_REQUEST and under no
  // other undo mode — AUTO_UNDO, FAST_ENTIRE_SCRIPT and ENTIRE_SCRIPT all
  // make InDesign refuse with "the last command cannot be undone".
  const before = Number(await read('app.activeDocument.pages[0].rectangles.length'));
  const undoResult = await executeInDesignScript(flow.undoSteps({ steps: 2 }), { undoName: null });
  if (/ERROR|cannot be undone|kann nicht/i.test(undoResult)) {
    fail('the undo tool failed: ' + undoResult.trim());
  }
  const after = Number(await read('app.activeDocument.pages[0].rectangles.length'));
  if (after !== before - 2) {
    fail(`undo of 2 steps took the rectangle count ${before} -> ${after}, expected ${before - 2}`);
  }
  ok(`undo tool works through the ungrouped path: ${before} -> ${after} rectangles`);

  console.log('\nResult   : pass');
} catch (e) {
  failure = e;
  console.error('\nResult   : FAIL');
  console.error('  ' + (e instanceof Abort ? e.message : e.message.split('\n')[0]));
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      await executeInDesignScript(`
        for (var i = app.documents.length - 1; i >= 0; i--) {
          if (app.documents[i].label === ${str(LABEL)}) { app.documents[i].close(SaveOptions.NO); }
        }
        __result__ = "closed";
      `, { undoName: null });
      console.log('Cleanup  : test document closed without saving');
    } catch (e) {
      console.error('Cleanup  : could not close the test document — ' + e.message.split('\n')[0]);
      if (!failure) process.exitCode = 1;
    }
  }
}
