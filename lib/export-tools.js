/**
 * export-tools.js
 * PDF, image and EPUB export, and preflight.
 *
 * Every property name here was read out of InDesign 21.5 rather than taken
 * from older documentation, because the previous versions of these tools set
 * names the application no longer has — and a missing property is not ignored,
 * it aborts the whole call. What changed:
 *
 *   includeBleedMarks          -> bleedMarks
 *   includeSlugArea            -> includeSlugWithPDF
 *   outputIntention            -> gone, no direct replacement
 *   jpeg/png .resolution       -> exportResolution
 *   jpeg/png .useDocumentBleedWithPDF -> useDocumentBleeds
 *   app.epubExportPreferences  -> gone entirely; EPUB exports without it
 *
 * Preflight had three: the processes collection lives on app and takes the
 * document as an argument, the results property is aggregatedResults rather
 * than preflightResultsData, and the process runs asynchronously — without
 * waitForProcess() the results are read before it has finished.
 */

import { str, num, index, bool, enumOf, jsxPath, validateFilePath } from './jsx-safe.js';

export const PDF_PRESETS = [
  'HighQualityPrint', 'PressQuality', 'SmallestFileSize',
  'PDFX1a2001', 'PDFX32002', 'PDFX42008',
];

export const IMAGE_FORMATS = ['PNG', 'JPG', 'JPEG'];

/** Reset export preferences that persist between calls. */
const RESET_PDF = `
      app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
      app.pdfExportPreferences.cropMarks = false;
      app.pdfExportPreferences.bleedMarks = false;
      app.pdfExportPreferences.registrationMarks = false;
      app.pdfExportPreferences.colorBars = false;
      app.pdfExportPreferences.pageInformationMarks = false;
      app.pdfExportPreferences.useDocumentBleedWithPDF = false;
      app.pdfExportPreferences.includeSlugWithPDF = false;
`;

/**
 * Export the active document to PDF.
 *
 * Marks and bleed are off unless asked for. Reports the file size afterwards,
 * because an export that produces a 0-byte file otherwise looks like success.
 */
export function exportPDF({
  filePath, preset = 'HighQualityPrint', pageRange = 'all',
  cropMarks = false, bleedMarks = false, registrationMarks = false,
  colorBars = false, pageInformation = false,
  includeBleed = false, includeSlug = false,
}) {
  const validated = validateFilePath(filePath);
  const p = enumOf(preset, PDF_PRESETS, { name: 'preset' });
  const allPages = pageRange === 'all' || pageRange === undefined;

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        ${RESET_PDF}
        var pdfPreset = null;
        try { pdfPreset = app.pdfExportPresets.itemByName("[" + ${str(p)} + "]"); } catch (e0) {}
        if (pdfPreset === null || !pdfPreset.isValid) {
          try { pdfPreset = app.pdfExportPresets.itemByName(${str(p)}); } catch (e1) {}
        }

        ${allPages ? `
          app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
        ` : `
          app.pdfExportPreferences.pageRange = ${str(pageRange)};
        `}
        app.pdfExportPreferences.cropMarks = ${bool(cropMarks)};
        app.pdfExportPreferences.bleedMarks = ${bool(bleedMarks)};
        app.pdfExportPreferences.registrationMarks = ${bool(registrationMarks)};
        app.pdfExportPreferences.colorBars = ${bool(colorBars)};
        app.pdfExportPreferences.pageInformationMarks = ${bool(pageInformation)};
        app.pdfExportPreferences.useDocumentBleedWithPDF = ${bool(includeBleed)};
        app.pdfExportPreferences.includeSlugWithPDF = ${bool(includeSlug)};

        var f = new File(${jsxPath(validated)});
        if (pdfPreset !== null && pdfPreset.isValid) {
          doc.exportFile(ExportFormat.PDF_TYPE, f, false, pdfPreset);
        } else {
          doc.exportFile(ExportFormat.PDF_TYPE, f, false);
        }

        if (!f.exists) {
          __result__ = "ERROR: the export reported no error but produced no file at " + f.fsName;
        } else {
          var kb = Math.round(f.length / 1024);
          __result__ = "Exported PDF to " + f.fsName +
            " | " + kb + " KB | preset " + ${str(p)} +
            " | " + doc.pages.length + " page(s)" +
            (${bool(includeBleed)} ? " | with bleed" : "") +
            (kb < 5 ? "\\n  WARNING: the file is suspiciously small - check the document has content."
                    : "");
        }
      } catch (e) {
        __result__ = "ERROR exporting PDF: " + e.message;
      }
    }
  `;
}

/**
 * Export pages as PNG or JPEG.
 *
 * The resolution property is exportResolution, and bleed is useDocumentBleeds
 * — the names the previous version used belong to the PDF preferences.
 */
export function exportImages({
  folderPath, format = 'PNG', resolution = 150, jpegQuality = 'HIGH',
  pageRange = 'all', transparentBackground = false, includeBleed = false,
}) {
  const validated = validateFilePath(folderPath);
  const fmt = enumOf(String(format).toUpperCase(), IMAGE_FORMATS, { name: 'format' });
  const isPng = fmt === 'PNG';
  const res = num(resolution, { name: 'resolution', min: 9, max: 2400 });
  const quality = enumOf(String(jpegQuality).toUpperCase(),
    ['LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'], { name: 'jpegQuality' });
  const allPages = pageRange === 'all' || pageRange === undefined;

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var folder = new Folder(${jsxPath(validated)});
        if (!folder.exists) { folder.create(); }

        ${isPng ? `
          app.pngExportPreferences.exportResolution = ${res};
          app.pngExportPreferences.transparentBackground = ${bool(transparentBackground)};
          app.pngExportPreferences.useDocumentBleeds = ${bool(includeBleed)};
          app.pngExportPreferences.antiAlias = true;
          app.pngExportPreferences.pngExportRange = ${allPages
            ? 'PNGExportRangeEnum.EXPORT_ALL'
            : 'PNGExportRangeEnum.EXPORT_RANGE'};
          ${allPages ? '' : `app.pngExportPreferences.pageString = ${str(pageRange)};`}
        ` : `
          app.jpegExportPreferences.exportResolution = ${res};
          app.jpegExportPreferences.jpegQuality = JPEGOptionsQuality.${quality};
          app.jpegExportPreferences.useDocumentBleeds = ${bool(includeBleed)};
          app.jpegExportPreferences.antiAlias = true;
          app.jpegExportPreferences.jpegExportRange = ${allPages
            ? 'ExportRangeOrAllPages.EXPORT_ALL'
            : 'ExportRangeOrAllPages.EXPORT_RANGE'};
          ${allPages ? '' : `app.jpegExportPreferences.pageString = ${str(pageRange)};`}
        `}

        var base = doc.name.replace(/\\.indd$/i, "");
        var target = new File(folder.fsName + "/" + base + ${isPng ? '".png"' : '".jpg"'});
        doc.exportFile(${isPng ? 'ExportFormat.PNG_FORMAT' : 'ExportFormat.JPG'}, target, false);

        // One file per page is written next to the target name; count what
        // actually arrived rather than assuming.
        var written = folder.getFiles(${isPng ? '"*.png"' : '"*.jpg"'});
        if (written.length === 0) {
          __result__ = "ERROR: the export reported no error but wrote no file into " + folder.fsName;
        } else {
          var total = 0;
          for (var i = 0; i < written.length; i++) { total += written[i].length; }
          __result__ = "Exported " + written.length + " ${fmt} file(s) to " + folder.fsName +
            " | " + ${res} + " dpi | " + Math.round(total / 1024) + " KB total" +
            (${bool(includeBleed)} ? " | with bleed" : "") +
            "\\n  " + written[0].name +
            (written.length > 1 ? " and " + (written.length - 1) + " more" : "");
        }
      } catch (e) {
        __result__ = "ERROR exporting images: " + e.message;
      }
    }
  `;
}

/**
 * Export to EPUB.
 *
 * app.epubExportPreferences no longer exists in this version, so there is
 * nothing to configure beforehand — the export uses the application's current
 * settings. ExportFormat still carries EPUB and FIXED_LAYOUT_EPUB.
 */
export function exportEPUB({ filePath, fixedLayout = false }) {
  const validated = validateFilePath(filePath);
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var f = new File(${jsxPath(validated)});
        doc.exportFile(${fixedLayout
          ? 'ExportFormat.FIXED_LAYOUT_EPUB'
          : 'ExportFormat.EPUB'}, f, false);
        if (!f.exists) {
          __result__ = "ERROR: the export reported no error but produced no file at " + f.fsName;
        } else {
          __result__ = "Exported ${fixedLayout ? 'fixed-layout ' : ''}EPUB to " + f.fsName +
            " | " + Math.round(f.length / 1024) + " KB" +
            "\\n  Note: this version has no scriptable EPUB preferences, so the " +
            "export uses InDesign's current settings. Adjust them in the " +
            "application if the result is not what you need.";
        }
      } catch (e) {
        __result__ = "ERROR exporting EPUB: " + e.message;
      }
    }
  `;
}

/**
 * Run a preflight profile and report what it found.
 *
 * The process is asynchronous — without waitForProcess() the results are read
 * before it has finished, which is why this used to report nothing useful.
 */
export function preflightDocument({ profile, maxIssues = 20 }) {
  const limit = num(maxIssues, { name: 'maxIssues', min: 1, max: 200 });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      var proc = null;
      try {
        var chosen = null;
        ${profile === undefined ? '' : `
          for (var i = 0; i < app.preflightProfiles.length; i++) {
            if (app.preflightProfiles[i].name === ${str(profile)}) {
              chosen = app.preflightProfiles[i];
              break;
            }
          }
          if (chosen === null) {
            var have = [];
            for (var h = 0; h < app.preflightProfiles.length; h++) {
              have.push(app.preflightProfiles[h].name);
            }
            throw new Error("no preflight profile named " + ${str(profile)} +
              ". Available: " + have.join(", "));
          }
        `}
        if (chosen === null) {
          if (app.preflightProfiles.length === 0) {
            throw new Error("this installation has no preflight profiles");
          }
          chosen = app.preflightProfiles[0];
        }

        // The processes collection is on app, and takes the document.
        proc = app.preflightProcesses.add(doc, chosen);
        proc.waitForProcess();

        var summary = String(proc.processResults);
        var out = "Preflight with profile '" + chosen.name + "': " + summary;

        var results = proc.aggregatedResults;
        if (results && results.length > 2 && results[2] && results[2].length > 0) {
          var rules = results[2];
          var shown = Math.min(rules.length, ${limit});
          out += "\\n" + rules.length + " rule(s) reported findings:";
          for (var r = 0; r < shown; r++) {
            var rule = rules[r];
            out += "\\n  - " + String(rule[0]);
            if (rule.length > 1 && rule[1] && rule[1].length) {
              out += " (" + rule[1].length + " occurrence(s))";
            }
          }
          if (rules.length > shown) {
            out += "\\n  ... and " + (rules.length - shown) + " more";
          }
        } else if (summary.indexOf("None") !== -1 || summary === "") {
          out += "\\n  No errors found.";
        }
        __result__ = out;
      } catch (e) {
        __result__ = "ERROR running preflight: " + e.message;
      } finally {
        try { if (proc !== null) { proc.remove(); } } catch (e2) {}
      }
    }
  `;
}
