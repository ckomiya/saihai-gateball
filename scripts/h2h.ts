// Dos kantokus frente a frente con la certeza del nivel «Kantoku IA» (error humano × `kantokuLevelErrorScale`), partidos en pares con los colores cambiados.
// Uso: npm run h2h -- --file src/game/cpuWeights.json --vs src/game/cpuWeights.v4base.json [--games 200] [--seed 8300000]
// Sirve para medir un cambio de reglas que está en el archivo de pesos (`legacy…`): el mismo kantoku con y sin el cambio.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import type { AnyWeightFile } from '../src/game/weights';
import { BrainSpec, GameOut, Pool, defaultWorkers, newPair, pairGames, workerGuard } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

async function main() {
  const games = Number(str('games', '200')), seed = Number(str('seed', '8300000'));
  const load = (f: string): BrainSpec => ({ kind: 'kantoku', file: JSON.parse(readFileSync(f, 'utf8')) as AnyWeightFile });
  const a = load(str('file', 'src/game/cpuWeights.json')), b = load(str('vs', 'src/game/cpuWeights.v4base.json'));
  const pool = new Pool(Number(str('workers', String(defaultWorkers()))));
  try {
    const specs = [];
    for (let k = 0; k < Math.floor(games / 2); k++) specs.push(...pairGames(newPair(seed + k, null, 0), a, b, specs.length));
    const outs: GameOut[] = await pool.run(specs.map((s) => ({ ...s, baseScale: CONFIG.kantokuLevelErrorScale, baseHuman: true })));
    let w = 0, d = 0, l = 0, sum = 0;
    outs.forEach((o, i) => { const mine = i % 2 === 0 ? o.red : o.white, theirs = i % 2 === 0 ? o.white : o.red; sum += mine - theirs; if (mine > theirs) w++; else if (mine === theirs) d++; else l++; });
    const rate = (w + 0.5 * d) / outs.length, ci = 1.96 * Math.sqrt((rate * (1 - rate)) / outs.length);
    console.log(`${str('file', 'actual')} contra ${str('vs', 'v4base')}: ${(100 * rate).toFixed(1)} % (±${(100 * ci).toFixed(1)}) · ${w}/${d}/${l} · ${sum / outs.length >= 0 ? '+' : ''}${(sum / outs.length).toFixed(2)} puntos · ${outs.length} partidos`);
  } finally {
    await pool.close();
  }
}

if (!workerGuard()) await main();
