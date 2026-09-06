/**
 * End-to-end test for the generic property access.
 *
 * Two things to show. First that it actually reaches what the specialised
 * tools do not — properties nothing wraps. Second, and more important, that
 * it is not a way to run code: a payload sent as a value has to end up as
 * text in the document, and one sent as a property path or method name has to
 * be refused before it reaches InDesign at all.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as g from '../lib/generic-tools.js';
import * as layout from '../lib/layout-tools.js';

const LABEL = 'MCP-E2E-GENERIC';
const BS = String.fromCharCode(92);
const BREAKOUT = 'x' + BS + '"; app.quit(); //';

let step = 0;
const ok = (m) => console.log('  [' + (++step) + '] ' + m);
class Abort extends Error {}
const fail = (m) => { throw new Abort(m); };
const run = async (s) => String(await executeInDesignScript(s));
const noError = (out, what) => { if (/^ERROR/m.test(out)) fail(what + ': ' + out); return out; };

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
    tf.contents = "Generischer Zugriff";
    __result__ = page.allPageItems.length + " objects";
  `);
  created = true;
  ok('document built: ' + built.trim());

  const seen = noError(await run(layout.inspectPage({ pageIndex: 0 })), 'inspect_page');
  const boxIdx = Number((seen.match(/^\[(\d+)\] Rectangle/m) || [])[1]);
  if (Number.isNaN(boxIdx)) fail('no rectangle:\n' + seen);

  // --- discovery ----------------------------------------------------------
  const listed = noError(
    await run(g.inspectObject({ target: { kind: 'pageItem', objectIndex: boxIdx } })),
    'inspect_object'
  );
  const count = Number((listed.match(/(\d+) of \d+ readable properties/) || [])[1]);
  if (!count || count < 20) fail('too few properties listed:\n' + listed.slice(0, 400));
  ok('inspect_object: listed ' + count + ' readable properties without being told any name');

  const specific = noError(
    await run(g.inspectObject({
      target: { kind: 'pageItem', objectIndex: boxIdx },
      properties: ['fillColor', 'geometricBounds', 'cornerRadius'],
    })),
    'inspect_object specific'
  );
  if (!/NOT AVAILABLE/.test(specific)) {
    fail('cornerRadius should be reported as unavailable:\n' + specific);
  }
  ok('inspect_object: names this version lacks are reported, not guessed');

  // --- reach something no specialised tool wraps --------------------------
  const exotic = noError(
    await run(g.setProperties({
      target: { kind: 'pageItem', objectIndex: boxIdx },
      properties: {
        nonprinting: true,
        'transparencySettings.blendingSettings.knockoutGroup': true,
        strokeCornerAdjustment: { enum: 'StrokeCornerAdjustment.ROUNDED_CORNERS' },
      },
    })),
    'set_properties exotic'
  );
  const exoticState = await run(`
    var it = app.activeDocument.pages[0].allPageItems[${boxIdx}];
    __result__ = "nonprinting " + it.nonprinting +
      " | knockout " + it.transparencySettings.blendingSettings.knockoutGroup;
  `);
  if (!/nonprinting true/.test(exoticState)) fail('property not applied: ' + exoticState);
  ok('set_properties: reached properties no tool wraps — ' + exoticState.trim());

  // --- partial failure is survivable --------------------------------------
  const mixed = await run(g.setProperties({
    target: { kind: 'pageItem', objectIndex: boxIdx },
    properties: { rotationAngle: 12, cornerRadius: 5, visible: true },
  }));
  if (!/2 of 3/.test(mixed)) fail('expected two of three to apply:\n' + mixed);
  if (!/failed:/.test(mixed)) fail('the failure should be named:\n' + mixed);
  const rot = await run(`
    __result__ = String(app.activeDocument.pages[0].allPageItems[${boxIdx}].rotationAngle);
  `);
  if (!/12/.test(rot)) fail('the good properties did not survive the bad one: ' + rot);
  ok('set_properties: one bad name did not take the other two with it');

  // --- method call --------------------------------------------------------
  const called = noError(
    await run(g.callMethod({
      target: { kind: 'pageItem', objectIndex: boxIdx }, method: 'sendToBack',
    })),
    'call_method'
  );
  ok('call_method: ' + called.split('\n')[0].trim());

  // --- the boundary -------------------------------------------------------
  const asValue = noError(
    await run(g.setProperties({
      target: { kind: 'textFrame', frameIndex: 0 },
      properties: { contents: BREAKOUT },
    })),
    'payload as value'
  );
  const stored = await run(`
    __result__ = app.activeDocument.pages[0].textFrames[0].contents;
  `);
  // InDesign's smart quotes turn a straight " into a typographic one on the
  // way in, so compare with that normalised. What matters is that the payload
  // arrived as text at all - the quote substitution is InDesign editing a
  // string, which is the opposite of executing it.
  const normalise = (s) => s.replace(/[“”„«»]/g, '"');
  if (normalise(stored.trim()) !== BREAKOUT) {
    fail('the payload did not survive as text: ' + JSON.stringify(stored));
  }
  const smartQuoted = stored.trim() !== BREAKOUT;
  ok('a breakout payload sent as a value is stored as text' +
    (smartQuoted ? ' (with the quote replaced typographically by InDesign)' : ', verbatim'));

  const stillOpen = Number((await run('__result__ = app.documents.length;')).trim());
  if (stillOpen === 0) fail('InDesign closed the document — the payload executed');
  ok('InDesign still has ' + stillOpen + ' document(s) open — nothing executed');

  // Refused before reaching InDesign at all.
  let refused = 0;
  for (const attempt of [
    () => g.setProperties({ target: { kind: 'pageItem', objectIndex: boxIdx }, properties: { 'contents; app.quit()': 1 } }),
    () => g.callMethod({ target: { kind: 'pageItem', objectIndex: boxIdx }, method: 'quit' }),
    () => g.setProperties({ target: { kind: 'pageItem', objectIndex: boxIdx }, properties: { x: { enum: 'A.B; app.quit()' } } }),
    () => g.inspectObject({ target: { kind: 'pageItem', objectIndex: '0]; app.quit(); //' } }),
  ]) {
    try { attempt(); } catch (e) { refused++; }
  }
  if (refused !== 4) fail(`only ${refused} of 4 code-shaped inputs were refused`);
  ok('4 of 4 code-shaped inputs refused before any script was built');

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
console.log('\nResult: generic access verified against InDesign, boundary included.');
