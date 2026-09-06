/**
 * End-to-end test for the text tools against a running InDesign.
 *
 * Reproduces the chain that failed before: put text in a document, read it
 * back, search it, replace something. Each step previously either returned
 * nothing or raised on an option InDesign does not have.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str, measure, num } from '../lib/jsx-safe.js';
import * as text from '../lib/text-tools.js';

const LABEL = 'MCP-E2E-TEXT';

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
    doc.documentPreferences.pagesPerDocument = 2;
    doc.label = ${str(LABEL)};

    var a = doc.pages[0].textFrames.add();
    a.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(80)}, ${measure(190)}];
    a.contents = ${str('Bauzaunbanner fuer die MakerFaire. Das Banner misst 340 x 173 cm.')};
    a.parentStory.characters.everyItem().pointSize = ${num(14)};

    var b = doc.pages[1].textFrames.add();
    b.geometricBounds = [${measure(20)}, ${measure(20)}, ${measure(80)}, ${measure(190)}];
    b.contents = ${str('Zweite Seite: banner, Banner und BANNER in drei Schreibweisen.')};
    b.parentStory.characters.everyItem().pointSize = ${num(14)};

    __result__ = doc.stories.length + " stories";
  `);
  created = true;
  ok('document built: ' + built.trim());

  // --- reading, the case that returned nothing -----------------------------
  const all = noError(await run(text.getTextContent({ scope: 'document' })), 'get_text_content');
  if (!/MakerFaire/.test(all) || !/Zweite Seite/.test(all)) {
    fail('document scope did not return both stories:\n' + all);
  }
  ok('get_text_content scope=document: ' + all.split('\n')[0].trim());

  const page2 = noError(await run(text.getTextContent({ scope: 'page', pageIndex: 1 })), 'page scope');
  if (!/Zweite Seite/.test(page2) || /MakerFaire/.test(page2)) {
    fail('page scope returned the wrong page:\n' + page2);
  }
  ok('get_text_content scope=page: only page 2');

  const noSel = await run(text.getTextContent({ scope: 'selection' }));
  if (!/Nothing is selected/.test(noSel)) fail('selection scope should explain itself: ' + noSel);
  ok('get_text_content scope=selection without selection: explains instead of returning nothing');

  // --- searching, the case that raised on caseSensitive --------------------
  const insensitive = noError(
    await run(text.findText({ query: 'banner', caseSensitive: false })),
    'find_text case-insensitive'
  );
  const nInsens = Number((insensitive.match(/^(\d+) match/) || [])[1]);
  if (!nInsens || nInsens < 3) fail('expected at least 3 case-insensitive matches:\n' + insensitive);
  ok('find_text case-insensitive: ' + nInsens + ' matches');

  const sensitive = noError(
    await run(text.findText({ query: 'banner', caseSensitive: true })),
    'find_text case-sensitive'
  );
  const nSens = Number((sensitive.match(/^(\d+) match/) || [])[1]);
  if (!(nSens < nInsens)) {
    fail('case-sensitive search should find fewer: ' + nSens + ' vs ' + nInsens);
  }
  ok('find_text case-sensitive: ' + nSens + ' matches — the option now works');

  if (!/character \d+/.test(insensitive)) fail('no position reported:\n' + insensitive);
  ok('find_text reports page, frame and context per hit');

  const grep = noError(
    await run(text.findText({ query: '\\d+ x \\d+', useGrep: true })),
    'find_text GREP'
  );
  if (!/1 match/.test(grep)) fail('GREP found nothing:\n' + grep);
  ok('find_text GREP: found the dimensions');

  // --- replacing -----------------------------------------------------------
  const preview = noError(
    await run(text.findReplaceText({ findText: 'Banner', replaceText: 'Plane', preview: true })),
    'preview'
  );
  if (!/Nothing was changed/.test(preview)) fail('preview changed something: ' + preview);
  const stillThere = await run(text.findText({ query: 'Banner', caseSensitive: true }));
  if (/No match/.test(stillThere)) fail('preview replaced after all');
  ok('find_replace_text preview: counted without changing');

  const replaced = noError(
    await run(text.findReplaceText({ findText: 'Banner', replaceText: 'Plane', caseSensitive: true })),
    'replace'
  );
  if (!/Replaced \d+/.test(replaced)) fail('replace did not report: ' + replaced);
  ok('find_replace_text: ' + replaced.trim());

  const after = noError(await run(text.getTextContent({ scope: 'document' })), 'verify');
  if (!/Plane/.test(after)) fail('replacement not visible in the text:\n' + after);
  ok('get_text_content confirms the replacement');

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
console.log('\nResult: text tools verified against InDesign.');
