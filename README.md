# indesign-mcp-server

An MCP server that drives Adobe InDesign from an MCP client such as Claude
Desktop. Create documents, place text and images, apply styles, export PDF —
about fifty tools in total.

Runs on **Windows** (PowerShell + COM) and **macOS** (osascript).

Deutsche Fassung: [README.de.md](README.de.md)

> This is a fork of [lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server),
> which is macOS-only. This fork adds Windows support, validates every tool
> argument before it reaches InDesign, and comes with a test suite. See
> [Differences from upstream](#differences-from-upstream).

---

## Requirements

- Node 18 or newer (developed and tested on Node 24)
- Adobe InDesign, **running**, in the same user context as Node

The second point is not a formality. COM isolates across integrity levels: if
InDesign runs elevated and Node does not (or the other way round), Node will
not find the COM object.

## Setup

```bash
npm ci
npm run smoke
```

`npm run smoke` only reads the application name and version. It does not touch
any document. Expected output:

```
Platform  : { "platform": "win32", "mode": "windows-com", … }
InDesign  : Adobe InDesign | 21.5.1.73

Result    : reachable
```

If it reports *not reachable*, check the registered ProgID first:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

If yours is missing from `WIN_PROGIDS` in
[lib/indesign-driver.js](lib/indesign-driver.js), add it there. The driver
tries versioned IDs first and falls back to the generic one.

## Using it with Claude Desktop

Add to `claude_desktop_config.json`:

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

`INDESIGN_ALLOWED_DIRS` restricts every file operation to the listed
directories. The separator is the platform's path delimiter — `;` on Windows,
`:` on macOS. Keep it narrow: point it at a working folder, not at your home
directory.

Do **not** set `INDESIGN_ALLOW_ARBITRARY_CODE`. It unlocks a tool that runs
arbitrary ExtendScript, which bypasses every check described below.

---

## Operating notes

ExtendScript is a capable runtime. Anything reachable through this server can
create, open, export and delete documents. That is the point of the server —
so run it deliberately:

- Start it when InDesign is intentionally open, not permanently from autostart.
- Keep `INDESIGN_ALLOWED_DIRS` narrow.
- Leave `INDESIGN_ALLOW_ARBITRARY_CODE` unset.

One behaviour is worth knowing: the tools operate on `app.activeDocument`. If
you are working on a document in parallel, a tool call can hit that document —
and `close_document` closes with `SaveOptions.NO`. When running against a live
InDesign session, know which document is in front.

---

## Differences from upstream

### Platform

| | upstream | here |
|---|---|---|
| Execution | `osascript` + `tell application "Adobe InDesign 2026"` | Windows: PowerShell + COM `DoScript`. macOS: unchanged |
| Temp files | fixed names in the repository directory | per-process directory under `os.tmpdir()`, random name, mode 0700, cleaned up on exit/SIGINT/SIGTERM |
| Argument passing | via file | via file, on both platforms. No argument ever goes over the command line |

Return values travel through a result file the ExtendScript writes itself, on
both platforms.

### Argument handling

Every tool argument is typed and validated before it becomes part of an
ExtendScript source — 366 interpolation sites across the fifty script
templates. The helpers live in [lib/jsx-safe.js](lib/jsx-safe.js):

| helper | for |
|---|---|
| `str` | text, names, style identifiers |
| `num`, `index` | sizes, counters, page and frame indices |
| `measure` | lengths with a unit, e.g. `geometricBounds` |
| `bool` | switches |
| `enumOf` | InDesign enums, against an allow-list |
| `jsxPath`, `validateFilePath` | file paths, restricted to allowed directories |
| `json`, `numList` | table data and colour values |

Values that cannot be represented are rejected with an error rather than
passed through. Path validation is platform-aware: the upstream deny-list was
POSIX-only (`/etc`, `/System`, `/bin`), which matches nothing on Windows.

### Fixed along the way

Three defects in the script templates, unrelated to platform support:

- **Return values.** Scripts return their result by evaluating a trailing
  expression, which the executor assigns to a result variable. That assignment
  was done per line, so a trailing expression spanning multiple lines received
  the prefix in the middle — a syntax error. `create_document` was affected.
- **`fix_typography_in_selection`** contained a literal made of three quote
  characters, which is not valid JavaScript. The script failed to parse as
  soon as `fixQuotes` was set.
- **`insert_markdown_text`** emitted a template literal into the ExtendScript.
  ExtendScript is ES3 and has no template literals.

---


---

## Working without seeing the page

The tools report what they did, not what the document looks like afterwards.
That gap is where wrong layouts come from: an image import that silently
produced nothing still answers "placed", a text frame that cannot show its
content answers "created", and nothing mentions that two frames overlap.

Three tools close it.

**`inspect_page`** lists every object with its type, position, size, layer and
state, front to back. The index it prints is the `objectIndex` the
manipulation tools take. Indices shift whenever objects are added, deleted or
reordered, so read it again after each of those.

**`check_layout`** reports what is wrong rather than what is there:

| finding | means |
|---|---|
| `OVERSET TEXT` | the frame cannot show all its content |
| `EMPTY FRAME` | no artwork and no fill — an import may have failed |
| `OFF PAGE` | the object extends past the page edge |
| `OVERLAP` | two objects intersect, with the area and which one is in front |

Run it after building a page and before exporting.

**`place_image`** now verifies that the import produced artwork. A malformed
SVG — a duplicate `xmlns` attribute is enough — leaves an empty frame behind
in InDesign without raising anything. The tool removes that frame and returns
an error naming the file, instead of reporting success. On success it returns
the frame and artwork bounds and warns when the artwork is cropped.

## Moving things

`move_object`, `resize_object`, `delete_object`, `arrange_object` and
`fit_frame` operate on the `objectIndex` from `inspect_page`. All measurements
are in millimetres, positions refer to the top-left corner.

`arrange_object` takes `BRING_TO_FRONT`, `BRING_FORWARD`, `SEND_BACKWARD` or
`SEND_TO_BACK` — use it when `check_layout` reports that the wrong object is
on top. `fit_frame` applies a fit option to something already placed:
`PROPORTIONALLY` fits the whole image inside the frame, `FILL_PROPORTIONALLY`
fills the frame and crops, `FRAME_TO_CONTENT` grows the frame instead.

`delete_object` requires `confirmDestructive: true`.

## Points and millimetres

Geometry is in millimetres; `fontSize` is in points, because that is what
InDesign uses for type. Passing a millimetre value produces text at roughly a
third of the intended size, and nothing rejects it — 10 pt is a perfectly
valid size. The tool descriptions say so explicitly, and a point size below
4 pt comes back with a note suggesting the conversion. 1 mm is about 2.83 pt.


## Arranging, flow and multi-page documents

`align_objects` and `distribute_objects` take a list of object indices.
Aligning to `ITEM_BOUNDS` needs two objects; against `PAGE_BOUNDS` or
`MARGIN_BOUNDS` one is enough, which is how you centre something on the page.
For distributing, `HORIZONTAL_SPACE` and `VERTICAL_SPACE` equalise the gaps —
usually what a row of cards wants — while the edge options equalise the
distance between those edges.

`group_objects` / `ungroup_objects` and `transform_object` (rotate, scale,
flip) complete the set. Rotation is absolute in degrees, counter-clockwise.

`thread_text_frames` runs a story from one frame into the next. Prefer
`readingOrder: true` with a `pageIndex` over listing frames by index, because
**the index order is inverted**: `page.textFrames` is ordered front to back,
so the last frame created is index 0. Threading by ascending index runs the
story backwards up the page. With `readingOrder` the frames are sorted top to
bottom and left to right instead. Either way the tool refuses when a later
frame already holds text, rather than discarding it.

`set_text_frame_options` sets columns, gutter, inset and vertical alignment.
`set_text_wrap` keeps text clear of an object.

`list_master_pages` and `apply_master_page` handle masters — read the list
first, since the default master carries a localised name. `insert_page_number`
places an automatic marker, which is the only numbering that survives page
reordering.

`list_links` and `update_links` cover placed files: a missing or out-of-date
link exports at preview resolution without raising anything, so check before
exporting. `undo` steps back through the document history when a call did the
wrong thing.

### A note on indices

Both `page.allPageItems` and `page.textFrames` are ordered **front to back** —
index 0 is the most recently created object, not the first. Verified against
InDesign 21.5. Indices also shift whenever objects are added, deleted,
grouped or restacked. Read `inspect_page` again after any of those rather than
reusing an index.



## Changing what already exists

Creating an object and changing one afterwards are different problems, and
only the first was covered. These four close the gap.

`format_object` sets fill, tint, stroke, stroke alignment, opacity and
corners. Colours are swatch names; an unknown name lists what the document
actually has rather than leaving the object unchanged. Pass `"None"` to
remove a fill or stroke.

`apply_shadow` adds or removes a drop shadow — offsets and blur in mm.

`transform_content` scales, moves or rotates the artwork **inside** a frame,
leaving the frame alone. That is the missing half of resizing: `resize_object`
changes the frame, `fit_frame` refits artwork to it, and this one lets you
crop or reposition by hand. It reports afterwards whether the artwork is
cropped.

`format_text` changes size, font, colour, alignment, leading and tracking on
text that is already placed, without defining a style, and warns if the change
makes the text overflow.

### Two names that are not what they look like

Both verified against InDesign 21.5, both previously wrong in this server:

- **A rectangle has no `cornerRadius`.** Each corner carries its own
  (`topLeftCornerRadius` and siblings), each with its own `...CornerOption`.
  `create_rectangle` used the non-existent property, so passing a corner
  radius raised at runtime. `format_object` sets all four.
- **`Justification` has no `JUSTIFY`.** The justified members are
  `LEFT_JUSTIFIED`, `RIGHT_JUSTIFIED`, `CENTER_JUSTIFIED` and
  `FULLY_JUSTIFIED`. Four tool schemas offered `JUSTIFY`, which the validator
  then rejected — the tool suggested a value it would not accept.


## Tests

```bash
npm test
```

75 cases, no running InDesign required:

- **[test/scripts.test.mjs](test/scripts.test.mjs)** — does each of the fifty
  tool methods produce parseable ExtendScript? `node --check index.js` only
  checks the server, never the generated script text, so a broken template
  would otherwise surface inside InDesign. Includes an ES3 deny-list, because
  Node parses more than ExtendScript accepts.
- **[test/injection.test.mjs](test/injection.test.mjs)** — escape-attempt
  payloads per argument type. Each must either be rejected or end up as an
  escaped literal. Includes a counter-test against deliberately insufficient
  escaping, so that a green run is evidence rather than the absence of a
  finding.

The harness ([test/harness.mjs](test/harness.mjs)) swaps the platform driver
for a collector and works on a copy of `index.js` in a temporary directory.
`index.js` itself is untouched.

### Against a running InDesign

```bash
npm run smoke          # read-only: name and version
node scripts/e2e.mjs   # document -> text -> PDF -> verify text -> close
```

[scripts/e2e.mjs](scripts/e2e.mjs) deliberately avoids the `close_document`
tool. It labels the document it creates and closes only what carries that
label, comparing the document count before and after. A document you have open
in parallel cannot be affected.

Text verification inside the PDF uses `pypdf` if installed. InDesign embeds
font subsets, so the character codes in the content stream are not ASCII and
the plain text is not there even after decompression. Without `pypdf` the
script checks the PDF structure only, and says so.

---

## Known limits

- Windows support is verified on Windows 11 with InDesign 21.5. Other versions
  should work through the generic ProgID but are untested.
- macOS support is inherited from upstream and unchanged; it is not covered by
  the end-to-end test here.
- The tools act on the active document. There is no document selection.
- Upstream does not carry these changes. Re-check after every merge from it.

## Licence

MIT. Original work © lucdesign, modifications © studio-prisma. See
[LICENSE](LICENSE).
