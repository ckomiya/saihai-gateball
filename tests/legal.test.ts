// Revisión automática de lo que no debe aparecer en este repositorio (reglas legales del proyecto): nombres del juego y de las empresas originales,
// referencias a los clips o a la carpeta de referencias, y texto de comparación con «el original». Las palabras se arman en fragmentos
// para que esta prueba no las contenga completas. CLAUDE.md no las nombra, así que también se revisa.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const banned = [
  ['App', 'are'], ['Hud', 'son'], ['Kon', 'ami'], ['PC ', 'Engine'], ['PC-', 'Engine'], ['referencias', '/'], ['juego ', 'original'], ['escena ', 'original'], ['en el ', 'clip'], ['los ', 'clips'],
].map(([a, b]) => new RegExp(a + b, 'i'));

const skipDirs = new Set(['node_modules', 'dist', '.git', '.build', 'training', 'partidas', 'fixtures']);
const skipFiles = new Set(['package-lock.json', 'legal.test.ts', 'golden.json', 'planner-golden.json']);
const exts = /\.(ts|mjs|md|json|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!skipDirs.has(name)) walk(p, out); } else if (exts.test(name) && !skipFiles.has(name)) out.push(p);
  }
  return out;
}

const hits: string[] = [];
const files = walk('.');
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => { if (banned.some((r) => r.test(l))) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`); });
}
console.log(`${hits.length === 0 ? '✓' : '✗'} ningún nombre ni referencia prohibida en ${files.length} archivos`);
hits.slice(0, 20).forEach((h) => console.log('   ' + h));
if (hits.length) process.exit(1);
console.log('\nTodo bien');
