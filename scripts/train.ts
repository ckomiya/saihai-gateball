// Entrenamiento del kantoku artificial v2 (iteración C): calibra por autojuego los pesos de la valoración del planificador (src/game/weights.ts, `genes2`).
// Uso: npm run train                      → entrena 30 generaciones (retoma solo si se corta, desde training/v2/state.json)
//      npm run train -- --generations 2 --dir training/pilot2 --no-publish    → piloto
//      npm run train -- --fresh           → empieza de cero (borra el estado guardado)
// Después: npm run select  (elige el campeón entre los últimos puntos de control validándolos contra el campeón actual).
// Opciones: --generations 30  --lambda 24  --sigma 0.4  --workers N  --seed 1  --dir training/v2  --end-fraction 0.4  --bank 400
//           --hand-pairs 2  --champion-pairs 2  --hof-pairs 2  --group-rounds 2  --hof-every 5  --monitor 5  --monitor-pairs 6  --no-publish
//           --risk-weights 1,1,1,1,1   peso de cada bola rival según su turno en el riesgo (por defecto 1,0.5,0.25, con lo que se entrenó el v2). Cada punto de control guarda
//                                      con qué estructura se entrenó, así que se puede seguir un entrenamiento cambiándola:
//                                      npm run train -- --generations 50 --risk-weights 1,1,1,1,1
// Liga: pesos a mano, el campeón actual (congelado), puntos de control de esta misma corrida y autojuego dentro del grupo. Error: el del nivel «Kantoku IA»
// (error base × `kantokuLevelErrorScale`) para los dos equipos. Ver TRAINING.md.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../src/config';
import type { SavedState } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { Gene, WeightFile2, clampGene, genes2, genes3, genes4, genomeToFile2 } from '../src/game/weights';
import { behaviorScore } from './behavior';
import { CmaState, SepCma } from './cma';
import { BrainSpec, EndBank, GameOut, GameSpec, PairSpec, Pool, buildBank, championV1, championV2, currentChampion, defaultWorkers, newPair, pairGames, workerGuard } from './trainLib';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const num = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

let GENES: Gene[] = genes2(championV1); // el v1 (respaldo) fija los valores de partida y los límites de los genes
let GENOME_SIZE = GENES.length;
let V4 = false; // iteración G: como el v3, pero solo aprende los pesos del v2 y el equilibrio entre puntos y ataque (`leadSlope`, `clockSlope`); las reglas quedan fijas; error del nivel (humano ×0,6); la aptitud suma las pruebas de comportamiento
let START_RULES: WeightFile2['rules'];
let V3 = false; // iteración E: genoma del v2 + constantes de reglas, que parte del campeón actual (`dir/start.json`) y activa las reglas avanzadas
/** Parámetros en unidades de su escala → pesos: valor inicial + escala × y, dentro de los límites de cada peso. */
const phenotype = (y: number[]) => GENES.map((g, i) => clampGene(g, g.init + g.scale * y[i]));
let RISK_WEIGHTS: number[] | undefined; // estructura del riesgo de esta ejecución (undefined = la del v2: 1, 0,5, 0,25)
/** `riskWeights` undefined = la estructura del v2; ojo: se pasa siempre explícito (los puntos de control antiguos no la guardan y conservan la del v2). */
const toBrain = (genome: number[], riskWeights: number[] | undefined): BrainSpec => {
  const file = genomeToFile2(genome, GENES, undefined, riskWeights, V3 ? true : undefined);
  if (V4) file.rules = { ...START_RULES, ...file.rules }; // las reglas del campeón de partida no son genes: se conservan
  return { kind: 'kantoku', file };
};
const HAND: BrainSpec = { kind: 'hand' };
const CHAMPION: BrainSpec = { kind: 'kantoku', file: currentChampion };
const fmt = (s: number) => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)} s`);

/** Aptitud de un resultado: victorias (el empate vale ½) + 0,02 × diferencia de puntos (acotada a ±10) por partido. */
const fitnessOf = (score: number, diff: number, n: number) => score / n + 0.02 * Math.max(-10, Math.min(10, diff / n));

/** cand = índice del candidato (−1: la media contra los pesos a mano, −2: la media contra el campeón actual, para el control); side = color con el que juega. */
interface Entry { cand: number; side: 0 | 1; opp?: number }

async function main() {
  V4 = flag('v4');
  V3 = flag('v3') || V4;
  const dir = str('dir', V4 ? 'training/v4' : V3 ? 'training/v3' : 'training/v2');
  const generations = num('generations', 30);
  if (V3) {
    // El campeón de partida se guarda una vez: si el campeón del juego cambia, esta corrida (y su estado) sigue con el mismo punto de partida
    mkdirSync(dir, { recursive: true });
    const startPath = join(dir, 'start.json');
    if (!existsSync(startPath)) copyFileSync('src/game/cpuWeights.json', startPath);
    const startFile = JSON.parse(readFileSync(startPath, 'utf8')) as WeightFile2;
    START_RULES = startFile.rules;
    GENES = V4 ? genes4(startFile, championV1) : genes3(startFile, championV1);
    GENOME_SIZE = GENES.length;
  }
  // Verificación de NANABAN_SET: lo que el proceso tiene realmente en CONFIG (los hilos lo heredan de la misma variable)
  console.log(`Configuración activa → NANABAN_SET='${process.env.NANABAN_SET ?? ''}' · kantokuRiskByValue=${CONFIG.kantokuRiskByValue} · kantokuZonePassP=${CONFIG.kantokuZonePassP}`);
  if (V4 && !CONFIG.kantokuRiskByValue && !flag('allow-rbv-off')) throw new Error('El v4 se entrena con el riesgo por valor encendido: define $env:NANABAN_SET="kantokuRiskByValue=true" (o usa --allow-rbv-off para entrenar sin él).');
  const lambda = num('lambda', 24);
  const seed = num('seed', 1);
  const handPairs = num('hand-pairs', V3 ? 1 : 2), champPairs = num('champion-pairs', 2), hofPairs = num('hof-pairs', V3 ? 1 : 2), groupRounds = num('group-rounds', 2);
  const v2Pairs = num('v2-pairs', V3 ? 1 : 0); // el v2 de respaldo como rival de la liga (solo en el v3)
  const humanPairs = num('human-pairs', V3 ? 12 : 0); // diagnóstico con rival tipo humano (no entra en la aptitud), cada `--monitor` generaciones
  const humanFit = num('human-fit', 0); // pares por candidato contra un rival tipo humano QUE SÍ entran en la aptitud (iteración F: la exposición ante una persona)
  const hofEvery = num('hof-every', 5);
  const endFraction = num('end-fraction', 0.4);
  const monitorEvery = num('monitor', 5), monitorPairs = num('monitor-pairs', 6);
  const publish = !flag('no-publish');
  const rwArg = str('risk-weights', '');
  RISK_WEIGHTS = rwArg ? rwArg.split(',').map(Number) : undefined;
  if (RISK_WEIGHTS && RISK_WEIGHTS.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('--risk-weights: lista de números separados por comas, por ejemplo 1,1,1,1,1');
  const SCALE = V4 ? CONFIG.kantokuLevelErrorScale : CONFIG.kantokuTrainErrorScale; // el error del entrenamiento (base × 0,4), en los dos equipos; en el v4 el del nivel (humano × 0,6)
  const behaviorW = num('behavior', V4 ? 0.5 : 0); // peso de las pruebas de comportamiento en la aptitud (fracción cumplida × peso)
  const behaviorEvery = num('behavior-every', 1), behaviorReps = num('behavior-reps', 4), behaviorMin = num('behavior-min', 0.6); // cada cuántas generaciones; semillas por escenario; descarte duro bajo esta fracción
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'state.json');
  const bankPath = join(dir, 'endbank.json');
  const pool = new Pool(num('workers', defaultWorkers()));
  const tStart = Date.now();

  try {
    // Banco de posiciones de final de partido (se reutiliza el de la v1 si existe; si no, se arma una vez)
    let bank: EndBank;
    if (!existsSync(bankPath) && existsSync('training/endbank.json') && !flag('fresh')) {
      copyFileSync('training/endbank.json', bankPath);
      console.log('Banco de finales reutilizado de training/endbank.json');
    }
    if (existsSync(bankPath) && !flag('fresh')) {
      bank = new EndBank(JSON.parse(readFileSync(bankPath, 'utf8')) as SavedState[]);
    } else {
      const t0 = Date.now();
      console.log(`Armando el banco de finales (${num('bank', 400)} posiciones)…`);
      bank = await buildBank(pool, num('bank', 400), seed);
      writeFileSync(bankPath, JSON.stringify(bank.states));
      console.log(`  listo en ${fmt((Date.now() - t0) / 1000)}`);
    }
    console.log(`Banco de finales: ${bank.summary()}`);

    // Optimizador y salón de la fama (se retoman si existen)
    const cma = new SepCma(new Array(GENOME_SIZE).fill(0), num('sigma', 0.4), lambda);
    let history: Record<string, unknown>[] = [];
    let hof: { gen: number; genome: number[]; riskWeights?: number[] }[] = [{ gen: 0, genome: phenotype(new Array(GENOME_SIZE).fill(0)) }]; // el punto de partida
    if (existsSync(statePath) && !flag('fresh')) {
      const saved = JSON.parse(readFileSync(statePath, 'utf8')) as { cma: CmaState; history: Record<string, unknown>[]; hof: typeof hof; riskWeights?: number[] };
      if (saved.cma.mean.length !== GENOME_SIZE) throw new Error('El estado guardado es de otro genoma: usa --fresh o otro --dir');
      cma.state = saved.cma;
      history = saved.history;
      hof = saved.hof;
      console.log(`Retomando en la generación ${cma.state.gen + 1} de ${generations}`);
      if (JSON.stringify(saved.riskWeights ?? null) !== JSON.stringify(RISK_WEIGHTS ?? null)) {
        console.log(`  Cambia la estructura del riesgo: ${JSON.stringify(saved.riskWeights ?? [1, 0.5, 0.25])} → ${JSON.stringify(RISK_WEIGHTS ?? [1, 0.5, 0.25])} (los puntos de control anteriores conservan la suya)`);
      }
    }
    console.log(
      `Genoma de ${GENOME_SIZE} números · población ${lambda} · ${pool.size} hilos · liga por candidato: ${handPairs} pares contra pesos a mano, ${champPairs} contra el campeón actual, ` +
      `${hofPairs} contra el salón de la fama, ${v2Pairs} contra el v2, ${groupRounds} contra el grupo · ${Math.round(endFraction * 100)} % desde finales · error ×${SCALE} · piso del riesgo ${CONFIG.kantokuRiskFloor} · pesos del riesgo por turno ${JSON.stringify(RISK_WEIGHTS ?? [1, 0.5, 0.25])}`,
    );

    let genSecondsTotal = history.reduce((s, h) => s + (h.seconds as number), 0);
    while (cma.state.gen < generations) {
      const gen = cma.state.gen;
      const t0 = Date.now();
      const genRng = mulberry32(seed * 1000003 + gen);
      const ys = cma.ask(genRng);
      const genomes = ys.map(phenotype);
      const brains = genomes.map((g) => toBrain(g, RISK_WEIGHTS));
      const base = seed * 100000000 + gen * 100000; // semillas de partido de esta generación

      const specs: GameSpec[] = [];
      const V2: BrainSpec = { kind: 'kantoku', file: championV2 };
      const entries: Entry[] = [];
      const add = (pair: [GameSpec, GameSpec], cand: number, opp?: number) => {
        for (const [k, g] of pair.entries()) { specs.push({ ...g, id: specs.length, baseScale: SCALE, baseHuman: V4 }); entries.push({ cand, side: k as 0 | 1, opp }); }
      };
      // Rivales fijos: los mismos pares para todos los candidatos (comparación justa)
      const fixed: { brain: BrainSpec; pairs: PairSpec[] }[] = [
        { brain: HAND, pairs: Array.from({ length: handPairs }, (_, h) => newPair(base + h, bank, endFraction)) },
        { brain: CHAMPION, pairs: Array.from({ length: champPairs }, (_, h) => newPair(base + 100 + h, bank, endFraction)) },
        ...(v2Pairs > 0 ? [{ brain: V2, pairs: Array.from({ length: v2Pairs }, (_, h) => newPair(base + 150 + h, bank, endFraction)) }] : []),
        // salón de la fama: puntos de control de esta corrida (al principio, solo el punto de partida)
        ...Array.from({ length: hofPairs }, (_, h) => ({ brain: (() => { const e = hof[Math.floor(genRng() * hof.length)]; return toBrain(e.genome, e.riskWeights); })(), pairs: [newPair(base + 200 + h, bank, endFraction)] })),
      ];
      for (const f of fixed) for (const pair of f.pairs) brains.forEach((b, i) => add(pairGames(pair, b, f.brain, specs.length), i));
      // Rival tipo humano en la aptitud (el v1 con `humanRivalError` y fuerza de más en el touch): los mismos pares para todos los candidatos
      if (humanFit > 0) {
        const V1h: BrainSpec = { kind: 'kantoku', file: championV1 };
        for (let k = 0; k < humanFit; k++) {
          const hp = newPair(base + 8000 + k, bank, endFraction);
          brains.forEach((b, i) => {
            const pair = pairGames(hp, b, V1h, specs.length);
            pair[0].humanSide = 1; pair[1].humanSide = 0;
            pair[0].humanExtra = pair[1].humanExtra = k % 2 ? 0.2 : 0.1;
            add(pair, i);
          });
        }
      }
      // Contra el grupo: emparejamientos al azar en cada ronda; el resultado cuenta para los dos
      for (let r = 0; r < groupRounds; r++) {
        const perm = Array.from({ length: lambda }, (_, i) => i);
        for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(genRng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
        for (let k = 0; k + 1 < lambda; k += 2) add(pairGames(newPair(base + 1000 + r * 100 + k, bank, endFraction), brains[perm[k]], brains[perm[k + 1]], specs.length), perm[k], perm[k + 1]);
      }
      // Control: cómo juega la media contra los pesos a mano y contra el campeón actual (cada tanto y en la última generación)
      const monitor = monitorPairs > 0 && (gen % monitorEvery === 0 || gen === generations - 1);
      const meanBrain = toBrain(phenotype(cma.state.mean), RISK_WEIGHTS);
      if (monitor && humanPairs > 0) {
        // Diagnóstico: la media contra un rival tipo humano (el v1 con `humanRivalError`, fuerza de más +10 %/+20 % en el touch). NO entra en la aptitud (el campeón le gana ≈ 99 %: sin gradiente)
        const V1: BrainSpec = { kind: 'kantoku', file: championV1 };
        for (let k = 0; k < humanPairs; k++) {
          const pair = pairGames(newPair(base + 7000 + k, bank, endFraction), meanBrain, V1, specs.length);
          pair[0].humanSide = 1; pair[1].humanSide = 0;
          pair[0].humanExtra = pair[1].humanExtra = k % 2 ? 0.2 : 0.1;
          add(pair, -3);
        }
      }
      if (monitor) {
        for (let k = 0; k < monitorPairs; k++) add(pairGames(newPair(base + 5000 + k, bank, endFraction), meanBrain, HAND, specs.length), -1);
        for (let k = 0; k < monitorPairs; k++) add(pairGames(newPair(base + 6000 + k, bank, endFraction), meanBrain, CHAMPION, specs.length), -2);
      }

      const outs: GameOut[] = await pool.run(specs);

      const score = new Array(lambda).fill(0), diff = new Array(lambda).fill(0), n = new Array(lambda).fill(0);
      const mon = { [-1]: { s: 0, n: 0 }, [-2]: { s: 0, n: 0 }, [-3]: { s: 0, n: 0 } } as Record<number, { s: number; n: number }>;
      let strokes = 0;
      outs.forEach((o, idx) => {
        strokes += o.strokes;
        const { cand, side, opp } = entries[idx];
        const mine = side === 0 ? o.red : o.white, theirs = side === 0 ? o.white : o.red;
        const s = mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
        if (cand < 0) { mon[cand].s += s; mon[cand].n++; return; }
        score[cand] += s; diff[cand] += mine - theirs; n[cand]++;
        if (opp !== undefined) { score[opp] += 1 - s; diff[opp] += theirs - mine; n[opp]++; }
      });
      const fit = score.map((s, i) => fitnessOf(s, diff[i], n[i]));
      // v4: las pruebas de comportamiento entran en la aptitud (un candidato que incumple casi todo no puede ganar solo por ganar partidos, como en la iteración F)
      let behaviorMean: number | null = null;
      if (behaviorW > 0 && gen % behaviorEvery === 0) {
        const bs = brains.map((b) => behaviorScore((b as { file: WeightFile2 }).file, behaviorReps, 500 + gen).score);
        bs.forEach((b, i) => { fit[i] += behaviorW * b - (b < behaviorMin ? 1 : 0); });
        behaviorMean = bs.reduce((a, b) => a + b, 0) / bs.length;
      }
      cma.tell(fit);
      if ((gen + 1) % hofEvery === 0) hof.push({ gen: gen + 1, genome: phenotype(cma.state.mean), riskWeights: RISK_WEIGHTS });

      const seconds = (Date.now() - t0) / 1000;
      genSecondsTotal += seconds;
      const best = Math.max(...fit), mean = fit.reduce((a, b) => a + b, 0) / fit.length;
      const rec = {
        gen: gen + 1, seconds, games: outs.length, strokes, msPerGame: outs.reduce((a, o) => a + o.ms, 0) / outs.length,
        bestFitness: best, meanFitness: mean, meanVsHand: mon[-1].n ? mon[-1].s / mon[-1].n : null, meanVsChampion: mon[-2].n ? mon[-2].s / mon[-2].n : null, meanVsHuman: mon[-3].n ? mon[-3].s / mon[-3].n : null, humanGames: mon[-3].n,
        monitorGames: mon[-1].n, sigma: cma.state.sigma, behavior: behaviorMean,
      };
      history.push(rec);
      writeFileSync(join(dir, `gen_${String(gen + 1).padStart(3, '0')}.json`), JSON.stringify({ ...rec, riskWeights: RISK_WEIGHTS, fitness: fit, genomes, mean: phenotype(cma.state.mean) }));
      writeFileSync(statePath, JSON.stringify({ cma: cma.state, history, hof, riskWeights: RISK_WEIGHTS }));
      const done = cma.state.gen, left = generations - done;
      console.log(
        `gen ${done}/${generations} · ${fmt(seconds)} · ${outs.length} partidos (${(outs.reduce((a, o) => a + o.ms, 0) / outs.length / 1000).toFixed(1)} s c/u) · aptitud mejor ${best.toFixed(3)} media ${mean.toFixed(3)} · ` +
        (mon[-1].n ? `la media gana ${(100 * mon[-1].s / mon[-1].n).toFixed(0)} % a los pesos a mano y ${(100 * mon[-2].s / mon[-2].n).toFixed(0)} % al campeón actual (${mon[-1].n} partidos cada uno) · ` : '') +
        (mon[-3].n ? `rival tipo humano ${(100 * mon[-3].s / mon[-3].n).toFixed(0)} % (${mon[-3].n} partidos)${mon[-3].s / mon[-3].n < 0.96 ? ' ¡BAJO 96 %!' : ''} · ` : '') +
        (behaviorMean !== null ? `comportamiento ${(100 * behaviorMean).toFixed(0)} % · ` : '') +
        `σ ${cma.state.sigma.toFixed(2)} · queda ≈ ${fmt((genSecondsTotal / history.length) * left)}`,
      );
    }

    // Campeón provisional: la media de la última generación. El definitivo se elige con `npm run select` entre los últimos puntos de control.
    const champion = genomeToFile2(phenotype(cma.state.mean), GENES, undefined, RISK_WEIGHTS, V3 ? true : undefined);
    writeFileSync(join(dir, 'champion.json'), JSON.stringify(champion, null, 1));
    if (publish) {
      writeFileSync('src/game/cpuWeights.next.json', JSON.stringify(champion, null, 1) + '\n');
      console.log('Última media guardada en src/game/cpuWeights.next.json (NO reemplaza al campeón actual ni al nivel «Kantoku IA») y en ' + join(dir, 'champion.json'));
    } else {
      console.log('Última media guardada en ' + join(dir, 'champion.json') + ' (sin publicar)');
    }
    console.log(`Tiempo total de esta sesión: ${fmt((Date.now() - tStart) / 1000)}. Siguiente: npm run select`);
  } finally {
    await pool.close();
  }
}

if (!workerGuard()) await main();
