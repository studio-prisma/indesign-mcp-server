/**
 * End-to-end test for effects, gradients, tables and paragraph settings.
 *
 * Checks the values back out of the document rather than trusting the return
 * message — an effect that silently does not apply reports success either way.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as fx from '../lib/effect-tools.js';
import * as layout from '../lib/layout-tools.js';

const LABEL = 'MCP-E2E-FX';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };
const run = async (s) => String(await executeInDesignScript(s));
const noError = (out, what) => { if (/ERROR/.test(out)) fail(what + ': ' + out); return out; };

console.log('Platform :', platformInfo.mode);
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
    doc.label = ${str(LABEL)};
    var page = doc.pages[0];

    var box = page.rectangles.add();
    box.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(70)}, ${measure(120)}];
    box.fillColor = doc.swatches.itemByName("Black");

    var tf = page.textFrames.add();
    tf.geometricBounds = [${measure(90)}, ${measure(20)}, ${measure(140)}, ${measure(190)}];
    tf.contents = ${str('Erster Absatz.\rZweiter Absatz mit etwas mehr Text darin.')};
    tf.parentStory.characters.everyItem().pointSize = ${num(11)};

    var tt = page.textFrames.add();
    tt.geometricBounds = [${measure(160)}, ${measure(20)}, ${measure(240)}, ${measure(190)}];
    var table = tt.parentStory.tables.add();
    table.columnCount = 3;
    table.bodyRowCount = 4;

    __result__ = page.allPageItems.length + " objects, tables: " +
      doc.stories.everyItem().tables.everyItem().getElements().length;
  `);
  created = true;
  ok('document built: ' + built.trim());

  const seen = noError(await run(layout.inspectPage({ pageIndex: 0 })), 'inspect_page');
  const boxIdx = Number((seen.match(/^\[(\d+)\] Rectangle/m) || [])[1]);
  if (Number.isNaN(boxIdx)) fail('no rectangle found:\n' + seen);
  ok('inspect_page: rectangle at [' + boxIdx + ']');

  // --- effects, read back -------------------------------------------------
  for (const [effect, check, label] of [
    ['DROP_SHADOW', 'String(it.transparencySettings.dropShadowSettings.mode)', 'ShadowMode.DROP'],
    ['OUTER_GLOW', 'it.transparencySettings.outerGlowSettings.applied', 'true'],
    ['BASIC_FEATHER', 'String(it.transparencySettings.featherSettings.mode)', 'FeatherMode.STANDARD'],
    ['INNER_SHADOW', 'it.transparencySettings.innerShadowSettings.applied', 'true'],
  ]) {
    noError(
      await run(fx.applyEffect({ objectIndex: boxIdx, effect, size: 3, opacity: 70 })),
      'apply_effect ' + effect
    );
    const state = await run(`
      var it = app.activeDocument.pages[0].allPageItems[${boxIdx}];
      __result__ = String(${check});
    `);
    if (!state.trim().includes(label.replace(/^.*\./, ''))) {
      fail(`${effect} did not take effect: read back "${state.trim()}", expected ${label}`);
    }
    ok('apply_effect ' + effect + ': verified in the document (' + state.trim() + ')');
  }

  const blended = noError(
    await run(fx.applyEffect({ objectIndex: boxIdx, blendMode: 'MULTIPLY', objectOpacity: 80 })),
    'blend mode'
  );
  const blendState = await run(`
    var it = app.activeDocument.pages[0].allPageItems[${boxIdx}];
    var b = it.transparencySettings.blendingSettings;
    __result__ = String(b.blendMode) + " @ " + b.opacity + "%";
  `);
  if (!/MULTIPLY/.test(blendState)) fail('blend mode not applied: ' + blendState);
  ok('apply_effect blend mode: ' + blendState.trim());

  const skipped = noError(
    await run(fx.applyEffect({ objectIndex: boxIdx, effect: 'BASIC_FEATHER', distance: 5 })),
    'unsupported option'
  );
  if (!/ignored/.test(skipped)) fail('an unsupported option should be reported: ' + skipped);
  ok('apply_effect: unsupported option reported, call did not fail');

  // --- gradient -----------------------------------------------------------
  const grad = noError(
    await run(fx.createGradient({
      name: 'ProbeVerlauf', type: 'LINEAR',
      stops: [{ color: 'Black', location: 0 }, { color: 'Paper', location: 100 }],
      objectIndex: boxIdx, angle: 30,
    })),
    'create_gradient'
  );
  const gradState = await run(`
    var doc = app.activeDocument;
    var it = doc.pages[0].allPageItems[${boxIdx}];
    __result__ = it.fillColor.name + " | stops " +
      (it.fillColor.gradientStops ? it.fillColor.gradientStops.length : "n/a") +
      " | angle " + it.gradientFillAngle;
  `);
  if (!/ProbeVerlauf/.test(gradState)) fail('gradient not applied as fill: ' + gradState);
  ok('create_gradient: ' + gradState.trim());

  // --- table --------------------------------------------------------------
  const tbl = noError(
    await run(fx.formatTable({
      tableIndex: 0, headerRows: 1, columnWidths: [50, 60, 50],
      borderWeight: 1, borderColor: 'Black',
    })),
    'format_table'
  );
  const tblState = await run(`
    var t = app.activeDocument.stories.everyItem().tables.everyItem().getElements()[0];
    __result__ = "header " + t.headerRowCount +
      " | col0 " + t.columns[0].width.toFixed(0) + "mm" +
      " | border " + t.cells[0].topEdgeStrokeWeight;
  `);
  if (!/header 1/.test(tblState)) fail('header row not set: ' + tblState);
  if (!/col0 50mm/.test(tblState)) fail('column width not set: ' + tblState);
  ok('format_table: ' + tblState.trim());

  const headerFill = noError(
    await run(fx.formatTable({
      tableIndex: 0, rowRange: 'header', fillColor: 'Black',
      fillTint: 30, verticalAlign: 'CENTER_ALIGN',
    })),
    'format_table header'
  );
  if (!/cell\(s\) formatted/.test(headerFill)) fail('no cells touched: ' + headerFill);
  ok('format_table header row: ' + headerFill.split('|').pop().trim());

  // --- paragraphs ---------------------------------------------------------
  const para = noError(
    await run(fx.formatParagraph({
      pageIndex: 0, frameIndex: 1, leftIndent: 5, firstLineIndent: 3,
      spaceBefore: 2, hyphenation: false,
    })),
    'format_paragraph'
  );
  const paraState = await run(`
    var p = app.activeDocument.pages[0].textFrames[1].parentStory.paragraphs[0];
    __result__ = "left " + p.leftIndent.toFixed(1) +
      " | first " + p.firstLineIndent.toFixed(1) +
      " | before " + p.spaceBefore.toFixed(1) +
      " | hyphenation " + p.hyphenation;
  `);
  if (!/left 5/.test(paraState)) fail('indent not applied: ' + paraState);
  if (!/hyphenation false/.test(paraState)) fail('hyphenation not applied: ' + paraState);
  ok('format_paragraph: ' + paraState.trim());

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
console.log('\nResult: effects, gradients, tables and paragraphs verified against InDesign.');
