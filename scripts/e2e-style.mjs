/**
 * End-to-end test for the appearance tools against a running InDesign.
 *
 * Covers the chain that "transform, restyle, restack, retext" actually means:
 * place a graphic, transform the frame, transform the artwork inside it
 * separately, restyle fill/stroke/corners/opacity, add a shadow, change text
 * and its formatting, and move things front to back.
 *
 * Writes its own test image so it needs nothing on disk beforehand.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as style from '../lib/style-tools.js';
import * as arrange from '../lib/arrange-tools.js';
import * as layout from '../lib/layout-tools.js';

const LABEL = 'MCP-E2E-STYLE';
const DIR = path.join(os.tmpdir(), 'indesign-mcp-e2e');
fs.mkdirSync(DIR, { recursive: true });

// A minimal valid SVG - artwork the placing and content transforms can act on.
const SVG = path.join(DIR, 'probe.svg');
fs.writeFileSync(SVG, [
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
  '  <rect x="0" y="0" width="200" height="100" fill="#3366cc"/>',
  '  <circle cx="100" cy="50" r="35" fill="#ffcc00"/>',
  '</svg>',
].join('\n'), 'utf8');

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };
const run = async (s) => String(await executeInDesignScript(s));
const noError = (out, what) => { if (/ERROR/.test(out)) fail(what + ': ' + out); return out; };

console.log('Platform :', platformInfo.mode);
console.log('Test SVG :', SVG);
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

    var t = page.textFrames.add();
    t.geometricBounds = [${measure(150)}, ${measure(20)}, ${measure(200)}, ${measure(190)}];
    t.contents = ${str('Ueberschrift und etwas Flattertext darunter.')};
    t.parentStory.characters.everyItem().pointSize = ${num(12)};

    var box = page.rectangles.add();
    box.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(120)}, ${measure(190)}];
    box.place(File(${str(SVG.replace(/\\/g, '/'))}));

    __result__ = page.allPageItems.length + " objects, artwork: " +
      (box.allGraphics.length > 0 ? "yes" : "NO");
  `);
  created = true;
  if (/artwork: NO/.test(built)) fail('the test SVG did not import: ' + built);
  ok('document built: ' + built.trim());

  // Which index is the picture frame?
  const seen = noError(await run(layout.inspectPage({ pageIndex: 0 })), 'inspect_page');
  const picIdx = Number((seen.match(/^\[(\d+)\] Rectangle/m) || [])[1]);
  const txtObjIdx = Number((seen.match(/^\[(\d+)\] TextFrame/m) || [])[1]);
  if (Number.isNaN(picIdx) || Number.isNaN(txtObjIdx)) fail('could not locate objects:\n' + seen);
  ok('inspect_page: picture at [' + picIdx + '], text frame at [' + txtObjIdx + ']');

  // --- frame vs. content --------------------------------------------------
  const frameRot = noError(
    await run(arrange.transformObject({ objectIndex: picIdx, rotation: 8 })),
    'transform_object'
  );
  if (!/rotation 8/.test(frameRot)) fail('frame rotation not applied: ' + frameRot);
  ok('transform_object: frame rotated 8 degrees');

  const contentScale = noError(
    await run(style.transformContent({ objectIndex: picIdx, scale: 130 })),
    'transform_content'
  );
  if (!/artwork after/.test(contentScale)) fail('content transform did not report: ' + contentScale);
  ok('transform_content: artwork scaled to 130% inside the frame'
    + (/is cropped/.test(contentScale) ? ' (reported as cropped)' : ''));

  const contentMove = noError(
    await run(style.transformContent({ objectIndex: picIdx, offsetX: -4, offsetY: 2 })),
    'transform_content offset'
  );
  ok('transform_content: artwork repositioned inside the frame');

  // --- appearance ---------------------------------------------------------
  const formatted = noError(
    await run(style.formatObject({
      objectIndex: picIdx, strokeColor: 'Black', strokeWeight: 2,
      strokeAlignment: 'INSIDE_ALIGNMENT', opacity: 85,
    })),
    'format_object'
  );
  if (!/after/.test(formatted)) fail('format_object did not report: ' + formatted);
  ok('format_object: ' + formatted.split('\n').pop().trim().slice(0, 66));

  const rounded = noError(
    await run(style.formatObject({ objectIndex: picIdx, cornerRadius: 6 })),
    'format_object corners'
  );
  const cornerCheck = await run(`
    var it = app.activeDocument.pages[0].allPageItems[${picIdx}];
    __result__ = "topLeft " + it.topLeftCornerRadius +
      " | bottomRight " + it.bottomRightCornerRadius +
      " | option " + String(it.topLeftCornerOption);
  `);
  if (!/topLeft 6/.test(cornerCheck)) {
    fail('corner radius not 6 mm as set: ' + cornerCheck);
  }
  ok('format_object: corners verified — ' + cornerCheck.trim());

  const badSwatch = await run(style.formatObject({ objectIndex: picIdx, fillColor: 'Gibtsnicht' }));
  if (!/Available:/.test(badSwatch)) fail('an unknown swatch should list the real ones: ' + badSwatch);
  ok('format_object: unknown swatch lists what the document has');

  const shadow = noError(
    await run(style.applyShadow({ objectIndex: picIdx, opacity: 60, blur: 4 })),
    'apply_shadow'
  );
  if (!/Drop shadow/.test(shadow)) fail('shadow not reported: ' + shadow);
  ok('apply_shadow: ' + shadow.trim().slice(0, 62));

  // --- text ---------------------------------------------------------------
  const retext = noError(await run(`
    var t = app.activeDocument.pages[0].textFrames[0];
    t.contents = ${str('Geaenderte Ueberschrift, laenger als vorher, damit sich etwas zeigt.')};
    __result__ = "text replaced, " + t.parentStory.length + " chars";
  `), 'text change');
  ok('text content changed: ' + retext.trim());

  const textFmt = noError(
    await run(style.formatText({
      pageIndex: 0, frameIndex: 0, fontSize: 22,
      alignment: 'FULLY_JUSTIFIED', tracking: 20,
    })),
    'format_text'
  );
  if (!/Formatted \d+ characters/.test(textFmt)) fail('format_text did not report: ' + textFmt);
  ok('format_text: ' + textFmt.split('\n')[0].trim()
    + (/overflows/.test(textFmt) ? ' (overflow reported)' : ''));

  // FULLY_JUSTIFIED had to work - the schema used to offer JUSTIFY, which
  // InDesign does not have.
  ok('format_text: FULLY_JUSTIFIED accepted (JUSTIFY never existed)');

  // --- stacking -----------------------------------------------------------
  const toBack = noError(
    await run(layout.arrangeObject({ objectIndex: picIdx, position: 'SEND_TO_BACK' })),
    'arrange_object'
  );
  if (!/frontmost/.test(toBack)) fail('arrange did not report position: ' + toBack);
  ok('arrange_object: picture sent to back — ' + toBack.split('\n')[0].trim().slice(0, 52));

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
console.log('\nResult: appearance and transform tools verified against InDesign.');
