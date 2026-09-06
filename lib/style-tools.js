/**
 * style-tools.js
 * Changing the appearance of objects that already exist.
 *
 * The server could set fill, stroke and corners when creating a rectangle,
 * but never afterwards — so adjusting a shape meant deleting and rebuilding
 * it, losing its position and stacking order. These tools close that.
 *
 * Two names verified against InDesign 21.5, because the obvious ones are
 * wrong: there is no `cornerRadius` on a rectangle (it is per corner,
 * `topLeftCornerRadius` and siblings, each with its own `...CornerOption`),
 * and Justification has no `JUSTIFY` member — the justified values are
 * LEFT_JUSTIFIED, RIGHT_JUSTIFIED, CENTER_JUSTIFIED and FULLY_JUSTIFIED.
 */

import { str, num, index, bool, measure, enumOf, ALLOWED } from './jsx-safe.js';

export const CORNER_OPTIONS = [
  'NONE', 'ROUNDED_CORNER', 'INVERSE_ROUNDED_CORNER',
  'INSET_CORNER', 'BEVEL_CORNER', 'FANCY_CORNER',
];

export const STROKE_ALIGNMENT = [
  'CENTER_ALIGNMENT', 'INSIDE_ALIGNMENT', 'OUTSIDE_ALIGNMENT',
];

export const ANCHOR_POINTS = [
  'TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR',
  'LEFT_CENTER_ANCHOR', 'CENTER_ANCHOR', 'RIGHT_CENTER_ANCHOR',
  'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR',
];

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const ITEM_AT = `
      function __itemAt(page, i) {
        var items = page.allPageItems;
        if (i < 0 || i >= items.length) {
          throw new Error("object index " + i + " out of range (page has " +
            items.length + " items)");
        }
        return items[i];
      }
      function __swatch(doc, name) {
        var s = doc.swatches.itemByName(name);
        if (!s.isValid) {
          var have = [];
          for (var i = 0; i < doc.swatches.length && i < 12; i++) {
            have.push(doc.swatches[i].name);
          }
          throw new Error("no swatch named '" + name + "'. Available: " + have.join(", ") +
            (doc.swatches.length > 12 ? ", ..." : "") +
            ". Use list_color_swatches, or create_color_swatch first.");
        }
        return s;
      }
      function __appearance(item) {
        var parts = [];
        try { parts.push("fill " + item.fillColor.name); } catch (e) {}
        try {
          parts.push("stroke " + item.strokeColor.name +
            (item.strokeWeight > 0 ? " " + item.strokeWeight + "pt" : ""));
        } catch (e2) {}
        try {
          parts.push("opacity " + item.transparencySettings.blendingSettings.opacity + "%");
        } catch (e3) {}
        try {
          if (item.topLeftCornerRadius > 0) {
            parts.push("corner " + item.topLeftCornerRadius + "mm");
          }
        } catch (e4) {}
        return parts.join(" | ");
      }
`;

/**
 * Fill, stroke, opacity and corners on an existing object.
 *
 * Colours are swatch names. An unknown name lists what the document has
 * rather than failing silently, because a mistyped swatch otherwise leaves
 * the object unchanged with no indication why.
 */
export function formatObject({
  pageIndex = 0, objectIndex,
  fillColor, fillTint, strokeColor, strokeWeight, strokeAlignment,
  opacity, cornerRadius, cornerStyle,
}) {
  const parts = [];

  if (fillColor !== undefined) {
    parts.push(fillColor === 'None'
      ? 'item.fillColor = doc.swatches.itemByName("None");'
      : `item.fillColor = __swatch(doc, ${str(fillColor)});`);
  }
  if (fillTint !== undefined) {
    parts.push(`item.fillTint = ${num(fillTint, { name: 'fillTint', min: 0, max: 100 })};`);
  }
  if (strokeColor !== undefined) {
    parts.push(strokeColor === 'None'
      ? 'item.strokeColor = doc.swatches.itemByName("None");'
      : `item.strokeColor = __swatch(doc, ${str(strokeColor)});`);
  }
  if (strokeWeight !== undefined) {
    parts.push(`item.strokeWeight = ${num(strokeWeight, { name: 'strokeWeight', min: 0, max: 200 })};`);
  }
  if (strokeAlignment !== undefined) {
    const a = enumOf(strokeAlignment, STROKE_ALIGNMENT, { name: 'strokeAlignment' });
    parts.push(`item.strokeAlignment = StrokeAlignment.${a};`);
  }
  if (opacity !== undefined) {
    parts.push(
      'item.transparencySettings.blendingSettings.opacity = ' +
      `${num(opacity, { name: 'opacity', min: 0, max: 100 })};`
    );
  }
  if (cornerRadius !== undefined || cornerStyle !== undefined) {
    // There is no cornerRadius on a rectangle — each corner carries its own
    // radius and option. Setting all four is what a caller means by "rounded".
    const style = enumOf(cornerStyle === undefined ? 'ROUNDED_CORNER' : cornerStyle,
      CORNER_OPTIONS, { name: 'cornerStyle' });
    for (const c of CORNERS) {
      parts.push(`item.${c}CornerOption = CornerOptions.${style};`);
      if (cornerRadius !== undefined) {
        parts.push(`item.${c}CornerRadius = ${measure(cornerRadius, { name: 'cornerRadius' })};`);
      }
    }
  }

  if (parts.length === 0) {
    throw new Error(
      'format_object needs at least one of fillColor, fillTint, strokeColor, ' +
      'strokeWeight, strokeAlignment, opacity, cornerRadius or cornerStyle'
    );
  }

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.locked) { throw new Error("object is locked"); }
        var before = __appearance(item);
        ${parts.join('\n        ')}
        __result__ = "Formatted [" + ${index(objectIndex, { name: 'objectIndex' })} + "] " +
          item.constructor.name +
          "\\n  before " + before +
          "\\n  after  " + __appearance(item);
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Drop shadow on an existing object. ShadowMode has only NONE and DROP. */
export function applyShadow({
  pageIndex = 0, objectIndex, enabled = true,
  opacity = 75, xOffset = 2, yOffset = 2, blur = 3,
}) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        var s = item.transparencySettings.dropShadowSettings;
        ${bool(enabled) ? `
          s.mode = ShadowMode.DROP;
          s.opacity = ${num(opacity, { name: 'opacity', min: 0, max: 100 })};
          s.xOffset = ${measure(xOffset, { name: 'xOffset' })};
          s.yOffset = ${measure(yOffset, { name: 'yOffset' })};
          s.size = ${measure(blur, { name: 'blur' })};
          __result__ = "Drop shadow on [" + ${index(objectIndex, { name: 'objectIndex' })} + "] " +
            item.constructor.name + " | opacity " + s.opacity + "% | offset " +
            ${num(xOffset, { name: 'xOffset' })} + "/" + ${num(yOffset, { name: 'yOffset' })} +
            " mm | blur " + ${num(blur, { name: 'blur' })} + " mm";
        ` : `
          s.mode = ShadowMode.NONE;
          __result__ = "Drop shadow removed from [" +
            ${index(objectIndex, { name: 'objectIndex' })} + "] " + item.constructor.name;
        `}
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Scale or reposition the artwork inside a frame, leaving the frame itself
 * alone.
 *
 * This is the other half of resizing: resize_object changes the frame,
 * fit_frame refits the artwork to it, and this one moves or scales the
 * artwork independently — which is how you crop by hand.
 */
export function transformContent({
  pageIndex = 0, objectIndex, scale, scaleX, scaleY, offsetX, offsetY, rotation,
}) {
  const parts = [];
  const sx = scaleX !== undefined ? scaleX : scale;
  const sy = scaleY !== undefined ? scaleY : scale;
  if (sx !== undefined) {
    parts.push(`g.horizontalScale = ${num(sx, { name: 'scaleX', min: 1, max: 1000 })};`);
  }
  if (sy !== undefined) {
    parts.push(`g.verticalScale = ${num(sy, { name: 'scaleY', min: 1, max: 1000 })};`);
  }
  if (rotation !== undefined) {
    parts.push(`g.rotationAngle = ${num(rotation, { name: 'rotation', min: -360, max: 360 })};`);
  }
  if (offsetX !== undefined || offsetY !== undefined) {
    parts.push(
      'var gb = g.geometricBounds;\n        ' +
      'g.move([gb[1] + ' + num(offsetX === undefined ? 0 : offsetX, { name: 'offsetX' }) +
      ', gb[0] + ' + num(offsetY === undefined ? 0 : offsetY, { name: 'offsetY' }) + ']);'
    );
  }
  if (parts.length === 0) {
    throw new Error(
      'transform_content needs at least one of scale, scaleX, scaleY, ' +
      'offsetX, offsetY or rotation'
    );
  }

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
        if (item.allGraphics.length === 0) {
          throw new Error("object [" + ${index(objectIndex, { name: 'objectIndex' })} +
            "] holds no artwork. transform_content works on the graphic inside a " +
            "frame; use transform_object to change the frame itself.");
        }
        var g = item.allGraphics[0];
        var fb = item.geometricBounds;
        var before = g.geometricBounds;
        ${parts.join('\n        ')}
        var after = g.geometricBounds;
        var cropped = (after[0] < fb[0] - 0.01) || (after[1] < fb[1] - 0.01) ||
                      (after[2] > fb[2] + 0.01) || (after[3] > fb[3] + 0.01);
        __result__ = "Transformed the artwork inside [" +
          ${index(objectIndex, { name: 'objectIndex' })} + "]" +
          "\\n  artwork before " + before[1].toFixed(1) + "," + before[0].toFixed(1) +
          " to " + before[3].toFixed(1) + "," + before[2].toFixed(1) + " mm" +
          "\\n  artwork after  " + after[1].toFixed(1) + "," + after[0].toFixed(1) +
          " to " + after[3].toFixed(1) + "," + after[2].toFixed(1) + " mm" +
          "\\n  frame          " + fb[1].toFixed(1) + "," + fb[0].toFixed(1) +
          " to " + fb[3].toFixed(1) + "," + fb[2].toFixed(1) + " mm" +
          (cropped ? "\\n  artwork extends beyond the frame and is cropped"
                   : "\\n  artwork sits inside the frame");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Character formatting on text that is already placed, without a style.
 *
 * Scope is the whole story by default. Justification has no JUSTIFY member —
 * the justified values end in _JUSTIFIED, which is what ALLOWED.alignment
 * carries.
 */
export function formatText({
  pageIndex = 0, frameIndex, fontSize, fontFamily, fontStyle,
  textColor, alignment, leading, tracking, allCaps, italic,
}) {
  const parts = [];
  if (fontSize !== undefined) {
    parts.push(`chars.pointSize = ${num(fontSize, { name: 'fontSize', min: 0.1, max: 1000 })};`);
  }
  if (fontFamily !== undefined) {
    const full = fontStyle === undefined
      ? str(fontFamily)
      : str(`${fontFamily}\t${fontStyle}`);
    parts.push(`try { chars.appliedFont = app.fonts.itemByName(${full}); }
        catch (fe) { notes.push("font not found: " + ${full}); }`);
  }
  if (textColor !== undefined) {
    parts.push(`chars.fillColor = __swatch(doc, ${str(textColor)});`);
  }
  if (leading !== undefined) {
    parts.push(`chars.leading = ${num(leading, { name: 'leading', min: 0, max: 1000 })};`);
  }
  if (tracking !== undefined) {
    parts.push(`chars.tracking = ${num(tracking, { name: 'tracking', min: -1000, max: 1000 })};`);
  }
  if (allCaps !== undefined) {
    parts.push(`chars.capitalization = ${bool(allCaps)} ? Capitalization.ALL_CAPS : Capitalization.NORMAL;`);
  }
  if (italic !== undefined && fontFamily === undefined) {
    parts.push(`try { chars.fontStyle = ${bool(italic)} ? "Italic" : "Regular"; }
        catch (ie) { notes.push("this font has no " + (${bool(italic)} ? "Italic" : "Regular") + " style"); }`);
  }
  if (alignment !== undefined) {
    const a = enumOf(alignment, ALLOWED.alignment, { name: 'alignment' });
    parts.push(`paras.justification = Justification.${a};`);
  }
  if (parts.length === 0) {
    throw new Error(
      'format_text needs at least one of fontSize, fontFamily, fontStyle, ' +
      'textColor, alignment, leading, tracking, allCaps or italic'
    );
  }

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var fi = ${index(frameIndex, { name: 'frameIndex' })};
        if (fi >= page.textFrames.length) {
          throw new Error("text frame index " + fi + " out of range (page has " +
            page.textFrames.length + " text frames)");
        }
        var frame = page.textFrames[fi];
        var story = frame.parentStory;
        var chars = story.characters.everyItem();
        var paras = story.paragraphs.everyItem();
        var notes = [];
        ${parts.join('\n        ')}
        __result__ = "Formatted " + story.length + " characters in frame " + fi +
          (frame.overflows ? "\\n  WARNING: the text now overflows this frame" : "") +
          (notes.length > 0 ? "\\n  " + notes.join("\\n  ") : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}
