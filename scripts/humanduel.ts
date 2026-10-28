// Liga con un rival «tipo humano»: el kantoku (con o sin las reglas avanzadas) contra un bando que se parece a una persona. Mide si las reglas avanzadas marcan diferencia.
// El rival: juega con el kantoku v1 (decide bien), pero ejecuta con el error de un buen jugador humano (`humanRivalError`, certeza neutra) y se pasa de fuerza en los intentos de touch
// (+10 % y +20 %, la mitad de los partidos cada uno, como en el experimento de la línea). El kantoku cree que su rival es una persona (`rivalIsHuman`, como en el juego).
// Mismas semillas y colores en las dos variantes (partidos en pares con los colores cambiados): se comparan juego a juego.
// Uso: npm run humanduel -- --variant rules|plain [--games 200] [--seed 9000] [--file src/game/cpuWeights.json] [--rival v1|champion]   y   npm run humanduel -- --combine
// `--rival champion`: el rival juega con el campeón sin las reglas (más fuerte que el v1: con el v1 el kantoku gana ≈ 99 % y no hay margen para ver diferencias).
import { readFileSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import type { AnyWeightFile, Brain, WeightFile2 } from '../src/game/weights';
import { championV1 } from './trainLib';
import { playMatch } from './selfplay';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const out = (v: string) => `.build/humanduel_${v}${str('tag', '')}.json`; // --tag evita pisar el archivo al comparar dos configuraciones (NANABAN_SET)
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const ci = (a: number[]) => 1.96 * sd(a) / Math.sqrt(a.length);

interface Game { score: number; diff: number; red: number; white: number }

if (argv.includes('--combine')) {
  const rules = JSON.parse(readFileSync(out('rules'), 'utf8')) as Game[];
  const plain = JSON.parse(readFileSync(out('plain'), 'utf8')) as Game[];
  const show = (name: string, g: Game[]) => console.log(`  ${name}: gana ${(100 * mean(g.map((x) => x.score))).toFixed(1)} % (±${(100 * ci(g.map((x) => x.score))).toFixed(1)}) · diferencia media de puntos ${mean(g.map((x) => x.diff)).toFixed(2)} (±${ci(g.map((x) => x.diff)).toFixed(2)}) · ${g.length} partidos`);
  console.log('Kantoku contra el rival tipo humano:');
  show('con las reglas avanzadas', rules);
  show('sin las reglas        ', plain);
  const n = Math.min(rules.length, plain.length);
  const ds = Array.from({ length: n }, (_, i) => rules[i].score - plain[i].score);
  const dp = Array.from({ length: n }, (_, i) => rules[i].diff - plain[i].diff);
  console.log(`  diferencia (con − sin, juego a juego): ${(100 * mean(ds)).toFixed(1)} puntos de porcentaje (±${(100 * ci(ds)).toFixed(1)}) · puntos ${mean(dp).toFixed(2)} (±${ci(dp).toFixed(2)})`);
  const by = (k: number) => [0, 1].map((c) => { const idx = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === c && ((i >> 1) % 2) === k); return `${(100 * mean(idx.map((i) => ds[i]))).toFixed(1)}`; });
  console.log(`  por fuerza extra del rival: +10 % (rojas, blancas) ${by(0).join(' / ')} · +20 % ${by(1).join(' / ')} (diferencia en puntos de porcentaje)`);
  process.exit(0);
}

const variant = str('variant', 'rules');
const GAMES = Number(str('games', '200'));
const SEED = Number(str('seed', '9000'));
const base = JSON.parse(readFileSync(str('file', 'src/game/cpuWeights.json'), 'utf8')) as WeightFile2;
const { advanced: _a, ...plainFile } = base;
void _a;
const kantoku: Brain = { kind: 'kantoku', file: (variant === 'rules' ? { ...plainFile, advanced: true } : plainFile) as AnyWeightFile };
const rival: Brain = { kind: 'kantoku', file: str('rival', 'v1') === 'champion' ? (plainFile as AnyWeightFile) : championV1 };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const human = { base: CONFIG.humanRivalError };
const neutral = Array.from({ length: 5 }, () => ({ short: 1, medium: 1, long: 1 }));

const games: Game[] = [];
for (let g = 0; g < GAMES; g++) {
  const side = (g % 2) as 0 | 1; // equipo del kantoku
  const extra = (g >> 1) % 2 ? 0.2 : 0.1; // fuerza de más del rival en el touch
  const kProfiles = Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + side) % 4] }));
  const res = playMatch({
    seed: SEED + g, levels: [3, 3],
    brains: side === 0 ? [kantoku, rival] : [rival, kantoku],
    errorsByTeam: side === 0 ? [own, human] : [human, own],
    errorScales: side === 0 ? [{ exec: own.executionScale ?? 1, plan: own.planningScale ?? 1 }, { exec: 1, plan: 1 }] : [{ exec: 1, plan: 1 }, { exec: own.executionScale ?? 1, plan: own.planningScale ?? 1 }],
    profiles: side === 0 ? [kProfiles, neutral] : [neutral, kProfiles],
    touchExtra: side === 0 ? [0, extra] : [extra, 0],
  });
  const mine = side === 0 ? res.red : res.white, theirs = side === 0 ? res.white : res.red;
  games.push({ score: mine > theirs ? 1 : mine === theirs ? 0.5 : 0, diff: mine - theirs, red: res.red, white: res.white });
  if ((g + 1) % 20 === 0) console.log(`  ${variant}: ${g + 1}/${GAMES} · gana ${(100 * mean(games.map((x) => x.score))).toFixed(1)} %`);
}
writeFileSync(out(variant), JSON.stringify(games));
console.log(`${variant}: gana ${(100 * mean(games.map((x) => x.score))).toFixed(1)} % (±${(100 * ci(games.map((x) => x.score))).toFixed(1)}) · puntos ${mean(games.map((x) => x.diff)).toFixed(2)}`);
