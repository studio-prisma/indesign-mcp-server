# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `apply_effect` - all nine effects and the sixteen blend modes, replacing the
  shadow-only `apply_shadow`.
- `create_gradient`, `format_table`, `format_paragraph` - gradients, table cell
  formatting and paragraph settings, none of which the server could do.

- `npm run verify-api` - checks every DOM property and enum member the server
  writes against the running InDesign and fails if one is missing. This class
  of bug is invisible to code review and to the test suite; only the
  application can answer it.

- `format_object`, `apply_shadow`, `transform_content`, `format_text` -
  changing fill, stroke, corners, opacity, shadow, the artwork inside a frame,
  and character formatting on objects that already exist. Creating an object
  was covered; changing one afterwards was not.

- `align_objects`, `distribute_objects`, `group_objects`, `ungroup_objects`,
  `transform_object` - arranging and transforming, none of which the server
  could do.
- `thread_text_frames` - run a story across frames and pages. Takes
  `readingOrder: true` to thread by position, because the index order is
  inverted and threading by ascending index runs the story backwards up the
  page.
- `set_text_frame_options` (columns, gutter, inset, vertical alignment) and
  `set_text_wrap`.
- `list_master_pages`, `apply_master_page`, `insert_page_number` - the basis
  for multi-page documents.
- `list_links`, `update_links` - a missing link exports at preview resolution
  without raising anything.
- `undo` - a recovery path when a call did the wrong thing.
- `inspect_page` - every object on a page with type, position, size, layer and
  state, front to back. The index it prints addresses the object in the tools
  below.
- `check_layout` - overset text, frames with no artwork and no fill, objects
  past the page edge, and overlapping objects with the shared area.
- `move_object`, `resize_object`, `delete_object`, `arrange_object`,
  `fit_frame` - the server could create objects but not move, resize, delete
  or restack them.

### Changed

- `apply_shadow` is gone, replaced by `apply_effect`. Adding a second tool
  beside it would have meant two ways to do the same thing.
- `verify-api` now also covers the effect settings objects, table cells,
  paragraph attributes and gradients: 238 properties and enum members.

- `place_image` verifies that the import produced artwork instead of reporting
  success either way. A malformed SVG leaves an empty frame behind in
  InDesign without raising; the tool now removes it and returns an error
  naming the file. On success it reports frame and artwork bounds and warns
  when the artwork is cropped.
- `place_image` handles every fit option it accepts. `FILL_PROPORTIONALLY` and
  `APPLY_FRAME_FITTING_OPTIONS` were in the allowed list but missing from the
  switch, so passing either applied no fit at all and left the image at its
  original size inside the frame.
- `fontSize` descriptions state that the value is in points while the geometry
  parameters are in millimetres, and a point size below 4 pt comes back with a
  note suggesting the conversion.

### Fixed

- `export_pdf`, `export_images`, `export_epub` and `preflight_document` each
  set a property InDesign 21.5 does not have, which aborts the whole call
  rather than being ignored. Corrected: `includeBleedMarks` to `bleedMarks`,
  `includeSlugArea` to `includeSlugWithPDF`, `outputIntention` dropped,
  image `resolution` to `exportResolution`, image `useDocumentBleedWithPDF`
  to `useDocumentBleeds`, and `app.epubExportPreferences` removed - it no
  longer exists, so EPUB exports with the application's current settings.
- `preflight_document` used `doc.preflightProcesses` (the collection is on
  `app` and takes the document), read `preflightResultsData` (it is
  `aggregatedResults`), and did not wait for the asynchronous process to
  finish before reading its results.
- Exports now report a missing output file instead of assuming success.

- `create_rectangle` set `rect.cornerRadius`, which a rectangle does not have -
  passing a corner radius raised at runtime. Each corner carries its own
  radius and option; all four are now set.
- Four tool schemas offered `JUSTIFY` as an alignment. `Justification` has no
  such member, so the validator rejected a value the tools themselves
  suggested. Replaced with the four `_JUSTIFIED` members.

- The confirmation gate for destructive operations did not gate.
  `validateDestructiveOperation` called an async method that only throws,
  without awaiting it, so the rejection surfaced as an unhandled rejection
  while the caller carried on. Affected close without saving, delete page,
  the exports, package and data merge.


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

[Unreleased]: https://github.com/studio-prisma/indesign-mcp-server/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/studio-prisma/indesign-mcp-server/releases/tag/v1.0.0
