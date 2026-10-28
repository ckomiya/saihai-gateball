// Valida un kantoku contra los pesos a mano (u otro kantoku): partidos en pares con los colores cambiados, con semillas nuevas y certeza de jugadores sorteada.
// Uso: npm run validate -- --games 200 [--file src/game/cpuWeights.json] [--vs hand] [--finals 60] [--bank training/endbank.json] [--seed 7000000]
//   --file / --vs: un archivo de pesos, `initial` (los pesos de partida, sin entrenar), `gen:N` (la media tras la generación N de --dir, v1 o v2), `current` (el campeón actual, hoy el v2) o `v1` (el respaldo) o, en --vs, `hand`.
//   --error-scale k: multiplica el error base de los dos equipos (por defecto 1; el nivel «Kantoku IA» usa 0,4) · --dir: carpeta de entrenamiento (training o training/v2).
//   --games = partidos completos; --finals = partidos extra que empiezan desde posiciones de final (necesita el banco del entrenamiento).
import { existsSync, readFileSync } from 'node:fs';
import type { SavedState } from '../src/game/match';
import { AnyWeightFile, WeightFile, genomeToFile, initialGenome } from '../src/game/weights';
import { BrainSpec, EndBank, GameOut, Pool, Scale, championV1, currentChampion, defaultWorkers, fileFromGenome, newPair, pairGames, workerGuard } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/** Quita una pieza del kantoku para medir cuánto aporta: `fases` (los mismos pesos en todo el partido), `muestras` (sin simular con error), `acomodo` (sin la certeza al acomodar). */
function ablate(f: AnyWeightFile, what: string): AnyWeightFile {
  if (f.version !== 1) throw new Error('--ablate solo funciona con el campeón v1');
  const c = JSON.parse(JSON.stringify(f)) as WeightFile;
  if (what === 'fases') for (const ph of ['inicio', 'final'] as const) for (const k of Object.keys(c.mult[ph]) as (keyof WeightFile['mult']['inicio'])[]) c.mult[ph][k] = 1;
  else if (what === 'muestras') c.sims.errorSamples = 0;
  else if (what === 'acomodo') { c.base.posProb = 0; c.base.nextMateBonus = 0; }
  else if (what) throw new Error(`--ablate desconocido: ${what}`);
  return c;
}

/** Pesos de un cerebro a partir de su nombre. */
function load(spec: string): { brain: BrainSpec; label: string } {
  if (spec === 'hand') return { brain: { kind: 'hand' }, label: 'pesos a mano' };
  if (spec === 'v1') return { brain: { kind: 'kantoku', file: championV1 }, label: 'campeón v1 (respaldo)' };
  if (spec === 'current') return { brain: { kind: 'kantoku', file: currentChampion }, label: 'campeón actual' };
  if (spec === 'initial') return { brain: { kind: 'kantoku', file: genomeToFile(initialGenome()) }, label: 'kantoku sin entrenar' };
  if (spec.startsWith('gen:')) {
    const n = Number(spec.slice(4));
    const g = JSON.parse(readFileSync(`${str('dir', 'training')}/gen_${String(n).padStart(3, '0')}.json`, 'utf8')) as { mean: number[]; riskWeights?: number[] };
    return { brain: { kind: 'kantoku', file: fileFromGenome(g.mean, g.riskWeights) }, label: `kantoku de la generación ${n}` };
  }
  return { brain: { kind: 'kantoku', file: JSON.parse(readFileSync(spec, 'utf8')) as AnyWeightFile }, label: `kantoku (${spec})` };
}

async function main() {
  const games = Number(str('games', '200'));
  const finals = Number(str('finals', '0'));
  const seed = Number(str('seed', '7000000'));
  const a = load(str('file', 'src/game/cpuWeights.json'));
  const what = str('ablate', '');
  if (what && a.brain.kind === 'kantoku') { a.brain = { kind: 'kantoku', file: ablate(a.brain.file, what) }; a.label += ` sin ${what}`; }
  const b = load(str('vs', 'hand'));
  // --kscale exec,plan: error de ejecución y lo que el planificador cree del primer cerebro, como múltiplo del error base (por defecto 1,1)
  const [ke, kp] = str('kscale', '1,1').split(',').map(Number);
  const kscale: Scale = { exec: ke, plan: kp };
  const errorScale = Number(str('error-scale', '1'));
  if (ke !== 1 || kp !== 1) a.label += ` (error ejecución ×${ke}, cree ×${kp})`;
  const pool = new Pool(Number(str('workers', String(defaultWorkers()))));
  try {
    const report = async (title: string, nGames: number, bank: EndBank | null, seed0: number) => {
      const specs = [];
      for (let k = 0; k < Math.floor(nGames / 2); k++) specs.push(...pairGames(newPair(seed0 + k, bank, bank ? 1 : 0), a.brain, b.brain, specs.length, kscale));
      const t0 = Date.now();
      const outs: GameOut[] = await pool.run(specs.map((s) => ({ ...s, baseScale: errorScale })));
      let w = 0, d = 0, l = 0, sumDiff = 0, sumSq = 0;
      const byColor = [{ w: 0, n: 0 }, { w: 0, n: 0 }];
      outs.forEach((o, i) => {
        const side = i % 2; // 0: el primero juega rojas; 1: blancas
        const mine = side === 0 ? o.red : o.white, theirs = side === 0 ? o.white : o.red;
        const dd = mine - theirs;
        if (dd > 0) { w++; byColor[side].w++; } else if (dd === 0) d++; else l++;
        byColor[side].n++;
        sumDiff += dd; sumSq += dd * dd;
      });
      const n = outs.length, rate = (w + 0.5 * d) / n, se = Math.sqrt((rate * (1 - rate)) / n);
      const meanDiff = sumDiff / n, seDiff = Math.sqrt(Math.max(0, sumSq / n - meanDiff ** 2) / n);
      console.log(
        `${title} · ${a.label} contra ${b.label}: ${n} partidos · gana ${w}, empata ${d}, pierde ${l} → ${(100 * rate).toFixed(1)} % (±${(196 * se).toFixed(1)} % al 95 %) · ` +
        `como rojas ${byColor[0].w}/${byColor[0].n}, como blancas ${byColor[1].w}/${byColor[1].n} · diferencia media de puntos ${meanDiff >= 0 ? '+' : ''}${meanDiff.toFixed(2)} (±${(1.96 * seDiff).toFixed(2)}) · ${((Date.now() - t0) / 1000).toFixed(0)} s`,
      );
    };
    await report('Partidos completos', games, null, seed);
    if (finals > 0) {
      const bankPath = str('bank', 'training/endbank.json');
      if (!existsSync(bankPath)) console.log(`(sin banco de finales en ${bankPath}: no se validan los finales)`);
      else await report('Desde posiciones de final', finals, new EndBank(JSON.parse(readFileSync(bankPath, 'utf8')) as SavedState[]), seed + 500000);
    }
  } finally {
    await pool.close();
  }
}

if (!workerGuard()) await main();
