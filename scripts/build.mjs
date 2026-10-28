// Compila Saihai para publicarlo: JavaScript ESM en dist/ (con los pesos y la tabla JSON dentro) y los tipos (.d.ts) en dist/types/.
// Las cuatro entradas comparten módulos (splitting): así `CONFIG` y `Match` son los mismos objetos en `saihai-gateball`, `/engine`, `/debug` y `/testing`.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { index: 'src/index.ts', engine: 'src/engine.ts', debug: 'src/debug.ts', testing: 'src/testing.ts' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  outdir: 'dist',
  logLevel: 'warning',
  sourcemap: true,
});
const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
console.log('Saihai compilado en dist/');
