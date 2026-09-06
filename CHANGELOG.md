# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-09-06

Undo becomes usable, the server can say things a tool description cannot, and
six object types and formats that were out of reach are now covered. Also
fixes 2.1.0, whose stroke change had no effect at all.

### Fixed

- **The stroke fix in 2.1.0 did not work.** It set the colour and then the
  weight; a `strokeWeight` assignment made *after* the colour pulls the item
  defaults back, and the object keeps the black 1 pt stroke it was supposed to
  lose. The two orders look identical and only one of them does anything.
  Reproduced against InDesign 21.5 on rectangles, polygons and text frames,
  and now covered by a test that reads the order out of the generated script.

  The same wrong order sat in `format_object`, where it only showed when both
  `strokeColor` and `strokeWeight` were passed in one call.

  2.1.0 shipped with the honest note that the end-to-end check could not run
  because a document was open. This is what that check would have caught.

### Added

- **One undo step per tool call, named after the tool.** `DoScript` takes an
  undo mode and a name; the server was passing neither, so InDesign recorded
  one history entry per internal operation, labelled in the interface
  language. Undoing a single call meant clicking undo an unknown number of
  times, past entries reading "Resize". Now one call is one step, the history
  says `create_rectangle`, and one undo reverses the whole call however many
  objects it touched.

  The `undo` tool itself runs ungrouped — InDesign refuses `doc.undo()` inside
  a script that is being recorded as one undo step.

  `withArguments` has to be an empty array, not `$null`: passing null raises a
  NullReferenceException inside the COM interop before InDesign sees the call.

- **MCP resources.** `indesign://guide` and `indesign://tools`. A tool
  description is read when the model is already reaching for that tool, which
  makes it the wrong place for what you need to know beforehand: that indices
  run front to back, that geometry is millimetres while type is points, what a
  silent failure means and what to do about it. A client can load a resource
  before it starts choosing tools.

- `create_polygon` — regular polygons and stars. The corner path is computed
  and written to `paths[0].entirePath`; a polygon added without one is a
  rectangle in disguise.
- `create_line` — a straight line between two points, with an optional stroke
  style.
- `create_anchored_frame` — a frame anchored in running text, so it moves when
  the text reflows. It has to be *created* on the insertion point: InDesign
  21.5 refuses both `move()` and `duplicate()` to one, so an object that
  already exists cannot be taken into the text.
- `create_section` and `list_sections` — page-numbering sections, which is how
  front matter numbers i, ii, iii while the body starts again at 1.
- `export_idml` — the interchange format. Opens in InDesign CS4 and newer and
  in other tools, so it is the way to hand a layout to somebody who cannot
  open the .indd. Not reachable through `call_method`, because `exportFile`
  needs a File object and the generic layer passes data, never constructed
  objects.

### Changed

- The server reports the version from `package.json`. It was a second literal
  and had said 1.0.0 since 1.0.0.
- `verify-api` covers the new surface: polygons, graphic lines, sections,
  anchored object settings, and the `PageNumberStyle`, `AnchorPosition`,
  `UndoModes` and `ExportFormat.INDESIGN_MARKUP` members. 267 names checked.
  `AnchoredPosition` does not exist — the enum is `AnchorPosition`; and
  `PageNumberStyle` has neither `KATAKANA_MODERN` nor `FULL_WIDTH_ARABIC`,
  though both appear in older references.
- `npm run e2e-shape` — end-to-end for the new tools, reading the corner count
  off the polygon's own path, the page names off the pages, and the anchored
  frame's parent out of the story.

## [2.1.0] - 2026-09-06

### Changed

- **A new frame no longer carries InDesign's default stroke.** Every object
  made by `create_text_frame`, `create_rectangle`, `create_ellipse`,
  `create_table` and `place_image` was born with the application default of
  1 pt black, because nothing set a stroke and InDesign fills that in. Nobody
  asked for it — a caller who wants a stroke names one. It is invisible on a
  dark ground, draws a box around the element on a light one, and shows up in
  print long after it stopped being noticeable on screen at 13 % zoom. All
  five creation sites now clear it unless `strokeColor` is given.

  This changes how documents built by existing calls look, so it is worth
  reading before upgrading. Nothing breaks: every call still works, and
  `strokeColor` still applies a stroke exactly as before.

  `create_text_frame` had no `strokeColor` parameter at all, so its frames
  could not avoid the stroke by any argument. Use `format_object` to put one
  back.

  The stroke is cleared per object, never through the application preference —
  changing that would reach outside the document and alter how InDesign
  behaves for everything else.

## [2.0.0] - 2026-09-06

A day of using the server against real documents, and fixing what that turned
up. The version is a major because `apply_shadow` is gone: a call that worked
before does not exist any more.

The theme running through it: the server could report what it did, but not
what the document looked like afterwards, and several tools set property names
InDesign 21.5 no longer has — which does not fail quietly, it aborts the whole
call and looks like the tool doing nothing.

### Added

**Seeing the document**

- `inspect_page` — every object with type, position, size, layer and state,
  front to back. The index it prints addresses the object in the tools below.
- `check_layout` — overset text, frames with no artwork and no fill, objects
  past the page edge, and overlapping objects with the shared area.
- `find_text` — search without changing anything, reporting each hit with its
  page, frame and context. `find_replace_text` always replaced, so there was no
  way to look before changing.
- `inspect_object` — read any object, or list everything it offers.

**Changing what exists**

- `move_object`, `resize_object`, `delete_object`, `arrange_object`,
  `fit_frame` — the server could create objects but not move, resize, delete
  or restack them.
- `format_object`, `transform_content`, `format_text`, `format_paragraph` —
  fill, stroke, corners, opacity, the artwork inside a frame, character and
  paragraph formatting on objects that already exist.
- `apply_effect` — all nine effects and the sixteen blend modes.
- `create_gradient`, `format_table` — gradients and table cell formatting.
- `align_objects`, `distribute_objects`, `group_objects`, `ungroup_objects`,
  `transform_object`.

**Multi-page documents**

- `thread_text_frames` — run a story across frames and pages. Takes
  `readingOrder: true` to thread by position, because the index order is
  inverted and threading by ascending index runs the story backwards up the
  page.
- `set_text_frame_options` (columns, gutter, inset, vertical alignment) and
  `set_text_wrap`.
- `list_master_pages`, `apply_master_page`, `insert_page_number`.
- `list_links`, `update_links` — a missing link exports at preview resolution
  without raising anything.
- `undo` — a recovery path when a call did the wrong thing.

**Generic access**

- `set_properties`, `call_method` — reach every property of every object, for
  everything the specialised tools do not wrap. Property paths, enum
  references and method names are validated as data; none can carry code,
  which is what separates this from `execute_indesign_code`.

**Tooling**

- `npm run verify-api` — checks every DOM property and enum member the server
  writes against the running InDesign and fails if one is missing. This class
  of bug is invisible to code review and to the test suite; only the
  application can answer it.
- End-to-end scripts per area, each labelling the document it creates and
  closing only that one.

### Changed

- **Windows support.** Scripts run through PowerShell and the InDesign COM
  interface. macOS keeps using `osascript`.
- **Every tool argument is validated** before it becomes part of an
  ExtendScript source — 366 interpolation sites. Values that cannot be
  represented are rejected rather than passed through.
- **`apply_shadow` is gone,** replaced by `apply_effect`. A second tool beside
  it would have meant two ways to do the same thing.
- `get_text_content` takes a `scope` — document, page, frame or selection. It
  previously looked only at the selection or one named frame, so with neither
  it returned nothing and no explanation.
- `place_image` verifies the import produced artwork, removes the empty frame
  and names the file when it did not, and reports whether the artwork is
  cropped.
- Temp files moved to a per-process directory under `os.tmpdir()` with random
  names and mode 0700, cleaned up on exit. Concurrent calls no longer collide.
- `@modelcontextprotocol/sdk` from `^0.5.0` to `^1.30.0`.
- The driver explains two failures it used to pass through raw: a modal dialog
  blocking every scripted call, and the COM integrity-level mismatch.

### Fixed

**Property names this InDesign version does not have.** Each of these aborted
the whole call:

- `findTextPreferences.caseSensitive` and `.wholeWord` → they belong to
  `findChangeTextOptions`. Every case-sensitive search failed outright.
- `rectangle.cornerRadius` → each corner carries its own
  (`topLeftCornerRadius` and siblings).
- `Justification.JUSTIFY` → does not exist; four tool schemas offered it, so
  the validator rejected a value the tools themselves suggested.
- `pdfExportPreferences.includeBleedMarks` → `bleedMarks`,
  `.includeSlugArea` → `includeSlugWithPDF`, `.outputIntention` → dropped.
- Image export `.resolution` → `exportResolution`,
  `.useDocumentBleedWithPDF` → `useDocumentBleeds`.
- `app.epubExportPreferences` → gone entirely; EPUB exports with the
  application's current settings.

**Other**

- The destructive-operation confirmation did not gate.
  `validateDestructiveOperation` called an async method that only throws
  without awaiting it, so the rejection surfaced as an unhandled rejection
  while the operation carried on. Affected close without saving, delete page,
  the exports, package and data merge.
- `preflight_document` used `doc.preflightProcesses` (the collection is on
  `app` and takes the document), read `preflightResultsData` (it is
  `aggregatedResults`), and did not wait for the asynchronous process.
- Return values: scripts return their result as a trailing expression, which
  the executor assigns to a result variable. That assignment was applied per
  line, so an expression spanning several lines received the prefix in the
  middle — a syntax error. `create_document` was affected.
- `fix_typography_in_selection` contained a literal made of three quote
  characters, which is not valid JavaScript.
- `insert_markdown_text` emitted a template literal into the ExtendScript;
  ExtendScript is ES3 and has no template literals.
- `INDESIGN_ALLOWED_DIRS` split on `:`, tearing Windows drive letters apart.
- Path validation was POSIX-only, leaving `C:\Windows\System32` unprotected.
- Exports report a missing output file instead of assuming success.
- `place_image` handled only four of the six fit options it accepted, so
  passing `FILL_PROPORTIONALLY` applied no fit at all — which looks exactly
  like the image being cropped.

## [1.0.0] - 2026-09-06

First release of this fork of
[lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server)
(upstream commit `3e3f367`).

### Added

- **Windows support.** Scripts run through PowerShell and the InDesign COM
  automation interface. macOS keeps using `osascript` and is unchanged.
- **Argument validation** for every value that becomes part of an ExtendScript
  source, across the fifty script templates. Helpers in `lib/jsx-safe.js`
  cover strings, numbers, indices, measurements, booleans, enums, file paths
  and data structures. Values that cannot be represented are rejected rather
  than passed through.
- **Test suite**, 75 cases, no running InDesign required: every tool method
  must produce parseable ExtendScript, and escape-attempt payloads must be
  either rejected or reduced to escaped literals. Includes a counter-test
  against deliberately insufficient escaping, so that a green run is evidence
  rather than the absence of a finding.
- `scripts/smoke.mjs` - read-only reachability check.
- `scripts/e2e.mjs` - full chain against a running InDesign: create a
  document, place text, export PDF, verify the text, close again. Closes only
  the document it created, identified by label, so a document open in
  parallel is unaffected.

### Changed

- Temp files moved from fixed names in the repository directory to a
  per-process directory under `os.tmpdir()` with random names and mode 0700,
  cleaned up on exit, SIGINT and SIGTERM. Concurrent tool calls no longer
  collide.
- `INDESIGN_ALLOWED_DIRS` is split on the platform path delimiter. Splitting
  on `:` tore Windows drive letters apart.
- Path validation is platform-aware; a POSIX-only deny-list matches nothing
  on Windows.
- `@modelcontextprotocol/sdk` from `^0.5.0` to `^1.30.0`. No code changes
  were required.

### Fixed

- **Return values.** Scripts return their result as a trailing expression that
  the executor assigns to a result variable. That assignment was applied per
  line, so a trailing expression spanning several lines received the prefix in
  the middle - a syntax error. `create_document` was affected.
- **`fix_typography_in_selection`** contained a literal made of three quote
  characters, which is not valid JavaScript. The script failed to parse as
  soon as `fixQuotes` was set.
- **`insert_markdown_text`** emitted a template literal into the ExtendScript.
  ExtendScript is ES3 and has no template literals.

[Unreleased]: https://github.com/studio-prisma/indesign-mcp-server/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/studio-prisma/indesign-mcp-server/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/studio-prisma/indesign-mcp-server/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/studio-prisma/indesign-mcp-server/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/studio-prisma/indesign-mcp-server/releases/tag/v1.0.0
