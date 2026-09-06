/**
 * layout-tools.js
 * Script builders for inspecting and manipulating page items.
 *
 * These exist because the server could report what it did, but not what the
 * document actually looks like afterwards. A caller placing an image was told
 * "placed" whether or not anything arrived; a caller adding a text frame was
 * not told the text overflows; nothing reported that two frames overlap or
 * that a frame sits outside the page. Working blind is what produces layouts
 * that look plausible in the transcript and wrong on the page.
 *
 * Every builder returns ExtendScript source. Argument escaping happens here,
 * through the helpers in jsx-safe.js — no value is interpolated raw.
 */

import { str, num, index, bool, measure, enumOf, ALLOWED } from './jsx-safe.js';

/** Shared ExtendScript preamble: resolve a page item by index. */
const RESOLVE_ITEM = `
      function __itemAt(page, i) {
        var items = page.allPageItems;
        if (i < 0 || i >= items.length) {
          throw new Error("object index " + i + " out of range (page has " + items.length + " items)");
        }
        return items[i];
      }
      function __describe(item, i) {
        var b = item.geometricBounds;
        var kind = item.constructor.name;
        var detail = "";
        if (kind === "TextFrame") {
          // parentStory.length, not contents.length — the latter does not
          // return a character count (it reports 4 for a 65-character story).
          detail = " | " + item.parentStory.length + " chars" +
            (item.overflows ? " | OVERSET" : "");
        } else if (item.allGraphics && item.allGraphics.length > 0) {
          detail = " | contains artwork";
        } else if (kind === "Rectangle" || kind === "Oval" || kind === "Polygon") {
          detail = item.allGraphics.length === 0 ? " | EMPTY frame" : "";
        }
        return "[" + i + "] " + kind +
          " | x " + b[1].toFixed(1) + " to " + b[3].toFixed(1) +
          " | y " + b[0].toFixed(1) + " to " + b[2].toFixed(1) + " mm" +
          " | layer " + item.itemLayer.name +
          (item.locked ? " | LOCKED" : "") +
          (item.visible ? "" : " | HIDDEN") +
          detail;
      }
`;

/**
 * Everything on a page, in stacking order.
 *
 * allPageItems is ordered front to back: index 0 is the frontmost object,
 * the last index is the backmost. Verified against InDesign 21.5 — three
 * rectangles created in sequence come back as [0] third, [1] second,
 * [2] first. The index doubles as the z position arrange_object reports.
 */
export function inspectPage({ pageIndex = 0 }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      var items = page.allPageItems;
      var out = "Page " + (${index(pageIndex, { name: 'pageIndex' })} + 1) + " of " + doc.pages.length +
        " | " + page.bounds[3].toFixed(1) + " x " + page.bounds[2].toFixed(1) + " mm" +
        " | " + items.length + " objects, front to back (index 0 is frontmost)\\n";
      for (var i = 0; i < items.length; i++) {
        out += __describe(items[i], i) + "\\n";
      }
      if (items.length === 0) { out += "(page is empty)\\n"; }
      __result__ = out;
    }
  `;
}

/**
 * Layout problems that are invisible to a caller working through the API.
 *
 * Overlaps are reported only for pairs that actually intersect, with the
 * overlapping area, so a deliberate background panel is distinguishable from
 * a frame that landed on top of something by accident.
 */
export function checkLayout({ pageIndex = 0, ignoreOverlapBelowMm = 1 }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      var items = page.allPageItems;
      var pb = page.bounds;
      var minOverlap = ${num(ignoreOverlapBelowMm, { name: 'ignoreOverlapBelowMm', min: 0 })};
      var problems = [];

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var b = it.geometricBounds;

        if (it.constructor.name === "TextFrame" && it.overflows) {
          problems.push("OVERSET TEXT  " + __describe(it, i) +
            "  -> the frame is too small for its content; enlarge it, reduce the point size, or thread it");
        }

        var isFrame = (it.constructor.name === "Rectangle" ||
                       it.constructor.name === "Oval" ||
                       it.constructor.name === "Polygon");
        if (isFrame && it.allGraphics.length === 0 &&
            it.fillColor.name === "None") {
          problems.push("EMPTY FRAME   " + __describe(it, i) +
            "  -> no artwork and no fill; an import may have failed silently. " +
            "A frame kept deliberately as a rule or outline will show up here too.");
        }

        if (b[0] < pb[0] - 0.01 || b[1] < pb[1] - 0.01 ||
            b[2] > pb[2] + 0.01 || b[3] > pb[3] + 0.01) {
          problems.push("OFF PAGE      " + __describe(it, i) +
            "  -> extends beyond the page edge");
        }

        for (var j = i + 1; j < items.length; j++) {
          var o = items[j].geometricBounds;
          var oy = Math.min(b[2], o[2]) - Math.max(b[0], o[0]);
          var ox = Math.min(b[3], o[3]) - Math.max(b[1], o[1]);
          if (oy > minOverlap && ox > minOverlap) {
            problems.push("OVERLAP       [" + i + "] " + items[i].constructor.name +
              " and [" + j + "] " + items[j].constructor.name +
              " share " + ox.toFixed(1) + " x " + oy.toFixed(1) + " mm" +
              "  -> [" + j + "] is in front; if that is wrong use arrange_object");
          }
        }
      }

      if (problems.length === 0) {
        __result__ = "No layout problems found on page " + (${index(pageIndex, { name: 'pageIndex' })} + 1) +
          " (" + items.length + " objects checked for overset text, empty frames, " +
          "objects off the page, and overlaps).";
      } else {
        __result__ = "Page " + (${index(pageIndex, { name: 'pageIndex' })} + 1) + ": " + problems.length +
          " finding(s)\\n" + problems.join("\\n");
      }
    }
  `;
}

/** Move an object, either to an absolute position or by an offset. */
export function moveObject({ pageIndex = 0, objectIndex, x, y, dx, dy }) {
  const absolute = x !== undefined || y !== undefined;
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      try {
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.locked) { throw new Error("object is locked"); }
        var b = item.geometricBounds;
        var h = b[2] - b[0], w = b[3] - b[1];
        var before = __describe(item, ${index(objectIndex, { name: 'objectIndex' })});
        ${absolute ? `
          var ny = ${y === undefined ? 'b[0]' : num(y, { name: 'y' })};
          var nx = ${x === undefined ? 'b[1]' : num(x, { name: 'x' })};
        ` : `
          var ny = b[0] + ${num(dy === undefined ? 0 : dy, { name: 'dy' })};
          var nx = b[1] + ${num(dx === undefined ? 0 : dx, { name: 'dx' })};
        `}
        item.geometricBounds = [ny, nx, ny + h, nx + w];
        __result__ = "Moved\\n  from " + before + "\\n  to   " +
          __describe(item, ${index(objectIndex, { name: 'objectIndex' })});
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Resize an object. Optionally refit its content afterwards. */
export function resizeObject({ pageIndex = 0, objectIndex, width, height, refit = true }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      try {
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.locked) { throw new Error("object is locked"); }
        var b = item.geometricBounds;
        var before = __describe(item, ${index(objectIndex, { name: 'objectIndex' })});
        var nh = ${height === undefined ? '(b[2] - b[0])' : num(height, { name: 'height', min: 0 })};
        var nw = ${width === undefined ? '(b[3] - b[1])' : num(width, { name: 'width', min: 0 })};
        item.geometricBounds = [b[0], b[1], b[0] + nh, b[1] + nw];
        ${bool(refit)} && item.allGraphics.length > 0
          ? item.fit(FitOptions.PROPORTIONALLY) : null;
        __result__ = "Resized\\n  from " + before + "\\n  to   " +
          __describe(item, ${index(objectIndex, { name: 'objectIndex' })}) +
          (item.constructor.name === "TextFrame" && item.overflows
            ? "\\n  WARNING: the text now overflows this frame" : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Delete an object. Requires confirmDestructive, like the other removals. */
export function deleteObject({ pageIndex = 0, objectIndex }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      try {
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.locked) { throw new Error("object is locked"); }
        var what = __describe(item, ${index(objectIndex, { name: 'objectIndex' })});
        item.remove();
        __result__ = "Deleted " + what +
          "\\nNote: indices of the remaining objects have shifted; re-run inspect_page before addressing another one.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Change stacking order. */
export function arrangeObject({ pageIndex = 0, objectIndex, position }) {
  const POSITIONS = ['BRING_TO_FRONT', 'BRING_FORWARD', 'SEND_BACKWARD', 'SEND_TO_BACK'];
  const p = enumOf(position, POSITIONS, { name: 'position' });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      try {
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        var what = item.constructor.name;
        switch (${str(p)}) {
          case "BRING_TO_FRONT": item.bringToFront(); break;
          case "BRING_FORWARD":  item.bringForward(); break;
          case "SEND_BACKWARD":  item.sendBackward(); break;
          case "SEND_TO_BACK":   item.sendToBack(); break;
        }
        var items = page.allPageItems;
        var pos = -1;
        for (var i = 0; i < items.length; i++) {
          if (items[i] === item) { pos = i; break; }
        }
        __result__ = what + " moved " + ${str(p)} + "; it is now at index " + pos +
          " of " + items.length + " (0 = frontmost)." +
          "\\nIndices of the other objects have shifted; re-run inspect_page before addressing another one.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Fit content to frame or frame to content on an existing object. */
export function fitFrame({ pageIndex = 0, objectIndex, fitOption = 'PROPORTIONALLY' }) {
  const opt = enumOf(fitOption, ALLOWED.fitOption, { name: 'fitOption' });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${RESOLVE_ITEM}
      var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
      try {
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.allGraphics.length === 0) {
          throw new Error("object holds no artwork, nothing to fit");
        }
        var before = __describe(item, ${index(objectIndex, { name: 'objectIndex' })});
        item.fit(FitOptions.${opt});
        var fb = item.geometricBounds;
        var gb = item.allGraphics[0].geometricBounds;
        var cropped = (gb[0] < fb[0] - 0.01) || (gb[1] < fb[1] - 0.01) ||
                      (gb[2] > fb[2] + 0.01) || (gb[3] > fb[3] + 0.01);
        __result__ = "Applied ${opt}\\n  before " + before + "\\n  after  " +
          __describe(item, ${index(objectIndex, { name: 'objectIndex' })}) +
          (cropped
            ? "\\n  artwork still extends beyond the frame (cropped). Use PROPORTIONALLY to fit it inside, or FRAME_TO_CONTENT to grow the frame."
            : "\\n  artwork sits inside the frame");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}
