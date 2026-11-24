/**
 * The path gate and the property deny-list (audit 2026-11-03, ID-1 to ID-4).
 *
 * Every path a tool hands to ExtendScript goes through validateFilePath().
 * ExtendScript's File() decodes URI escapes, so a check on the raw string is
 * not enough: "%2E%2E" is a harmless name to Node and ".." to InDesign. The
 * same holds for a symlink or junction inside an allowed folder that points
 * outside it. These tests pin the gate down from the attacker's side: a
 * document or web page that talks the model into exporting to ~/.ssh or an
 * autostart folder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateFilePath, buildAllowedDirs, EXT } from '../lib/jsx-safe.js';
import * as exporters from '../lib/export-tools.js';
import * as g from '../lib/generic-tools.js';

const HOME = os.homedir();
const WORK = path.join(os.tmpdir(), `indesign-gate-${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(WORK, { recursive: true });
const DIRS = [HOME, WORK];

function withEnv(value, fn) {
  const saved = process.env.INDESIGN_ALLOWED_DIRS;
  try {
    if (value === undefined) delete process.env.INDESIGN_ALLOWED_DIRS;
    else process.env.INDESIGN_ALLOWED_DIRS = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env.INDESIGN_ALLOWED_DIRS;
    else process.env.INDESIGN_ALLOWED_DIRS = saved;
  }
}

// ------------------------------------------------------------------ ID-1

test('ID-1: URI escapes are refused, ExtendScript would decode them', () => {
  for (const p of [
    path.join(WORK, '%2E%2E', '%2E%2E', 'x.pdf'),
    path.join(WORK, '%2e%2e', 'x.pdf'),
    path.join(WORK, 'a%2Fb.pdf'),
    path.join(WORK, '100%.pdf'),
  ]) {
    assert.throws(() => validateFilePath(p, DIRS), /Invalid path/, `accepted: ${p}`);
  }
});

test('ID-1: ".." is resolved before the allow-list check', () => {
  const escape = path.join(WORK, '..', '..', 'x.pdf');
  assert.throws(() => validateFilePath(escape, [WORK]), /Access denied/);
});

test('ID-1: control characters and UNC paths are refused', () => {
  assert.throws(() => validateFilePath(path.join(WORK, 'a\u0000b.pdf'), DIRS), /Invalid path/);
  assert.throws(() => validateFilePath('\\\\server\\share\\x.pdf', DIRS), /Invalid path/);
  assert.throws(() => validateFilePath('//server/share/x.pdf', DIRS), /Invalid path/);
});

// ------------------------------------------------------------------ ID-3

test('ID-3: without INDESIGN_ALLOWED_DIRS no file operation is allowed', () => {
  withEnv(undefined, () => {
    assert.deepEqual(buildAllowedDirs(), []);
    assert.throws(
      () => validateFilePath(path.join(HOME, 'x.pdf')),
      /INDESIGN_ALLOWED_DIRS/
    );
    assert.throws(() => exporters.exportPDF({ filePath: path.join(HOME, 'x.pdf') }),
      /INDESIGN_ALLOWED_DIRS/);
  });
  withEnv(` ${path.delimiter} `, () => {
    assert.deepEqual(buildAllowedDirs(), [], 'a blank list is not a fallback to home');
  });
});

test('ID-3: sensitive folders are refused even inside an allowed directory', () => {
  const denied = [
    path.join(HOME, '.ssh', 'authorized_keys.pdf'),
    path.join(HOME, '.SSH', 'x.pdf'),
    path.join(HOME, '.gnupg', 'x.pdf'),
    path.join(HOME, '.aws', 'x.pdf'),
    path.join(HOME, '.git', 'hooks', 'x.pdf'),
    path.join(HOME, 'proj', '.git', 'hooks', 'pre-commit.pdf'),
    path.join(HOME, '.config', 'autostart', 'x.pdf'),
    path.join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu',
      'Programs', 'Startup', 'x.pdf'),
    path.join(HOME, 'Library', 'LaunchAgents', 'x.pdf'),
    path.join(HOME, 'AppData', 'Roaming', 'Adobe', 'InDesign', 'Version 21.0',
      'en_US', 'Scripts', 'Scripts Panel', 'x.pdf'),
    path.join(HOME, 'Library', 'Preferences', 'Adobe InDesign', 'Version 21.0',
      'en_US', 'Scripts', 'Startup Scripts', 'x.pdf'),
  ];
  for (const p of denied) {
    assert.throws(() => validateFilePath(p, DIRS), /Access denied/, `accepted: ${p}`);
  }
});

test('ID-3: shell start-up files are refused by name', () => {
  for (const name of ['.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile',
    '.zshenv', 'Microsoft.PowerShell_profile.ps1', 'profile.ps1']) {
    assert.throws(() => validateFilePath(path.join(HOME, name), DIRS), /Access denied/,
      `accepted: ${name}`);
  }
});

test('ID-3: every file tool checks the extension it writes or reads', () => {
  const cmd = path.join(WORK, 'payload.cmd');
  withEnv(WORK, () => {
    assert.throws(() => exporters.exportPDF({ filePath: cmd }), /extension/);
    assert.throws(() => exporters.exportEPUB({ filePath: cmd }), /extension/);
    assert.throws(() => exporters.exportIDML({ filePath: cmd }), /extension/);
  });
  assert.throws(() => validateFilePath(cmd, DIRS, { extensions: EXT.document }), /extension/);
  assert.throws(() => validateFilePath(cmd, DIRS, { extensions: EXT.image }), /extension/);
  assert.throws(() => validateFilePath(path.join(WORK, 'x'), DIRS, { extensions: EXT.pdf }),
    /extension/, 'no extension at all');
  assert.equal(
    validateFilePath(path.join(WORK, 'Out.PDF'), DIRS, { extensions: EXT.pdf }),
    path.join(fs.realpathSync.native(WORK), 'Out.PDF')
  );
});

test('ID-3: an ordinary path in an allowed directory still passes', () => {
  withEnv(WORK, () => {
    const p = path.join(WORK, 'sub', 'brochure.pdf');
    assert.equal(validateFilePath(p, buildAllowedDirs(), { extensions: EXT.pdf }),
      path.join(fs.realpathSync.native(WORK), 'sub', 'brochure.pdf'));
    assert.match(exporters.exportPDF({ filePath: p }), /brochure\.pdf/);
  });
});

// ------------------------------------------------------------------ ID-4

test('ID-4: a link inside an allowed directory that leads outside is refused', (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-outside-'));
  const link = path.join(WORK, 'link');
  try {
    fs.symlinkSync(outside, link, 'junction');
  } catch (e) {
    t.skip(`cannot create a link here: ${e.code}`);
    return;
  }
  try {
    assert.throws(
      () => validateFilePath(path.join(link, 'new', 'x.pdf'), [WORK], { extensions: EXT.pdf }),
      /Access denied/
    );
  } finally {
    fs.rmSync(link, { force: true, recursive: false });
    fs.rmSync(outside, { force: true, recursive: true });
  }
});

// ------------------------------------------------------------------ ID-2

test('ID-2: set_properties refuses file, path, script and prototype properties', () => {
  const target = { kind: 'document' };
  for (const prop of [
    'filePath', 'fullName', 'epubExportPreferences.javascripts',
    'epubExportPreferences.externalStyleSheets', 'htmlExportPreferences.imageFolder',
    'parent.scriptPreferences.userInteractionLevel', 'scriptPreferences.enableRedraw',
    '__proto__', 'constructor.prototype', 'dataMergeProperties.dataSourceFile',
    'someFile', 'somePath', 'someFolder', 'linkResourceURI', 'reflect',
  ]) {
    assert.throws(
      () => g.setProperties({ target, properties: { [prop]: 'C:/x/evil.js' } }),
      /not allowed/,
      `accepted: ${prop}`
    );
  }
});

test('ID-2: the application only takes the find/change preferences', () => {
  const app = { kind: 'application' };
  for (const prop of ['scriptPreferences.userInteractionLevel', 'generalPreferences.x',
    'epubExportPreferences.javascripts', 'name']) {
    assert.throws(() => g.setProperties({ target: app, properties: { [prop]: 1 } }),
      /not allowed/, `accepted on application: ${prop}`);
  }
  // The documented GREP route keeps working.
  const ok = g.setProperties({ target: app, properties: {
    'findGrepPreferences.findWhat': '\\d+', 'changeGrepPreferences.changeTo': 'n',
  } });
  assert.match(ok, /findGrepPreferences\.findWhat/);
});

test('ID-2: ordinary layout properties still pass', () => {
  const out = g.setProperties({ target: { kind: 'pageItem', objectIndex: 0 }, properties: {
    rotationAngle: 45, 'transparencySettings.blendingSettings.opacity': 50, name: 'Box',
  } });
  assert.match(out, /rotationAngle/);
});
