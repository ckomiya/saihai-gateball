// Corre cada prueba de `npm test` POR SEPARADO (una falla no detiene a las demás) y resume cuáles pasan.
// Uso: npm run tests:todas -- <etiqueta> [--jobs 4]      → escribe .build/tests_<etiqueta>.json y muestra la tabla
// Para probar otro kantoku, cámbialo antes en src/game/cpuWeights.json (las pruebas usan el campeón de ese archivo).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) ?? 'campeon';
const ji = args.indexOf('--jobs');
const jobs = ji >= 0 ? Number(args[ji + 1]) : 4;
const chain = JSON.parse(readFileSync('package.json', 'utf8')).scripts.test;
const files = [...chain.matchAll(/node scripts\/run-node\.mjs (tests\/[\w.-]+\.ts)/g)].map((m) => m[1]);
mkdirSync('.build', { recursive: true });
const results = [];
let next = 0;
const run = (f) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, ['scripts/run-node.mjs', f], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => {
    const fails = out.split('\n').filter((l) => l.startsWith('✗'));
    results.push({ file: f, code, seconds: Math.round((Date.now() - t0) / 1000), fails });
    console.log(`${code === 0 ? 'PASA ' : 'FALLA'} ${f} (${Math.round((Date.now() - t0) / 1000)} s)${fails.length ? '\n   ' + fails.join('\n   ') : ''}`);
    resolve();
  });
});
await Promise.all(Array.from({ length: jobs }, async () => { while (next < files.length) await run(files[next++]); }));
results.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file));
writeFileSync(`.build/tests_${label}.json`, JSON.stringify(results, null, 1));
console.log(`\n${label}: ${results.filter((r) => r.code === 0).length}/${results.length} pruebas pasan`);
