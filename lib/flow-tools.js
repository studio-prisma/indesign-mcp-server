/**
 * flow-tools.js
 * Text flow, text frame setup, master pages, links and undo.
 *
 * These cover what a multi-page document needs and the server could not do:
 * text running from one frame into the next, frames with columns and insets,
 * master pages, automatic page numbers, and taking a step back when something
 * went wrong.
 */

import { str, num, index, bool, measure, enumOf } from './jsx-safe.js';

export const VERTICAL_JUSTIFICATION = [
  'TOP_ALIGN', 'CENTER_ALIGN', 'BOTTOM_ALIGN', 'JUSTIFY_ALIGN',
];

export const TEXT_WRAP_MODES = [
  'NONE', 'BOUNDING_BOX_TEXT_WRAP', 'CONTOUR',
  'JUMP_OBJECT_TEXT_WRAP', 'NEXT_COLUMN_TEXT_WRAP',
];

const FRAME_AT = `
      function __frameAt(page, i) {
        var frames = page.textFrames;
        if (i < 0 || i >= frames.length) {
          throw new Error("text frame index " + i + " out of range (page has " +
            frames.length + " text frames)");
        }
        return frames[i];
      }
      function __frameInfo(f) {
        var b = f.geometricBounds;
        return f.parentStory.length + " chars" +
          (f.overflows ? ", OVERSET" : ", fits") +
          " | x " + b[1].toFixed(1) + " to " + b[3].toFixed(1) +
          " | y " + b[0].toFixed(1) + " to " + b[2].toFixed(1) + " mm";
      }
`;

/**
 * Thread text frames so text runs from one into the next.
 *
 * Two ways to say which frames. Either list them explicitly as
 * {pageIndex, frameIndex} pairs in flow order, or pass readingOrder with a
 * pageIndex and let the frames be sorted by position.
 *
 * The second exists because the index order is a trap: page.textFrames is
 * ordered front to back, so the *last* frame created is index 0. Frames laid
 * out top to bottom therefore come back in reverse, and threading them by
 * ascending index runs the story backwards up the page. Verified against
 * InDesign 21.5.
 */
export function threadTextFrames({ frames, pageIndex = 0, readingOrder = false }) {
  if (readingOrder) {
    return threadInReadingOrder(pageIndex);
  }
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error(
      "'frames' must list at least two frames to thread, " +
      "or pass readingOrder: true to thread every frame on the page by position"
    );
  }
  const refs = frames.map((f, n) => {
    const p = index(f.pageIndex === undefined ? 0 : f.pageIndex, { name: `frames[${n}].pageIndex` });
    const i = index(f.frameIndex, { name: `frames[${n}].frameIndex` });
    return `{ p: ${p}, i: ${i} }`;
  }).join(', ');

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${FRAME_AT}
      try {
        var refs = [${refs}];
        var chain = [];
        for (var k = 0; k < refs.length; k++) {
          if (refs[k].p >= doc.pages.length) {
            throw new Error("page index " + refs[k].p + " out of range");
          }
          chain.push(__frameAt(doc.pages[refs[k].p], refs[k].i));
        }

        // Threading moves the later frames' content into the first story, so
        // anything already in them would be lost. Refuse instead.
        for (var m = 1; m < chain.length; m++) {
          if (chain[m].parentStory.length > 0 &&
              chain[m].parentStory !== chain[0].parentStory) {
            throw new Error("frame " + m + " in the chain already holds text; " +
              "threading would discard it. Empty it first, or thread in the other order.");
          }
        }

        for (var n = 0; n < chain.length - 1; n++) {
          chain[n].nextTextFrame = chain[n + 1];
        }

        var last = chain[chain.length - 1];
        __result__ = "Threaded " + chain.length + " frames into one story\\n  " +
          __frameInfo(chain[0]) +
          (last.overflows
            ? "\\n  The last frame still overflows - the story needs more room."
            : "\\n  The story fits in the chain.");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Thread every text frame on a page in reading order: top to bottom, and
 * left to right where frames sit side by side.
 *
 * Frames are considered to be on the same line when their tops are within
 * 5 mm of each other, which handles a row of columns whose tops are set
 * fractionally apart.
 */
function threadInReadingOrder(pageIndex) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${FRAME_AT}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var frames = [];
        for (var i = 0; i < page.textFrames.length; i++) { frames.push(page.textFrames[i]); }
        if (frames.length < 2) {
          throw new Error("the page has " + frames.length +
            " text frame(s); threading needs at least two");
        }

        frames.sort(function (a, b) {
          var ab = a.geometricBounds, bb = b.geometricBounds;
          if (Math.abs(ab[0] - bb[0]) > 5) { return ab[0] - bb[0]; }  // top
          return ab[1] - bb[1];                                        // then left
        });

        var carrying = [];
        for (var m = 1; m < frames.length; m++) {
          if (frames[m].parentStory.length > 0 &&
              frames[m].parentStory !== frames[0].parentStory) {
            carrying.push(m);
          }
        }
        if (carrying.length > 0) {
          throw new Error("frame(s) " + carrying.join(", ") +
            " in reading order already hold text; threading would discard it. " +
            "Empty them, or put the text in the first frame only.");
        }

        for (var n = 0; n < frames.length - 1; n++) {
          frames[n].nextTextFrame = frames[n + 1];
        }

        var order = [];
        for (var k = 0; k < frames.length; k++) {
          var gb = frames[k].geometricBounds;
          order.push("(" + gb[1].toFixed(0) + "," + gb[0].toFixed(0) + ")");
        }
        var last = frames[frames.length - 1];
        __result__ = "Threaded " + frames.length + " frames in reading order: " +
          order.join(" -> ") +
          "\\n  " + __frameInfo(frames[0]) +
          (last.overflows
            ? "\\n  The last frame still overflows - the story needs more room."
            : "\\n  The story fits in the chain.");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Columns, inset and vertical alignment inside a text frame. */
export function setTextFrameOptions({
  pageIndex = 0, frameIndex, columns, columnGutter, inset, verticalJustification, autoSize,
}) {
  const parts = [];
  if (columns !== undefined) {
    parts.push(`p.textColumnCount = ${num(columns, { name: 'columns', min: 1, max: 40 })};`);
  }
  if (columnGutter !== undefined) {
    parts.push(`p.textColumnGutter = ${measure(columnGutter, { name: 'columnGutter' })};`);
  }
  if (inset !== undefined) {
    const v = measure(inset, { name: 'inset' });
    parts.push(`p.insetSpacing = [${v}, ${v}, ${v}, ${v}];`);
  }
  if (verticalJustification !== undefined) {
    const vj = enumOf(verticalJustification, VERTICAL_JUSTIFICATION, { name: 'verticalJustification' });
    parts.push(`p.verticalJustification = VerticalJustification.${vj};`);
  }
  if (autoSize !== undefined) {
    parts.push(
      `p.autoSizingType = ${bool(autoSize)}` +
      ' ? AutoSizingTypeEnum.HEIGHT_ONLY : AutoSizingTypeEnum.OFF;'
    );
  }
  if (parts.length === 0) {
    throw new Error(
      'set_text_frame_options needs at least one of columns, columnGutter, inset, ' +
      'verticalJustification or autoSize'
    );
  }
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${FRAME_AT}
      try {
        var f = __frameAt(doc.pages[${index(pageIndex, { name: 'pageIndex' })}],
                          ${index(frameIndex, { name: 'frameIndex' })});
        var p = f.textFramePreferences;
        var before = __frameInfo(f);
        ${parts.join('\n        ')}
        __result__ = "Text frame options applied\\n  before " + before +
          "\\n  after  " + __frameInfo(f) +
          "\\n  columns " + p.textColumnCount;
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Text wrap on any page item, so text keeps clear of it. */
export function setTextWrap({ pageIndex = 0, objectIndex, mode, offset = 0 }) {
  const m = enumOf(mode, TEXT_WRAP_MODES, { name: 'mode' });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var all = page.allPageItems;
        var i = ${index(objectIndex, { name: 'objectIndex' })};
        if (i < 0 || i >= all.length) { throw new Error("object index " + i + " out of range"); }
        var item = all[i];
        var w = item.textWrapPreferences;
        w.textWrapMode = TextWrapModes.${m};
        ${m === 'NONE' ? '' : `
          var o = ${num(offset, { name: 'offset', min: 0 })};
          w.textWrapOffset = [o, o, o, o];
        `}
        __result__ = "Text wrap set to ${m}" +
          ${m === 'NONE' ? '""' : `" with ${num(offset, { name: 'offset', min: 0 })} mm offset"`} +
          " on [" + i + "] " + item.constructor.name;
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Master pages available in the document. */
export function listMasterPages() {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      var out = doc.masterSpreads.length + " master spread(s):\\n";
      for (var i = 0; i < doc.masterSpreads.length; i++) {
        var m = doc.masterSpreads[i];
        out += "  " + m.namePrefix + "-" + m.baseName +
          " | " + m.pages.length + " page(s)" +
          " | " + m.pageItems.length + " item(s)\\n";
      }
      out += "\\nApplied to document pages:\\n";
      for (var p = 0; p < doc.pages.length; p++) {
        var am = doc.pages[p].appliedMaster;
        out += "  page " + (p + 1) + " -> " +
          (am === null || am === undefined ? "(none)" : am.name) + "\\n";
      }
      __result__ = out;
    }
  `;
}

/** Apply a master spread to a page, or detach it. */
export function applyMasterPage({ pageIndex = 0, masterName }) {
  const detach = masterName === null || masterName === 'none' || masterName === '';
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        ${detach ? `
          page.appliedMaster = NothingEnum.NOTHING;
          __result__ = "Detached the master from page " +
            (${index(pageIndex, { name: 'pageIndex' })} + 1);
        ` : `
          var wanted = ${str(masterName)};
          var found = null;
          for (var i = 0; i < doc.masterSpreads.length; i++) {
            var m = doc.masterSpreads[i];
            if (m.name === wanted || (m.namePrefix + "-" + m.baseName) === wanted ||
                m.baseName === wanted || m.namePrefix === wanted) {
              found = m; break;
            }
          }
          if (found === null) {
            var have = [];
            for (var j = 0; j < doc.masterSpreads.length; j++) { have.push(doc.masterSpreads[j].name); }
            throw new Error("no master spread named '" + wanted + "'. Available: " + have.join(", "));
          }
          page.appliedMaster = found;
          __result__ = "Applied master '" + found.name + "' to page " +
            (${index(pageIndex, { name: 'pageIndex' })} + 1) +
            "\\nMaster items are not editable on the page until overridden.";
        `}
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * An automatic page number marker in a text frame.
 *
 * On a master page this renders as the master's prefix and updates per page;
 * on a document page it shows that page's number.
 */
export function insertPageNumber({ pageIndex = 0, frameIndex, onMaster = false, masterName, prefix = '' }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${FRAME_AT}
      try {
        var container;
        ${onMaster ? `
          var wanted = ${str(masterName === undefined ? '' : masterName)};
          var m = null;
          for (var i = 0; i < doc.masterSpreads.length; i++) {
            var cand = doc.masterSpreads[i];
            if (wanted === "" || cand.name === wanted ||
                (cand.namePrefix + "-" + cand.baseName) === wanted) { m = cand; break; }
          }
          if (m === null) { throw new Error("master spread not found: " + wanted); }
          container = m.pages[0];
        ` : `
          container = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        `}
        var frames = container.textFrames;
        var fi = ${index(frameIndex, { name: 'frameIndex' })};
        if (fi < 0 || fi >= frames.length) {
          throw new Error("text frame index " + fi + " out of range (" +
            frames.length + " frames here)");
        }
        var f = frames[fi];
        f.insertionPoints[-1].contents = ${str(prefix)};
        f.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        __result__ = "Inserted an automatic page number" +
          ${onMaster ? '" on the master page"' : '" on page " + (' + index(pageIndex, { name: 'pageIndex' }) + ' + 1)'} +
          ". On a master it shows the prefix and resolves per page.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Placed files and their state — missing or modified links break an export. */
export function listLinks() {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      if (doc.links.length === 0) {
        __result__ = "No linked files (artwork may be embedded).";
      } else {
        var out = doc.links.length + " link(s):\\n";
        var bad = 0;
        for (var i = 0; i < doc.links.length; i++) {
          var l = doc.links[i];
          var st = String(l.status).replace("LinkStatus.", "");
          if (st !== "NORMAL") { bad++; }
          out += "  [" + i + "] " + l.name + " | " + st +
            " | page " + (l.parent.parentPage === null ? "?" : l.parent.parentPage.name) +
            "\\n      " + l.filePath + "\\n";
        }
        out += bad === 0
          ? "\\nAll links are up to date."
          : "\\n" + bad + " link(s) need attention - export would embed the low-resolution preview.";
        __result__ = out;
      }
    }
  `;
}

/** Re-establish or refresh links. */
export function updateLinks({ onlyOutOfDate = true }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var updated = 0, missing = [];
        for (var i = 0; i < doc.links.length; i++) {
          var l = doc.links[i];
          var st = String(l.status);
          if (st.indexOf("LINK_OUT_OF_DATE") !== -1) {
            l.update(); updated++;
          } else if (st.indexOf("LINK_MISSING") !== -1) {
            missing.push(l.name);
          } else if (!${bool(onlyOutOfDate)}) {
            l.update(); updated++;
          }
        }
        __result__ = "Updated " + updated + " link(s)." +
          (missing.length > 0
            ? "\\n" + missing.length + " still missing and cannot be updated automatically: " +
              missing.join(", ") + "\\nRelink them in InDesign or place the files where the document expects them."
            : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Step back through the document's history.
 *
 * Worth knowing: this undoes whatever is on the document's stack, including
 * steps a person took in the interface. It is a recovery tool for a wrong
 * call, not a transaction rollback.
 */
export function undoSteps({ steps = 1 }) {
  const n = num(steps, { name: 'steps', min: 1, max: 50 });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var done = 0;
        for (var i = 0; i < ${n}; i++) {
          if (doc.undoName === "" || doc.undoName === null) { break; }
          doc.undo(); done++;
        }
        __result__ = "Undid " + done + " step(s)." +
          (done < ${n} ? " The history had no more steps." : "") +
          "\\nNote: this steps back through the document's whole history, " +
          "including anything done in the interface.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}
