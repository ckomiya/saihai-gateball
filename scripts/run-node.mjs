// Empaqueta un script TypeScript con esbuild (sin dependencias nuevas) y lo ejecuta con Node.
// Uso: node scripts/run-node.mjs scripts/selfplay.ts [argumentos…]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const [entry, ...args] = process.argv.slice(2);
if (!entry) { console.error('Falta el script .ts'); process.exit(2); }
mkdirSync('.build', { recursive: true });
const out = `.build/${basename(entry).replace(/\.ts$/, '')}.mjs`;
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning', packages: 'external', sourcemap: 'inline' });
const r = spawnSync(process.execPath, ['--enable-source-maps', out, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
