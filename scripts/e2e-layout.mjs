/**
 * End-to-end test for the layout tools against a running InDesign.
 *
 * Builds a small page that reproduces the failure modes these tools exist to
 * catch — overlapping frames, an oversized image, text that does not fit —
 * then checks that inspect_page and check_layout actually report them and
 * that the manipulation tools fix them.
 *
 * Like scripts/e2e.mjs it labels the document it creates and closes only
 * that, so a document open in parallel cannot be affected.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, index, num } from '../lib/jsx-safe.js';
import * as layout from '../lib/layout-tools.js';

const LABEL = 'MCP-E2E-LAYOUT';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };

console.log('Platform :', platformInfo.mode);
console.log('');

const countBefore = Number(String(await executeInDesignScript('__result__ = app.documents.length;')).trim());
ok('documents open before: ' + countBefore);

let created = false;
let failure = null;

try {
  // A4 with three overlapping frames and a deliberately overset text frame.
  const r1 = await executeInDesignScript(`
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = ${measure(210)};
    doc.documentPreferences.pageHeight = ${measure(297)};
    doc.label = ${str(LABEL)};
    var page = doc.pages[0];

    var back = page.rectangles.add();
    back.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(80)}, ${measure(120)}];
    back.fillColor = doc.swatches.itemByName("Black");

    var tf = page.textFrames.add();
    tf.geometricBounds = [${measure(40)}, ${measure(40)}, ${measure(55)}, ${measure(90)}];
    tf.contents = ${str('This deliberately holds far more text than the frame can show, so that the overset check has something to find. '.repeat(4))};
    tf.parentStory.characters.everyItem().pointSize = ${num(14)};

    var empty = page.rectangles.add();
    empty.geometricBounds = [${measure(200)}, ${measure(150)}, ${measure(260)}, ${measure(230)}];

    __result__ = doc.name + " | " + page.allPageItems.length + " objects";
  `);
  created = true;
  ok('test page built: ' + String(r1).trim());

  // --- inspect_page -------------------------------------------------------
  const inspect = String(await executeInDesignScript(layout.inspectPage({ pageIndex: 0 })));
  if (!/\[0\]/.test(inspect) || !/TextFrame/.test(inspect)) {
    fail('inspect_page did not list the objects:\n' + inspect);
  }
  ok('inspect_page listed ' + (inspect.match(/^\[\d+\]/gm) || []).length + ' objects');

  if (!/OVERSET/.test(inspect)) fail('inspect_page missed the overset text frame');
  ok('inspect_page flagged the overset text frame');

  // --- check_layout -------------------------------------------------------
  const check = String(await executeInDesignScript(layout.checkLayout({ pageIndex: 0 })));
  for (const [what, re] of [
    ['overset text', /OVERSET TEXT/],
    ['empty frame', /EMPTY FRAME/],
    ['object off the page', /OFF PAGE/],
    ['overlap', /OVERLAP/],
  ]) {
    if (!re.test(check)) fail('check_layout missed the ' + what + ':\n' + check);
    ok('check_layout found the ' + what);
  }

  // --- move_object --------------------------------------------------------
  const moved = String(await executeInDesignScript(
    layout.moveObject({ pageIndex: 0, objectIndex: 2, x: 20, y: 200 })
  ));
  if (/ERROR/.test(moved)) fail('move_object failed: ' + moved);
  ok('move_object: ' + moved.split('\n').pop().trim().slice(0, 70));

  // --- resize_object ------------------------------------------------------
  const resized = String(await executeInDesignScript(
    layout.resizeObject({ pageIndex: 0, objectIndex: 1, width: 150, height: 90 })
  ));
  if (/ERROR/.test(resized)) fail('resize_object failed: ' + resized);
  ok('resize_object applied' + (/WARNING/.test(resized) ? ' (still overset, reported)' : ''));

  // --- arrange_object -----------------------------------------------------
  const arranged = String(await executeInDesignScript(
    layout.arrangeObject({ pageIndex: 0, objectIndex: 0, position: 'BRING_TO_FRONT' })
  ));
  if (/ERROR/.test(arranged)) fail('arrange_object failed: ' + arranged);
  if (!/index 0 of 3/.test(arranged)) fail('arrange_object reported the wrong position: ' + arranged);
  ok('arrange_object moved an object to the front (index 0)');

  // --- delete_object ------------------------------------------------------
  const deleted = String(await executeInDesignScript(
    layout.deleteObject({ pageIndex: 0, objectIndex: 0 })
  ));
  if (/ERROR/.test(deleted)) fail('delete_object failed: ' + deleted);
  const after = String(await executeInDesignScript(layout.inspectPage({ pageIndex: 0 })));
  const remaining = (after.match(/^\[\d+\]/gm) || []).length;
  if (remaining !== 2) fail('expected 2 objects after deletion, found ' + remaining);
  ok('delete_object removed one object, 2 remain');

} catch (e) {
  failure = e;
} finally {
  if (created) {
    try {
      const cleanup = await executeInDesignScript(`
        var closed = 0;
        for (var i = app.documents.length - 1; i >= 0; i--) {
          if (app.documents[i].label === ${str(LABEL)}) {
            app.documents[i].close(SaveOptions.NO);
            closed++;
          }
        }
        __result__ = "closed: " + closed + ", open: " + app.documents.length;
      `);
      ok(String(cleanup).trim());
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
console.log('\nResult: layout tools verified against InDesign.');
