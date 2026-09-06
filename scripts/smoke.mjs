/**
 * Smoke test: can the driver reach a running InDesign instance?
 *
 * Read-only — asks for name and version, touches no document.
 * Requires InDesign to be running in the same user context as Node.
 */

import { probeInDesign, platformInfo } from '../lib/indesign-driver.js';

console.log('Platform :', JSON.stringify(platformInfo, null, 2));

try {
  const answer = await probeInDesign();
  console.log('InDesign :', answer);
  console.log('\nResult   : reachable');
} catch (e) {
  console.error('\nResult   : not reachable');
  console.error(e.message);
  console.error(
    '\nThings to check:\n' +
    '  - Is Adobe InDesign running?\n' +
    '  - Is it running in the same user context as Node? Do not run it\n' +
    '    elevated while Node is not — COM isolates across integrity levels.\n' +
    '  - Is the ProgID registered?\n' +
    "      Get-ChildItem 'HKLM:\\SOFTWARE\\Classes' |\n" +
    "        Where-Object { $_.PSChildName -like 'InDesign.Application*' }\n" +
    '    If yours is missing, add it to WIN_PROGIDS in lib/indesign-driver.js.'
  );
  process.exitCode = 1;
}
