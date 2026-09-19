/**
 * Driver tests.
 *
 * Unlike the tool tests these import the real driver rather than the mock —
 * what is under test is the text it hands to PowerShell and ExtendScript, and
 * the encoding of the files it writes. Nothing here starts InDesign.
 *
 * The end-to-end counterpart lives in scripts/e2e-driver.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import {
  buildPowerShellRunner,
  buildAppleScriptRunner,
  writeFileWithBom,
  stripBom,
} from '../lib/indesign-driver.js';

const UNDO_ENTIRE_SCRIPT = 1699963733;
const UNDO_SCRIPT_REQUEST = 1699967573;

// ---------------------------------------------------------------- encoding

test('writeFileWithBom starts the file with a UTF-8 BOM', () => {
  const p = path.join(os.tmpdir(), `bom-${crypto.randomBytes(6).toString('hex')}.txt`);
  try {
    writeFileWithBom(p, 'SAYNER H\u00DCTTE');
    const bytes = fs.readFileSync(p);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'no UTF-8 BOM');
    // The payload behind the BOM is UTF-8, not the ANSI codepage.
    assert.deepEqual([...bytes.subarray(3)], [...Buffer.from('SAYNER H\u00DCTTE', 'utf8')]);
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test('a BOM-less UTF-8 runner is what turns \u00DC into charCodes 195, 339', () => {
  // The bug this guards against, stated as an assertion: Windows PowerShell
  // 5.1 falls back to the ANSI codepage when there is no BOM, and CP1252 reads
  // the two UTF-8 bytes of U+00DC as U+00C3 (195) and U+0153 (339).
  const utf8 = Buffer.from('\u00DC', 'utf8');
  assert.deepEqual([...utf8], [0xc3, 0x9c]);
  const asCp1252 = [0x00c3, 0x0153]; // CP1252: 0xC3 -> A-tilde, 0x9C -> oe
  assert.deepEqual(asCp1252, [195, 339]);
});

test('stripBom removes a leading U+FEFF and leaves everything else alone', () => {
  assert.equal(stripBom('\uFEFFHallo'), 'Hallo');
  assert.equal(stripBom('Hallo'), 'Hallo');
  assert.equal(stripBom(''), '');
  assert.equal(stripBom('Hallo\uFEFFWelt'), 'Hallo\uFEFFWelt', 'only a leading BOM');
});

// ---------------------------------------------------- PowerShell runner text

test('the runner forces UTF-8 console output before anything can fail', () => {
  const ps = buildPowerShellRunner('C:\\tmp\\s.jsx', 'create_rectangle');
  const lines = ps.split('\r\n');
  assert.equal(
    lines[0],
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'output encoding must be set first, or early errors come back in the OEM codepage'
  );
});

test('DoScript is always called with five arguments', () => {
  for (const undoName of ['create_rectangle', null, undefined]) {
    const ps = buildPowerShellRunner('C:\\tmp\\s.jsx', undoName);
    const call = ps.split('\r\n').find((l) => l.includes('DoScript'));
    assert.ok(call, `no DoScript call for undoName=${String(undoName)}`);
    // Five arguments: script, language, withArguments, undo mode, undo name.
    assert.match(
      call,
      /^\$app\.DoScript\(\$script, \d+, @\(\), \d+, '[^']*'\) \| Out-Null$/,
      `two-argument overload for undoName=${String(undoName)}: ${call}`
    );
  }
});

test('withArguments is an empty array, never $null', () => {
  const ps = buildPowerShellRunner('C:\\tmp\\s.jsx', null);
  const call = ps.split('\r\n').find((l) => l.includes('DoScript'));
  assert.ok(call.includes('@()'), 'withArguments must be @()');
  assert.ok(!/\$null/.test(call), '$null in DoScript raises a NullReferenceException');
});

test('undoName null selects SCRIPT_REQUEST, the only mode doc.undo() survives', () => {
  const ungrouped = buildPowerShellRunner('C:\\tmp\\s.jsx', null);
  const grouped = buildPowerShellRunner('C:\\tmp\\s.jsx', 'create_rectangle');

  const modeOf = (ps) =>
    Number(ps.split('\r\n').find((l) => l.includes('DoScript')).match(/@\(\), (\d+),/)[1]);

  assert.equal(modeOf(ungrouped), UNDO_SCRIPT_REQUEST);
  assert.equal(modeOf(grouped), UNDO_ENTIRE_SCRIPT);
});

test('the undo label reaches the runner and stays inside its character set', () => {
  const ps = buildPowerShellRunner('C:\\tmp\\s.jsx', 'create_rectangle');
  assert.ok(ps.includes("'create_rectangle'"));

  // Anything outside [A-Za-z0-9 _.-] is dropped rather than escaped, so a
  // label can never close the PowerShell literal it sits in.
  const hostile = buildPowerShellRunner('C:\\tmp\\s.jsx', "x'; Remove-Item C:\\ -Recurse; '");
  const call = hostile.split('\r\n').find((l) => l.includes('DoScript'));
  // The surviving letters are inert. What matters is the shape: the label is
  // one single-quoted run of safe characters, so it cannot close its own
  // literal and append a statement.
  assert.match(call, /'[A-Za-z0-9 _.-]*'\) \| Out-Null$/, `label escaped its literal: ${call}`);
  const label = call.match(/'([^']*)'\) \| Out-Null$/)[1];
  assert.ok(!/['";]/.test(label), `unsafe characters survived: ${label}`);
});

// ------------------------------------------------------- AppleScript runner

test('the AppleScript runner still drops undo grouping for undoName null', () => {
  assert.ok(!buildAppleScriptRunner('/tmp/s.jsx', null).includes('undo mode'));
  assert.ok(buildAppleScriptRunner('/tmp/s.jsx', 'create_rectangle').includes('undo mode entire script'));
});
