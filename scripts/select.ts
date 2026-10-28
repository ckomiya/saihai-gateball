// Elige el campeón entre los últimos puntos de control del entrenamiento v2: cada uno juega contra el campeón actual (colores cambiados, semillas nuevas, error del nivel)
// y gana el mejor. Después, con --verdict, comprueba los criterios para reemplazar al nivel «Kantoku IA».
// Uso: npm run select -- [--dir training/v2] [--from 20] [--to 30] [--step 2] [--games 100] [--verdict]
// Escribe el elegido en src/game/cpuWeights.next.json (no reemplaza al campeón actual ni al nivel «Kantoku IA»).
// Criterios de Chris (iteración C): ≥ 57 % contra el campeón actual con el límite inferior del intervalo > 50 % (200 partidos), ≥ 90 % contra los pesos a mano, y menos
// exposición en `npm run exposure` (reentrada desde fuera y salida de la puerta 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../src/config';
import type { AnyWeightFile } from '../src/game/weights';
import { BrainSpec, GameOut, Pool, currentChampion, defaultWorkers, fileFromGenome, newPair, pairGames, workerGuard } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

interface Result { w: number; d: number; l: number; n: number; rate: number; ci: number; diff: number }

async function main() {
  const dir = str('dir', 'training/v2');
  const from = Number(str('from', '20')), to = Number(str('to', '30')), step = Number(str('step', '2'));
  const games = Number(str('games', '100'));
  const v4 = process.argv.includes('--v4'); // iteración G: se compara con la certeza del nivel (humano × 0,6)
  const scale = v4 ? CONFIG.kantokuLevelErrorScale : CONFIG.kantokuTrainErrorScale; // la selección compara con el error del entrenamiento (base × 0,4), no con el del nivel
  const pool = new Pool(Number(str('workers', String(defaultWorkers()))));
  const current: BrainSpec = { kind: 'kantoku', file: currentChampion };
  const hand: BrainSpec = { kind: 'hand' };

  /** `a` contra `b`: partidos completos en pares con los colores cambiados. */
  const duel = async (a: BrainSpec, b: BrainSpec, n: number, seed0: number): Promise<Result> => {
    const specs = [];
    for (let k = 0; k < Math.floor(n / 2); k++) specs.push(...pairGames(newPair(seed0 + k, null, 0), a, b, specs.length));
    const outs: GameOut[] = await pool.run(specs.map((s) => ({ ...s, baseScale: scale, baseHuman: v4 })));
    let w = 0, d = 0, l = 0, sum = 0;
    outs.forEach((o, i) => {
      const mine = i % 2 === 0 ? o.red : o.white, theirs = i % 2 === 0 ? o.white : o.red;
      sum += mine - theirs;
      if (mine > theirs) w++; else if (mine === theirs) d++; else l++;
    });
    const rate = (w + 0.5 * d) / outs.length;
    return { w, d, l, n: outs.length, rate, ci: 1.96 * Math.sqrt((rate * (1 - rate)) / outs.length), diff: sum / outs.length };
  };
  const show = (r: Result) => `${(100 * r.rate).toFixed(1)} % (±${(100 * r.ci).toFixed(1)}) · ${r.w}/${r.d}/${r.l} · ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(2)} puntos`;

  try {
    console.log(`Puntos de control ${from} a ${to} (cada ${step}) contra el campeón actual, ${games} partidos cada uno, error ×${scale}\
`);
    let best: { gen: number; file: AnyWeightFile; res: Result } | null = null;
    for (let g = from; g <= to; g += step) {
      const ck = JSON.parse(readFileSync(join(dir, `gen_${String(g).padStart(3, '0')}.json`), 'utf8')) as { mean: number[]; riskWeights?: number[] };
      const file = fileFromGenome(ck.mean, ck.riskWeights);
      const res = await duel({ kind: 'kantoku', file }, current, games, 8000000);
      console.log(`  generación ${g}: ${show(res)}`);
      if (!best || res.rate + 0.01 * res.diff > best.res.rate + 0.01 * best.res.diff) best = { gen: g, file, res };
    }
    if (!best) throw new Error('No hay puntos de control en ese rango');
    writeFileSync('src/game/cpuWeights.next.json', JSON.stringify(best.file, null, 1) + '\
');
    writeFileSync(join(dir, 'selected.json'), JSON.stringify({ gen: best.gen, result: best.res }));
    console.log(`\
Elegida la generación ${best.gen}; guardada en src/game/cpuWeights.next.json`);

    if (argv.includes('--verdict')) {
      const next: BrainSpec = { kind: 'kantoku', file: best.file };
      const vsCurrent = await duel(next, current, 200, 8100000);
      const vsHand = await duel(next, hand, 200, 8200000);
      const ok1 = vsCurrent.rate >= 0.57 && vsCurrent.rate - vsCurrent.ci > 0.5, ok2 = vsHand.rate >= 0.9;
      console.log('\
VEREDICTO (200 partidos cada uno)');
      console.log(`  ${ok1 ? 'SÍ' : 'NO'} · contra el campeón actual: ${show(vsCurrent)}  (pide ≥ 57 % y límite inferior > 50 %)`);
      console.log(`  ${ok2 ? 'SÍ' : 'NO'} · contra los pesos a mano: ${show(vsHand)}  (pide ≥ 90 %)`);
      console.log('  falta · menos exposición: npm run exposure -- --brain src/game/cpuWeights.next.json --rival champion --games 40   (y lo mismo con --brain champion para comparar)');
      console.log(ok1 && ok2 ? '  → cumple los dos criterios de victorias; falta mirar la exposición.' : '  → NO cumple: el nivel «Kantoku IA» no se reemplaza.');
    }
  } finally {
    await pool.close();
  }
}

if (!workerGuard()) await main();
