/**
 * End-to-end test for the arrange and flow tools against a running InDesign.
 *
 * Builds a two-page document, then exercises aligning, distributing,
 * grouping, transforming, threading, frame options, master pages and page
 * numbers — checking the reported result each time rather than assuming.
 *
 * Labels its document and closes only that one.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as arrange from '../lib/arrange-tools.js';
import * as flow from '../lib/flow-tools.js';
import * as layout from '../lib/layout-tools.js';

const LABEL = 'MCP-E2E-ARRANGE';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };
const run = async (s) => String(await executeInDesignScript(s));
const noError = (out, what) => { if (/^ERROR|ERROR:/m.test(out)) fail(what + ': ' + out); return out; };

console.log('Platform :', platformInfo.mode);
console.log('');

const countBefore = Number((await run('__result__ = app.documents.length;')).trim());
ok('documents open before: ' + countBefore);

let created = false;
let failure = null;

try {
  // Three small rectangles at uneven positions, plus two empty text frames.
  const built = await run(`
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = ${measure(210)};
    doc.documentPreferences.pageHeight = ${measure(297)};
    doc.documentPreferences.pagesPerDocument = 2;
    doc.label = ${str(LABEL)};
    var page = doc.pages[0];

    var boxes = [[30, 20, 50, 60], [70, 15, 95, 55], [120, 30, 140, 70]];
    for (var i = 0; i < boxes.length; i++) {
      var r = page.rectangles.add();
      r.geometricBounds = [boxes[i][1], boxes[i][0], boxes[i][3], boxes[i][2]];
      r.fillColor = doc.swatches.itemByName("Black");
    }
    var t1 = page.textFrames.add();
    t1.geometricBounds = [${measure(120)}, ${measure(20)}, ${measure(200)}, ${measure(95)}];
    var t2 = page.textFrames.add();
    t2.geometricBounds = [${measure(120)}, ${measure(110)}, ${measure(200)}, ${measure(190)}];
    t1.contents = ${str('Fliesstext, der bewusst laenger ist als der erste Rahmen fasst. '.repeat(12))};

    __result__ = doc.pages.length + " pages, " + page.allPageItems.length + " objects";
  `);
  created = true;
  ok('document built: ' + built.trim());

  // --- align --------------------------------------------------------------
  const aligned = noError(
    await run(arrange.alignObjects({ objectIndices: [2, 3, 4], alignment: 'TOP_EDGES' })),
    'align_objects'
  );
  if (!/Aligned TOP_EDGES/.test(aligned)) fail('align_objects did not report: ' + aligned);
  ok('align_objects: three rectangles to TOP_EDGES');

  // --- distribute ---------------------------------------------------------
  const distributed = noError(
    await run(arrange.distributeObjects({ objectIndices: [2, 3, 4], distribution: 'HORIZONTAL_SPACE' })),
    'distribute_objects'
  );
  ok('distribute_objects: ' + distributed.split('\n')[0].trim());

  // --- group / ungroup ----------------------------------------------------
  const grouped = noError(
    await run(arrange.groupObjects({ objectIndices: [2, 3, 4], name: 'Boxes' })),
    'group_objects'
  );
  if (!/Grouped 3 objects/.test(grouped)) fail('group_objects did not report: ' + grouped);
  ok('group_objects: ' + grouped.split('\n')[0].trim().slice(0, 68));

  const afterGroup = await run(layout.inspectPage({ pageIndex: 0 }));
  const groupIdx = (afterGroup.match(/^\[(\d+)\] Group/m) || [])[1];
  if (groupIdx === undefined) fail('the group is not visible in inspect_page:\n' + afterGroup);
  ok('inspect_page shows the group at index ' + groupIdx);

  const ungrouped = noError(
    await run(arrange.ungroupObjects({ objectIndex: Number(groupIdx) })),
    'ungroup_objects'
  );
  if (!/Ungrouped into 3/.test(ungrouped)) fail('ungroup_objects did not report: ' + ungrouped);
  ok('ungroup_objects: back to three objects');

  // --- transform ----------------------------------------------------------
  // Deliberately a Rectangle, not whatever sits at index 0: index 0 is the
  // most recently created object, which here is a text frame. Rotating it
  // would change its bounds and therefore the reading order used below.
  const beforeTransform = await run(layout.inspectPage({ pageIndex: 0 }));
  const rectIdx = (beforeTransform.match(/^\[(\d+)\] Rectangle/m) || [])[1];
  if (rectIdx === undefined) fail('no rectangle found: ' + beforeTransform);
  const rotated = noError(
    await run(arrange.transformObject({ objectIndex: Number(rectIdx), rotation: 15 })),
    'transform_object'
  );
  if (!/rotation 15/.test(rotated)) fail('rotation not applied: ' + rotated);
  ok('transform_object: rotated rectangle [' + rectIdx + '] by 15 degrees');

  // --- text frame options -------------------------------------------------
  const opts = noError(
    await run(flow.setTextFrameOptions({ pageIndex: 0, frameIndex: 0, columns: 2, columnGutter: 4, inset: 3 })),
    'set_text_frame_options'
  );
  if (!/columns 2/.test(opts)) fail('columns not applied: ' + opts);
  ok('set_text_frame_options: two columns with gutter and inset');

  // --- threading ----------------------------------------------------------
  const threaded = noError(
    await run(flow.threadTextFrames({ pageIndex: 0, readingOrder: true })),
    'thread_text_frames'
  );
  if (!/Threaded 2 frames/.test(threaded)) fail('threading did not report: ' + threaded);
  ok('thread_text_frames: ' + threaded.split('\n').pop().trim().slice(0, 62));

  // --- text wrap ----------------------------------------------------------
  const wrapped = noError(
    await run(flow.setTextWrap({
      pageIndex: 0, objectIndex: Number(rectIdx),
      mode: 'BOUNDING_BOX_TEXT_WRAP', offset: 3,
    })),
    'set_text_wrap'
  );
  ok('set_text_wrap: ' + wrapped.trim().slice(0, 62));

  // --- master pages -------------------------------------------------------
  const masters = noError(await run(flow.listMasterPages()), 'list_master_pages');
  const masterName = (masters.match(/^\s{2}(\S+)\s\|/m) || [])[1];
  if (!masterName) fail('no master name parsed from:\n' + masters);
  ok('list_master_pages: found "' + masterName + '"');

  const applied = noError(
    await run(flow.applyMasterPage({ pageIndex: 1, masterName })),
    'apply_master_page'
  );
  if (!/Applied master/.test(applied)) fail('apply_master_page did not report: ' + applied);
  ok('apply_master_page: applied to page 2');

  // --- page number on the master -----------------------------------------
  await run(`
    var doc = app.activeDocument;
    var m = doc.masterSpreads[0].pages[0];
    var f = m.textFrames.add();
    f.geometricBounds = [${measure(280)}, ${measure(20)}, ${measure(290)}, ${measure(60)}];
    __result__ = "master frame added";
  `);
  const numbered = noError(
    await run(flow.insertPageNumber({ frameIndex: 0, onMaster: true, masterName, prefix: 'Page ' })),
    'insert_page_number'
  );
  if (!/automatic page number/.test(numbered)) fail('page number not reported: ' + numbered);
  ok('insert_page_number: marker placed on the master');

  // --- links --------------------------------------------------------------
  const links = noError(await run(flow.listLinks()), 'list_links');
  ok('list_links: ' + links.split('\n')[0].trim());

  // --- undo ---------------------------------------------------------------
  const undone = noError(await run(flow.undoSteps({ steps: 1 })), 'undo');
  if (!/Undid/.test(undone)) fail('undo did not report: ' + undone);
  ok('undo: ' + undone.split('\n')[0].trim());

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
console.log('\nResult: arrange and flow tools verified against InDesign.');
