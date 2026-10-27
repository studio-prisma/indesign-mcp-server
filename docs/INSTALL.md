# Installation: InDesign MCP Server

Step by step, in this order. Every step names the point at which to stop.

---

## 0. Read first: what this server can do on your machine

The server lets an AI client drive a running InDesign. Within the limits below
it can open, change, save, export and close documents, and read and write
files.

- **File access is confined** to the directories in `INDESIGN_ALLOWED_DIRS`.
  Without that variable the limit is your **home directory** — that includes
  autostart folders and `~/.ssh`. Set it (step 4).
- **Prompt injection is the realistic attack.** Text inside a document, a file
  name or an image can carry instructions to the model. The server validates
  every argument and refuses paths outside the allowed directories, but it
  cannot tell a legitimate request from an injected one. Do not run it
  unattended on documents from untrusted sources.
- **`INDESIGN_ALLOW_ARBITRARY_CODE=1` switches every check off.** It unlocks a
  tool that runs any ExtendScript. Do not set it.
- **Undo is one step per tool call.** A call that went wrong can be taken back
  with a single Undo in InDesign.

---

## 1. Check the prerequisites

| Check | Command | Expected |
|---|---|---|
| Node | `node --version` | 18 or newer (20 or newer for the tests) |
| InDesign | start it | running, no modal dialog open |
| Same user context | — | InDesign and Node both elevated or both not |

**Stop if** InDesign runs as administrator and your terminal does not (or the
other way round). COM isolates across integrity levels and Node will not find
InDesign.

---

## 2. Get the code

From the [latest release](https://github.com/studio-prisma/indesign-mcp-server/releases/latest)
(`indesign-mcp-server-<version>.tgz`, with a signed build-provenance
attestation) or a checkout of the tag:

```bash
git clone https://github.com/studio-prisma/indesign-mcp-server.git
cd indesign-mcp-server
git checkout v<version>
npm ci --omit=dev
```

Check the downloaded package, if you used one:

```bash
gh attestation verify indesign-mcp-server-<version>.tgz --repo studio-prisma/indesign-mcp-server
```

**Stop if** the verification fails.

---

## 3. Smoke test, read-only

```bash
npm run smoke
```

Expected:

```
InDesign : Adobe InDesign | <version>
Result   : reachable
```

It reads the application name and version and touches no document.

**Stop if** it reports *not reachable*. On Windows check the registered ProgID:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

If yours is missing from `WIN_PROGIDS` in `lib/indesign-driver.js`, add it
there.

---

## 4. Choose the working folder

Create one folder for the documents the AI may touch, for example
`C:\InDesign-Work` or `~/InDesign-Work`. Not your home directory, not a cloud
sync root, not a folder that holds anything executable.

Several folders are separated by the platform delimiter: `;` on Windows, `:`
on macOS. Once the variable is set, the home directory is **not** allowed in
addition.

---

## 5. Register the server in Claude Desktop

Configuration file:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/index.js"],
      "env": {
        "INDESIGN_ALLOWED_DIRS": "<your working folder>"
      }
    }
  }
}
```

Restart Claude Desktop. The server appears in the tool list as `indesign`.

**Stop if** it does not appear: open the Claude Desktop MCP log, a wrong path
in `args` is the usual cause.

Then add the resource `indesign://guide` through the **+** in the chat input
before starting work. It explains indices, units and silent failures and saves
many calls that go nowhere.

---

## 6. Functional test

In a new chat, in this order:

1. "Show me the open documents." — lists them or says there are none.
2. "Create a new A4 document and put a text frame with 'Test' on page 1." —
   document appears in InDesign.
3. "Export it as PDF to `<working folder>/test.pdf`." — file exists.
4. Undo once in InDesign — the last change disappears.
5. "Close the document without saving." — document closes.

---

## 7. Security gate

| # | Ask the AI to … | Expected |
|---|---|---|
| 1 | export the document to a folder **outside** the working folder | `Access denied: '…' is outside the allowed directories (…)` |
| 2 | export to `C:\Windows\x.pdf` (or `/etc/x.pdf`) | `Access denied` |
| 3 | run custom ExtendScript (`execute_indesign_code`) | `Arbitrary code execution is disabled for security reasons.` |
| 4 | call `call_method` with `save` or `exportFile` | refused with `Invalid value` (not on the method list) |

All four must hold. If one does not, remove the server from the configuration
and report it privately (see [SECURITY.md](../SECURITY.md)).

---

## 8. Kill switch

- **Immediately:** quit Claude Desktop, or remove the `indesign` entry from the
  configuration and restart it. The server runs only as a child process of the
  client.
- **A change you do not want:** Undo in InDesign, one step per tool call.

---

## 9. Update

```bash
git fetch --tags
git checkout v<new version>
npm ci --omit=dev
```

Read the CHANGELOG section of the new version first; a major version changes
configuration behaviour (3.0.0: `INDESIGN_ALLOWED_DIRS` replaces the home
directory instead of adding to it). Restart Claude Desktop, then repeat step 3
and the security gate.

---

## Known limits

- Verified on Windows 11 with InDesign 21.5. Other versions should work
  through the generic ProgID but are untested.
- macOS support is inherited from upstream and not covered by the end-to-end
  tests.
- Tools act on the active document; there is no document selection.
- `npm run verify-api` checks the DOM names this server writes against the
  running InDesign. Run it after every InDesign upgrade.
