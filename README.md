# InDesign MCP Server

[![Validate](https://github.com/studio-prisma/indesign-mcp-server/actions/workflows/validate.yml/badge.svg)](https://github.com/studio-prisma/indesign-mcp-server/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![InDesign 21.x](https://img.shields.io/badge/InDesign-21.x-ff3366.svg)](https://www.adobe.com/products/indesign.html)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-339933.svg)](https://nodejs.org/)
[![Tools 83](https://img.shields.io/badge/tools-83-6236ff.svg)](#what-it-can-do)
[![Tests 268](https://img.shields.io/badge/tests-268-brightgreen.svg)](#tests)

Drive Adobe InDesign from Claude Desktop or any MCP client — build documents,
place text and images, restyle and rearrange what is already there, check the
result before exporting it. 83 tools, every argument validated, plus generic
access to the rest of the DOM.

**Windows** (PowerShell + COM) and **macOS** (osascript).

**[Deutsche Fassung →](README.de.md)**

> Fork of [lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server),
> which is macOS-only. This fork adds Windows support, validates every tool
> argument, reports what the document actually looks like, and comes with a
> test suite. See [Differences from upstream](#differences-from-upstream).

> Maintained by **studio-prisma**.

---

## Why this exists

Two things make scripted InDesign work harder than it looks, and both are
addressed here.

**A server can tell you what it did, but not what the page looks like.** An
image import that silently produced nothing still answers "placed"; a text
frame that cannot show its content still answers "created". `inspect_page` and
`check_layout` close that gap, and the tools report the document state rather
than their own success.

**Property names drift between InDesign versions,** and a name the current
version lacks does not fail quietly — it aborts the whole call, so the tool
looks broken for unrelated reasons. `npm run verify-api` checks every name
this server writes against the running application.

---

## Requirements

- Node 18 or newer for the server; Node 20 or newer for the test suite
- Adobe InDesign, **running**, in the same user context as Node

The second point is not a formality. COM isolates across integrity levels: if
InDesign runs elevated and Node does not, or the other way round, Node will not
find the COM object.

## Setup

```bash
npm ci
npm run smoke
```

`npm run smoke` reads the application name and version and touches no document:

```
Platform : { "platform": "win32", "mode": "windows-com", … }
InDesign : Adobe InDesign | 21.5.1.73

Result   : reachable
```

If it reports *not reachable*, check the registered ProgID:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

If yours is missing from `WIN_PROGIDS` in
[lib/indesign-driver.js](lib/indesign-driver.js), add it there.

## Using it with Claude Desktop

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["<path-to-repo>/index.js"],
      "env": {
        "INDESIGN_ALLOWED_DIRS": "<path-to-your-working-folder>"
      }
    }
  }
}
```

`INDESIGN_ALLOWED_DIRS` confines every file operation to the listed
directories. The separator is the platform's path delimiter — `;` on Windows,
`:` on macOS. Keep it narrow: a working folder, not your home directory.

Do **not** set `INDESIGN_ALLOW_ARBITRARY_CODE`. It unlocks a tool that runs
arbitrary ExtendScript and bypasses every check described here.

---

## What it can do

| Area | Tools | What it covers |
|---|:--:|---|
| **[Seeing the document](#seeing-the-document--18-tools)** | 18 | What is on the page, where, on which layer — and what is wrong with it |
| **[Building pages](#building-pages--21-tools)** | 21 | Documents, pages, frames, images, tables, layers, threading |
| **[Changing what is there](#changing-what-is-there--18-tools)** | 18 | Move, resize, restack, align, group, transform, effects |
| **[Text and styles](#text-and-styles--16-tools)** | 16 | Editing, formatting, find and replace, styles and colours |
| **[Output](#output--7-tools)** | 7 | PDF, images, EPUB, package, preflight |
| **[Anything else](#anything-else--3-tools)** | 3 | Generic access to the rest of the DOM |

### Seeing the document — 18 tools

The half that matters most, because the rest is guesswork without it.

`inspect_page` lists every object with type, position, size, layer and state.
`check_layout` reports what is *wrong*: text that overflows its frame, frames
with no artwork and no fill, objects past the page edge, and overlapping
objects with the shared area. `get_text_content` reads text at document, page,
frame or selection scope; `find_text` searches without changing anything,
reporting each hit with its page, frame and surrounding context.

Also `inspect_object`, `get_document_info`, `list_text_frames`, `list_layers`,
`list_styles`, `list_color_swatches`, `list_master_pages`, `list_links`,
`get_selected_objects`, `analyze_embedded_objects`, `analyze_text_problems`,
`find_typography_issues`, `list_grep_searches`, `preflight_document`.

### Building pages — 21 tools

`create_document`, `open_document`, `save_document`, `close_document`,
`add_page`, `delete_page`, `duplicate_page`, `navigate_to_page`,
`create_text_frame`, `create_rectangle`, `create_ellipse`, `place_image`,
`create_table`, `populate_table`, `create_layer`, `set_active_layer`,
`insert_markdown_text`, `apply_master_page`, `insert_page_number`,
`thread_text_frames`, `data_merge`.

`place_image` verifies that the import produced artwork rather than reporting
success either way — a malformed SVG (a duplicate `xmlns` is enough) otherwise
leaves an empty frame behind silently.

### Changing what is there — 18 tools

`move_object`, `resize_object`, `delete_object`, `arrange_object`,
`fit_frame`, `transform_object`, `transform_content`, `format_object`,
`apply_effect`, `create_gradient`, `align_objects`, `distribute_objects`,
`group_objects`, `ungroup_objects`, `set_text_wrap`,
`set_text_frame_options`, `format_table`, `undo`.

`transform_object` changes the frame; `transform_content` changes the artwork
inside it, which is how you crop by hand. `apply_effect` covers all nine
effects and the sixteen blend modes.

### Text and styles — 16 tools

`edit_text_frame`, `format_text`, `format_paragraph`, `find_replace_text`,
`clean_imported_text`, `fix_typography_in_selection`, the paragraph, character
and object style tools, plus `create_color_swatch` and `apply_color`.

`format_text` and `format_paragraph` change placed text without defining a
style first.

### Output — 7 tools

`export_pdf`, `export_images`, `export_epub`, `package_document`,
`update_links`, `view_document`, `zoom_to_page`. Each export checks that a file
actually arrived.

### Anything else — 3 tools

A tool per task cannot cover InDesign; the DOM has thousands of properties.
`inspect_object`, `set_properties` and `call_method` reach all of them.

```json
{ "target": { "kind": "pageItem", "objectIndex": 2 },
  "properties": { "nonprinting": true,
                  "transparencySettings.blendingSettings.knockoutGroup": true } }
```

`inspect_object` without a property list enumerates everything readable, so you
can find out what an object offers without documentation. Values are numbers,
strings, booleans and arrays, plus `{ enum: "Justification.CENTER_ALIGN" }`,
`{ swatch: "Black" }` and `{ measure: 20, unit: "mm" }`. Each assignment is
guarded separately, so a property this InDesign version lacks is reported
without taking the others with it.

**This is not `execute_indesign_code` by another route.** These tools pass
data, never statements: property paths are checked segment by segment against
`^[A-Za-z][A-Za-z0-9_]*$`, so no call, operator or bracket fits in one; enum
references must be exactly `Name.MEMBER`; values go through the same escaping
as everywhere else; methods come from a fixed list that excludes `doScript`,
`quit` and `eval`. 31 tests cover that boundary.

---

## Working with it

Three things that will otherwise cost you an afternoon.

### Indices shift, and they run front to back

`page.allPageItems` and `page.textFrames` are ordered **front to back**: index
0 is the most recently created object, not the first. Verified against
InDesign 21.5. Indices also shift whenever objects are added, deleted, grouped
or restacked — read `inspect_page` again after any of those rather than reusing
an index.

For threading, prefer `readingOrder: true` over listing frames by index. The
inverted order means threading by ascending index runs the story *backwards up
the page*.

### Points and millimetres

Geometry is in millimetres; `fontSize` is in points, because that is what
InDesign uses for type. A millimetre value produces text at roughly a third of
the intended size, and nothing rejects it — 10 pt is a valid size. The tool
descriptions say so, and a size below 4 pt comes back with a note.
1 mm is about 2.83 pt.

### When a tool fails for no visible reason

InDesign does not ignore a property it does not have — it raises, and the whole
call aborts. A tool that sets one name too many fails entirely, which looks
like the tool doing nothing.

```bash
npm run verify-api
```

checks every DOM property and enum member this server writes against the
running application and exits non-zero if one is missing. Run it after an
InDesign upgrade, and first whenever something misbehaves without explanation.

Two other causes worth knowing. **A modal dialog** in InDesign blocks every
scripted call until it is dismissed, and the message arrives in the interface
language — the driver now says so explicitly. And InDesign's **smart quotes**
replace straight quotes in text you set, which matters when you need exact
characters.

---

## Differences from upstream

| | upstream | here |
|---|---|---|
| Platform | macOS only, via `osascript` | Windows via PowerShell + COM; macOS unchanged |
| Temp files | fixed names in the repository directory | per-process directory under `os.tmpdir()`, mode 0700, cleaned up on exit |
| Arguments | interpolated into script source | typed and validated at 366 interpolation sites |
| Feedback | reports what it did | reports what the document looks like |
| Tests | none | 268 |

Argument validation lives in [lib/jsx-safe.js](lib/jsx-safe.js): `str`, `num`,
`index`, `measure`, `bool`, `enumOf`, `jsxPath`, `json`, `numList`. Values that
cannot be represented are rejected rather than passed through.

Several API names had drifted between InDesign versions and were corrected
against 21.5 — `bleedMarks`, `includeSlugWithPDF`, `exportResolution`,
`useDocumentBleeds`, `findChangeTextOptions.caseSensitive`,
`topLeftCornerRadius`, the `_JUSTIFIED` alignment members — and
`app.epubExportPreferences` no longer exists at all. `verify-api` exists so
that does not have to be found one tool at a time again.

---

## Tests

```bash
npm test              # 268 cases, no InDesign required
npm run lint          # syntax across all modules
npm run verify-api    # DOM names against the running application
```

The suite mocks the platform driver, so it runs on Linux and Windows in CI
without InDesign. It checks that every tool produces parseable ExtendScript —
`node --check index.js` validates the server but never the generated script —
and that escape-attempt payloads are rejected or reduced to escaped literals.
It includes a counter-test against deliberately insufficient escaping, so a
green run is evidence rather than the absence of a finding.

### Against a running InDesign

```bash
npm run smoke          # read-only
npm run e2e            # document -> text -> PDF -> verify -> close
npm run e2e-layout     # inspection and object manipulation
npm run e2e-arrange    # aligning, threading, masters
npm run e2e-style      # transforms and appearance
npm run e2e-effect     # effects, gradients, tables, paragraphs
npm run e2e-export     # exports and preflight
npm run e2e-generic    # generic access, including its boundary
```

Each labels the document it creates and closes only that one, comparing the
document count before and after — a document you have open in parallel cannot
be affected. They read values back out of the document rather than trusting
return messages.

---

## Known limits

- Windows is verified on Windows 11 with InDesign 21.5. Other versions should
  work through the generic ProgID but are untested.
- macOS support is inherited from upstream and not covered by the end-to-end
  tests here.
- Tools act on the active document; there is no document selection.
- Not wrapped, though reachable through `set_properties`: interactive features
  (hyperlinks, buttons), articles, table of contents, index, books, the
  pathfinder, guides and the ink manager.
- Upstream does not carry these changes. Re-check after every merge from it.

## Licence

MIT. Original work © lucdesign, modifications © studio-prisma. See
[LICENSE](LICENSE).
