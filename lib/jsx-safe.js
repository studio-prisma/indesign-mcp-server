/**
 * jsx-safe.js
 * Escaping and validation helpers for values that end up in ExtendScript.
 *
 * ExtendScript is not sandboxed: it reads and writes files and starts system
 * commands through app.system(). A value placed unchecked into source text is
 * therefore potentially executable code. This is not only about direct input —
 * tool arguments frequently originate from documents, CSV files or web
 * content, that is, from sources the caller does not control.
 *
 * Rule: no value is ever interpolated into a script as-is.
 * Strings -> str(), numbers -> num(), enums -> enumOf(), booleans -> bool().
 */

import path from 'path';
import fs from 'fs';

/** Embed a string as a JS/JSX literal, including backslashes and Unicode. */
export function str(value) {
  if (value === undefined || value === null) return '""';
  // JSON.stringify escapes backslashes, quotes and control characters
  // correctly. U+2028/U+2029 need separate handling: ES3 parsers treat them
  // as line terminators, which would end the literal early.
  return JSON.stringify(String(value))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Require a finite number. Throws on anything else. */
export function num(value, { min = -1e9, max = 1e9, name = 'value' } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for '${name}': ${JSON.stringify(value)}`);
  }
  if (n < min || n > max) {
    throw new Error(`Value for '${name}' out of range [${min}, ${max}]: ${n}`);
  }
  return String(n);
}

/** Require a non-negative integer, e.g. a page index. */
export function index(value, { name = 'index', max = 100000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new Error(`Invalid index for '${name}': ${JSON.stringify(value)}`);
  }
  return String(n);
}

/** Boolean as a JSX literal. Never passes a caller-supplied value through. */
export function bool(value) {
  return value ? 'true' : 'false';
}

/**
 * Allow only values from a list — for anything written into the script as an
 * identifier rather than a string, such as Justification enum members.
 */
export function enumOf(value, allowed, { name = 'enum' } = {}) {
  const v = String(value);
  if (!allowed.includes(v)) {
    throw new Error(
      `Invalid value for '${name}': ${JSON.stringify(value)}. Allowed: ${allowed.join(', ')}`
    );
  }
  return v;
}

/** Allow-lists for the InDesign enums used by the tools. */
export const ALLOWED = {
  alignment: [
    'LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN',
    'LEFT_JUSTIFIED', 'RIGHT_JUSTIFIED', 'CENTER_JUSTIFIED', 'FULLY_JUSTIFIED',
  ],
  fitOption: [
    'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'PROPORTIONALLY',
    'FILL_PROPORTIONALLY', 'CENTER_CONTENT', 'APPLY_FRAME_FITTING_OPTIONS',
  ],
  colorSpace: ['CMYK', 'RGB', 'LAB'],
  colorModel: ['PROCESS', 'SPOT', 'REGISTRATION'],
  imageFormat: ['PNG', 'JPG', 'JPEG', 'TIFF', 'GIF'],
  pdfPreset: [
    'HighQualityPrint', 'PressQuality', 'SmallestFileSize',
    'PDFX1a2001', 'PDFX32002', 'PDFX42008',
  ],
  // UIColors — layer colours in the InDesign interface.
  uiColor: [
    'LIGHT_BLUE', 'RED', 'GREEN', 'BLUE', 'YELLOW', 'MAGENTA', 'CYAN',
    'GRAY', 'BLACK', 'ORANGE', 'DARK_GREEN', 'TEAL', 'TAN', 'BROWN',
    'VIOLET', 'GOLD', 'DARK_BLUE', 'PINK', 'LAVENDER', 'BRICK_RED',
    'OLIVE_GREEN', 'PEACH', 'BURGUNDY', 'GRASS_GREEN', 'OCHRE',
    'PURPLE', 'LIGHT_GRAY', 'CHARCOAL', 'GRID_BLUE', 'GRID_ORANGE',
    'FIESTA', 'LIGHT_OLIVE', 'LIPSTICK', 'CUTE_TEAL', 'SULPHUR',
    'GRID_GREEN', 'WHITE',
  ],
};

/**
 * Embed a data structure as a JS literal (arrays and objects from tool
 * arguments). JSON.stringify already produces valid JS, but lets U+2028 and
 * U+2029 through — line terminators to an ES3 parser.
 */
export function json(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** A list of numbers as JSX array contents, e.g. for colorValue. */
export function numList(values, { name = 'values', min, max } = {}) {
  if (!Array.isArray(values)) {
    throw new Error(`Expected a list for '${name}': ${JSON.stringify(values)}`);
  }
  const opts = { name };
  if (min !== undefined) opts.min = min;
  if (max !== undefined) opts.max = max;
  return values.map((v) => num(v, opts)).join(', ');
}

/**
 * A measurement with a unit, e.g. "20mm". Number plus known unit only, and it
 * supplies its own quotes — so no additional quoting at the call site.
 */
export function measure(value, { unit = 'mm', name = 'measure' } = {}) {
  const allowedUnits = ['mm', 'cm', 'in', 'pt', 'px', 'p'];
  if (!allowedUnits.includes(unit)) {
    throw new Error(`Invalid unit for '${name}': ${unit}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid measurement for '${name}': ${JSON.stringify(value)}`);
  }
  return `"${n}${unit}"`;
}

/**
 * Directories file operations are confined to: the directories listed in
 * INDESIGN_ALLOWED_DIRS, and nothing else. Without the variable no tool may
 * read or write a file at all (fail-closed). The home directory used to be
 * the fallback, which left ~/.ssh, autostart folders and InDesign's own
 * startup scripts open to a prompt-injected export.
 *
 * The list is split on path.delimiter — ';' on Windows. Splitting on ':'
 * would tear a drive letter apart: 'C:\projects' becomes ['C', '\projects'],
 * and the second entry resolves on every drive.
 */
export function buildAllowedDirs() {
  const dirs = [];
  const fromEnv = process.env.INDESIGN_ALLOWED_DIRS;
  if (fromEnv) {
    for (const d of fromEnv.split(path.delimiter)) {
      const trimmed = d.trim();
      if (trimmed) dirs.push(trimmed);
    }
  }
  return dirs.map((d) => path.resolve(d));
}

/**
 * File extensions per kind of file operation. A tool names the list it needs;
 * a path with any other extension is refused, so an export cannot be steered
 * into writing a .cmd, .plist or shell profile.
 */
export const EXT = Object.freeze({
  document: Object.freeze(['.indd', '.indt', '.idml']),
  save: Object.freeze(['.indd', '.indt']),
  pdf: Object.freeze(['.pdf']),
  epub: Object.freeze(['.epub']),
  idml: Object.freeze(['.idml']),
  image: Object.freeze([
    '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.gif', '.bmp', '.webp',
    '.psd', '.ai', '.eps', '.pdf', '.svg', '.heic',
  ]),
  dataSource: Object.freeze(['.csv', '.txt']),
});

const WIN_FORBIDDEN = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];
const POSIX_FORBIDDEN = ['/etc', '/System', '/usr', '/bin', '/sbin', '/Library'];

// Folders that execute or authenticate: whatever lands there runs at the next
// login or start of InDesign, or replaces a key. Compared per path segment,
// case-insensitively, wherever they sit inside an allowed directory.
const SENSITIVE_SEGMENTS = new Set([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.git',
  'launchagents', 'launchdaemons', 'startupitems',
  'startup scripts', 'scripts panel',
]);
// Two-segment sequences: ~/.config/autostart, ~/.config/systemd and the
// Windows Startup folder under Start Menu\Programs.
const SENSITIVE_PAIRS = [
  ['.config', 'autostart'],
  ['.config', 'systemd'],
  ['programs', 'startup'],
];
// Shell and PowerShell profiles: run on every new terminal.
const SENSITIVE_NAMES = new Set([
  '.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile',
  '.zshrc', '.zshenv', '.zprofile', '.zlogin', '.cshrc', '.tcshrc', '.login',
  'profile.ps1', 'microsoft.powershell_profile.ps1',
]);

function isSensitive(resolved) {
  const segs = resolved.split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  if (segs.some((s) => SENSITIVE_SEGMENTS.has(s))) return true;
  for (let i = 1; i < segs.length; i++) {
    if (SENSITIVE_PAIRS.some(([a, b]) => segs[i - 1] === a && segs[i] === b)) return true;
  }
  // Adobe script folders: a "Scripts" segment below anything Adobe or
  // InDesign — Scripts Panel and Startup Scripts of every version and locale.
  const adobeAt = segs.findIndex((s) => s.startsWith('adobe') || s.includes('indesign'));
  if (adobeAt !== -1 && segs.slice(adobeAt + 1).includes('scripts')) return true;
  return SENSITIVE_NAMES.has(segs[segs.length - 1]);
}

/**
 * Resolve symlinks and junctions in the part of the path that exists. The
 * file itself usually does not exist yet (an export target), so the nearest
 * existing ancestor is resolved and the rest appended.
 */
function realResolve(resolved) {
  let existing = resolved;
  const rest = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  let real;
  try {
    real = fs.realpathSync.native(existing);
  } catch {
    return resolved;
  }
  return rest.length ? path.join(real, ...rest) : real;
}

const cmpCase = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;

function isInside(p, dir) {
  const d = cmpCase(dir);
  const r = cmpCase(p);
  return r === d || r.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

/**
 * Path gate for every file operation — Windows and macOS.
 *
 * In order: refuse what ExtendScript would read differently than Node (URI
 * escapes, control characters, UNC, alternate data streams), resolve ".."
 * and links, then require an allowed directory, refuse system and sensitive
 * folders, and check the extension the tool expects.
 *
 * Returns the resolved real path; callers pass that to jsxPath(), never the
 * raw argument.
 */
export function validateFilePath(filePath, allowedDirs = buildAllowedDirs(), { extensions } = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path.');
  }
  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    throw new Error(
      'File access is disabled: set INDESIGN_ALLOWED_DIRS to the folder(s) InDesign ' +
      'may read from and write to.'
    );
  }
  // ExtendScript's File() decodes %XX, so "%2E%2E" would become ".." after
  // the check. No legitimate path needs a literal '%'.
  if (filePath.includes('%')) {
    throw new Error(`Invalid path (contains '%'): ${filePath}`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(filePath)) {
    throw new Error('Invalid path (control character).');
  }
  if (/^[\\/]{2}/.test(filePath)) {
    throw new Error(`Invalid path (network/UNC paths are not allowed): ${filePath}`);
  }
  if (process.platform === 'win32' && filePath.slice(2).includes(':')) {
    throw new Error(`Invalid path (alternate data stream suspected): ${filePath}`);
  }

  const resolved = realResolve(path.resolve(filePath));
  const allowed = allowedDirs.map((d) => realResolve(path.resolve(d)));

  if (!allowed.some((dir) => isInside(resolved, dir))) {
    throw new Error(
      `Access denied: '${filePath}' is outside the allowed directories (${allowedDirs.join(', ')}).`
    );
  }

  const forbidden = process.platform === 'win32' ? WIN_FORBIDDEN : POSIX_FORBIDDEN;
  if (forbidden.some((f) => isInside(resolved, path.resolve(f)))) {
    throw new Error(`Access denied: system directory '${resolved}'.`);
  }
  if (isSensitive(resolved)) {
    throw new Error(
      `Access denied: '${resolved}' is a startup, script or credential location.`
    );
  }

  if (extensions) {
    const ext = path.extname(resolved).toLowerCase();
    if (!extensions.includes(ext)) {
      throw new Error(
        `File extension '${ext || '(none)'}' is not allowed here. Allowed: ${extensions.join(', ')}.`
      );
    }
  }

  return resolved;
}

/** A path for ExtendScript File() — forward slashes, safe as a literal. */
export function jsxPath(resolvedPath) {
  return str(String(resolvedPath).replace(/\\/g, '/'));
}
