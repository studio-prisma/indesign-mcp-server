# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
