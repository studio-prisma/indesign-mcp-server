/**
 * Most suites build scripts for paths under the home directory. Since the fail-closed path gate
 * file access is off unless INDESIGN_ALLOWED_DIRS is set, so these suites set
 * it to home first. Import this before anything that reads the variable.
 * path-gate.test.mjs tests the unset case on its own.
 */
import os from 'node:os';

if (!process.env.INDESIGN_ALLOWED_DIRS) {
  process.env.INDESIGN_ALLOWED_DIRS = os.homedir();
}
