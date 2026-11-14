import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const outDir = path.join(root, '.verification');
const compiler = require.resolve('typescript/bin/tsc');
const args = [
  compiler, '--module', 'commonjs', '--moduleResolution', 'node', '--target', 'ES2022',
  '--esModuleInterop', '--strict', '--skipLibCheck', '--outDir', outDir,
  'scripts/verify-benchmark.ts', 'src/lib/reconciliation.ts', 'src/lib/exports.ts', 'src/lib/extractor.ts',
];
try {
  rmSync(outDir, { recursive: true, force: true });
  const compile = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else {
    const run = spawnSync(process.execPath, [path.join(outDir, 'scripts', 'verify-benchmark.js')], { cwd: root, stdio: 'inherit' });
    process.exitCode = run.status ?? 1;
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
