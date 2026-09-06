# Security Policy

## Supported Versions

Only the latest minor release receives security fixes. Older tags are archived, not maintained.

| Version | Supported |
|---|---|
| `1.0.x` | yes |
| everything older | no |

## Reporting a Vulnerability

Use **[GitHub Security Advisories](https://github.com/studio-prisma/indesign-mcp-server/security/advisories/new)** — private by default. Do not open a public issue for a suspected vulnerability.

Include:

- affected version and host platform version
- what an attacker gains, not only what misbehaves
- reproduction steps, ideally against a clean install

Expected response: an acknowledgement within 7 days, an assessment within 30. This is a spare-time project, not a vendor with an on-call rotation — that is the honest number, not a target.

## In Scope

- A tool argument that reaches the ExtendScript source as code rather than as
  data. Escaping is the property this project exists to provide; a payload
  that leaves its string literal is a real finding.
- A file operation that escapes `INDESIGN_ALLOWED_DIRS`, including through
  symlinks, UNC paths, alternate data streams or path normalisation.
- Reaching `execute_indesign_code` without `INDESIGN_ALLOW_ARBITRARY_CODE`
  being set.
- A temp file that is readable or writable by another local user, or that
  survives process exit with document content in it.
- Command injection into the PowerShell or osascript runner.

A proof of concept is expected: the generated script text is enough, runtime
execution is not required.

## Out of Scope

- **The capabilities of the tools themselves.** Anything reachable through
  this server can create, open, export and delete documents. That is what the
  server is for. Restricting it is the operator's job, through
  `INDESIGN_ALLOWED_DIRS` and by not running the server unattended.
- **`execute_indesign_code` with `INDESIGN_ALLOW_ARBITRARY_CODE` set.** That
  switch exists to run arbitrary ExtendScript. It bypasses every check here by
  design, which is why it is off unless explicitly enabled.
- **Tools acting on `app.activeDocument`.** There is no document selection;
  a call can hit whichever document is in front. Documented, not a finding.
- Anything requiring an already-compromised account, or InDesign itself being
  compromised.
- Vulnerabilities in Adobe InDesign or in ExtendScript - report those to Adobe.
- Scanner output without a working proof of concept.

## Handling of Secrets

No credentials belong in this repository — not in tests, not commented out, not in fixtures. A secret that reached a commit is rotated first and removed second. The history stays readable either way.

## Disclosure

Coordinated. A fix ships first, the advisory follows once a patched release is available. Reporters are credited unless they ask not to be.
