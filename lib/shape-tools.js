/**
 * shape-tools.js
 * Objects the generic layer cannot reach.
 *
 * set_properties and call_method act on objects that already exist; creating
 * one is not among the allowed methods, and it should not be — `add` on an
 * arbitrary collection is a different kind of power. So every object type the
 * server should be able to make needs a tool of its own, and three were
 * missing: polygons, straight lines, and frames anchored inside running text.
 *
 * Anchoring was the interesting one. Both obvious routes are refused by
 * InDesign 21.5 — `item.move(insertionPoint)` and `item.duplicate(
 * insertionPoint)` both answer "invalid value for parameter to". An anchored
 * frame has to be created *on* the insertion point, which is why this tool
 * makes a new frame rather than taking an existing object into the text.
 */

import {
  str, num, index, enumOf, measure, validateFilePath, jsxPath,
} from './jsx-safe.js';

/** Anchored objects sit in AnchorPosition. AnchoredPosition does not exist. */
export const ANCHOR_POSITIONS = ['INLINE_POSITION', 'ABOVE_LINE', 'ANCHORED'];

// Weight first, then colour. The other order loses both - assigning
// strokeWeight after the colour pulls the item defaults back and the object
// keeps its black 1 pt stroke. Reproduced on rectangles, polygons and text
// frames in InDesign 21.5.
const NO_STROKE = `
        try {
          item.strokeWeight = 0;
          item.strokeColor = doc.swatches.itemByName("None");
        } catch (e) {}`;

/** Fill and stroke, shared by the shape tools. */
function appearance(fillColor, strokeColor, strokeWidth) {
  const parts = [];
  if (fillColor) {
    parts.push(`
        try { item.fillColor = doc.swatches.itemByName(${str(fillColor)}); } catch (e) {}`);
  }
  if (strokeColor) {
    parts.push(`
        try {
          item.strokeWeight = ${measure(strokeWidth, { unit: 'pt', name: 'strokeWidth' })};
          item.strokeColor = doc.swatches.itemByName(${str(strokeColor)});
        } catch (e) {}`);
  } else {
    parts.push(NO_STROKE);
  }
  return parts.join('\n');
}

/**
 * A regular polygon, or a star, inscribed in the given box.
 *
 * InDesign's own polygon tool takes a side count and a star inset; scripting
 * has neither. The path is computed here and written to paths[0].entirePath,
 * which is the only route that produces real corners — a polygon added
 * without one is a rectangle in disguise.
 */
export function createPolygon({
  x, y, width, height, sides = 6, starInset = 0, pageIndex = 0,
  fillColor, strokeColor, strokeWidth = 1, rotation = 0,
}) {
  // num() validates and returns a string for interpolation; the corner maths
  // below needs the values back as numbers.
  const n = Number(num(sides, { name: 'sides', min: 3, max: 100 }));
  const inset = Number(num(starInset, { name: 'starInset', min: 0, max: 100 }));
  const px = Number(num(x, { name: 'x' }));
  const py = Number(num(y, { name: 'y' }));
  const w = Number(num(width, { name: 'width', min: 0.1 }));
  const h = Number(num(height, { name: 'height', min: 0.1 }));

  // The corners are computed in JavaScript rather than in ExtendScript: fewer
  // moving parts in the generated script, and every value that reaches it has
  // already been through num().
  const cx = px + w / 2;
  const cy = py + h / 2;
  const steps = inset > 0 ? n * 2 : n;
  const corners = [];
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    const shrink = inset > 0 && i % 2 === 1 ? 1 - inset / 100 : 1;
    corners.push([
      +(cx + (w / 2) * shrink * Math.cos(angle)).toFixed(4),
      +(cy + (h / 2) * shrink * Math.sin(angle)).toFixed(4),
    ]);
  }
  const path = corners
    .map(([ax, ay]) =>
      `[${measure(ax, { unit: 'mm', name: 'x' })}, ${measure(ay, { unit: 'mm', name: 'y' })}]`)
    .join(', ');

  const pi = index(pageIndex, { name: 'pageIndex' });

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var page = doc.pages[${pi}];
        var item = page.polygons.add();
        item.paths[0].entirePath = [${path}];
${appearance(fillColor, strokeColor, strokeWidth)}
        ${rotation ? `item.rotationAngle = ${num(rotation, { name: 'rotation', min: -360, max: 360 })};` : ''}
        var b = item.geometricBounds;
        __result__ = "${inset > 0 ? 'Star' : 'Polygon'} with ${steps} corner(s) on page " + (${pi} + 1) +
          " | x " + b[1].toFixed(1) + " to " + b[3].toFixed(1) +
          " | y " + b[0].toFixed(1) + " to " + b[2].toFixed(1) + " mm";
      } catch (e) {
        __result__ = "ERROR creating polygon: " + e.message;
      }
    }
  `;
}

/** A straight line between two points. */
export function createLine({
  x1, y1, x2, y2, pageIndex = 0,
  strokeColor = 'Black', strokeWidth = 1, strokeType,
}) {
  const pi = index(pageIndex, { name: 'pageIndex' });

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      var warning = "";
      try {
        var page = doc.pages[${pi}];
        var item = page.graphicLines.add();
        item.paths[0].entirePath = [
          [${measure(x1, { unit: 'mm', name: 'x1' })}, ${measure(y1, { unit: 'mm', name: 'y1' })}],
          [${measure(x2, { unit: 'mm', name: 'x2' })}, ${measure(y2, { unit: 'mm', name: 'y2' })}]
        ];
        try {
          item.strokeWeight = ${measure(strokeWidth, { unit: 'pt', name: 'strokeWidth' })};
          item.strokeColor = doc.swatches.itemByName(${str(strokeColor)});
        } catch (e) {}
        ${strokeType ? `
        try {
          item.strokeType = doc.strokeStyles.itemByName(${str(strokeType)});
        } catch (e) {
          warning = "\\nWARNING: no stroke style named " + ${str(strokeType)} +
            ". The line was drawn with the default.";
        }` : ''}
        var b = item.geometricBounds;
        __result__ = "Line on page " + (${pi} + 1) +
          " from " + b[1].toFixed(1) + "," + b[0].toFixed(1) +
          " to " + b[3].toFixed(1) + "," + b[2].toFixed(1) + " mm" + warning;
      } catch (e) {
        __result__ = "ERROR creating line: " + e.message;
      }
    }
  `;
}

/**
 * A frame anchored in running text, so it moves when the text reflows.
 *
 * The position is a character offset into a story, because that is what an
 * insertion point is. find_text reports its hits with an offset, so the two
 * work together: search for the word, anchor the frame where it sits.
 */
export function createAnchoredFrame({
  frameIndex = 0, characterOffset = 0, width, height, pageIndex = 0,
  content, imagePath, position = 'INLINE_POSITION',
  fillColor, strokeColor, strokeWidth = 1, yOffset = 0, allowedDirs,
}) {
  const pos = enumOf(position, ANCHOR_POSITIONS, { name: 'position' });
  const validated = imagePath ? validateFilePath(imagePath, allowedDirs) : null;
  const pi = index(pageIndex, { name: 'pageIndex' });
  const fi = index(frameIndex, { name: 'frameIndex' });
  const off = index(characterOffset, { name: 'characterOffset' });

  const placeOrFill = validated ? `
            var f = File(${jsxPath(validated)});
            if (!f.exists) {
              item.remove();
              failed = "ERROR: image file not found: " + ${jsxPath(validated)};
            } else {
              item.place(f);
              if (item.allGraphics.length === 0) {
                item.remove();
                failed = "ERROR: no artwork imported from " + f.name +
                  ". The file exists but InDesign read nothing from it. For SVG, " +
                  "check that the XML is well formed.";
              } else {
                item.fit(FitOptions.PROPORTIONALLY);
                note = " | image " + f.name;
              }
            }` : content ? `
            item.contents = ${str(content)};
            if (item.overflows) { note = " | WARNING: the text does not fit this frame"; }` : '';

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      try {
        var page = doc.pages[${pi}];
        if (page.textFrames.length === 0) {
          __result__ = "No text frame on page " + (${pi} + 1) + " to anchor into.";
        } else if (${fi} >= page.textFrames.length) {
          __result__ = "No text frame " + ${fi} + " on this page - it has " +
            page.textFrames.length + ". Frames are ordered front to back.";
        } else {
          var story = page.textFrames[${fi}].parentStory;
          if (${off} >= story.insertionPoints.length) {
            __result__ = "Character offset " + ${off} + " is past the end of the story, " +
              "which has " + story.insertionPoints.length + " positions.";
          } else {
            var note = "";
            var failed = "";
            var item = story.insertionPoints[${off}].${validated ? 'rectangles' : 'textFrames'}.add();
            item.geometricBounds = [
              0, 0,
              ${measure(height, { unit: 'mm', name: 'height' })},
              ${measure(width, { unit: 'mm', name: 'width' })}
            ];
${appearance(fillColor, strokeColor, strokeWidth)}

            var settings = item.anchoredObjectSettings;
            settings.anchoredPosition = AnchorPosition.${pos};
            ${yOffset ? `settings.anchorYoffset = ${measure(yOffset, { unit: 'mm', name: 'yOffset' })};` : ''}
${placeOrFill}

            __result__ = failed !== "" ? failed :
              "Anchored a frame at character " + ${off} + " of the story in frame " + ${fi} +
              " | position ${pos}" + note +
              " | it moves with the text from here on";
          }
        }
      } catch (e) {
        __result__ = "ERROR anchoring frame: " + e.message;
      }
    }
  `;
}
