/**
 * text-tools.js
 * Reading text out of a document, and finding it.
 *
 * The existing tools could not answer "what text is in this document".
 * get_text_content only looked at the selection or one named frame, so with
 * neither it returned nothing; find_replace_text always replaced, so there was
 * no way to look without changing. Between them, checking a document's text
 * was not possible.
 *
 * Note on the find/change API: caseSensitive and wholeWord live on
 * app.findChangeTextOptions, not on app.findTextPreferences — setting them on
 * the preferences object raises "Object does not support the property or
 * method". Verified against InDesign 21.5. The GREP options object has no
 * caseSensitive at all; a GREP search is case sensitive by default and takes
 * (?i) in the pattern instead.
 */

import { str, num, index, bool, enumOf } from './jsx-safe.js';

export const TEXT_SCOPES = ['selection', 'frame', 'page', 'document'];

/** Reset every find/change setting. Leftovers silently alter the next call. */
const RESET_FIND = `
      app.findTextPreferences = NothingEnum.nothing;
      app.changeTextPreferences = NothingEnum.nothing;
      app.findGrepPreferences = NothingEnum.nothing;
      app.changeGrepPreferences = NothingEnum.nothing;
`;

const TEXT_HELPERS = `
      function __trim(s, max) {
        if (max > 0 && s.length > max) {
          return s.substring(0, max) + "... [" + (s.length - max) + " more characters]";
        }
        return s;
      }
      function __normalise(s) {
        return s.replace(/\\r/g, "\\n").replace(/[ \\t]+/g, " ");
      }
      function __frameLabel(frame) {
        var b = frame.geometricBounds;
        var pg = frame.parentPage;
        return "page " + (pg === null ? "?" : pg.name) +
          " | x " + b[1].toFixed(0) + " y " + b[0].toFixed(0);
      }
`;

/**
 * Read text out of the document.
 *
 * scope 'document' and 'page' are what "check the text" usually means; the
 * older behaviour is still available as 'selection' and 'frame'.
 */
export function getTextContent({
  scope = 'document', pageIndex = 0, frameIndex, maxLength = 0, normalizeSpaces = true,
}) {
  const s = enumOf(scope, TEXT_SCOPES, { name: 'scope' });
  if (s === 'frame' && frameIndex === undefined) {
    throw new Error("scope 'frame' needs a frameIndex; use scope 'page' to read every frame on a page");
  }
  const max = num(maxLength, { name: 'maxLength', min: 0 });

  const collect = {
    selection: `
        if (app.selection.length === 0) {
          __result__ = "Nothing is selected. Use scope 'page' or 'document' to read " +
            "text without a selection.";
        } else {
          var picked = [];
          for (var s = 0; s < app.selection.length; s++) {
            var sel = app.selection[s];
            var txt = null;
            // Not hasOwnProperty: DOM objects expose properties through the
            // host bridge, so hasOwnProperty reports false for contents.
            try { if (typeof sel.contents === "string") { txt = sel.contents; } } catch (e) {}
            if (txt === null) {
              try {
                if (sel.parentTextFrames && sel.parentTextFrames.length > 0) {
                  txt = sel.parentTextFrames[0].contents;
                }
              } catch (e2) {}
            }
            if (txt !== null && txt !== "") { picked.push(txt); }
          }
          if (picked.length === 0) {
            __result__ = "The selection holds no text (" +
              app.selection[0].constructor.name + ").";
          } else {
            found.push({ label: "selection", text: picked.join("\\n") });
          }
        }`,
    frame: `
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        var fi = ${frameIndex === undefined ? '0' : index(frameIndex, { name: 'frameIndex' })};
        if (fi >= page.textFrames.length) {
          __result__ = "ERROR: frame index " + fi + " out of range; page " +
            (${index(pageIndex, { name: 'pageIndex' })} + 1) + " has " +
            page.textFrames.length + " text frame(s).";
        } else {
          var f = page.textFrames[fi];
          found.push({ label: "frame " + fi + " (" + __frameLabel(f) + ")", text: f.contents });
        }`,
    page: `
        var page = doc.pages[${index(pageIndex, { name: 'pageIndex' })}];
        for (var i = 0; i < page.textFrames.length; i++) {
          var fr = page.textFrames[i];
          if (fr.contents !== "") {
            found.push({ label: "frame " + i + " (" + __frameLabel(fr) + ")", text: fr.contents });
          }
        }`,
    document: `
        for (var i = 0; i < doc.stories.length; i++) {
          var st = doc.stories[i];
          if (st.length === 0) { continue; }
          var where = st.textContainers.length > 0
            ? __frameLabel(st.textContainers[0]) +
              (st.textContainers.length > 1
                ? " and " + (st.textContainers.length - 1) + " more frame(s)" : "")
            : "(not placed)";
          found.push({ label: "story " + i + " (" + where + ")", text: st.contents });
        }`,
  }[s];

  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${TEXT_HELPERS}
      try {
        var found = [];
        ${collect}

        if (typeof __result__ === "undefined" || __result__ === null) {
          if (found.length === 0) {
            __result__ = "No text found (scope: ${s}). The document has " +
              doc.stories.length + " story object(s) and " + doc.pages.length + " page(s). " +
              "An empty result here usually means the frames exist but hold no content.";
          } else {
            var total = 0;
            for (var n = 0; n < found.length; n++) { total += found[n].text.length; }
            var out = "Text (scope: ${s}) | " + found.length + " block(s), " +
              total + " characters\\n";
            for (var m = 0; m < found.length; m++) {
              var body = found[m].text;
              ${bool(normalizeSpaces)} ? body = __normalise(body) : null;
              out += "\\n--- " + found[m].label + " (" + found[m].text.length + " chars) ---\\n" +
                __trim(body, ${max}) + "\\n";
            }
            __result__ = out;
          }
        }
      } catch (e) {
        __result__ = "ERROR reading text: " + e.message;
      }
    }
  `;
}

/**
 * Find text without changing it — the missing half of find/replace.
 *
 * Reports each hit with its page and frame plus surrounding context, so a
 * caller can decide whether a replacement is safe before making it.
 */
export function findText({
  query, useGrep = false, caseSensitive = false, wholeWord = false,
  includeMasterPages = false, includeHiddenLayers = false, maxHits = 50, contextChars = 40,
}) {
  const hits = num(maxHits, { name: 'maxHits', min: 1, max: 1000 });
  const ctx = num(contextChars, { name: 'contextChars', min: 0, max: 200 });
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${TEXT_HELPERS}
      try {
        ${RESET_FIND}
        ${useGrep ? `
          app.findChangeGrepOptions.includeMasterPages = ${bool(includeMasterPages)};
          app.findChangeGrepOptions.includeHiddenLayers = ${bool(includeHiddenLayers)};
          app.findGrepPreferences.findWhat = ${str(query)};
          var results = doc.findGrep();
        ` : `
          // caseSensitive and wholeWord belong to findChangeTextOptions;
          // findTextPreferences has no such properties.
          app.findChangeTextOptions.caseSensitive = ${bool(caseSensitive)};
          app.findChangeTextOptions.wholeWord = ${bool(wholeWord)};
          app.findChangeTextOptions.includeMasterPages = ${bool(includeMasterPages)};
          app.findChangeTextOptions.includeHiddenLayers = ${bool(includeHiddenLayers)};
          app.findTextPreferences.findWhat = ${str(query)};
          var results = doc.findText();
        `}

        var out = "";
        if (results.length === 0) {
          out = "No match for " + ${str(query)} +
            ${useGrep ? '" (GREP)"' : `" (case ${caseSensitive ? 'sensitive' : 'insensitive'}${wholeWord ? ', whole word' : ''})"`} +
            ". The document holds " + doc.stories.length + " story object(s).";
        } else {
          out = results.length + " match(es) for " + ${str(query)} + "\\n";
          var shown = Math.min(results.length, ${hits});
          for (var i = 0; i < shown; i++) {
            var r = results[i];
            var story = r.parentStory;
            var from = Math.max(0, r.index - ${ctx});
            var to = Math.min(story.length, r.index + r.length + ${ctx});
            var around = story.characters.itemByRange(from, to - 1).contents;
            if (around instanceof Array) { around = around.join(""); }
            var frames = r.parentTextFrames;
            var where = frames.length > 0 ? __frameLabel(frames[0]) : "(not placed)";
            out += "\\n[" + i + "] " + where + " | character " + r.index + "\\n    ..." +
              __normalise(String(around)) + "...";
          }
          if (results.length > shown) {
            out += "\\n\\n" + (results.length - shown) + " further match(es) not shown.";
          }
        }
        ${RESET_FIND}
        __result__ = out;
      } catch (e) {
        ${RESET_FIND}
        __result__ = "ERROR searching: " + e.message;
      }
    }
  `;
}

/**
 * Find and replace.
 *
 * Fixes the option placement: caseSensitive and wholeWord were being set on
 * app.findTextPreferences, which has no such properties, so every call raised
 * "Object does not support the property or method 'caseSensitive'". They
 * belong to app.findChangeTextOptions.
 */
export function findReplaceText({
  findText: query, replaceText, useGrep = false, caseSensitive = false, wholeWord = false,
  includeMasterPages = false, includeHiddenLayers = false, preview = false,
}) {
  if (query === undefined || query === '') {
    throw new Error("'findText' must not be empty");
  }
  if (useGrep && caseSensitive) {
    throw new Error(
      'GREP search has no caseSensitive option in InDesign; ' +
      'put (?i) at the start of the pattern for a case-insensitive match, ' +
      'or leave caseSensitive off — GREP is case sensitive by default'
    );
  }
  return `
    if (app.documents.length === 0) {
      __result__ = "No document open.";
    } else {
      var doc = app.activeDocument;
      ${TEXT_HELPERS}
      try {
        ${RESET_FIND}
        ${useGrep ? `
          app.findChangeGrepOptions.includeMasterPages = ${bool(includeMasterPages)};
          app.findChangeGrepOptions.includeHiddenLayers = ${bool(includeHiddenLayers)};
          app.findGrepPreferences.findWhat = ${str(query)};
          app.changeGrepPreferences.changeTo = ${str(replaceText === undefined ? '' : replaceText)};
          var hits = doc.findGrep();
        ` : `
          app.findChangeTextOptions.caseSensitive = ${bool(caseSensitive)};
          app.findChangeTextOptions.wholeWord = ${bool(wholeWord)};
          app.findChangeTextOptions.includeMasterPages = ${bool(includeMasterPages)};
          app.findChangeTextOptions.includeHiddenLayers = ${bool(includeHiddenLayers)};
          app.findTextPreferences.findWhat = ${str(query)};
          app.changeTextPreferences.changeTo = ${str(replaceText === undefined ? '' : replaceText)};
          var hits = doc.findText();
        `}

        var out = "";
        if (hits.length === 0) {
          out = "No match for " + ${str(query)} + ", nothing replaced.";
        } else if (${bool(preview)}) {
          out = hits.length + " match(es) for " + ${str(query)} +
            ". Nothing was changed (preview). Call again with preview: false to replace.";
        } else {
          var changed = ${useGrep ? 'doc.changeGrep()' : 'doc.changeText()'};
          out = "Replaced " + changed.length + " of " + hits.length +
            " match(es) of " + ${str(query)} + " with " +
            ${str(replaceText === undefined ? '' : replaceText)} + ".";
          if (changed.length !== hits.length) {
            out += " Some matches were not changed - they may sit on a locked layer " +
              "or a master page that is not included.";
          }
        }
        ${RESET_FIND}
        __result__ = out;
      } catch (e) {
        ${RESET_FIND}
        __result__ = "ERROR in find/replace: " + e.message;
      }
    }
  `;
}
