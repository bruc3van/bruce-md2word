/** Produce a reviewable document through the bundled CLI. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
execFileSync(process.execPath, [fileURLToPath(new URL('../lib/cli.js', import.meta.url)), 'fixtures/示例.md'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
