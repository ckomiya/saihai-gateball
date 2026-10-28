import { BarPattern, CONFIG, kantokuLevelBase } from '../config';
import { ErrorBase, errorsAt, scaleError, shotDistance } from './certainty';
import { CpuPlan, Decision, chooseTarget, clearEntry, distTo, idealTarget, knockOutTarget, levelError, makePlanWith } from './cpu';
import { Explanation, PlanTrace, describeShot, explainPlan, planShot } from './cpuPlanner';
import { EndTurn, endTurnOf, planChain } from './lastTurn';
import { openingAim } from './opening';
import { BallState, Match, POLE_STEP, accuracySpeedFactor, barSpeed } from './match';
import { Pace, PaceCtx, paceOf } from './pace';
import { phaseOf, upcomingTurns } from './phase';
import { kantokuBrain } from './kantoku';
import { Brain, WeightFile2, handBrain, weightsFor } from './weights';

/**
 * Decisiones de la CPU sobre un partido (`Match`), sin Phaser: elige hacia dónde tirar y el plan de barras con el error de su nivel.
 * La escena lo anima paso a paso (`MatchScene.cpuStep`) y `scripts/selfplay.ts` lo ejecuta de golpe.
 */

type P = { x: number; y: number };

const levelOf = (level: number) => CONFIG.cpuLevels[Math.min(level, CONFIG.cpuLevels.length - 1)];

/** Plan del golpe de la CPU: hacia su puerta (o poste) o, en un spark, hacia la meta de la bola tocada o fuera si es rival. */
function greedyTarget(m: Match, level: number): P {
  const b = m.b;
  const sp = m.sparkBall;
  let target: P | undefined;
  if (sp) {
    target = sp.team !== b.team ? knockOutTarget(sp) : idealTarget(sp, sp.nextGate, false);
  } else if (b.nextGate >= 2 && !b.outBall) {
    // Bola en juego: compara puntuar, atacar a un rival, mandar a puntuar a una bola propia o acomodarse.
    const inPlay = (o: BallState) => o !== b && o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall && !m.sparkedThisTurn.has(o);
    const rivals = m.balls.filter((o) => o.team !== b.team && inPlay(o));
    const mates = m.balls.filter((o) => o.team === b.team && inPlay(o));
    target = chooseTarget(b, b.nextGate, rivals, mates, {
      clock: m.clock,
      lead: m.teamScore(b.team) - m.teamScore(b.team === 0 ? 1 : 0),
      strategy: levelOf(level).strategy,
      rng: m.rng,
    });
  }
  if (!sp) {
    target ??= idealTarget(b, b.nextGate, b.outBall);
    if (m.sparkedThisTurn.size) {
      // Tocar otra vez una bola ya sparkeada en el turno es falta: el golpe esquiva esas bolas.
      target = clearEntry(b, target, [...m.sparkedThisTurn].filter((o) => !o.outBall && o.nextGate <= POLE_STEP));
    }
    if (b.outBall) {
      // Volver a entrar sin tocar otra bola (sería falta).
      const others = m.balls.filter((o) => o !== b && o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall);
      target = clearEntry(b, target, others);
    }
  }
  return target ?? idealTarget(b, b.nextGate, b.outBall);
}

/**
 * Planificador: prueba golpes con la física del juego y elige el que deja mejor el tablero (puntos, touches, buena
 * posición, y sin dejar bolas propias al alcance de un touch rival). Según el nivel lo usa más o menos; si no, null.
 */
function plannedTarget(m: Match, level: number, opts: CpuOptions): { aim: P; powerMul?: number; explanation?: Explanation; chain?: { turn: EndTurn; value: number; nodes: number } } | null {
  const lv = levelOf(level);
  if (m.rng() >= lv.strategy) return null;
  const sp = m.sparkBall;
  const brain = opts.brain ?? handBrain;
  const pace = brain.kind === 'kantoku' && (brain.file as WeightFile2).version === 2 && !(brain.file as WeightFile2).legacyTurnModel ? paceOf(m, paceCtxOf(m, opts)) : undefined; // turnos que quedan según la cancha (`pace.ts`)
  const weights = weightsFor(brain, brain.kind === 'kantoku' ? phaseOf(m, pace) : 'medio'); // el kantoku cambia de pesos según la fase
  const trace: PlanTrace | undefined = opts.explain ? { tried: [], candidates: 0, scored: 0 } : undefined;
  // Último turno del partido (o penúltimo sin rivales que ataquen): se busca la cadena que más puntos suma, no el mejor golpe aislado (`lastTurn.ts`)
  const future = weights.certainty ? futureOf(m, opts, pace) : undefined;
  const endKind = future && !weights.legacyLastTurn ? endTurnOf(m, future) : null;
  if (future && endKind) {
    const ch = planChain(m, future, endKind);
    if (ch) return { aim: ch.aim, chain: { turn: endKind, value: ch.value, nodes: ch.nodes } };
  }
  const si = sp ? m.balls.indexOf(sp) : m.turn, mode = sp ? 'spark' : 'stroke', pinned = sp ? m.turn : -1;
  const ctx = {
    team: m.b.team,
    clock: m.clock,
    noise: lv.evalNoise,
    sparked: [...m.sparkedThisTurn].map((o) => m.balls.indexOf(o)),
    rng: m.rng,
    weights,
    future,
    turnsLeft: pace ? 1 + pace.turns[m.turn] : undefined,
    trace,
    continuation: m.strokesInTurn > 0 && !sp,
    lead: m.teamScore(m.b.team) - m.teamScore(m.b.team === 0 ? 1 : 0),
  } as const;
  const plan = planShot(m.balls, si, mode, pinned, ctx);
  // El registro explica la decisión con otro azar: no cambia ninguna jugada
  return plan ? { aim: plan.aim, powerMul: plan.powerMul, explanation: trace ? explainPlan(m.balls, si, mode, pinned, ctx, plan, trace) : undefined } : null;
}

/** Nivel temporal «Kantoku IA» del menú: el campeón entrenado, con el error base del entrenamiento × la certeza del jugador. Los niveles 1 a 4 no cambian. */
export const KANTOKU_LEVEL = CONFIG.cpuLevels.length;

/** Opciones de la CPU para un nivel del menú: solo el nivel «Kantoku IA» usa el cerebro entrenado y el error base × certeza. */
export function levelOptions(level: number): CpuOptions {
  return level === KANTOKU_LEVEL ? { brain: kantokuBrain, errors: { ...kantokuLevelErrors(), rivalIsHuman: true } } : {}; // el rival del nivel es una persona
}

/** Error del nivel «Kantoku IA»: el error base del entrenamiento con sus multiplicadores de `config.ts` (ejecución y lo que el planificador cree). */
export function kantokuLevelErrors(): NonNullable<CpuOptions['errors']> {
  return { base: kantokuLevelBase(), executionScale: CONFIG.kantokuLevelErrorScale, planningScale: CONFIG.kantokuLevelPlanScale };
}

/** Contexto del kantoku: orden de los turnos que quedan, certeza de cada bola y errores. Con rival humano, sus opciones se miden con el error de un buen jugador humano. */
export function futureOf(m: Match, opts: CpuOptions, pace?: Pace) {
  const base = scaleError(opts.errors?.base ?? CONFIG.kantokuBaseError, opts.errors?.planningScale ?? 1);
  const human = !!opts.errors?.rivalIsHuman;
  return { seq: upcomingTurns(m, pace), turns: pace?.turns, pAgain: pace?.pAgain, profiles: m.profiles, base, rivalBase: human ? CONFIG.humanRivalError : base, rivalProfiles: human ? undefined : m.profiles };
}

/** Errores con que el modelo de ritmo (`pace.ts`) juzga a cada equipo: los de la CPU y los del rival (una persona, si lo es). */
export function paceCtxOf(m: Match, opts: CpuOptions): PaceCtx {
  const base = scaleError(opts.errors?.base ?? CONFIG.kantokuBaseError, opts.errors?.planningScale ?? 1);
  const human = !!opts.errors?.rivalIsHuman;
  return { team: m.b.team, base, rivalBase: human ? CONFIG.humanRivalError : base, profiles: m.profiles, rivalProfiles: human ? undefined : m.profiles };
}

/** Cómo decide la CPU. Sin opciones: pesos a mano y el error del nivel (lo que usa el juego hoy). */
export interface CpuOptions {
  /** Quién valora los golpes: los pesos a mano o el kantoku (por defecto, a mano). */
  brain?: Brain;
  /**
   * Error base realista: el tiro se desvía este error × la certeza del jugador a esa distancia (por defecto, el error del nivel).
   * `executionScale` multiplica lo que de verdad se equivoca al golpear; `planningScale`, lo que el planificador cree que se equivoca.
   */
  errors?: { base: ErrorBase; executionScale?: number; planningScale?: number; rivalIsHuman?: boolean };
  /** Anota en `CpuPlan.decision` por qué eligió el golpe (alternativas, términos, riesgo, agari). Solo para el registro de partidas; no cambia la jugada. */
  explain?: boolean;
}

/** Plan completo del golpe de la bola que juega: objetivo + errores de puntería según el nivel (0-3) o el error base y el perfil del jugador. */
export function cpuPlan(m: Match, level: number, opts: CpuOptions = {}): CpuPlan {
  // Libro de aperturas de la primera vuelta (solo el kantoku; `legacyOpenings` en el archivo de pesos lo apaga)
  const opening = opts.brain?.kind === 'kantoku' && !(opts.brain.file as WeightFile2).legacyOpenings
    ? openingAim(m, { only: (opts.brain.file as WeightFile2).openingsOnly, anyRival: !(opts.brain.file as WeightFile2).legacyOpeningRivals, errors: opts.errors && { base: opts.errors.base, planningScale: opts.errors.planningScale, rivalIsHuman: opts.errors.rivalIsHuman } })
    : null;
  const planned = opening ? null : plannedTarget(m, level, opts);
  const target = opening?.aim ?? planned?.aim ?? greedyTarget(m, level);
  const err = opts.errors ? errorsAt(scaleError(opts.errors.base, opts.errors.executionScale ?? 1), m.profiles[m.turn], m.sparkBall ? distTo(m.b, target) : shotDistance(m.b, target, m.b.nextGate)) : levelError(level);
  const bars = { power: Math.min(1, m.sweetSpot() * (planned?.powerMul ?? 1)), acc: m.bars().accuracy.sweetSpot }; // spark de expulsión: fuerza de sobra
  const plan: CpuPlan = { ...makePlanWith(target, bars, err, m.rng), ideal: { aim: target, ...bars } };
  if (opts.explain) {
    const sp = m.sparkBall;
    const si = sp ? m.balls.indexOf(sp) : m.turn, mode = sp ? 'spark' : 'stroke', pinned = sp ? m.turn : -1;
    const shot = describeShot(m.balls, si, mode, pinned, [...m.sparkedThisTurn].map((o) => m.balls.indexOf(o)), target, planned?.powerMul);
    const decision: Decision = { source: opening ? 'apertura' : planned?.chain ? 'cadena final' : planned ? 'planificador' : 'simple', kind: shot.kind, intended: shot.intended, explanation: planned?.explanation };
    if (planned?.chain) decision.chain = planned.chain;
    if (opening) decision.opening = opening.kind;
    plan.decision = decision;
  }
  return plan;
}

// ---------- Cuánto tarda la CPU en la pantalla ----------
// Espeja `MatchScene.cpuStep` (cuadro a cuadro a 60 fps). Sirve para cobrar al reloj del partido el mismo tiempo que en pantalla.

const FRAME = 1 / 60;
export const CPU_SET_WAIT = 0.5; // la CPU espera al menos esto antes de confirmar la salida y la mira (÷ `cpuAnimSpeed`)
export const CPU_BAR_WAIT = 0.15; // ... y esto antes de poder detener una barra (÷ `cpuAnimSpeed`)
export const CPU_AIM_SPEED = 6; // m/s de la mira de la CPU (× `cpuAnimSpeed`)

/** Segundos que tarda una barra en llegar al punto `target` (sube desde 0 y rebota en los extremos). */
function barSeconds(bar: BarPattern, target: number, factor: number) {
  const sp = CONFIG.cpuAnimSpeed;
  let v = 0, dir = 1, timer = 0, frames = 0;
  while (frames < 60 * 60) {
    timer += FRAME;
    frames++;
    if (timer > CPU_BAR_WAIT / sp && (dir > 0 ? v >= target : v <= target)) break;
    v += dir * barSpeed(bar, v) * factor * sp * FRAME;
    if (v >= 1) { v = 1; dir = -1; }
    if (v <= 0) { v = 0; dir = 1; }
  }
  return frames * FRAME;
}

/**
 * Segundos reales que tarda la CPU en hacer el golpe de `plan` en pantalla: colocar la bola en la salida (solo en un turno nuevo con la
 * puerta 1 sin pasar), llevar la mira desde `aim0` hasta el plan y detener las barras de fuerza y de rumbo. `freshTurn` = el turno acaba de
 * empezar: en un golpe continuo o un spark la espera mínima de 0,5 s ya pasó mientras rodaba la bola y se leían los mensajes.
 */
export function cpuThinkSeconds(m: Match, plan: CpuPlan, aim0: P, freshTurn: boolean): number {
  const sp = CONFIG.cpuAnimSpeed;
  let total = 0;
  if (freshTurn && m.b.nextGate === 1) {
    let x = m.b.x, timer = 0;
    for (let f = 0; f < 60 * 60; f++) {
      timer += FRAME;
      const dx = plan.startX - x;
      const step = CONFIG.startAreaMoveSpeed * sp * FRAME;
      x += Math.max(-step, Math.min(step, dx));
      if (Math.abs(dx) < 0.01 && timer > CPU_SET_WAIT / sp) break;
    }
    total += timer;
  }
  let ax = aim0.x, ay = aim0.y, timer = freshTurn ? 0 : Infinity;
  let spent = 0;
  for (let f = 0; f < 60 * 60; f++) {
    timer += FRAME;
    spent += FRAME;
    const dx = plan.aim.x - ax, dy = plan.aim.y - ay;
    const d = Math.hypot(dx, dy);
    const step = CPU_AIM_SPEED * sp * FRAME;
    if (d > step) { ax += (dx / d) * step; ay += (dy / d) * step; } else { ax = plan.aim.x; ay = plan.aim.y; }
    if (d < 0.01 && timer > CPU_SET_WAIT / sp) break;
  }
  total += spent;
  const bars = m.bars();
  total += barSeconds(bars.power, plan.power, 1);
  total += barSeconds(bars.accuracy, plan.acc, accuracySpeedFactor(m.travelDistance(plan.aim, plan.power)));
  return total;
}
