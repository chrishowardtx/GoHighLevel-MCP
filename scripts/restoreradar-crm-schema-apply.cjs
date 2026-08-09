#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { helpText, runSchemaTool } = require('./restoreradar-crm-schema-lib.cjs');

async function main() {
  const result = await runSchemaTool({ argv: process.argv.slice(2) });
  if (result.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const serialized = `${JSON.stringify(result.receipt, null, 2)}\n`;
  const receiptIndex = process.argv.indexOf('--receipt');
  if (receiptIndex !== -1 && process.argv[receiptIndex + 1]) {
    const receiptPath = path.resolve(process.argv[receiptIndex + 1]);
    fs.writeFileSync(receiptPath, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(serialized);
  process.exitCode = result.exitCode;
}

main().catch(() => {
  process.stderr.write('RestoreRadar schema tool halted before producing a receipt.\n');
  process.exitCode = 2;
});
