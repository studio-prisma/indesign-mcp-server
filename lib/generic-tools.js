/**
 * generic-tools.js
 * Read and change any DOM object, without running arbitrary code.
 *
 * Why this exists: a tool per task cannot cover InDesign. The DOM has
 * thousands of properties, and the specialised tools only reach the ones
 * somebody thought to wrap. Everything else was out of reach unless
 * execute_indesign_code was unlocked, which hands over the whole runtime.
 *
 * This is the middle ground. A caller names an object, names properties, and
 * passes typed values. Nothing it sends becomes code:
 *
 *   - the target is a structured reference, not an expression. Indices go
 *     through index(), names through str().
 *   - property paths are matched against /^[A-Za-z][A-Za-z0-9_]*$/ per
 *     segment, so a path cannot contain a call, an operator or a bracket.
 *   - values are typed: number, string, boolean, array of those, or one of
 *     two tagged forms — { enum: "Justification.CENTER_ALIGN" } and
 *     { swatch: "Black" } — both validated before they are written.
 *   - methods come from an allow-list, and their arguments are typed the
 *     same way.
 *
 * So the reachable surface is "every property of every object", which is the
 * point, but not "every statement", which is what execute_indesign_code is
 * and why it stays off.
 */

import { str, num, index, bool, enumOf } from './jsx-safe.js';

/** Objects a caller can address. */
export const TARGET_KINDS = [
  'document', 'page', 'pageItem', 'textFrame', 'story', 'paragraph',
  'character', 'table', 'cell', 'row', 'column', 'layer', 'swatch',
  'paragraphStyle', 'characterStyle', 'objectStyle', 'masterSpread',
  'application',
];

/**
 * Methods that may be called. Each is a plain action on the object it
 * belongs to; none takes a script, opens a file or changes application
 * settings. Anything not listed here is refused.
 */
export const ALLOWED_METHODS = [
  // page items
  'fit', 'remove', 'bringToFront', 'bringForward', 'sendBackward', 'sendToBack',
  'flipItem', 'move', 'resize', 'duplicate', 'select', 'clearTransformations',
  'detach', 'override',
  // text
  'insertionPoints', 'changeText', 'changeGrep',
  // tables
  'merge', 'unmerge', 'convertToText',
  // groups
  'ungroup',
  // documents and pages
  'recompose', 'save', 'exportFile',
];

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Turn a dotted property path into a validated ExtendScript accessor.
 *
 * Each segment must be a plain identifier, so no call, index, operator or
 * string can be smuggled in. "transparencySettings.dropShadowSettings.opacity"
 * is fine; "foo(); app.quit()" is not a valid identifier and is refused.
 */
function accessor(path, name = 'property') {
  const segments = String(path).split('.');
  if (segments.length === 0 || segments.length > 6) {
    throw new Error(`Invalid property path for '${name}': ${JSON.stringify(path)}`);
  }
  for (const s of segments) {
    if (!IDENT.test(s)) {
      throw new Error(
        `Invalid property path for '${name}': ${JSON.stringify(path)}. ` +
        'Each segment must be a plain name such as ' +
        '"opacity" or "transparencySettings.dropShadowSettings.opacity".'
      );
    }
  }
  return segments;
}

/**
 * Render a value as an ExtendScript literal.
 *
 * Tagged objects cover the two cases a literal cannot express: an enum member
 * has to be written as an identifier, and a colour has to be looked up as a
 * swatch. Both are validated rather than interpolated.
 */
function literal(value, name = 'value') {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return num(value, { name, min: -1e9, max: 1e9 });
  if (typeof value === 'boolean') return bool(value);
  if (typeof value === 'string') return str(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v, i) => literal(v, `${name}[${i}]`)).join(', ') + ']';
  }
  if (typeof value === 'object') {
    if (typeof value.enum === 'string') {
      // "Justification.CENTER_ALIGN" -> two identifiers, nothing else.
      const parts = value.enum.split('.');
      if (parts.length !== 2 || !IDENT.test(parts[0]) || !IDENT.test(parts[1])) {
        throw new Error(
          `Invalid enum for '${name}': ${JSON.stringify(value.enum)}. ` +
          'Expected the form "EnumName.MEMBER", e.g. "Justification.CENTER_ALIGN".'
        );
      }
      return `${parts[0]}.${parts[1]}`;
    }
    if (typeof value.swatch === 'string') {
      return `__swatch(${str(value.swatch)})`;
    }
    if (typeof value.measure === 'number') {
      const unit = value.unit === undefined ? 'mm' : String(value.unit);
      if (!['mm', 'cm', 'in', 'pt', 'px', 'p'].includes(unit)) {
        throw new Error(`Invalid unit for '${name}': ${JSON.stringify(unit)}`);
      }
      return str(`${num(value.measure, { name })}${unit}`);
    }
  }
  throw new Error(
    `Unsupported value for '${name}': ${JSON.stringify(value)}. ` +
    'Use a number, string, boolean, array, { enum: "Enum.MEMBER" }, ' +
    '{ swatch: "Name" } or { measure: 20, unit: "mm" }.'
  );
}

/** ExtendScript that resolves a structured target into `obj`. */
function resolveTarget(target = {}) {
  const kind = enumOf(target.kind === undefined ? 'pageItem' : target.kind,
    TARGET_KINDS, { name: 'target.kind' });

  const pageIdx = () => index(target.pageIndex === undefined ? 0 : target.pageIndex,
    { name: 'target.pageIndex' });
  const need = (field) => {
    if (target[field] === undefined) {
      throw new Error(`target.kind '${kind}' needs '${field}'`);
    }
    return index(target[field], { name: `target.${field}` });
  };
  const needName = (field) => {
    if (typeof target[field] !== 'string' || target[field] === '') {
      throw new Error(`target.kind '${kind}' needs '${field}' as a name`);
    }
    return str(target[field]);
  };

  const byName = (collection, field) => `
      var __c = doc.${collection};
      obj = null;
      for (var __i = 0; __i < __c.length; __i++) {
        if (__c[__i].name === ${needName(field)}) { obj = __c[__i]; break; }
      }
      if (obj === null) {
        var __have = [];
        for (var __j = 0; __j < __c.length && __j < 15; __j++) { __have.push(__c[__j].name); }
        throw new Error("no ${collection} named " + ${needName(field)} +
          ". Available: " + __have.join(", "));
      }
      __label = "${kind} " + obj.name;`;

  const tableLookup = `
      var __tables = doc.stories.everyItem().tables.everyItem().getElements();
      var __ti = ${target.tableIndex === undefined ? '0' : index(target.tableIndex, { name: 'target.tableIndex' })};
      if (__tables.length === 0) { throw new Error("the document holds no tables"); }
      if (__ti >= __tables.length) {
        throw new Error("table index " + __ti + " out of range; the document has " +
          __tables.length + " table(s)");
      }
      var __table = __tables[__ti];`;

  switch (kind) {
    case 'application':
      return { code: '      obj = app;\n      __label = "application";', kind };
    case 'document':
      return { code: '      obj = doc;\n      __label = "document " + doc.name;', kind };
    case 'page':
      return {
        code: `
      obj = doc.pages[${pageIdx()}];
      __label = "page " + obj.name;`,
        kind,
      };
    case 'pageItem':
      return {
        code: `
      var __items = doc.pages[${pageIdx()}].allPageItems;
      var __oi = ${need('objectIndex')};
      if (__oi >= __items.length) {
        throw new Error("object index " + __oi + " out of range; the page has " +
          __items.length + " item(s)");
      }
      obj = __items[__oi];
      __label = "[" + __oi + "] " + obj.constructor.name;`,
        kind,
      };
    case 'textFrame':
      return {
        code: `
      var __frames = doc.pages[${pageIdx()}].textFrames;
      var __fi = ${need('frameIndex')};
      if (__fi >= __frames.length) {
        throw new Error("text frame index " + __fi + " out of range; the page has " +
          __frames.length + " text frame(s)");
      }
      obj = __frames[__fi];
      __label = "text frame " + __fi;`,
        kind,
      };
    case 'story':
      return {
        code: `
      var __si = ${target.storyIndex === undefined ? '0' : index(target.storyIndex, { name: 'target.storyIndex' })};
      if (__si >= doc.stories.length) {
        throw new Error("story index " + __si + " out of range; the document has " +
          doc.stories.length + " story object(s)");
      }
      obj = doc.stories[__si];
      __label = "story " + __si;`,
        kind,
      };
    case 'paragraph':
    case 'character': {
      const coll = kind === 'paragraph' ? 'paragraphs' : 'characters';
      return {
        code: `
      var __si = ${target.storyIndex === undefined ? '0' : index(target.storyIndex, { name: 'target.storyIndex' })};
      if (__si >= doc.stories.length) { throw new Error("story index " + __si + " out of range"); }
      var __coll = doc.stories[__si].${coll};
      var __ii = ${target.itemIndex === undefined ? '0' : index(target.itemIndex, { name: 'target.itemIndex' })};
      if (__ii >= __coll.length) {
        throw new Error("${kind} index " + __ii + " out of range; the story has " +
          __coll.length);
      }
      obj = __coll[__ii];
      __label = "${kind} " + __ii + " of story " + __si;`,
        kind,
      };
    }
    case 'table':
      return { code: tableLookup + '\n      obj = __table;\n      __label = "table " + __ti;', kind };
    case 'cell':
      return {
        code: tableLookup + `
      var __r = ${target.row === undefined ? '0' : index(target.row, { name: 'target.row' })};
      var __col = ${target.column === undefined ? '0' : index(target.column, { name: 'target.column' })};
      if (__r >= __table.rows.length) { throw new Error("row " + __r + " out of range"); }
      if (__col >= __table.columns.length) { throw new Error("column " + __col + " out of range"); }
      obj = __table.rows[__r].cells[__col];
      __label = "cell " + __r + "/" + __col + " of table " + __ti;`,
        kind,
      };
    case 'row':
      return {
        code: tableLookup + `
      var __r = ${target.row === undefined ? '0' : index(target.row, { name: 'target.row' })};
      if (__r >= __table.rows.length) { throw new Error("row " + __r + " out of range"); }
      obj = __table.rows[__r];
      __label = "row " + __r + " of table " + __ti;`,
        kind,
      };
    case 'column':
      return {
        code: tableLookup + `
      var __col = ${target.column === undefined ? '0' : index(target.column, { name: 'target.column' })};
      if (__col >= __table.columns.length) { throw new Error("column " + __col + " out of range"); }
      obj = __table.columns[__col];
      __label = "column " + __col + " of table " + __ti;`,
        kind,
      };
    case 'layer':
      return { code: byName('layers', 'name'), kind };
    case 'swatch':
      return { code: byName('swatches', 'name'), kind };
    case 'paragraphStyle':
      return { code: byName('paragraphStyles', 'name'), kind };
    case 'characterStyle':
      return { code: byName('characterStyles', 'name'), kind };
    case 'objectStyle':
      return { code: byName('objectStyles', 'name'), kind };
    case 'masterSpread':
      return { code: byName('masterSpreads', 'name'), kind };
    default:
      throw new Error(`unhandled target kind: ${kind}`);
  }
}

const PREAMBLE = `
      function __swatch(name) {
        var s = app.activeDocument.swatches.itemByName(name);
        if (!s.isValid) { throw new Error("no swatch named '" + name + "'"); }
        return s;
      }
      function __show(v) {
        if (v === null || v === undefined) { return "(none)"; }
        var t = typeof v;
        if (t === "number" || t === "boolean" || t === "string") { return String(v); }
        try {
          if (v instanceof Array) {
            var parts = [];
            for (var i = 0; i < v.length && i < 8; i++) { parts.push(__show(v[i])); }
            return "[" + parts.join(", ") + (v.length > 8 ? ", ..." : "") + "]";
          }
        } catch (e1) {}
        try { if (typeof v.name === "string") { return v.name; } } catch (e2) {}
        try { return String(v); } catch (e3) { return "(unreadable)"; }
      }
`;

/**
 * Read properties of any object, or list what it has.
 *
 * With no `properties`, it reports every readable name and its value, which
 * is how a caller finds out what an object offers without documentation.
 */
export function inspectObject({ target, properties, maxProperties = 80 }) {
  const t = resolveTarget(target);
  const limit = num(maxProperties, { name: 'maxProperties', min: 1, max: 400 });

  const wanted = Array.isArray(properties) && properties.length > 0
    ? properties.map((p) => accessor(p, 'properties').join('.'))
    : null;

  return `
    if (app.documents.length === 0 && ${bool(t.kind !== 'application')}) {
      __result__ = "No document open.";
    } else {
      var doc = app.documents.length > 0 ? app.activeDocument : null;
      ${PREAMBLE}
      var obj = null;
      var __label = "";
      try {
        ${t.code}
        var out = __label + "\\n";
        ${wanted === null ? `
          var names = [];
          for (var k in obj) {
            if (k === "reflect" || k === "parent" || k === "properties" ||
                k === "events" || k === "eventListeners") { continue; }
            names.push(k);
          }
          names.sort();
          var shown = 0;
          for (var n = 0; n < names.length && shown < ${limit}; n++) {
            var val;
            try { val = obj[names[n]]; } catch (e1) { continue; }
            if (typeof val === "function") { continue; }
            out += "  " + names[n] + " = " + __show(val) + "\\n";
            shown++;
          }
          out += "\\n" + shown + " of " + names.length + " readable properties" +
            (shown < names.length ? " (raise maxProperties for more)" : "") +
            ".\\nPass 'properties' to read specific ones, or use set_properties to change them.";
        ` : wanted.map((p) => `
          try { out += "  ${p} = " + __show(obj.${p}) + "\\n"; }
          catch (e_${p.replace(/\./g, '_')}) {
            out += "  ${p} -> NOT AVAILABLE on this object\\n";
          }
        `).join('')}
        __result__ = out;
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Set properties on any object.
 *
 * Each assignment is guarded on its own, so one name this version does not
 * have does not abort the rest — the failure mode that made several of the
 * specialised tools look broken.
 */
export function setProperties({ target, properties }) {
  const t = resolveTarget(target);
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error("'properties' must be an object of { path: value }");
  }
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    throw new Error("'properties' must contain at least one entry");
  }
  if (entries.length > 40) {
    throw new Error("'properties' takes at most 40 entries in one call");
  }

  const assignments = entries.map(([path, value], i) => {
    const segs = accessor(path, path);
    const dotted = segs.join('.');
    return `
        try {
          obj.${dotted} = ${literal(value, path)};
          applied.push("${dotted}");
        } catch (e${i}) {
          failed.push("${dotted}: " + String(e${i}.message).slice(0, 70));
        }`;
  }).join('');

  return `
    if (app.documents.length === 0 && ${bool(t.kind !== 'application')}) {
      __result__ = "No document open.";
    } else {
      var doc = app.documents.length > 0 ? app.activeDocument : null;
      ${PREAMBLE}
      var obj = null;
      var __label = "";
      try {
        ${t.code}
        var applied = [];
        var failed = [];
        ${assignments}
        var out = __label + ": " + applied.length + " of " +
          ${entries.length} + " propert" + (${entries.length} === 1 ? "y" : "ies") + " set";
        if (applied.length > 0) { out += "\\n  set: " + applied.join(", "); }
        if (failed.length > 0) {
          out += "\\n  failed:";
          for (var f = 0; f < failed.length; f++) { out += "\\n    " + failed[f]; }
          out += "\\n  A name this version does not have raises rather than being " +
            "ignored. Use inspect_object without 'properties' to see what this " +
            "object actually offers.";
        }
        __result__ = out;
      } catch (e) {
        __result__ = "ERROR: " + e.message;
      }
    }
  `;
}

/**
 * Call one of the allowed methods on an object.
 *
 * The allow-list is the point: it keeps this a way to act on objects rather
 * than a way to run statements.
 */
export function callMethod({ target, method, args = [] }) {
  const t = resolveTarget(target);
  const m = enumOf(method, ALLOWED_METHODS, { name: 'method' });
  if (!Array.isArray(args)) {
    throw new Error("'args' must be an array");
  }
  if (args.length > 6) {
    throw new Error("'args' takes at most six entries");
  }
  const rendered = args.map((a, i) => literal(a, `args[${i}]`)).join(', ');

  return `
    if (app.documents.length === 0 && ${bool(t.kind !== 'application')}) {
      __result__ = "No document open.";
    } else {
      var doc = app.documents.length > 0 ? app.activeDocument : null;
      ${PREAMBLE}
      var obj = null;
      var __label = "";
      try {
        ${t.code}
        if (typeof obj.${m} !== "function") {
          throw new Error("${m}() is not available on " + obj.constructor.name +
            ". Use inspect_object to see what this object is.");
        }
        var res = obj.${m}(${rendered});
        __result__ = __label + ": ${m}(${args.length ? args.length + ' argument(s)' : ''}) called" +
          (res === undefined || res === null ? "" : "\\n  returned: " + __show(res));
      } catch (e) {
        __result__ = "ERROR calling ${m}(): " + e.message;
      }
    }
  `;
}
