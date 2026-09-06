/**
 * indesign-driver.js
 * Platform driver for the InDesign MCP server.
 *
 *   win32  -> PowerShell + COM (InDesign.Application.DoScript)
 *   darwin -> osascript / AppleScript
 *
 * Scripts are always handed over as files, never on the command line. Temp
 * files live in a per-process directory under os.tmpdir() with unique names:
 * no collisions between concurrent calls, no artefacts in the repository.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// InDesign ScriptLanguage enum: idJavascript
const ID_JAVASCRIPT = 1246973031;

// Versioned ProgIDs first, generic one as a fallback. Which versioned ID
// exists depends on the installation; the generic entry covers the rest.
const WIN_PROGIDS = [
  'InDesign.Application.2026',
  'InDesign.Application.2025',
  'InDesign.Application',
];

const MAC_APP_NAMES = [
  'Adobe InDesign 2026',
  'Adobe InDesign 2025',
];

const DEFAULT_TIMEOUT_MS = 120000;

/** Per-process temp directory, mode 0700 where the OS honours it. */
function makeSessionDir() {
  const dir = path.join(
    os.tmpdir(),
    `indesign-mcp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const SESSION_DIR = makeSessionDir();

function cleanupSessionDir() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on('exit', cleanupSessionDir);
process.on('SIGINT', () => { cleanupSessionDir(); process.exit(130); });
process.on('SIGTERM', () => { cleanupSessionDir(); process.exit(143); });

function uniqueName(prefix, ext) {
  return path.join(
    SESSION_DIR,
    `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`
  );
}

/** Escaping for PowerShell single-quoted strings: ' -> '' */
function psSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

/** Escaping for AppleScript double-quoted strings. */
function asDoubleQuote(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Windows: build a PowerShell script that attaches to a running InDesign
 * instance over COM and runs the .jsx file.
 */
function buildPowerShellRunner(jsxPath) {
  const p = psSingleQuote(jsxPath);
  const progIds = WIN_PROGIDS.map((id) => `'${psSingleQuote(id)}'`).join(', ');
  return [
    '$ErrorActionPreference = "Stop"',
    `$progIds = @(${progIds})`,
    '$app = $null',
    '$lastErr = $null',
    'foreach ($id in $progIds) {',
    '  try { $app = New-Object -ComObject $id; break }',
    '  catch { $lastErr = $_ }',
    '}',
    'if ($null -eq $app) {',
    '  Write-Error "InDesign COM object not reachable. Is Adobe InDesign running? Last error: $lastErr"',
    '  exit 1',
    '}',
    `$script = '${p}'`,
    'if (-not (Test-Path -LiteralPath $script)) { Write-Error "Script file missing: $script"; exit 1 }',
    `$app.DoScript($script, ${ID_JAVASCRIPT}) | Out-Null`,
    'exit 0',
  ].join('\r\n');
}

/** Windows: run a PowerShell file. No arguments on the command line. */
function runPowerShellFile(ps1Path, timeout) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
    { encoding: 'utf8', timeout, windowsHide: true }
  );
}

/** macOS: run an AppleScript file through osascript. */
function runAppleScriptFile(scptPath, timeout) {
  return execFileSync('osascript', [scptPath], { encoding: 'utf8', timeout });
}

function buildAppleScriptRunner(jsxPath) {
  const p = asDoubleQuote(jsxPath);
  // Try the known application names in order; first hit wins.
  const attempts = MAC_APP_NAMES.map((name) => `
    try
      tell application "${asDoubleQuote(name)}"
        activate
        do script (POSIX file "${p}") language javascript
      end tell
      return "ok"
    end try`).join('\n');
  return `${attempts}\nerror "Adobe InDesign not found or not running."`;
}

/**
 * Last code character of a line — strings and comments skipped.
 * Returns '' for lines without code.
 */
function lastCodeChar(line) {
  let last = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') break;          // rest is a comment
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === quote) break;
        i++;
      }
      last = quote;
      continue;
    }
    if (!/\s/.test(c)) last = c;
  }
  return last;
}

// Statements that yield no usable value — never prefixed.
const NON_EXPRESSION =
  /^(var|let|const|if|for|while|do|switch|function|try|return|throw|break|continue|with)\b/;

/**
 * Assign a script's trailing expression to `__result__`, so the value travels
 * back through the result file.
 *
 * The tool scripts return their result by ending in a bare expression, and
 * rely on the executor to capture it. The assignment may land inside a block —
 * `__result__` is declared in the wrapper, so hoisting covers that.
 *
 * The trailing expression may span several lines. Prefixing the *last* line
 * would put the assignment in the middle of the expression and produce a
 * syntax error, so this walks back to where the statement starts: as long as
 * the preceding line does not end in `;`, `{` or `}`, it belongs to it.
 *
 * Scripts that set `__result__` themselves are left alone.
 */
export function autoCaptureResult(script) {
  if (/\b__result__\b/.test(script)) return script;

  const lines = script.split('\n');

  // Candidate: last non-empty line that is neither a comment nor a block end.
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t && !t.startsWith('//') && !t.startsWith('}')) { end = i; break; }
  }
  if (end < 0) return script;

  // Walk back to the start of the statement.
  let start = end;
  for (;;) {
    let prev = -1;
    for (let i = start - 1; i >= 0; i--) { if (lines[i].trim()) { prev = i; break; } }
    if (prev < 0) break;
    const c = lastCodeChar(lines[prev]);
    if (c === '' || c === ';' || c === '{' || c === '}') break;
    start = prev;
  }

  const head = lines[start].trim();
  if (NON_EXPRESSION.test(head) || /^[)\]}]/.test(head)) return script;

  lines[start] = lines[start].replace(/^(\s*)/, '$1__result__ = ');
  return lines.join('\n');
}

/**
 * Turn the more opaque InDesign failures into something a caller can act on.
 *
 * The modal-dialog case matters most: while any dialog is open — including one
 * InDesign raised itself, such as a missing-font warning — every call fails,
 * and the message arrives in the interface language. A caller sees tools
 * "returning nothing" with no indication that the application is simply
 * waiting for a click.
 */
export function explainFailure(detail) {
  const text = String(detail);
  const MODAL = /modal|modale[rs]? (Dialogfeld|Warnmeldung)|dialog|Dialogfeld/i;
  if (MODAL.test(text)) {
    return text +
      '\n\nInDesign is showing a modal dialog and will not accept scripted calls ' +
      'until it is dismissed. Switch to InDesign, close the dialog, and retry. ' +
      'A missing-font or missing-link warning on document open is the usual cause.';
  }
  if (/COM|nicht erreichbar|not reachable/i.test(text) && /InDesign/i.test(text)) {
    return text +
      '\n\nCheck that InDesign is running in the same user context as this process. ' +
      'COM isolates across integrity levels, so an elevated InDesign is invisible ' +
      'to a normal process and the other way round.';
  }
  return text;
}

/**
 * Run ExtendScript inside InDesign and return its result.
 *
 * The script is wrapped in try/catch; the value of __result__ is written to a
 * result file by the script itself and read back here. That protocol is
 * platform-neutral.
 */
export async function executeInDesignScript(rawScript, options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const jsxPath = uniqueName('script', '.jsx');
  const resultPath = uniqueName('result', '.txt');
  const runnerPath = uniqueName('runner', IS_WIN ? '.ps1' : '.scpt');

  // ExtendScript's File() expects POSIX-style separators, on Windows too.
  const resultForJsx = resultPath.replace(/\\/g, '/');

  const wrapped = [
    'var __result__;',
    'try {',
    autoCaptureResult(rawScript),
    '} catch (e) {',
    '  __result__ = "ERROR: " + e.message + " (Line: " + (e.line || "unknown") + ")";',
    '}',
    'if (typeof __result__ !== "undefined" && __result__ !== null) {',
    `  var __f__ = new File(${JSON.stringify(resultForJsx)});`,
    '  __f__.encoding = "UTF-8";',
    '  __f__.open("w");',
    '  __f__.write(String(__result__));',
    '  __f__.close();',
    '}',
  ].join('\n');

  try {
    fs.writeFileSync(jsxPath, wrapped, 'utf8');

    if (IS_WIN) {
      fs.writeFileSync(runnerPath, buildPowerShellRunner(jsxPath), 'utf8');
      runPowerShellFile(runnerPath, timeout);
    } else if (IS_MAC) {
      fs.writeFileSync(runnerPath, buildAppleScriptRunner(jsxPath), 'utf8');
      runAppleScriptFile(runnerPath, timeout);
    } else {
      throw new Error(
        `Unsupported platform: ${process.platform}. Supported: win32, darwin.`
      );
    }

    if (fs.existsSync(resultPath)) {
      return fs.readFileSync(resultPath, 'utf8');
    }
    return '(no return value)';
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`InDesign script execution failed: ${explainFailure(detail)}`);
  } finally {
    for (const f of [jsxPath, resultPath, runnerPath]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
    }
  }
}

/** Diagnostic: is InDesign reachable? Used by the smoke test. */
export async function probeInDesign() {
  const out = await executeInDesignScript('__result__ = app.name + " | " + app.version;');
  return out.trim();
}

export const platformInfo = {
  platform: process.platform,
  mode: IS_WIN ? 'windows-com' : IS_MAC ? 'macos-applescript' : 'unsupported',
  sessionDir: SESSION_DIR,
};
