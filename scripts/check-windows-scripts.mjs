/**
 * The Windows scripts must be pure ASCII.
 *
 * PowerShell reads a .ps1 without a byte-order mark using the machine's ANSI
 * codepage, so a UTF-8 em dash arrives as three stray bytes — which broke a
 * string mid-script and took the updater down with it. Batch files show the
 * same bytes as mojibake in front of the operator.
 *
 * Run by `pnpm check:windows`, and worth running before anything is pushed to
 * a machine nobody can walk up to.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/agent/windows';
const failures = [];

for (const file of readdirSync(DIR)) {
  if (!/\.(bat|ps1)$/i.test(file)) continue;

  const text = readFileSync(join(DIR, file), 'utf8');
  text.split('\n').forEach((line, index) => {
    for (const char of line) {
      if (char.codePointAt(0) > 127) {
        failures.push(`${DIR}/${file}:${index + 1} contains ${JSON.stringify(char)}`);
        break;
      }
    }
  });
}

if (failures.length > 0) {
  console.error('Windows scripts must be ASCII only:\n' + failures.map((f) => `  ${f}`).join('\n'));
  console.error('\nUse a plain hyphen, straight quotes and "..." instead.');
  process.exit(1);
}

console.log('Windows scripts are ASCII only.');
