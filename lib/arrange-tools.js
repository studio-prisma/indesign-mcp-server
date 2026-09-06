/**
 * arrange-tools.js
 * Aligning, distributing, grouping and transforming page items.
 *
 * The enum members below were read from InDesign 21.5 rather than taken from
 * documentation — AlignOptions has six members, DistributeOptions eight (the
 * same six plus HORIZONTAL_SPACE and VERTICAL_SPACE), and the bounds enum
 * carries BLEED_BOUNDS and KEY_OBJECT alongside the obvious ones.
 */

import { str, num, index, bool, enumOf } from './jsx-safe.js';

export const ALIGN_OPTIONS = [
  'LEFT_EDGES', 'RIGHT_EDGES', 'TOP_EDGES', 'BOTTOM_EDGES',
  'HORIZONTAL_CENTERS', 'VERTICAL_CENTERS',
];

export const DISTRIBUTE_OPTIONS = [
  ...ALIGN_OPTIONS, 'HORIZONTAL_SPACE', 'VERTICAL_SPACE',
];

export const ALIGN_BOUNDS = [
  'ITEM_BOUNDS', 'PAGE_BOUNDS', 'MARGIN_BOUNDS',
  'SPREAD_BOUNDS', 'BLEED_BOUNDS', 'KEY_OBJECT',
];

/** Resolve a list of object indices into an ExtendScript array literal. */
function itemList(objectIndices, name = 'objectIndices') {
  if (!Array.isArray(objectIndices) || objectIndices.length === 0) {
    throw new Error(`'${name}' must be a non-empty list of object indices`);
  }
  return objectIndices.map((i) => index(i, { name })).join(', ');
}

const PREAMBLE = `
      function __describe(item, i) {
        var b = item.geometricBounds;
        return "[" + i + "] " + item.constructor.name +
          " | x " + b[1].toFixed(1) + " to " + b[3].toFixed(1) +
          " | y " + b[0].toFixed(1) + " to " + b[2].toFixed(1) + " mm";
      }
      function __collect(page, idx) {
        var all = page.allPageItems;
        var picked = [];
        for (var k = 0; k < idx.length; k++) {
          if (idx[k] < 0 || idx[k] >= all.length) {
            throw new Error("object index " + idx[k] + " out of range (page has " +
              all.length + " items)");
          }
          picked.push(all[idx[k]]);
        }
        return picked;
      }
`;

/**
 * Align objects to each other, to the page, to the margins or to the spread.
 *
 * With ITEM_BOUNDS the objects align to their own collective bounding box, so
 * at least two are needed for the call to mean anything. Against PAGE_BOUNDS
 * or MARGIN_BOUNDS a single object is fine — that is how you centre something
 * on the page.
 */
export function alignObjects({ pageIndex = 0, objectIndices, alignment, relativeTo = 'ITEM_BOUNDS' }) {
  const items = itemList(objectIndices);
  const how = enumOf(alignment, ALIGN_OPTIONS, { name: 'alignment' });
  const to = enumOf(relativeTo, ALIGN_BOUNDS, { name: 'relativeTo' });
  if (to === 'ITEM_BOUNDS' && objectIndices.length < 2) {
    throw new Error(
      "aligning to ITEM_BOUNDS needs at least two objects; " +
      "to place a single object use relativeTo: 'PAGE_BOUNDS' or 'MARGIN_BOUNDS'"
    );
  }
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${PREAMBLE}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var picked = __collect(page, [${items}]);
        var before = [];
        for (var i = 0; i < picked.length; i++) { before.push(__describe(picked[i], i)); }

        doc.align(picked, AlignOptions.${how}, AlignDistributeBounds.${to});

        var after = [];
        for (var j = 0; j < picked.length; j++) { after.push(__describe(picked[j], j)); }
        __result__ = "Aligned ${how} relative to ${to}\\n  before: " +
          before.join("\\n          ") + "\\n  after:  " + after.join("\\n          ");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Distribute objects evenly. Needs at least three to be meaningful — with two
 * there is nothing to space out between them.
 *
 * HORIZONTAL_SPACE and VERTICAL_SPACE equalise the gaps rather than the
 * positions, which is what you usually want for a row of cards; the edge
 * options equalise the distance between the chosen edges instead.
 */
export function distributeObjects({
  pageIndex = 0, objectIndices, distribution, relativeTo = 'ITEM_BOUNDS', spacing,
}) {
  const items = itemList(objectIndices);
  const how = enumOf(distribution, DISTRIBUTE_OPTIONS, { name: 'distribution' });
  const to = enumOf(relativeTo, ALIGN_BOUNDS, { name: 'relativeTo' });
  if (objectIndices.length < 3 && to === 'ITEM_BOUNDS') {
    throw new Error(
      'distributing across ITEM_BOUNDS needs at least three objects; ' +
      'with two there is no gap between them to equalise'
    );
  }
  const useSpacing = spacing !== undefined;
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${PREAMBLE}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var picked = __collect(page, [${items}]);

        doc.distribute(
          picked,
          DistributeOptions.${how},
          AlignDistributeBounds.${to},
          ${bool(useSpacing)},
          ${useSpacing ? num(spacing, { name: 'spacing', min: 0 }) : '0'}
        );

        var after = [];
        for (var j = 0; j < picked.length; j++) { after.push(__describe(picked[j], j)); }
        __result__ = "Distributed ${how} relative to ${to}" +
          ${useSpacing ? `" with fixed spacing ${num(spacing, { name: 'spacing', min: 0 })} mm"` : '""'} +
          "\\n  " + after.join("\\n  ");
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Group objects. The group replaces them as a single item on the page. */
export function groupObjects({ pageIndex = 0, objectIndices, name }) {
  const items = itemList(objectIndices);
  if (objectIndices.length < 2) {
    throw new Error('grouping needs at least two objects');
  }
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${PREAMBLE}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var picked = __collect(page, [${items}]);
        var group = page.groups.add(picked);
        ${name !== undefined ? `group.name = ${str(name)};` : ''}
        var b = group.geometricBounds;
        __result__ = "Grouped " + picked.length + " objects" +
          ${name !== undefined ? `" as " + ${str(name)}` : '""'} +
          " | x " + b[1].toFixed(1) + " to " + b[3].toFixed(1) +
          " | y " + b[0].toFixed(1) + " to " + b[2].toFixed(1) + " mm" +
          "\\nThe group is now one object; run inspect_page for the new indices.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/** Ungroup a group back into its members. */
export function ungroupObjects({ pageIndex = 0, objectIndex }) {
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${PREAMBLE}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var all = page.allPageItems;
        var i = ${index(objectIndex, { name: 'objectIndex' })};
        if (i < 0 || i >= all.length) {
          throw new Error("object index " + i + " out of range");
        }
        var item = all[i];
        if (item.constructor.name !== "Group") {
          throw new Error("object " + i + " is a " + item.constructor.name + ", not a Group");
        }
        var n = item.pageItems.length;
        item.ungroup();
        __result__ = "Ungrouped into " + n + " objects" +
          "\\nIndices have shifted; run inspect_page before addressing another one.";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Rotate, scale or flip an object.
 *
 * Rotation is absolute, not cumulative: 45 sets the angle to 45 degrees
 * rather than adding 45 to it. InDesign measures counter-clockwise.
 */
export function transformObject({
  pageIndex = 0, objectIndex, rotation, scaleX, scaleY, flipHorizontal, flipVertical,
}) {
  const parts = [];
  if (rotation !== undefined) {
    parts.push(`item.rotationAngle = ${num(rotation, { name: 'rotation', min: -360, max: 360 })};`);
  }
  if (scaleX !== undefined) {
    parts.push(`item.horizontalScale = ${num(scaleX, { name: 'scaleX', min: 1, max: 1000 })};`);
  }
  if (scaleY !== undefined) {
    parts.push(`item.verticalScale = ${num(scaleY, { name: 'scaleY', min: 1, max: 1000 })};`);
  }
  if (flipHorizontal) {
    parts.push('item.flipItem(Flip.HORIZONTAL);');
  }
  if (flipVertical) {
    parts.push('item.flipItem(Flip.VERTICAL);');
  }
  if (parts.length === 0) {
    throw new Error(
      'transform_object needs at least one of rotation, scaleX, scaleY, flipHorizontal or flipVertical'
    );
  }
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${PREAMBLE}
      try {
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var all = page.allPageItems;
        var i = ${index(objectIndex, { name: 'objectIndex' })};
        if (i < 0 || i >= all.length) { throw new Error("object index " + i + " out of range"); }
        var item = all[i];
        if (item.locked) { throw new Error("object is locked"); }
        var before = __describe(item, i);
        ${parts.join('\n        ')}
        __result__ = "Transformed\\n  before " + before + "\\n  after  " + __describe(item, i) +
          "\\n  rotation " + item.rotationAngle + " deg";
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}
