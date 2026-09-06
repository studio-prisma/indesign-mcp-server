/**
 * effect-tools.js
 * Effects, gradients, table formatting and paragraph settings.
 *
 * These fill the gaps the Effects, Colour and Type-and-Tables panels leave:
 * the server could set a drop shadow but none of the other six effects, could
 * make a swatch but not a gradient, could create a table but not format one,
 * and could set character attributes but no paragraph ones.
 *
 * Property names read out of InDesign 21.5, not from documentation:
 *   glow      applied, blendMode, opacity, noise, effectColor, technique, spread, size
 *   feather   mode (FeatherMode.NONE|STANDARD), width, cornerType, noise, chokeAmount
 *   blending  blendMode, opacity, knockoutGroup, isolateBlending
 *   gradient  type (GradientType.LINEAR|RADIAL), gradientStops[].stopColor/.location
 *   cell      fillColor, fillTint, ...EdgeStrokeWeight/Color, verticalJustification, insets
 *
 * Note that CellVerticalJustification does not exist — cells use
 * VerticalJustification, the same enum as text frames.
 */

import { str, num, index, bool, measure, enumOf } from './jsx-safe.js';

export const EFFECT_TYPES = [
  'DROP_SHADOW', 'INNER_SHADOW', 'OUTER_GLOW', 'INNER_GLOW',
  'BEVEL_EMBOSS', 'SATIN', 'BASIC_FEATHER', 'DIRECTIONAL_FEATHER',
  'GRADIENT_FEATHER',
];

export const BLEND_MODES = [
  'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'SOFT_LIGHT', 'HARD_LIGHT',
  'COLOR_DODGE', 'COLOR_BURN', 'DARKEN', 'LIGHTEN', 'DIFFERENCE',
  'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY',
];

export const GRADIENT_TYPES = ['LINEAR', 'RADIAL'];

export const CELL_VERTICAL = ['TOP_ALIGN', 'CENTER_ALIGN', 'BOTTOM_ALIGN', 'JUSTIFY_ALIGN'];

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
          throw new Error("no swatch named '" + name + "'. Use list_color_swatches.");
        }
        return s;
      }
`;

/** Which settings object and which switch each effect uses. */
const EFFECT_MAP = {
  DROP_SHADOW: { obj: 'dropShadowSettings', mode: 'ShadowMode.DROP', off: 'ShadowMode.NONE' },
  INNER_SHADOW: { obj: 'innerShadowSettings', applied: true },
  OUTER_GLOW: { obj: 'outerGlowSettings', applied: true },
  INNER_GLOW: { obj: 'innerGlowSettings', applied: true },
  BEVEL_EMBOSS: { obj: 'bevelAndEmbossSettings', applied: true },
  SATIN: { obj: 'satinSettings', applied: true },
  BASIC_FEATHER: { obj: 'featherSettings', mode: 'FeatherMode.STANDARD', off: 'FeatherMode.NONE' },
  DIRECTIONAL_FEATHER: { obj: 'directionalFeatherSettings', applied: true },
  GRADIENT_FEATHER: { obj: 'gradientFeatherSettings', applied: true },
};

/**
 * Apply or remove any of the nine effects, and set the blend mode.
 *
 * Replaces apply_shadow, which could do one of them. Not every option applies
 * to every effect — size and opacity are common, distance and angle only make
 * sense for shadows — so unsupported ones are skipped rather than raising.
 */
export function applyEffect({
  pageIndex = 0, objectIndex, effect = 'DROP_SHADOW', enabled = true,
  opacity, size, distance, angle, effectColor, blendMode, objectOpacity,
}) {
  const e = enumOf(effect, EFFECT_TYPES, { name: 'effect' });
  const spec = EFFECT_MAP[e];

  const on = [];
  if (spec.applied) {
    on.push(`fx.applied = true;`);
  } else {
    on.push(`fx.mode = ${spec.mode};`);
  }
  // Each guarded: an effect that has no such property must not abort the call.
  if (opacity !== undefined) {
    on.push(`try { fx.opacity = ${num(opacity, { name: 'opacity', min: 0, max: 100 })}; } catch (e1) { skipped.push("opacity"); }`);
  }
  if (size !== undefined) {
    on.push(`try { fx.size = ${measure(size, { name: 'size' })}; } catch (e2) { skipped.push("size"); }`);
    on.push(`try { fx.width = ${measure(size, { name: 'size' })}; } catch (e3) {}`);
  }
  if (distance !== undefined) {
    on.push(`try { fx.distance = ${measure(distance, { name: 'distance' })}; } catch (e4) { skipped.push("distance"); }`);
  }
  if (angle !== undefined) {
    on.push(`try { fx.angle = ${num(angle, { name: 'angle', min: -360, max: 360 })}; } catch (e5) { skipped.push("angle"); }`);
  }
  if (effectColor !== undefined) {
    on.push(`try { fx.effectColor = __swatch(doc, ${str(effectColor)}); } catch (e6) { skipped.push("effectColor"); }`);
  }

  const off = spec.applied ? 'fx.applied = false;' : `fx.mode = ${spec.off};`;

  const blend = [];
  if (blendMode !== undefined) {
    const b = enumOf(blendMode, BLEND_MODES, { name: 'blendMode' });
    blend.push(`item.transparencySettings.blendingSettings.blendMode = BlendMode.${b};`);
  }
  if (objectOpacity !== undefined) {
    blend.push(
      'item.transparencySettings.blendingSettings.opacity = ' +
      `${num(objectOpacity, { name: 'objectOpacity', min: 0, max: 100 })};`
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
        var skipped = [];
        var fx = item.transparencySettings.${spec.obj};
        ${bool(enabled) ? on.join('\n        ') : off}
        ${blend.join('\n        ')}
        __result__ = "${e} " + (${bool(enabled)} ? "applied to" : "removed from") +
          " [" + ${index(objectIndex, { name: 'objectIndex' })} + "] " + item.constructor.name +
          ${blendMode === undefined ? '""' : `" | blend " + ${str(blendMode)}`} +
          (skipped.length > 0
            ? "\\n  not supported by this effect, ignored: " + skipped.join(", ")
            : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Create a gradient swatch and optionally fill an object with it.
 *
 * Stops are {color, location} where color is an existing swatch name and
 * location runs 0 to 100. Two stops minimum, which is what the API creates by
 * default; more are appended.
 */
export function createGradient({
  name, type = 'LINEAR', stops, pageIndex = 0, objectIndex, angle,
}) {
  const t = enumOf(type, GRADIENT_TYPES, { name: 'type' });
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error("'stops' needs at least two entries of { color, location }");
  }
  const stopCode = stops.map((s, i) => {
    const loc = num(s.location === undefined ? (i / (stops.length - 1)) * 100 : s.location,
      { name: `stops[${i}].location`, min: 0, max: 100 });
    return `
        {
          var stop = (${i} < g.gradientStops.length)
            ? g.gradientStops[${i}]
            : g.gradientStops.add();
          stop.stopColor = __swatch(doc, ${str(s.color)});
          stop.location = ${loc};
        }`;
  }).join('');

  const applyTo = objectIndex !== undefined;
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var existing = doc.gradients.itemByName(${str(name)});
        var g = existing.isValid ? existing : doc.gradients.add();
        g.name = ${str(name)};
        g.type = GradientType.${t};
        ${stopCode}

        var msg = "Gradient '" + g.name + "' (" + ${str(t)} + ", " +
          g.gradientStops.length + " stops)";
        ${applyTo ? `
          var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
          var item = __itemAt(page, ${index(objectIndex, { name: 'objectIndex' })});
          item.fillColor = g;
          ${angle === undefined ? '' : `
            try { item.gradientFillAngle = ${num(angle, { name: 'angle', min: -360, max: 360 })}; }
            catch (ea) {}
          `}
          msg += " applied to [" + ${index(objectIndex, { name: 'objectIndex' })} + "] " +
            item.constructor.name;
        ` : `
          msg += " created. Pass objectIndex to fill an object with it, " +
            "or use it by name in format_object.";
        `}
        __result__ = msg;
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Format a table: cell fill, borders, insets, alignment, column widths and
 * header rows.
 *
 * Tables live in stories, not on pages, so they are addressed by their index
 * across the document. list_text_frames does not show them; create_table
 * reports the index it used.
 */
export function formatTable({
  tableIndex = 0, rowRange = 'all', firstRow, lastRow,
  fillColor, fillTint, borderWeight, borderColor,
  verticalAlign, cellInset, columnWidths, headerRows, footerRows,
}) {
  const parts = [];

  if (headerRows !== undefined) {
    parts.push(`table.headerRowCount = ${index(headerRows, { name: 'headerRows', max: 50 })};`);
  }
  if (footerRows !== undefined) {
    parts.push(`table.footerRowCount = ${index(footerRows, { name: 'footerRows', max: 50 })};`);
  }
  if (Array.isArray(columnWidths)) {
    columnWidths.forEach((w, i) => {
      parts.push(
        `if (${i} < table.columns.length) { table.columns[${i}].width = ` +
        `${measure(w, { name: `columnWidths[${i}]` })}; }`
      );
    });
  }

  const cellParts = [];
  if (fillColor !== undefined) {
    cellParts.push(fillColor === 'None'
      ? 'cell.fillColor = doc.swatches.itemByName("None");'
      : `cell.fillColor = __swatch(doc, ${str(fillColor)});`);
  }
  if (fillTint !== undefined) {
    cellParts.push(`cell.fillTint = ${num(fillTint, { name: 'fillTint', min: 0, max: 100 })};`);
  }
  if (borderWeight !== undefined) {
    const w = num(borderWeight, { name: 'borderWeight', min: 0, max: 100 });
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      cellParts.push(`cell.${edge}EdgeStrokeWeight = ${w};`);
    }
  }
  if (borderColor !== undefined) {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      cellParts.push(`cell.${edge}EdgeStrokeColor = __swatch(doc, ${str(borderColor)});`);
    }
  }
  if (verticalAlign !== undefined) {
    // Cells use VerticalJustification; CellVerticalJustification does not exist.
    const v = enumOf(verticalAlign, CELL_VERTICAL, { name: 'verticalAlign' });
    cellParts.push(`cell.verticalJustification = VerticalJustification.${v};`);
  }
  if (cellInset !== undefined) {
    const v = measure(cellInset, { name: 'cellInset' });
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      cellParts.push(`cell.${edge}Inset = ${v};`);
    }
  }

  if (parts.length === 0 && cellParts.length === 0) {
    throw new Error(
      'format_table needs at least one of fillColor, fillTint, borderWeight, ' +
      'borderColor, verticalAlign, cellInset, columnWidths, headerRows or footerRows'
    );
  }

  const range = enumOf(rowRange, ['all', 'header', 'body', 'range'], { name: 'rowRange' });
  const from = firstRow === undefined ? 0 : index(firstRow, { name: 'firstRow' });
  const to = lastRow === undefined ? 'table.rows.length - 1' : index(lastRow, { name: 'lastRow' });

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${ITEM_AT}
      try {
        var tables = doc.stories.everyItem().tables.everyItem().getElements();
        var ti = ${index(tableIndex, { name: 'tableIndex' })};
        if (tables.length === 0) {
          throw new Error("the document holds no tables");
        }
        if (ti >= tables.length) {
          throw new Error("table index " + ti + " out of range; the document has " +
            tables.length + " table(s)");
        }
        var table = tables[ti];
        ${parts.join('\n        ')}

        ${cellParts.length === 0 ? '' : `
          var rows = [];
          ${range === 'all' ? 'for (var r = 0; r < table.rows.length; r++) { rows.push(r); }' : ''}
          ${range === 'header' ? 'for (var r = 0; r < table.headerRowCount; r++) { rows.push(r); }' : ''}
          ${range === 'body' ? 'for (var r = table.headerRowCount; r < table.rows.length - table.footerRowCount; r++) { rows.push(r); }' : ''}
          ${range === 'range' ? `for (var r = ${from}; r <= ${to} && r < table.rows.length; r++) { rows.push(r); }` : ''}
          var touched = 0;
          for (var i = 0; i < rows.length; i++) {
            var row = table.rows[rows[i]];
            for (var c = 0; c < row.cells.length; c++) {
              var cell = row.cells[c];
              ${cellParts.join('\n              ')}
              touched++;
            }
          }
        `}

        __result__ = "Table " + ti + " (" + table.rows.length + " rows x " +
          table.columns.length + " columns)" +
          ${cellParts.length === 0 ? '""' : '" | " + touched + " cell(s) formatted"'} +
          (table.headerRowCount > 0 ? " | " + table.headerRowCount + " header row(s)" : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Paragraph settings on placed text: indents, spacing, hyphenation.
 *
 * format_text covers character attributes; these are the paragraph ones the
 * server had no way to set outside a style.
 */
export function formatParagraph({
  pageIndex = 0, frameIndex, leftIndent, rightIndent, firstLineIndent,
  spaceBefore, spaceAfter, hyphenation, keepLinesTogether,
}) {
  const parts = [];
  const add = (prop, value, name) => {
    parts.push(`paras.${prop} = ${measure(value, { name })};`);
  };
  if (leftIndent !== undefined) add('leftIndent', leftIndent, 'leftIndent');
  if (rightIndent !== undefined) add('rightIndent', rightIndent, 'rightIndent');
  if (firstLineIndent !== undefined) add('firstLineIndent', firstLineIndent, 'firstLineIndent');
  if (spaceBefore !== undefined) add('spaceBefore', spaceBefore, 'spaceBefore');
  if (spaceAfter !== undefined) add('spaceAfter', spaceAfter, 'spaceAfter');
  if (hyphenation !== undefined) parts.push(`paras.hyphenation = ${bool(hyphenation)};`);
  if (keepLinesTogether !== undefined) {
    parts.push(`paras.keepLinesTogether = ${bool(keepLinesTogether)};`);
  }

  if (parts.length === 0) {
    throw new Error(
      'format_paragraph needs at least one of leftIndent, rightIndent, ' +
      'firstLineIndent, spaceBefore, spaceAfter, hyphenation or keepLinesTogether'
    );
  }

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var fi = ${index(frameIndex, { name: 'frameIndex' })};
        if (fi >= page.textFrames.length) {
          throw new Error("text frame index " + fi + " out of range (page has " +
            page.textFrames.length + " text frames)");
        }
        var frame = page.textFrames[fi];
        var story = frame.parentStory;
        var paras = story.paragraphs.everyItem();
        ${parts.join('\n        ')}
        __result__ = "Formatted " + story.paragraphs.length + " paragraph(s) in frame " + fi +
          (frame.overflows ? "\\n  WARNING: the text now overflows this frame" : "");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}
