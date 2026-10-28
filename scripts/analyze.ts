// Qué hace distinto un kantoku frente a los pesos a mano: pesos por fase y estadísticas de juego por fase y por certeza del tirador.
// Uso: npm run analyze -- [--file src/game/cpuWeights.json] [--games 200] [--seed 7000000]
// Juega kantoku contra pesos a mano (pares con los colores cambiados, certeza sorteada, error base realista) y compara a los dos equipos.
import { readFileSync } from 'node:fs';
import { Weights, WeightFile, handWeights, resolveWeights } from '../src/game/weights';
import { CLASSES, GameOut, INTENTS, PHASES, Pool, SideStats, defaultWorkers, emptySide, newPair, pairGames, workerGuard } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const num = (v: number, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)} %` : '–');

function sum(stats: SideStats[]): SideStats {
  const t = emptySide();
  for (const s of stats) {
    for (const k of ['strokes', 'points', 'touches', 'touchesSuffered', 'rivalKnocked', 'ownOut', 'faults', 'gate4', 'poleReached'] as const) s[k].forEach((v, i) => { t[k][i] += v; });
    s.intents.forEach((m, i) => { for (const [k, v] of Object.entries(m)) t.intents[i][k] = (t.intents[i][k] ?? 0) + v; });
    for (const k of ['goalAttempts', 'goalHits', 'chosenBand'] as const) for (const c of CLASSES) s[k][c].forEach((v, i) => { t[k][c][i] += v; });
  }
  return t;
}

async function main() {
  const file = JSON.parse(readFileSync(str('file', 'src/game/cpuWeights.json'), 'utf8')) as WeightFile;
  const games = Number(str('games', '200'));
  const seed = Number(str('seed', '7000000'));

  // 1. Pesos por fase
  console.log('## Pesos de la valoración (mano contra campeón por fase)\n');
  const rows: [string, Weights, Weights, Weights][] = [['', resolveWeights(file, 'inicio'), resolveWeights(file, 'medio'), resolveWeights(file, 'final')]];
  const [, wi, wm, wf] = rows[0];
  const keys = (Object.keys(handWeights) as (keyof Weights)[]).filter((k) => typeof handWeights[k] === 'number' && [handWeights[k], wi[k], wm[k], wf[k]].some((v) => v !== (handWeights[k] as number)));
  console.log('término'.padEnd(20) + 'mano'.padStart(8) + 'inicio'.padStart(9) + 'medio'.padStart(9) + 'final'.padStart(9));
  for (const k of keys) console.log(String(k).padEnd(20) + [handWeights[k], wi[k], wm[k], wf[k]].map((v) => num(v as number).padStart(k === keys[0] ? 8 : 9)).join('').replace(/^ {0,1}/, (m) => m));

  // 2. Partidos
  const pool = new Pool(Number(str('workers', String(defaultWorkers()))));
  try {
    const specs = [];
    for (let k = 0; k < Math.floor(games / 2); k++) {
      for (const g of pairGames(newPair(seed + k, null, 0), { kind: 'kantoku', file }, { kind: 'hand' }, specs.length)) specs.push({ ...g, analyze: true });
    }
    console.log(`\nJugando ${specs.length} partidos del kantoku contra los pesos a mano…`);
    const outs: GameOut[] = await pool.run(specs);
    const kan = sum(outs.map((o, i) => o.stats![i % 2]));
    const man = sum(outs.map((o, i) => o.stats![1 - (i % 2)]));
    const n = outs.length;

    console.log(`\n## Comportamiento por fase (por partido; ${n} partidos)\n`);
    console.log('fase / métrica'.padEnd(34) + 'mano'.padStart(9) + 'kantoku'.padStart(9));
    PHASES.forEach((ph, p) => {
      console.log(`-- ${ph}`);
      const line = (name: string, a: number, b: number, per = n) => console.log('  ' + name.padEnd(32) + num(a / per).padStart(9) + num(b / per).padStart(9));
      line('golpes', man.strokes[p], kan.strokes[p]);
      line('puntos sumados', man.points[p], kan.points[p]);
      line('touches logrados', man.touches[p], kan.touches[p]);
      line('touches que recibe', man.touchesSuffered[p], kan.touchesSuffered[p]);
      line('bolas rivales que saca', man.rivalKnocked[p], kan.rivalKnocked[p]);
      line('bolas propias que salen', man.ownOut[p], kan.ownOut[p]);
      line('faltas', man.faults[p], kan.faults[p]);
      console.log('  ' + 'llega al poste (de los golpes en el poste)'.padEnd(32) + pct(man.poleReached[p], man.gate4[p]).padStart(9) + pct(kan.poleReached[p], kan.gate4[p]).padStart(9));
      for (const it of INTENTS) {
        if (it === 'salida' || it === 'spark') continue;
        console.log('  ' + `intención: ${it}`.padEnd(32) + pct(man.intents[p][it] ?? 0, man.strokes[p]).padStart(9) + pct(kan.intents[p][it] ?? 0, kan.strokes[p]).padStart(9));
      }
    });

    console.log('\n## Por certeza del tirador\n');
    const bands = ['corto (≤4 m)', 'medio (4–9 m)', 'largo (>9 m)'];
    for (const c of CLASSES) {
      const tot = (s: SideStats) => s.chosenBand[c].reduce((a, b) => a + b, 0);
      console.log(`-- ${c}: golpes ${tot(man)} (mano) y ${tot(kan)} (kantoku)`);
      bands.forEach((b, i) => {
        const hit = (s: SideStats) => `${pct(s.goalHits[c][i], s.goalAttempts[c][i])} de ${s.goalAttempts[c][i]}`;
        console.log(`  ${b.padEnd(15)} reparte sus golpes: mano ${pct(man.chosenBand[c][i], tot(man)).padStart(5)} · kantoku ${pct(kan.chosenBand[c][i], tot(kan)).padStart(5)}   | acierta puerta/poste: mano ${hit(man).padEnd(12)} kantoku ${hit(kan)}`);
      });
    }
  } finally {
    await pool.close();
  }
}

if (!workerGuard()) await main();
