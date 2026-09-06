/**
 * Check every DOM property this server writes against the running InDesign.
 *
 * Exists because the same failure kept recurring: a property name that was
 * valid in an older version, set on an object that no longer has it. InDesign
 * raises "Object does not support the property or method", the whole call
 * fails, and the tool looks broken for unrelated reasons. Reading the code
 * cannot catch it — only asking the application can.
 *
 * Run it after an InDesign upgrade, and whenever a tool fails for no visible
 * reason:  npm run verify-api
 *
 * Exit code 1 if anything is missing.
 */

import { executeInDesignScript, platformInfo } from '../lib/indesign-driver.js';
import { str } from '../lib/jsx-safe.js';

const LABEL = 'MCP-VERIFY-API';

/**
 * Each entry: an expression yielding the object, and the properties the
 * server sets on it. Values are only probed for readability — nothing is
 * written to a real document beyond the throwaway one created here.
 */
const SURFACE = [
  ['app.pdfExportPreferences', [
    'pageRange', 'cropMarks', 'bleedMarks', 'registrationMarks', 'colorBars',
    'pageInformationMarks', 'useDocumentBleedWithPDF', 'includeSlugWithPDF',
  ]],
  ['app.jpegExportPreferences', [
    'jpegQuality', 'exportResolution', 'jpegExportRange', 'pageString',
    'useDocumentBleeds', 'antiAlias',
  ]],
  ['app.pngExportPreferences', [
    'exportResolution', 'pngExportRange', 'pageString',
    'transparentBackground', 'useDocumentBleeds', 'antiAlias',
  ]],
  ['app.preflightProfiles', ['length']],
  ['app.preflightProcesses', ['length']],
  ['app.findChangeTextOptions', [
    'caseSensitive', 'wholeWord', 'includeFootnotes', 'includeMasterPages',
    'includeHiddenLayers',
  ]],
  ['app.findChangeGrepOptions', [
    'includeFootnotes', 'includeMasterPages', 'includeHiddenLayers',
  ]],
  ['app.findTextPreferences', ['findWhat']],
  ['app.changeTextPreferences', ['changeTo']],
  ['doc.documentPreferences', [
    'pageWidth', 'pageHeight', 'facingPages', 'pagesPerDocument',
    'documentBleedTopOffset', 'slugTopOffset',
  ]],
  ['doc.marginPreferences', ['top', 'bottom', 'left', 'right']],
  ['rect', [
    'geometricBounds', 'fillColor', 'strokeColor', 'strokeWeight',
    'strokeAlignment', 'rotationAngle', 'horizontalScale', 'verticalScale',
    'topLeftCornerRadius', 'topLeftCornerOption', 'locked', 'visible',
    'itemLayer', 'allGraphics',
    // Known absent - listed so the report shows it stays absent:
    'cornerRadius',
  ]],
  ['rect.transparencySettings.blendingSettings', ['opacity']],
  ['rect.transparencySettings.dropShadowSettings', [
    'mode', 'opacity', 'xOffset', 'yOffset', 'size', 'distance', 'angle',
  ]],
  ['rect.transparencySettings.outerGlowSettings', [
    'applied', 'opacity', 'size', 'effectColor', 'blendMode', 'spread', 'noise',
  ]],
  ['rect.transparencySettings.innerShadowSettings', ['applied', 'opacity', 'size']],
  ['rect.transparencySettings.innerGlowSettings', ['applied', 'opacity', 'size']],
  ['rect.transparencySettings.bevelAndEmbossSettings', ['applied', 'size']],
  ['rect.transparencySettings.satinSettings', ['applied', 'opacity', 'size']],
  ['rect.transparencySettings.featherSettings', ['mode', 'width', 'cornerType', 'noise']],
  ['rect.transparencySettings.directionalFeatherSettings', ['applied']],
  ['rect.transparencySettings.gradientFeatherSettings', ['applied']],
  ['rect.transparencySettings.blendingSettings', ['blendMode', 'knockoutGroup']],
  ['tf', [
    'contents', 'overflows', 'nextTextFrame', 'previousTextFrame',
    'parentStory', 'textWrapPreferences', 'geometricBounds',
  ]],
  ['tf.textFramePreferences', [
    'textColumnCount', 'textColumnGutter', 'insetSpacing',
    'verticalJustification', 'autoSizingType',
  ]],
  ['tf.textWrapPreferences', ['textWrapMode', 'textWrapOffset']],
  ['doc.pages[0]', ['appliedMaster', 'allPageItems', 'textFrames', 'bounds']],
  ['doc', ['masterSpreads', 'links', 'stories', 'swatches', 'layers', 'align',
    'distribute', 'undo', 'gradients']],
  ['tbl', ['headerRowCount', 'footerRowCount', 'columnCount', 'bodyRowCount', 'rows', 'columns', 'cells']],
  ['tbl.cells[0]', ['fillColor', 'fillTint', 'topEdgeStrokeWeight', 'topEdgeStrokeColor',
    'bottomEdgeStrokeWeight', 'leftEdgeStrokeWeight', 'rightEdgeStrokeWeight',
    'verticalJustification', 'topInset', 'leftInset']],
  ['para', ['leftIndent', 'rightIndent', 'firstLineIndent', 'spaceBefore',
    'spaceAfter', 'hyphenation', 'keepLinesTogether', 'justification']],
  ['grad', ['type', 'name', 'gradientStops']],
  // Only what the server actually writes - midpoint is never set.
  ['grad.gradientStops[0]', ['stopColor', 'location']],
  // Shapes and sections.
  ['doc.pages[0]', ['polygons', 'graphicLines', 'ovals', 'rectangles']],
  ['poly.paths[0]', ['entirePath']],
  ['doc.sections[0]', ['pageStart', 'continueNumbering', 'pageNumberStart',
    'pageNumberStyle', 'sectionPrefix', 'includeSectionPrefix', 'marker']],
  // anchorYoffset, not anchorYOffset. AnchoredPosition does not exist either -
  // the enum is AnchorPosition, see ENUMS below.
  ['anchored.anchoredObjectSettings', ['anchoredPosition', 'anchorYoffset',
    'anchorXoffset', 'spineRelative']],
];

/** Enum members the server names explicitly. */
const ENUMS = {
  Justification: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN',
    'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED'],
  FitOptions: ['PROPORTIONALLY', 'FILL_PROPORTIONALLY', 'FRAME_TO_CONTENT',
    'CONTENT_TO_FRAME', 'CENTER_CONTENT', 'APPLY_FRAME_FITTING_OPTIONS'],
  AlignOptions: ['LEFT_EDGES', 'RIGHT_EDGES', 'TOP_EDGES', 'BOTTOM_EDGES',
    'HORIZONTAL_CENTERS', 'VERTICAL_CENTERS'],
  DistributeOptions: ['HORIZONTAL_SPACE', 'VERTICAL_SPACE', 'LEFT_EDGES'],
  AlignDistributeBounds: ['ITEM_BOUNDS', 'PAGE_BOUNDS', 'MARGIN_BOUNDS',
    'SPREAD_BOUNDS', 'BLEED_BOUNDS', 'KEY_OBJECT'],
  CornerOptions: ['NONE', 'ROUNDED_CORNER', 'INVERSE_ROUNDED_CORNER',
    'INSET_CORNER', 'BEVEL_CORNER', 'FANCY_CORNER'],
  StrokeAlignment: ['CENTER_ALIGNMENT', 'INSIDE_ALIGNMENT', 'OUTSIDE_ALIGNMENT'],
  VerticalJustification: ['TOP_ALIGN', 'CENTER_ALIGN', 'BOTTOM_ALIGN', 'JUSTIFY_ALIGN'],
  TextWrapModes: ['NONE', 'BOUNDING_BOX_TEXT_WRAP', 'CONTOUR',
    'JUMP_OBJECT_TEXT_WRAP', 'NEXT_COLUMN_TEXT_WRAP'],
  ShadowMode: ['NONE', 'DROP'],
  ColorSpace: ['CMYK', 'RGB', 'LAB'],
  ColorModel: ['PROCESS', 'SPOT', 'REGISTRATION'],
  ExportFormat: ['PDF_TYPE', 'JPG', 'PNG_FORMAT', 'EPUB', 'FIXED_LAYOUT_EPUB',
    'INDESIGN_MARKUP'],
  PageRange: ['ALL_PAGES'],
  JPEGOptionsQuality: ['LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'],
  PNGExportRangeEnum: ['EXPORT_ALL', 'EXPORT_RANGE'],
  ExportRangeOrAllPages: ['EXPORT_ALL', 'EXPORT_RANGE'],
  SaveOptions: ['YES', 'NO', 'ASK'],
  LocationOptions: ['BEFORE', 'AFTER', 'AT_END'],
  Capitalization: ['NORMAL', 'ALL_CAPS'],
  AnchorPoint: ['TOP_LEFT_ANCHOR', 'CENTER_ANCHOR'],
  Flip: ['HORIZONTAL', 'VERTICAL'],
  BlendMode: ['NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'LUMINOSITY'],
  FeatherMode: ['NONE', 'STANDARD'],
  GradientType: ['LINEAR', 'RADIAL'],
  // Read out of 21.5: KATAKANA_MODERN and FULL_WIDTH_ARABIC appear in older
  // references and are not there.
  PageNumberStyle: ['ARABIC', 'LOWER_ROMAN', 'UPPER_ROMAN', 'LOWER_LETTERS',
    'UPPER_LETTERS', 'KANJI', 'SINGLE_LEADING_ZEROS', 'DOUBLE_LEADING_ZEROS',
    'TRIPLE_LEADING_ZEROS'],
  AnchorPosition: ['INLINE_POSITION', 'ABOVE_LINE', 'ANCHORED'],
  UndoModes: ['ENTIRE_SCRIPT'],
};

// Build one script that probes everything and returns a compact report.
const NL = String.fromCharCode(92) + 'n';
const lines = [
  'var doc = app.documents.add();',
  `doc.label = ${str(LABEL)};`,
  'var page = doc.pages[0];',
  'var rect = page.rectangles.add();',
  'rect.geometricBounds = [10, 10, 40, 60];',
  'var tf = page.textFrames.add();',
  'tf.geometricBounds = [50, 10, 80, 60];',
  'tf.contents = "probe";',
  'var tt = page.textFrames.add();',
  'tt.geometricBounds = [90, 10, 140, 60];',
  'var tbl = tt.parentStory.tables.add();',
  'tbl.columnCount = 2; tbl.bodyRowCount = 2;',
  'var para = tf.parentStory.paragraphs[0];',
  'var grad = doc.gradients.add();',
  'var poly = page.polygons.add();',
  'poly.paths[0].entirePath = [[10, 150], [60, 150], [35, 190]];',
  'var anchored = tf.parentStory.insertionPoints[2].rectangles.add();',
  'anchored.geometricBounds = [0, 0, 8, 8];',
  'var out = [];',
  'function probe(owner, label, name) {',
  '  var verdict;',
  '  try {',
  '    verdict = (typeof owner[name] === "undefined") ? "MISSING" : "ok";',
  '  } catch (e) {',
  '    verdict = "MISSING";',
  '  }',
  '  out.push(verdict + "|" + label + "." + name);',
  '}',
  'function probeEnum(obj, label, member) {',
  '  var verdict;',
  '  try {',
  '    verdict = (typeof obj[member] === "undefined") ? "MISSING" : "ok";',
  '  } catch (e) { verdict = "MISSING"; }',
  '  out.push(verdict + "|" + label + "." + member);',
  '}',
];

// One try/catch per owner: if the owner expression itself raises - because
// that preferences object no longer exists - the whole script would otherwise
// abort at the first one and report nothing about the rest.
for (const [owner, props] of SURFACE) {
  lines.push('try {');
  for (const p of props) {
    lines.push(`  probe(${owner}, ${JSON.stringify(owner)}, ${JSON.stringify(p)});`);
  }
  lines.push(`} catch (e) { out.push("NO-OWNER|" + ${JSON.stringify(owner)}); }`);
}
for (const [name, members] of Object.entries(ENUMS)) {
  lines.push('try {');
  for (const m of members) {
    lines.push(`  probeEnum(${name}, ${JSON.stringify(name)}, ${JSON.stringify(m)});`);
  }
  lines.push(`} catch (e) { out.push("NO-OWNER|" + ${JSON.stringify(name)}); }`);
}
lines.push(`__result__ = out.join("${NL}");`);

console.log('Platform :', platformInfo.mode);
console.log('');

let report;
try {
  report = String(await executeInDesignScript(lines.join('\n')));
} finally {
  await executeInDesignScript(`
    var n = 0;
    for (var i = app.documents.length - 1; i >= 0; i--) {
      if (app.documents[i].label === ${str(LABEL)}) { app.documents[i].close(SaveOptions.NO); n++; }
    }
    __result__ = "cleaned " + n;
  `);
}

if (process.env.RAW) { console.log('--- RAW ---'); console.log(report.slice(0, 800)); console.log('--- /RAW ---'); }
const rows = report.split('\n').map((l) => l.trim()).filter(Boolean);
const missing = rows.filter((r) => r.startsWith('MISSING|')).map((r) => r.slice(8));
const noOwner = rows.filter((r) => r.startsWith('NO-OWNER|')).map((r) => r.slice(9));
const ok = rows.length - missing.length - noOwner.length;

// cornerRadius is probed deliberately and is expected to be absent.
// Probed on purpose: names this server used to set and no longer does.
const EXPECTED_ABSENT = ['rect.cornerRadius'];
const unexpected = missing.filter((m) => !EXPECTED_ABSENT.includes(m));
const expected = missing.filter((m) => EXPECTED_ABSENT.includes(m));

console.log(`Checked ${rows.length} properties and enum members against InDesign.`);
console.log(`  present: ${ok}`);

if (expected.length > 0) {
  console.log('\nAbsent as expected (the server does not use these):');
  expected.forEach((m) => console.log('  ' + m));
}

if (noOwner.length > 0) {
  console.log(`
${noOwner.length} object(s) this version does not expose at all:`);
  noOwner.forEach((o) => console.log('  NO OBJECT  ' + o));
  process.exitCode = 1;
}

if (unexpected.length === 0 && noOwner.length === 0) {
  console.log('\nEverything the server writes exists in this version.');
} else {
  console.log(`\n${unexpected.length} property/properties this version does NOT have:`);
  unexpected.forEach((m) => console.log('  MISSING  ' + m));
  console.log('\nAny tool setting one of these fails outright — InDesign raises');
  console.log('"Object does not support the property or method" and the whole call');
  console.log('aborts, which usually looks like the tool doing nothing.');
  process.exitCode = 1;
}
