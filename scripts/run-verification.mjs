import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const run = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/verify-benchmark.ts'], { cwd: root, stdio: 'inherit' });
process.exitCode = run.status ?? 1;
