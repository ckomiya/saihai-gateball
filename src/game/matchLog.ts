import { CONFIG } from '../config';
import type { CpuPlan, Decision } from './cpu';
import { BallState, Match, MatchEvent, Resolution } from './match';
import { messagesFor } from './messages';
import { kantokuLevelErrors, paceCtxOf } from './cpuDriver';
import { paceOf } from './pace';
import { phaseOf, secondsPerRound, turnsLeft } from './phase';
import { mulberry32 } from './rng';

/**
 * Registro de partidas: cada golpe con el número de turno, el reloj, las 10 bolas antes y después, quién tiró, qué pasó y, en los turnos de la CPU, su decisión
 * (tipo de jugada, alternativas con su valor, términos que más pesaron, reparto del riesgo y qué decidió el agari). Sin Phaser: la escena lo guarda en `partidas/`
 * (`vite.config.ts`, solo con `npm run dev`) y `npm run replay` lo lee. Registrar no cambia ninguna jugada (la explicación usa su propio azar).
 */

export interface BallRec { n: number; x: number; y: number; gate: number; out: boolean; pts: number }

export interface ShotLog {
  shot: number; // golpe de la partida (1, 2, …)
  turn: number; // turno de la partida: el que se ve en el HUD («TURNO 23»); un turno puede tener varios golpes (continuo o spark)
  stroke: number; // golpe dentro del turno
  clock: number; // segundos de partido que quedan al golpear
  clockText: string; // mm:ss, como en el HUD
  pacing: { secondsPerRound: number; turnsLeft: number; phase: string; model?: { turnsLeft: number; pAgain: number; seconds: number } }; // lo que usa el kantoku para saber cuántos turnos quedan (`turnsLeft`: el promedio de reloj de antes; `model`: el modelo de la cancha, `pace.ts`)
  ball: number;
  team: 0 | 1;
  mode: 'golpe' | 'spark';
  sparkBall?: number; // bola que se sparkea
  sparked?: number[]; // bolas ya sparkeadas en este turno (tocarlas otra vez es falta)
  cpu: boolean;
  before: BallRec[];
  decision?: Decision; // solo en los turnos de la CPU
  plan?: { aim: { x: number; y: number }; power: number; acc: number; idealPower?: number; idealAcc?: number }; // lo que la CPU intentó hacer con sus barras (ya con el error)
  input: { aim: { x: number; y: number }; shownAim: { x: number; y: number }; power: number; acc: number };
  result?: { events: MatchEvent[]; messages: string[]; touches: number[]; strokerOut: boolean; foul: string | null; shotGate: number; next: string };
  after?: BallRec[];
  score?: [number, number];
  outCause?: { cause: string; detail: string }; // la bola que golpea salió de la cancha: por qué (solo CPU)
  sparkFail?: { cause: string; detail: string }; // la CPU quiso sacar una bola rival con el spark y no salió: por qué
}

export interface MatchLogData {
  version: 1;
  id: string;
  started: string;
  level: number;
  cpuTeam: 0 | 1 | null;
  config: { clockFactor: number; matchMinutes: number; messageSeconds: number; kantokuRoundSeconds: number; kantokuAgariTurns: number };
  shots: ShotLog[];
  final?: { score: [number, number]; reason: string; clock: number };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rec = (b: BallState): BallRec => ({ n: b.n, x: r3(b.x), y: r3(b.y), gate: b.nextGate, out: b.outBall, pts: b.points });
/** Lo que estima el modelo de ritmo para la bola que juega (con el error del nivel «Kantoku IA» y un rival humano). */
function paceModel(m: Match) {
  const p = paceOf(m, paceCtxOf(m, { errors: { ...kantokuLevelErrors(), rivalIsHuman: true } }));
  return { turnsLeft: r3(1 + p.turns[m.turn]), pAgain: r3(p.pAgain[m.turn]), seconds: r3(p.seconds) };
}
export const snapshot = (m: Match): BallRec[] => m.balls.map(rec);

export const clockText = (clock: number) => {
  const t = Math.ceil(clock);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** JSON legible y compacto: números a 3 decimales. */
export const stringifyLog = (d: MatchLogData) => JSON.stringify(d, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? r3(v) : v), 1);

export class MatchLogger {
  data: MatchLogData;
  private cur: ShotLog | null = null;
  private extra: { turn: number; sparkIdx: number; sparked: number[]; ideal: NonNullable<CpuPlan['ideal']> } | null = null; // para explicar por qué sale la bola
  private lastTurn = -1;
  private stroke = 0;

  constructor(opts: { level: number; cpuTeam: 0 | 1 | null; now?: Date }) {
    const d = opts.now ?? new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    this.data = {
      version: 1,
      id: `partida-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-nivel${opts.level + 1}`,
      started: d.toISOString(),
      level: opts.level,
      cpuTeam: opts.cpuTeam,
      config: { clockFactor: CONFIG.clockFactor, matchMinutes: CONFIG.matchMinutes, messageSeconds: CONFIG.messageSeconds, kantokuRoundSeconds: CONFIG.kantokuRoundSeconds, kantokuAgariTurns: CONFIG.kantokuAgariTurns },
      shots: [],
    };
  }

  /** Antes de golpear (`Match.shoot`): estado, quién tira y, si juega la CPU, su decisión. */
  beginShot(m: Match, o: { cpu: boolean; aim: { x: number; y: number }; power: number; acc: number; plan?: CpuPlan | null }) {
    if (m.turnStarts !== this.lastTurn) { this.lastTurn = m.turnStarts; this.stroke = 0; }
    this.stroke++;
    this.extra = null;
    const shown = m.shownAim(o.aim);
    const s: ShotLog = {
      shot: this.data.shots.length + 1,
      turn: m.turnStarts,
      stroke: this.stroke,
      clock: r3(m.clock),
      clockText: clockText(m.clock),
      pacing: { secondsPerRound: r3(secondsPerRound(m)), turnsLeft: turnsLeft(m), phase: phaseOf(m), model: paceModel(m) },
      ball: m.b.n,
      team: m.b.team,
      mode: m.sparkBall ? 'spark' : 'golpe',
      sparkBall: m.sparkBall?.n,
      sparked: m.sparkedThisTurn.size ? [...m.sparkedThisTurn].map((x) => x.n) : undefined,
      cpu: o.cpu,
      before: snapshot(m),
      input: { aim: { ...o.aim }, shownAim: { ...shown }, power: o.power, acc: o.acc },
    };
    if (o.cpu && o.plan) {
      s.decision = o.plan.decision;
      s.plan = { aim: { ...o.plan.aim }, power: o.plan.power, acc: o.plan.acc, idealPower: o.plan.ideal?.power, idealAcc: o.plan.ideal?.acc };
      if (o.plan.ideal) this.extra = { turn: m.turn, sparkIdx: m.sparkBall ? m.balls.indexOf(m.sparkBall) : -1, sparked: [...m.sparkedThisTurn].map((x) => m.balls.indexOf(x)), ideal: o.plan.ideal };
    }
    this.cur = s;
    this.data.shots.push(s);
  }

  /** Con el golpe ya resuelto (todo quieto), antes de pasar al turno siguiente. */
  endShot(m: Match, res: Resolution) {
    const s = this.cur;
    if (!s) return;
    this.cur = null;
    s.result = { events: res.events, messages: messagesFor(res.events), touches: res.touches.map((i) => m.balls[i].n), strokerOut: res.strokerOut, foul: res.foul, shotGate: res.shotGate, next: res.next };
    s.after = snapshot(m);
    s.score = [m.teamScore(0), m.teamScore(1)];
    const extra = this.extra;
    this.extra = null;
    if (s.cpu && extra && s.mode === 'golpe' && res.strokerOut && s.plan) s.outCause = diagnoseOut(s.before, extra.turn, extra.sparked, extra.ideal, s.plan);
    if (s.cpu && extra && s.mode === 'spark' && s.plan && s.decision?.kind === 'spark: expulsar bola rival' && !m.balls[extra.sparkIdx].outBall) s.sparkFail = diagnoseSpark(s.before, extra.turn, extra.sparkIdx, extra.sparked, extra.ideal, s.plan);
  }

  finish(m: Match) {
    this.data.final = { score: [m.teamScore(0), m.teamScore(1)], reason: m.endReason(), clock: r3(m.clock) };
  }

  json() {
    return stringifyLog(this.data);
  }
}

// ---------- Por qué sale la bola de la CPU ----------

const toBalls = (rs: BallRec[]): BallState[] => rs.map((b) => ({ n: b.n, team: b.n % 2 === 1 ? 0 : 1, x: b.x, y: b.y, vx: 0, vy: 0, nextGate: b.gate, outBall: b.out, points: b.pts }));

type Shot = { aim: { x: number; y: number }; power: number; acc: number };

/** Repite un golpe (`sparkIdx` ≥ 0: spark de esa bola) con esas barras y el azar del pasto fijo: si la que golpea sale, si la sparkeada sale y si algo más se movió. */
function replay(before: BallRec[], turn: number, sparkIdx: number, sparked: number[], shot: Shot) {
  const m = Match.fromBalls(toBalls(before), { turn, rng: mulberry32(1), sparked, sparkBall: sparkIdx >= 0 ? sparkIdx : undefined });
  const start = m.balls.map((b) => ({ x: b.x, y: b.y }));
  let res = m.shoot(shot.aim, shot.power, shot.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  const hitOthers = m.balls.some((b, i) => i !== turn && i !== sparkIdx && (Math.abs(b.x - start[i].x) > 1e-6 || Math.abs(b.y - start[i].y) > 1e-6));
  return { strokerOut: res.strokerOut, sparkOut: sparkIdx >= 0 && res.kind === 'spark' && m.balls[sparkIdx].outBall, hitOthers };
}

const replayOut = (before: BallRec[], turn: number, sparked: number[], shot: Shot) => replay(before, turn, -1, sparked, shot).strokerOut;

/** El spark de expulsión de la CPU no sacó la bola rival: ¿fuerza corta, rumbo, mira, un choque con otra bola o la combinación? (misma idea que `npm run spark`). */
export function diagnoseSpark(before: BallRec[], turn: number, sparkIdx: number, sparked: number[], ideal: Shot, plan: Shot): { cause: string; detail: string } {
  if (!replay(before, turn, sparkIdx, sparked, ideal).sparkOut) return { cause: 'no la sacaba ni sin error', detail: 'el golpe exacto elegido tampoco la saca (revisar el candidato)' };
  const only = (k: 'power' | 'acc' | 'aim') => replay(before, turn, sparkIdx, sparked, { aim: k === 'aim' ? plan.aim : ideal.aim, power: k === 'power' ? plan.power : ideal.power, acc: k === 'acc' ? plan.acc : ideal.acc });
  const rel = ideal.power > 0 ? plan.power / ideal.power - 1 : 0;
  if (!only('power').sparkOut) return { cause: 'fuerza corta', detail: `la barra quedó ${(100 * rel).toFixed(1)} % ${rel >= 0 ? 'por encima' : 'por debajo'} de lo planeado y la bola se queda adentro` };
  if (!only('acc').sparkOut) return { cause: 'rumbo desviado', detail: `rumbo ${(plan.acc - ideal.acc).toFixed(3)} fuera del triángulo` };
  if (!only('aim').sparkOut) return { cause: 'mira desviada', detail: `mira desviada ${Math.hypot(plan.aim.x - ideal.aim.x, plan.aim.y - ideal.aim.y).toFixed(3)} m` };
  const actual = replay(before, turn, sparkIdx, sparked, plan);
  return actual.hitOthers ? { cause: 'choque con otra bola', detail: 'con la combinación de errores toca otra bola antes de salir' } : { cause: 'combinación de errores', detail: 'ninguno solo la deja adentro; juntos sí' };
}

/**
 * La bola de la CPU salió de la cancha: ¿lo pretendía el plan (fuerza extra o poco espacio hasta la línea), o lo causó un error de ejecución? Se repite el golpe
 * sin error y con un solo error a la vez (fuerza, rumbo, mira), con el azar del pasto fijo.
 */
export function diagnoseOut(before: BallRec[], turn: number, sparked: number[], ideal: { aim: { x: number; y: number }; power: number; acc: number }, plan: { aim: { x: number; y: number }; power: number; acc: number }): { cause: string; detail: string } {
  if (replayOut(before, turn, sparked, ideal)) return { cause: 'plan', detail: 'el golpe exacto, sin error, ya la saca (fuerza extra o línea cerca de la mira)' };
  const only = (k: 'power' | 'acc' | 'aim') => replayOut(before, turn, sparked, { aim: k === 'aim' ? plan.aim : ideal.aim, power: k === 'power' ? plan.power : ideal.power, acc: k === 'acc' ? plan.acc : ideal.acc });
  const rel = ideal.power > 0 ? plan.power / ideal.power - 1 : 0;
  if (only('power')) return { cause: 'error de fuerza', detail: `la barra quedó ${(100 * rel).toFixed(1)} % ${rel >= 0 ? 'por encima' : 'por debajo'} de lo planeado` };
  if (only('acc')) return { cause: 'error de rumbo', detail: `rumbo desviado ${(plan.acc - ideal.acc).toFixed(3)}` };
  if (only('aim')) return { cause: 'error de mira', detail: `mira desviada ${Math.hypot(plan.aim.x - ideal.aim.x, plan.aim.y - ideal.aim.y).toFixed(3)} m` };
  if (replayOut(before, turn, sparked, plan)) return { cause: 'combinación de errores', detail: 'ninguno solo la saca; juntos sí' };
  return { cause: 'rebote o pasto', detail: 'con las barras de la CPU y el azar fijo no sale: rebote o irregularidad del pasto' };
}
