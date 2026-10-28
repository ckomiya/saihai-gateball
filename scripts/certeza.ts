// Compara la certeza nueva del nivel «Kantoku IA» (buen jugador humano) con la anterior (base × 0,4), con los mismos pesos del campeón, o con los pesos a mano.
// Uso: npm run certeza -- --vs old|hand [--games 200] [--parts 4 --part 0] [--tag x]      y      npm run certeza -- --combine --vs old|hand --tag x
// A = campeón con la certeza del nivel (`kantokuLevelErrors()`); B = el campeón con la certeza anterior (`--vs old`) o los pesos a mano con el error del entrenamiento (`--vs hand`).
// Partidos en pares con los colores cambiados y las mismas semillas.
import { readFileSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { handBrain } from '../src/game/weights';
import { playMatch } from './selfplay';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const vs = str('vs', 'old'), tag = str('tag', 'x');
const file = (part: number) => `.build/certeza_${vs}_${tag}_${part}.json`;
const parts = Number(str('parts', '1'));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };

if (argv.includes('--combine')) {
  const rows: { score: number; diff: number }[] = [];
  for (let p = 0; p < parts; p++) rows.push(...(JSON.parse(readFileSync(file(p), 'utf8')) as { score: number; diff: number }[]));
  const sc = rows.map((r) => r.score), df = rows.map((r) => r.diff);
  console.log(`certeza nueva contra ${vs === 'old' ? 'el campeón con la certeza anterior' : 'los pesos a mano'}: ${rows.length} partidos · gana ${(100 * mean(sc)).toFixed(1)} % (±${(196 * sd(sc) / Math.sqrt(rows.length)).toFixed(1)}) · diferencia media de puntos ${mean(df).toFixed(2)} (±${(1.96 * sd(df) / Math.sqrt(rows.length)).toFixed(2)})`);
  process.exit(0);
}

const GAMES = Number(str('games', '200')), part = Number(str('part', '0'));
const a = kantokuLevelErrors();
const oldErr = { base: CONFIG.kantokuBaseError, executionScale: 0.4, planningScale: 0.4 };
const rows: { score: number; diff: number }[] = [];
for (let g = part; g < GAMES; g += parts) {
  const side = (g % 2) as 0 | 1; // equipo de A
  const seed = 31000 + (g >> 1);
  const prof = (off: number) => Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + off) % 4] }));
  const pa = prof(side), pb = prof(1 - side);
  const brainB = vs === 'old' ? kantokuBrain : handBrain;
  const errB = vs === 'old' ? oldErr : { base: CONFIG.kantokuBaseError, executionScale: 0.4, planningScale: 0.4 };
  const r = playMatch({
    seed, levels: [3, 3],
    brains: side === 0 ? [kantokuBrain, brainB] : [brainB, kantokuBrain],
    errorsByTeam: side === 0 ? [{ base: a.base }, { base: errB.base }] : [{ base: errB.base }, { base: a.base }],
    errorScales: side === 0 ? [{ exec: a.executionScale ?? 1, plan: a.planningScale ?? 1 }, { exec: errB.executionScale, plan: errB.planningScale }] : [{ exec: errB.executionScale, plan: errB.planningScale }, { exec: a.executionScale ?? 1, plan: a.planningScale ?? 1 }],
    profiles: side === 0 ? [pa, pb] : [pb, pa],
  });
  const mine = side === 0 ? r.red : r.white, theirs = side === 0 ? r.white : r.red;
  rows.push({ score: mine > theirs ? 1 : mine === theirs ? 0.5 : 0, diff: mine - theirs });
}
writeFileSync(file(part), JSON.stringify(rows));
console.log(`parte ${part}: ${rows.length} partidos · gana ${(100 * mean(rows.map((r) => r.score))).toFixed(1)} %`);
