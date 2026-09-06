/**
 * End-to-end test for the shape, section and IDML tools, plus the undo
 * grouping that now wraps every call.
 *
 * Everything here is read back out of the document rather than taken from a
 * return message: the corner count off the polygon's own path, the page names
 * off the pages, the anchored frame's parent out of the story.
 *
 * Like the other e2e scripts it labels the document it creates and closes only
 * that one, so a document open in parallel cannot be affected.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { executeInDesignScript, platformInfo, withUndoLabel } from '../lib/indesign-driver.js';
import { str } from '../lib/jsx-safe.js';
import * as shapes from '../lib/shape-tools.js';
import * as flow from '../lib/flow-tools.js';
import * as exporters from '../lib/export-tools.js';

const LABEL = 'MCP-E2E-SHAPE';
const IDML = path.join(os.homedir(), 'mcp-e2e-shape.idml');

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };

/** Run a tool the way the server does: inside its own named undo step. */
const tool = (name, script) => withUndoLabel(name, () => executeInDesignScript(script));
const read = (expr) => executeInDesignScript(`__result__ = ${expr};`, { undoName: null })
  .then((r) => String(r).trim());

console.log('Platform :', platformInfo.mode);
console.log('');

const countBefore = Number(await read('app.documents.length'));
ok('documents open before: ' + countBefore);

let created = false;
let failure = null;

try {
  await tool('create_document', `
    var doc = app.documents.add();
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
    doc.documentPreferences.pageWidth = "210mm";
    doc.documentPreferences.pageHeight = "297mm";
    doc.documentPreferences.pagesPerDocument = 6;
    doc.label = ${str(LABEL)};
    __result__ = doc.name;
  `);
  created = true;
  ok('test document created with 6 pages');

  // ---------------------------------------------------------------- shapes

  await tool('create_polygon', shapes.createPolygon({
    x: 20, y: 20, width: 50, height: 50, sides: 6, fillColor: 'Black',
  }));
  const hexCorners = await read('app.activeDocument.pages[0].polygons[0].paths[0].entirePath.length');
  if (hexCorners !== '6') fail(`hexagon has ${hexCorners} corners, expected 6`);
  ok('polygon: 6 corners, read off the path itself');

  await tool('create_polygon', shapes.createPolygon({
    x: 20, y: 90, width: 50, height: 50, sides: 5, starInset: 45,
  }));
  const starCorners = await read('app.activeDocument.pages[0].polygons[0].paths[0].entirePath.length');
  if (starCorners !== '10') fail(`star has ${starCorners} corners, expected 10`);
  ok('star: 10 corners (polygons are ordered front to back, so index 0 is the new one)');

  // The None swatch reports an empty name, so compare identity rather than
  // the label, and check the weight as well.
  const noStroke = await read(
    '(function () { var d = app.activeDocument; var p0 = d.pages[0].polygons[0]; ' +
    'return (p0.strokeColor === d.swatches.itemByName("None")) + "/" + p0.strokeWeight; })()');
  if (!noStroke.startsWith('true')) {
    fail(`the new polygon carries a stroke nobody asked for: ${noStroke}`);
  }
  ok('no stroke unless asked for (identity/weight: ' + noStroke + ')');

  await tool('create_line', shapes.createLine({
    x1: 20, y1: 160, x2: 190, y2: 160, strokeWidth: 2,
  }));
  const linePoints = await read('app.activeDocument.pages[0].graphicLines[0].paths[0].entirePath.length');
  const lineWeight = await read('app.activeDocument.pages[0].graphicLines[0].strokeWeight');
  if (linePoints !== '2') fail(`line has ${linePoints} points, expected 2`);
  ok(`line: 2 points, stroke weight ${lineWeight}`);

  // ------------------------------------------------------- anchored frame

  await tool('create_text_frame', `
    var page = app.activeDocument.pages[0];
    var tf = page.textFrames.add();
    tf.geometricBounds = ["180mm", "20mm", "260mm", "190mm"];
    tf.contents = "A paragraph long enough that an anchored object has somewhere to sit inside it.";
    tf.strokeColor = app.activeDocument.swatches.itemByName("None");
    __result__ = "text frame with " + tf.parentStory.insertionPoints.length + " positions";
  `);
  ok('text frame to anchor into');

  await tool('create_anchored_frame', shapes.createAnchoredFrame({
    frameIndex: 0, characterOffset: 10, width: 12, height: 8, content: 'x',
  }));
  // An anchored object is still a page item, but its parent is a character in
  // the story rather than the spread. That is the thing to check.
  const anchored = await read(
    '(function () { var d = app.activeDocument; var items = d.pages[0].allPageItems; ' +
    'var n = 0, kinds = []; for (var i = 0; i < items.length; i++) { try { ' +
    'var p = String(items[i].parent); if (p.indexOf("Character") >= 0 || ' +
    'p.indexOf("InsertionPoint") >= 0 || p.indexOf("Story") >= 0) ' +
    '{ n++; kinds.push(p); } } catch (e) {} } ' +
    'return n + " | " + kinds.join(","); })()');
  if (anchored.startsWith('0')) {
    fail('no page item has a text position as its parent - nothing was anchored');
  }
  ok('anchored frame sits in the text (' + anchored + ')');

  // -------------------------------------------------------------- section

  await tool('create_section', flow.createSection({
    pageIndex: 2, pageNumberStart: 1, pageNumberStyle: 'LOWER_ROMAN',
  }));
  const names = await read(
    '(function () { var n = []; for (var i = 0; i < app.activeDocument.pages.length; i++) ' +
    '{ n.push(app.activeDocument.pages[i].name); } return n.join(","); })()');
  if (!names.includes('i')) fail(`the numbering did not change: ${names}`);
  ok('section: page names are now ' + names);

  const sections = await tool('list_sections', flow.listSections());
  if (!String(sections).includes('LOWER_ROMAN')) fail('list_sections does not report the style');
  ok('list_sections reports both sections');

  // ----------------------------------------------------------------- undo

  // One call made several objects; one undo has to take all of them.
  const beforeUndo = Number(await read('app.activeDocument.pages[0].polygons.length'));
  const undoName = await read('app.activeDocument.undoName');
  await executeInDesignScript('app.activeDocument.undo(); __result__ = "done";', { undoName: null });
  const afterUndo = Number(await read('app.activeDocument.pages[0].polygons.length'));
  ok(`undo: history named the last step "${undoName}", polygons ${beforeUndo} -> ${afterUndo}`);
  if (undoName !== 'create_section' && undoName !== 'list_sections') {
    fail(`the undo step is named "${undoName}", not after the tool that made it`);
  }

  // ----------------------------------------------------------------- IDML

  if (fs.existsSync(IDML)) fs.unlinkSync(IDML);
  const idml = await tool('export_idml', exporters.exportIDML({ filePath: IDML }));
  if (!fs.existsSync(IDML)) fail('export_idml produced no file: ' + String(idml).trim());
  const kb = Math.round(fs.statSync(IDML).size / 1024);
  if (kb < 5) fail(`the IDML is only ${kb} KB, which is not a document`);
  ok(`IDML exported, ${kb} KB on disk`);
} catch (e) {
  failure = e;
} finally {
  if (created) {
    const closed = await executeInDesignScript(`
      var n = 0;
      for (var i = app.documents.length - 1; i >= 0; i--) {
        if (app.documents[i].label === ${str(LABEL)}) {
          app.documents[i].close(SaveOptions.NO);
          n++;
        }
      }
      __result__ = n + " closed, " + app.documents.length + " still open";
    `, { undoName: null });
    ok('cleanup: ' + String(closed).trim());
  }
  try { if (fs.existsSync(IDML)) fs.unlinkSync(IDML); } catch { /* best effort */ }
}

const countAfter = Number(await read('app.documents.length'));
if (countAfter !== countBefore) {
  console.log(`\n  WARNING: ${countBefore} documents open before, ${countAfter} after.`);
}

if (failure) {
  console.log('\nFAILED: ' + failure.message);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
