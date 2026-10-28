// Piezas compartidas por scripts/train.ts y scripts/validate.ts: partidos de entrenamiento, pool de hilos (worker_threads) y banco de finales.
import { cpus } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/config';

// NANABAN_SET="clave=valor,clave=valor": cambia valores de CONFIG en este proceso y en sus workers (comparar una regla nueva con la anterior en `validate` y `humanduel`)
for (const kv of (process.env.NANABAN_SET ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (CONFIG as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}
import { Profile, randomProfile, scaleError } from '../src/game/certainty';
import type { SavedState } from '../src/game/match';
import { bandOf } from '../src/game/certainty';
import { distTo, goalOf } from '../src/game/cpu';
import { inPlay } from '../src/game/match';
import { phaseOf } from '../src/game/phase';
import { Rng, mulberry32 } from '../src/game/rng';
import cpuWeightsCurrent from '../src/game/cpuWeights.json';
import cpuWeightsV1 from '../src/game/cpuWeights.v1.json';
import cpuWeightsV2 from '../src/game/cpuWeights.v2.json';
import { AnyWeightFile, Brain, RULE_GENES4, WeightFile, WeightFile2, genes2, genes3, genes4, genomeToFile, genomeToFile2, handBrain } from '../src/game/weights';
import { playMatch } from './selfplay';

/** Quién valora los golpes: los pesos a mano o un kantoku (se manda su archivo de pesos, no funciones). */
export type BrainSpec = { kind: 'hand' } | { kind: 'kantoku'; file: AnyWeightFile };

/** El campeón del nivel «Kantoku IA» (hoy el v2, `cpuWeights.json`): el rival fijo de la liga y la referencia de la validación. */
export const currentChampion = cpuWeightsCurrent as AnyWeightFile;

/** El campeón v1 (`cpuWeights.v1.json`, respaldo): de él salen los valores de partida y los límites de los genes del v2, así que los puntos de control del v2 se reconstruyen igual. */
export const championV1 = cpuWeightsV1 as WeightFile;

/** El v2 de 30 generaciones (`cpuWeights.v2.json`, respaldo): rival de la liga del v3. */
export const championV2 = cpuWeightsV2 as AnyWeightFile;

/** Archivo de pesos a partir de un genoma guardado: v1 (36 números), v2 (el tamaño de `genes2`) o v3 (v2 + constantes de reglas; las reglas avanzadas van activadas, como en el campeón). */
export function fileFromGenome(x: number[], riskWeights?: number[]): AnyWeightFile {
  const g2 = genes2(championV1);
  if (x.length === g2.length) return genomeToFile2(x, g2, undefined, riskWeights);
  // v4 (iteración G): v2 + `leadSlope` y `clockSlope`; las constantes de reglas del campeón de partida se conservan fijas
  if (x.length === g2.length + RULE_GENES4.length) {
    const start = currentChampion as WeightFile2;
    const f = genomeToFile2(x, genes4(start, championV1), undefined, riskWeights, true);
    f.rules = { ...start.rules, ...f.rules };
    return f;
  }
  const g3 = genes3(currentChampion as WeightFile2, championV1);
  return x.length === g3.length ? genomeToFile2(x, g3, undefined, riskWeights, true) : genomeToFile(x);
}

export interface GameSpec {
  id: number;
  seed: number;
  brains: [BrainSpec, BrainSpec]; // rojas, blancas
  profiles: [Profile[], Profile[]]; // certeza de los 5 jugadores de cada equipo
  start?: SavedState; // partido desde un final guardado
  captureFinals?: boolean; // devuelve estados de final de partido (para armar el banco)
  scales?: [{ exec: number; plan: number }, { exec: number; plan: number }]; // error de ejecución y creencia del planificador, por equipo (rojas, blancas)
  baseHuman?: boolean; // el error base es el de un buen jugador humano (`humanRivalError`, como el nivel «Kantoku IA») y no el `kantokuBaseError` del entrenamiento (v4)
  baseScale?: number; // multiplicador del error base de los dos equipos (por defecto 1; el entrenamiento v2 y la validación del nivel usan `kantokuLevelErrorScale`)
  analyze?: boolean; // devuelve estadísticas de juego por equipo (scripts/analyze.ts)
  /** Diagnóstico con rival tipo humano (como `npm run humanduel`): el equipo `humanSide` ejecuta con `humanRivalError`, sin certeza y con `extra` de fuerza de más al atacar; el otro cree que su rival es una persona. */
  humanSide?: 0 | 1;
  humanExtra?: number;
}

export interface GameOut { id: number; red: number; white: number; strokes: number; ms: number; captured?: SavedState[]; stats?: [SideStats, SideStats] }

// ---------- Estadísticas de juego (scripts/analyze.ts) ----------

export const PHASES = ['inicio', 'medio', 'final'] as const;
export const INTENTS = ['meta', 'touchRival', 'touchPropia', 'acomodo', 'salida', 'spark'] as const;
export const CLASSES = ['certeroCorto', 'certeroLargo', 'otro'] as const;
const BANDS = ['short', 'medium', 'long'] as const;

/** Contadores de un equipo en una partida, por fase (inicio, medio, final). */
export interface SideStats {
  strokes: number[];
  points: number[]; // puntos que sumó el equipo en sus golpes
  intents: Record<string, number>[]; // por fase: intención del golpe (según dónde apunta)
  touches: number[]; // touches logrados
  touchesSuffered: number[]; // touches que le hizo el rival a sus bolas
  rivalKnocked: number[]; // bolas rivales que saca de la cancha
  ownOut: number[]; // bolas propias que salen (la que golpea o empujadas)
  faults: number[];
  gate4: number[]; // golpes con la bola ya en el último paso (poste)
  poleReached: number[]; // ... y los que llegan al poste
  goalAttempts: Record<string, number[]>; // clase de certeza del tirador → golpes con intención de puerta o poste por tramo de distancia a la meta (corto, medio, largo)
  goalHits: Record<string, number[]>;
  chosenBand: Record<string, number[]>; // clase → cuántos golpes de cualquier intención en cada tramo de distancia
}

const zeros = (n = 3) => new Array<number>(n).fill(0);
export const emptySide = (): SideStats => ({
  strokes: zeros(), points: zeros(), intents: PHASES.map(() => ({})), touches: zeros(), touchesSuffered: zeros(), rivalKnocked: zeros(),
  ownOut: zeros(), faults: zeros(), gate4: zeros(), poleReached: zeros(),
  goalAttempts: Object.fromEntries(CLASSES.map((c) => [c, zeros()])), goalHits: Object.fromEntries(CLASSES.map((c) => [c, zeros()])),
  chosenBand: Object.fromEntries(CLASSES.map((c) => [c, zeros()])),
});

/** Certeza del tirador: especialista de tiro corto, de tiro largo u otro. */
const classOf = (p: Profile) => (p.short <= 0.8 && p.long >= 1.2 ? 'certeroCorto' : p.long <= 0.8 && p.short >= 1.2 ? 'certeroLargo' : 'otro');


const toBrain = (b: BrainSpec): Brain => (b.kind === 'hand' ? handBrain : { kind: 'kantoku', file: b.file });

/** Nivel de la CPU en el entrenamiento: el 4 usa siempre el planificador y sin ruido de valoración; el error lo da `kantokuBaseError` × el perfil. */
const TRAIN_LEVEL = 3;

/** Opciones de `playMatch` del diagnóstico con rival tipo humano. */
function humanRivalOptions(spec: GameSpec) {
  const own = { base: scaleError(spec.baseHuman ? CONFIG.humanRivalError : CONFIG.kantokuBaseError, spec.baseScale ?? 1), rivalIsHuman: true };
  const human = { base: CONFIG.humanRivalError };
  const side = spec.humanSide!;
  return {
    errorsByTeam: (side === 0 ? [human, own] : [own, human]) as [typeof human, typeof own],
    touchExtra: (side === 0 ? [spec.humanExtra ?? 0.1, 0] : [0, spec.humanExtra ?? 0.1]) as [number, number],
  };
}

export function runGame(spec: GameSpec): GameOut {
  const t0 = performance.now();
  const captured: SavedState[] = [];
  let firstTurnStarts = -1;
  const stats: [SideStats, SideStats] = [emptySide(), emptySide()];
  let pending: { phase: number; points: [number, number]; scoring: boolean; cls: string; band: number } | null = null;
  const r = playMatch({
    onShot: spec.analyze ? (m, team, plan) => {
      const b = m.b, ph = PHASES.indexOf(phaseOf(m));
      const s = stats[team];
      s.strokes[ph]++;
      const distAim = distTo(b, plan.aim);
      let intent: (typeof INTENTS)[number] = 'acomodo';
      if (m.sparkBall) intent = 'spark';
      else if (b.nextGate === 1) intent = 'salida';
      else {
        const target = m.balls.find((o) => o !== b && inPlay(o) && distTo(o, plan.aim) < 0.6);
        if (target) intent = target.team !== b.team ? 'touchRival' : 'touchPropia';
        else {
          const g = goalOf(b.nextGate);
          const dx = plan.aim.x - b.x, dy = plan.aim.y - b.y, len2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((g.x - b.x) * dx + (g.y - b.y) * dy) / len2));
          if (Math.hypot(b.x + dx * t - g.x, b.y + dy * t - g.y) < 0.3) intent = 'meta';
        }
      }
      s.intents[ph][intent] = (s.intents[ph][intent] ?? 0) + 1;
      const cls = classOf(m.profiles[m.turn]);
      s.chosenBand[cls][BANDS.indexOf(bandOf(distAim))]++;
      const scoring = intent === 'meta' && b.nextGate >= 2 && b.nextGate <= 4 && !b.outBall; // solo los golpes que apuntan a la meta
      const band = scoring ? BANDS.indexOf(bandOf(distTo(b, goalOf(b.nextGate)))) : -1;
      if (scoring) { s.goalAttempts[cls][band]++; if (b.nextGate === 4) s.gate4[ph]++; }
      pending = { phase: ph, points: [m.teamScore(0), m.teamScore(1)], scoring, cls, band };
    } : undefined,
    onResult: spec.analyze ? (m, res, team) => {
      const p = pending!;
      const s = stats[team], o = stats[1 - team];
      s.points[p.phase] += m.teamScore(team) - p.points[team];
      const teamOf = (n: number) => (n % 2 === 1 ? 0 : 1);
      let scored = false;
      for (const e of res.events) {
        if ((e.type === 'gate' || e.type === 'pole') && e.stroker) { scored = true; if (e.type === 'pole') s.poleReached[p.phase]++; }
        else if (e.type === 'touch') { s.touches[p.phase]++; o.touchesSuffered[p.phase] += e.balls.filter((n) => teamOf(n) !== team).length; }
        else if (e.type === 'out') { if (teamOf(e.ball) === team) s.ownOut[p.phase]++; else s.rivalKnocked[p.phase]++; }
        else if (e.type === 'strokerOut' && !e.start) { s.ownOut[p.phase]++; if (e.foul) s.faults[p.phase]++; }
        else if (e.type === 'sparkFoul') s.faults[p.phase]++;
      }
      if (p.scoring && scored) s.goalHits[p.cls][p.band]++;
    } : undefined,
    seed: spec.seed,
    levels: [TRAIN_LEVEL, TRAIN_LEVEL],
    brains: [toBrain(spec.brains[0]), toBrain(spec.brains[1])],
    errors: { base: scaleError(spec.baseHuman ? CONFIG.humanRivalError : CONFIG.kantokuBaseError, spec.baseScale ?? 1) },
    ...(spec.humanSide !== undefined ? humanRivalOptions(spec) : {}),
    profiles: spec.humanSide !== undefined ? spec.profiles.map((p, t) => (t === spec.humanSide ? p.map(() => ({ short: 1, medium: 1, long: 1 })) : p)) as [Profile[], Profile[]] : spec.profiles,
    errorScales: spec.scales,
    start: spec.start,
    onStroke: spec.captureFinals
      ? (m, fresh) => {
          if (!fresh || phaseOf(m) !== 'final') return;
          if (captured.length === 0) { captured.push(m.saveState()); firstTurnStarts = m.turnStarts; }
          else if (captured.length === 1 && m.turnStarts >= firstTurnStarts + 6) captured.push(m.saveState());
        }
      : undefined,
  });
  return { id: spec.id, red: r.red, white: r.white, strokes: r.strokes, ms: performance.now() - t0, captured, stats: spec.analyze ? stats : undefined };
}

// ---------- Pares de partidos con los colores cambiados ----------

/** Banco de posiciones de final de partido con distintos marcadores. Se sortea por tramos de diferencia de puntos, para que haya de todo. */
export class EndBank {
  private bins: SavedState[][] = [[], [], [], [], []];
  constructor(readonly states: SavedState[]) {
    for (const s of states) {
      const diff = s.balls.filter((b) => b.team === 0).reduce((a, b) => a + b.points, 0) - s.balls.filter((b) => b.team === 1).reduce((a, b) => a + b.points, 0);
      const k = diff <= -6 ? 0 : diff <= -2 ? 1 : diff <= 1 ? 2 : diff <= 5 ? 3 : 4;
      this.bins[k].push(s);
    }
  }
  summary() { return `${this.states.length} posiciones por diferencia de puntos (rojas − blancas): ${this.bins.map((b) => b.length).join(' / ')} (≤−6, −5..−2, −1..1, 2..5, ≥6)`; }
  sample(rng: Rng): SavedState {
    const full = this.bins.filter((b) => b.length);
    const bin = full[Math.floor(rng() * full.length)];
    return bin[Math.floor(rng() * bin.length)];
  }
}

export interface PairSpec { seed: number; A: Profile[]; B: Profile[]; start?: SavedState }

/** Un par de partidos: los mismos sorteos (semilla, certeza de los jugadores y, si toca, la posición de final) para los dos colores. */
export function newPair(seed: number, bank: EndBank | null, endFraction: number): PairSpec {
  const rng = mulberry32(seed);
  const set = () => Array.from({ length: 5 }, () => randomProfile(rng));
  const A = set(), B = set();
  const start = bank && rng() < endFraction ? bank.sample(rng) : undefined;
  return { seed, A, B, start };
}

/** Los dos partidos del par: `i` juega rojas con los jugadores A y luego blancas con los mismos A, contra `j` con los B. */
export function pairGames(pair: PairSpec, i: BrainSpec, j: BrainSpec, id: number, si?: Scale, sj?: Scale): [GameSpec, GameSpec] {
  const one = { exec: 1, plan: 1 };
  return [
    { id, seed: pair.seed, brains: [i, j], profiles: [pair.A, pair.B], start: pair.start, scales: [si ?? one, sj ?? one] },
    { id: id + 1, seed: pair.seed, brains: [j, i], profiles: [pair.B, pair.A], start: pair.start, scales: [sj ?? one, si ?? one] },
  ];
}
export type Scale = { exec: number; plan: number };

// ---------- Pool de hilos ----------

export class Pool {
  private workers: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) this.workers.push(new Worker(fileURLToPath(import.meta.url), { workerData: { role: 'game-worker' } }));
  }
  get size() { return this.workers.length; }

  /** Ejecuta los partidos repartiéndolos entre los hilos a medida que se liberan. Devuelve los resultados en el mismo orden. */
  run(specs: GameSpec[]): Promise<GameOut[]> {
    return new Promise((resolve, reject) => {
      if (!specs.length) return resolve([]);
      const out = new Array<GameOut>(specs.length);
      let next = 0, done = 0;
      const feed = (w: Worker) => {
        if (next >= specs.length) return;
        const i = next++;
        const onMsg = (msg: { out?: GameOut; error?: string }) => {
          w.off('error', onErr);
          if (msg.error) return reject(new Error(msg.error));
          out[i] = msg.out!;
          if (++done === specs.length) resolve(out);
          else feed(w);
        };
        const onErr = (e: Error) => { w.off('message', onMsg); reject(e); };
        w.once('message', onMsg);
        w.once('error', onErr);
        w.postMessage(specs[i]);
      };
      for (const w of this.workers) feed(w);
    });
  }

  close() { return Promise.all(this.workers.map((w) => w.terminate())); }
}

export const defaultWorkers = () => Math.max(1, cpus().length - 1);

/** Llamar al principio del script: si este archivo se cargó como hilo de partidos, atiende partidos y devuelve true. */
export function workerGuard(): boolean {
  if (isMainThread || workerData?.role !== 'game-worker') return false;
  parentPort!.on('message', (spec: GameSpec) => {
    try { parentPort!.postMessage({ out: runGame(spec) }); } catch (e) { parentPort!.postMessage({ error: String((e as Error).stack ?? e) }); }
  });
  return true;
}

// ---------- Banco de finales ----------

/** Juega partidos de pesos a mano contra pesos a mano (certeza sorteada) y guarda posiciones de final. Las posiciones salen con marcadores variados. */
export async function buildBank(pool: Pool, count: number, seed: number, onProgress?: (n: number) => void): Promise<EndBank> {
  const states: SavedState[] = [];
  let g = 0;
  while (states.length < count) {
    const batch: GameSpec[] = [];
    for (let k = 0; k < pool.size * 2; k++) {
      const p = newPair(seed + 900000 + g++, null, 0);
      batch.push({ id: g, seed: p.seed, brains: [{ kind: 'hand' }, { kind: 'hand' }], profiles: [p.A, p.B], captureFinals: true });
    }
    for (const o of await pool.run(batch)) states.push(...(o.captured ?? []));
    onProgress?.(Math.min(count, states.length));
    if (g > count * 4) break; // por seguridad
  }
  return new EndBank(states.slice(0, count));
}
