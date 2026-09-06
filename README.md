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
