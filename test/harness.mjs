/**
 * Test harness.
 *
 * Loads index.js with the platform driver swapped out: instead of sending a
 * script to InDesign, it collects it. That makes the generated ExtendScript
 * inspectable without InDesign running.
 *
 * index.js itself is not modified — the harness writes a copy into a temp
 * directory, redirects the driver import there and removes the auto-start at
 * the end of the file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const MOCK_DRIVER = `
export const captured = [];
export async function executeInDesignScript(script) {
  captured.push(script);
  return '(mock)';
}
export const platformInfo = { platform: 'mock', mode: 'mock', sessionDir: '(mock)' };
export function autoCaptureResult(s) { return s; }
export function withUndoLabel(label, fn) { return fn(); }
`;

let cached = null;

/** Load the server once, with the driver mocked. */
export async function loadServer() {
  if (cached) return cached;

  const dir = path.join(os.tmpdir(), `indesign-mcp-test-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });

  // Copy every library module except the driver — they are part of what is
  // under test. Copying the whole directory rather than naming files keeps
  // this working when a module is added.
  for (const file of fs.readdirSync(path.join(ROOT, 'lib'))) {
    if (file === 'indesign-driver.js') continue;
    fs.copyFileSync(path.join(ROOT, 'lib', file), path.join(dir, 'lib', file));
  }
  fs.writeFileSync(path.join(dir, 'lib', 'indesign-driver.js'), MOCK_DRIVER, 'utf8');

  let code = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  // Drop the auto-start, export the class.
  code = code.replace(/const server = new InDesignMCPServer\(\);\s*server\.run\(\)[^\n]*/, '');
  code += '\nexport { InDesignMCPServer };\n';
  fs.writeFileSync(path.join(dir, 'index.js'), code, 'utf8');

  // Make node_modules reachable for the SDK import.
  try {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  } catch {
    /* symlink not permitted — the package.json below still sets module type */
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

  const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href);
  const drv = await import(pathToFileURL(path.join(dir, 'lib', 'indesign-driver.js')).href);
  cached = { server: new mod.InDesignMCPServer(), captured: drv.captured, dir };
  return cached;
}

/**
 * Call a tool method and return the script it produced.
 * If the method throws — an argument was rejected, say — the error is
 * returned rather than raised.
 */
export async function runTool(method, args) {
  const { server, captured } = await loadServer();
  const before = captured.length;
  try {
    await server[method](args);
  } catch (e) {
    return { error: e, script: captured.length > before ? captured[captured.length - 1] : null };
  }
  return { error: null, script: captured.length > before ? captured[captured.length - 1] : null };
}

/**
 * Does an ExtendScript source parse?
 *
 * ES3 is a subset of the Node grammar, so new Function() works as a parser.
 * The reverse is not true: Node accepts ES2024 constructs that ExtendScript
 * does not, hence the additional deny-list.
 */
const ES3_FORBIDDEN = [
  [/`/, 'template literal (ExtendScript is ES3)'],
  [/\blet\s+[A-Za-z_$]/, 'let (ExtendScript only has var)'],
  [/\bconst\s+[A-Za-z_$]/, 'const (ExtendScript only has var)'],
  [/=>/, 'arrow function (ExtendScript is ES3)'],
];

export function parses(script) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(script);
  } catch (e) {
    return { ok: false, message: e.message };
  }
  for (const [re, what] of ES3_FORBIDDEN) {
    if (re.test(script)) return { ok: false, message: 'not valid for ExtendScript: ' + what };
  }
  return { ok: true };
}
