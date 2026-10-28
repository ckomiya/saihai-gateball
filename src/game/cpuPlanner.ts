import { CONFIG } from '../config';
import { ErrorBase, Profile, shotDistance, drawShotError, errorsAt, pathClearance, scoreProbability, touchProbability, typicalScoreProbability } from './certainty';
import { LAYOUT } from '../config';
import { COURT_H, COURT_W, GATES, POSTS, clampAimToPosts, leftInnerField } from './court';
import { applyShotError, canScoreNow, distTo, goalOf, knockOutTarget, reach } from './cpu';
import { BallState, FINISHED, Match, POLE_STEP, inPlay } from './match';
import { Rng, gauss, mulberry32 } from './rng';
import { attackOutcome } from './attackTable';
import { ChainModel, EXIT_STOPS, resetChainCache, bestOption, exitChainThreat, passThreat, touchThreat } from './threat';
import { Weights, handWeights } from './weights';

/**
 * Planificador de la CPU: prueba muchos golpes posibles con la misma física del juego (sin error de puntería),
 * mira cómo queda el tablero y elige el mejor según una valoración: puntos, touches, bolas rivales sacadas, buena
 * posición para la siguiente puerta y, sobre todo, no dejar bolas propias al alcance de un touch rival.
 * Sin Phaser: se puede probar solo. Simula con el motor de reglas (`Match`), el mismo que usa la escena.
 */

export type SimBall = BallState;
const NEUTRAL_PROFILE: Profile = { short: 1, medium: 1, long: 1 }; // el rival humano no tiene perfil de certeza

export interface PlanCtx {
  team: 0 | 1; // equipo de la CPU
  clock: number; // segundos de partido que quedan
  noise: number; // ruido sumado a cada valoración: la CPU de nivel bajo elige peor
  sparked?: number[]; // índices de bolas ya sparkeadas en este turno: tocarlas otra vez es falta
  rng: Rng; // azar de la valoración y de la física de las simulaciones
  weights?: Weights; // pesos de la valoración (por defecto, los de mano: `handWeights`)
  future?: FutureCtx; // lo que necesitan los pesos con certeza (`weights.certainty`)
  /** Solo para el registro de partidas: `evaluate` anota aquí lo que aporta cada término y `detail` guarda el reparto del riesgo. No cambian ninguna decisión. */
  terms?: Record<string, number>;
  detail?: { risk?: RiskRow[] };
  /** Solo para el registro: el planificador anota los golpes que midió con error y qué pasó con el agari. */
  trace?: PlanTrace;
  /** Ventaja del equipo de la CPU en puntos (suyos − del rival): la regla del punto seguro es más o menos exigente según el marcador y el tiempo. */
  lead?: number;
  /** El golpe es un golpe continuo (la bola acaba de pasar una puerta o de hacer un spark): lo usa la regla de ataque. */
  continuation?: boolean;
  /** Turnos que se esperan para la bola que juega (el actual cuenta), según la cancha (`pace.ts`); sin él (`legacyTurnModel`) el equilibrio usa el reloj. */
  turnsLeft?: number;
}

/** Riesgo de una bola rival que va a jugar: pasar su puerta o tocar una bola mía (lo que pesa es lo mayor). */
export interface RiskRow { rival: number; weight: number; free: number; pass: number; touches: { ball: number; pTouch: number; threat: number; weighted: number; send?: number }[]; best: number; combo?: { kind: string; value: number } }

export interface PlanTrace {
  tried: { aim: { x: number; y: number }; powerMul?: number; value: number; touch: boolean }[];
  candidates: number;
  scored: number;
  agari?: { turnsLeft: number; limit: number; heldBack: number; minThreat: number; threatLimit: number; released: 'sinAlternativas' | 'amenaza' | null };
}

/** Contexto del kantoku: qué turnos quedan, la certeza de quien tira cada bola y el error base. */
export interface FutureCtx {
  seq: number[]; // índices de las bolas que aún jugarán, en orden (`phase.upcomingTurns`)
  turns?: number[]; // por bola: turnos que se esperan después del actual, según la cancha (`pace.ts`); sin él se cuentan en `seq`
  pAgain?: number[]; // por bola: probabilidad de que vuelva a jugar tras su turno actual
  profiles: Profile[]; // certeza de quien tira cada bola
  base: ErrorBase; // error base del tiro
  rivalBase?: ErrorBase; // error de los rivales (modelo v2): el de un buen jugador humano si el rival es una persona; por defecto, `base`
  rivalProfiles?: Profile[]; // certeza de quien tira cada bola rival; sin ella (rival humano) no se aplica perfil
}

/** Turnos que le quedan a la bola `i` después del actual: los esperados según la cancha (redondeados) o, sin el modelo, los de la secuencia. */
export const turnsAfter = (F: FutureCtx, i: number): number => (F.turns ? Math.round(F.turns[i]) : F.seq.filter((x) => x === i).length);

/** Solo para pruebas: apagar el filtro de seguridad permite comprobar que un escenario de verdad lo necesita. */
export const PLANNER_FLAGS = { safetyFilter: true, knockoutBoost: true, farEntry: true };

type P = { x: number; y: number };
const DT = 1 / 30;
const MAX_STEPS = 420; // 14 s de partido: más que cualquier golpe

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Outcome {
  balls: SimBall[];
  touched: number[]; // touches válidos (como los cuenta la escena)
  foul: boolean;
  shooterOut: boolean; // la que golpea salió de la cancha (queda bola fuera)
  gate: boolean; // la que golpea pasó una puerta
  sparkOk: boolean; // en un spark: éxito (si no, falta y todo vuelve)
}

/**
 * Simula un golpe exacto (barras en el triángulo) con el motor de reglas: puertas, poste, salida de la cancha, touch, movimiento
 * inválido y faltas, igual que en la escena. En un spark (`pinned` = la bola que golpea) la que golpea queda fija y se mueve la sparkeada.
 */
function simulate(init: SimBall[], si: number, aim: P, mode: 'stroke' | 'spark', pinned: number, sparked: number[], rng: Rng, shot?: { power: number; acc: number }): Outcome {
  const m = Match.fromBalls(init, mode === 'spark' ? { turn: pinned, rng, sparkBall: si, sparked } : { turn: si, rng, sparked });
  const bars = m.bars();
  let res = m.shoot(aim, shot?.power ?? bars.power.sweetSpot, shot?.acc ?? bars.accuracy.sweetSpot);
  for (let i = 0; i < MAX_STEPS && !res && m.stage === 'rolling'; i++) if (m.step(DT)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return { balls: m.balls, touched: res.touches, foul: res.foul !== null, shooterOut: res.strokerOut, gate: res.shotGate > 0, sparkOk: res.kind !== 'sparkFoul' };
}

/** Qué tan bien queda una bola para su siguiente puerta o el poste. */
function positionQuality(b: SimBall, w: Weights) {
  const d = distTo(b, goalOf(b.nextGate));
  return canScoreNow(b, b.nextGate) ? w.posGood * clamp(1 - d / w.posGoodDist, w.posGoodMin, 1) : -w.posBadBase - w.posBadPerM * d;
}

/**
 * Puntos que se espera que sume aún una bola con los `n` turnos que le quedan: cada turno pasa su siguiente meta con probabilidad p
 * (la primera, según dónde está y la certeza de su dueño; las siguientes, la de un tiro típico por `efpNextFactor`); pasar una puerta da +1
 * y un golpe continuo en el mismo turno; el poste da +2 y la bola sale; fallar gasta el turno. Una bola fuera pierde un turno en volver a entrar.
 */
function expectedFuturePoints(b: SimBall, n: number, e: ErrorBase, w: Weights): number {
  if (b.nextGate >= FINISHED) return 0;
  if (b.outBall) n -= 1;
  if (n <= 0) return 0;
  const pNext = typicalScoreProbability(e) * w.efpNextFactor;
  const pFirst = b.outBall ? pNext : scoreProbability(b, b.nextGate, e);
  const gain = (t: number) => (t === 4 ? CONFIG.polePoints : CONFIG.gatePoints);
  // g[t][k]: puntos esperados desde la meta t con k turnos, ya sin la posición de partida
  const g: number[][] = [];
  for (let t = 4; t >= b.nextGate; t--) {
    g[t] = new Array(n + 1).fill(0);
    for (let k = 1; k <= n; k++) g[t][k] = pNext * (gain(t) + (t === 4 ? 0 : g[t + 1][k])) + (1 - pNext) * g[t][k - 1];
  }
  const t0 = b.nextGate;
  return pFirst * (gain(t0) + (t0 === 4 ? 0 : g[t0 + 1][n])) + (1 - pFirst) * g[t0][n - 1];
}

/** Valor del tablero tras el golpe para el equipo de la CPU: más es mejor. */
/**
 * Equilibrio entre puntos y ataque (v4, Chris, 2026-10-26): perdiendo o con poco tiempo los puntos pesan más; ganando y con tiempo, se ataca más. Devuelve el multiplicador de los puntos (> 1: puntos) y el ataque
 * (touch, oportunidad de touch, preparar a una compañera) se divide por él. `leadSlope` y `clockSlope` valen 0 en el campeón actual (= 1, sin efecto) y los aprende el v4.
 */
export function balanceMul(ctx: PlanCtx, w: Weights): number {
  const urgent = CONFIG.kantokuClockUrgency > 0 && ctx.turnsLeft !== undefined;
  if (!w.leadSlope && !w.clockSlope && !urgent) return 1;
  const need = Math.max(-1, Math.min(1, -(ctx.lead ?? 0) / 6)); // > 0 perdiendo
  if (ctx.turnsLeft === undefined) {
    const elapsed = 1 - Math.max(0, Math.min(1, ctx.clock / (CONFIG.matchMinutes * 60)));
    return Math.max(0.5, Math.min(2, 1 + (w.leadSlope ?? 0) * need + (w.clockSlope ?? 0) * (elapsed - 0.5)));
  }
  // Con el modelo de ritmo (Chris, 2026-10-27): el apuro sale de los turnos que le quedan a la bola (1 = el último), no del reloj: 0 con `kantokuUrgentTurns` o más, 1 con un solo turno.
  const hurry = Math.max(0, Math.min(1, (CONFIG.kantokuUrgentTurns - ctx.turnsLeft) / Math.max(1e-6, CONFIG.kantokuUrgentTurns - 1)));
  return Math.max(0.5, Math.min(2, 1 + (w.leadSlope ?? 0) * need + (w.clockSlope ?? 0) * (hurry - 0.5) + CONFIG.kantokuClockUrgency * Math.max(0, need) * hurry));
}

export function evaluate(init: SimBall[], out: Outcome, si: number, mode: 'stroke' | 'spark', ctx: PlanCtx) {
  const my = ctx.team;
  const S = out.balls;
  const w = ctx.weights ?? handWeights;
  const late = ctx.clock < w.lateClock;
  const bm = balanceMul(ctx, w);
  const pw = (late ? w.pointLate : w.point) * bm; // valor de un punto
  let v = 0;
  const terms = ctx.terms;
  const add = (k: string, x: number) => { if (k === 'touch') x /= bm; v += x; if (terms) terms[k] = (terms[k] ?? 0) + x; };
  for (let i = 0; i < S.length; i++) {
    add('puntos', (S[i].points - init[i].points) * (S[i].team === my ? pw : -pw));
    if (!(mode === 'stroke' && i === si) && !init[i].outBall && S[i].outBall && S[i].nextGate !== FINISHED) {
      add('bolasFuera', S[i].team === my ? w.outOwn : w.outRivalBase + w.outRivalPerPoint * S[i].points); // bola fuera: pierde tiempo
      if (S[i].team === my && w.certainty && !w.legacySparkClear) add('propiaFuera', -(CONFIG.kantokuOwnOutCost + CONFIG.kantokuOwnOutPerPoint * S[i].points)); // sacar una bola mía (un spark o un touch que la empuja) es una pérdida seria: hay que reentrar
    }
  }
  if (out.foul) add('falta', -w.foul);
  const sh = S[si];
  if (mode === 'stroke') {
    if (out.shooterOut) add('miBolaSale', -(init[si].nextGate === 1 ? w.shooterOutStart : w.shooterOutLater));
    // Sacar la propia bola desde el juego no es barato (v1.3, Chris, 2026-10-27, turno 4 de la partida 20261027-181359): hay que gastar un turno en reentrar y la reentrada queda tan expuesta como quedarse. `legacySelfOut` lo apaga.
    if (out.shooterOut && w.certainty && !w.legacySelfOut && !init[si].outBall && init[si].nextGate >= 2 && init[si].nextGate <= POLE_STEP) add('salidaPropia', -CONFIG.kantokuSelfOutCost);
    // Casi siempre hay que entrar (Chris, 2026-10-27, v1.2): no entrar cuesta además `kantokuReentryMust`, salvo en la última vuelta de esa bola yendo ganando (quedarse fuera no le da bolas al rival). `legacyReentryMust` lo apaga.
    const mustEnter = w.certainty && !w.legacyReentryMust && init[si].outBall && !(ctx.future?.turns && ctx.future.turns[si] < CONFIG.kantokuReentryLastTurns && (ctx.lead ?? 0) >= CONFIG.kantokuReentryLead) ? CONFIG.kantokuReentryMust : 0;
    if (init[si].outBall && !out.shooterOut && leftInnerField(sh)) add('noEntra', -(w.failReenter + mustEnter)); // no logra entrar
    // Tirar la bola fuera otra vez desde fuera también es no entrar (y gasta el turno): sin esto costaba solo `miBolaSale` (≈ 1,2) y, con el riesgo de entrar más alto, a la CPU le convenía fallar a propósito (partida 20261027-114432, turno 32). `legacyReentryFail` lo apaga.
    if (init[si].outBall && out.shooterOut && w.certainty && !w.legacyReentryFail) add('noEntra', -(w.failReenter + mustEnter));
    for (const t of out.touched) {
      const o = S[t];
      if (o.team !== my) add('touch', w.certainty && ctx.future ? rivalWorth(init, t, w, ctx.future, init, si) : w.touchRivalBase + w.touchPerPoint * o.points + (o.nextGate >= 4 ? w.touchPole : o.nextGate === 3 ? w.touchGate3 : 0));
      else add('touch', w.touchOwn);
    }
    if (out.gate && inPlay(sh)) add('continuo', w.continuation); // golpe continuo
  }
  if (w.certainty && ctx.future) {
    v += (w.model === 2 ? certaintyTermsV2 : certaintyTerms)(init, out, si, mode, ctx, w, ctx.future);
  } else {
    const placed = !(mode === 'stroke' && out.shooterOut) && sh.nextGate <= POLE_STEP && !sh.outBall && sh.nextGate !== 1;
    if (placed) add('posicion', positionQuality(sh, w));
    // Exposición: una bola propia a la vista de un rival en juego puede recibir un touch y salir de la cancha.
    const rivals = S.filter((o) => o.team !== my && inPlay(o));
    for (const b of S) {
      if (b.team !== my || !inPlay(b)) continue;
      let p = 0;
      for (const r of rivals) {
        const d = distTo(r, b);
        if (d <= w.exposureReach && reach(r, b)) p = Math.max(p, clamp(1 - d / w.exposureReach, w.exposureMin, w.exposureMax));
      }
      add('exposicion', -(w.exposure * (1 + w.exposurePerPoint * b.points) * p * (late ? w.exposureLate : 1) * (out.gate ? w.exposureContinuation : 1)));
    }
  }
  return v + gauss(ctx.rng) * ctx.noise;
}


/**
 * Lo que vale tocar y sacar a la bola rival `ri`, según su peligro real (Chris, 2026-10-26, turno 28: «sacar a la 7 no es buen negocio: pegada a la línea, lejos de todas las bolas, en una zona que no es peligrosa»).
 * El valor de los pesos se multiplica por `kantokuDangerBase` (0,8) y sube hasta 1 cuanto más cerca está de una bola mía (≤ 4 m, 0 a 10 m) o de su propia puerta (≤ 3 m, 0 a 9 m); una bola pegada a la línea y aislada
 * (sin otra bola a `kantokuDangerIsoM`) vale solo `kantokuDangerFloor`. Estar lista para el poste solo suma (`touchPole`) si el agari es posible pronto (le quedan ≤ `kantokuAgariTurns` turnos) o si amenaza a una bola mía (≤ 6 m).
 * Sin certeza (pesos a mano) o con `legacyRivalDanger`, vale lo de siempre. Las bolas que miden la cercanía salen de `ref` (el tablero ANTES del golpe) y `skip` es la bola que se está colocando: si no, acercarse a la rival la haría «más peligrosa».
 */
export function rivalWorth(S: SimBall[], ri: number, w: Weights, F?: FutureCtx, ref: SimBall[] = S, skip = -1): number {
  const r = S[ri];
  const plain = w.touchRivalBase + w.touchPerPoint * r.points + (r.nextGate >= 4 ? w.touchPole : r.nextGate === 3 ? w.touchGate3 : 0);
  if (!F || !w.certainty || w.legacyRivalDanger || !CONFIG.kantokuDanger || !inPlay(r)) return plain;
  let dMine = 99, dAny = 99;
  ref.forEach((o, i) => { if (i === ri || i === skip || !inPlay(o)) return; const d = distTo(o, r); dAny = Math.min(dAny, d); if (o.team !== r.team) dMine = Math.min(dMine, d); });
  const dGate = r.nextGate <= 3 ? distTo(r, goalOf(r.nextGate)) : r.nextGate === POLE_STEP ? distTo(r, LAYOUT.pole) : 99;
  const prox = (d: number, a: number, b: number) => (d <= a ? 1 : d >= b ? 0 : (b - d) / (b - a));
  const close = Math.max(prox(dMine, 4, 10), prox(dGate, 3, 9));
  const edge = Math.min(r.x, COURT_W - r.x, r.y, COURT_H - r.y);
  const base = edge <= CONFIG.kantokuLineTouchEdgeM && dAny > CONFIG.kantokuDangerIsoM ? CONFIG.kantokuDangerFloor : CONFIG.kantokuDangerBase;
  const k = base + (1 - base) * close;
  const turnsLeft = F.seq.filter((x) => x === ri).length + 1;
  const pole = r.nextGate >= 4 ? (turnsLeft <= CONFIG.kantokuAgariTurns || dMine <= 6 ? w.touchPole : 0) : r.nextGate === 3 ? w.touchGate3 : 0;
  return k * (w.touchRivalBase + w.touchPerPoint * r.points + pole);
}

// ---------- Touch a compañeras: a dónde llevarlas con el spark ----------

/**
 * Destinos que se consideran para una compañera `mi` que se sparkea desde `from` (la bola que golpea, parada junto a ella), a ≤ 10 m con línea limpia:
 *  - puerta: delante de la puerta que necesita pasar (su zona de entrada), o a 2-3 m del poste;
 *  - ataque: a 2,5-4,5 m de las bolas rivales en juego (las 3 más cercanas a ella), del lado del que viene.
 * El valor de cada destino lo da `mateTurnValue` (ataque y doble salen de ahí).
 */
/**
 * ¿El camino de `from` a `to` pasa a más de «radio de la bola + radio del poste + margen» de cada poste (puertas y poste de meta)? `reach` trata la bola como un punto y deja pasar un camino que roza el poste: la física lo choca.
 * Turno 28 (Chris): el poste de meta (10; 7,5) estaba en la línea entre la 10 y el frente del 2º arco, y la 10 se quedaba en (8; 8,2).
 */
export function clearOfPosts(from: P, to: P, margin = CONFIG.kantokuPostClearM): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, len2 = dx * dx + dy * dy;
  return POSTS.every((p) => {
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2));
    return Math.hypot(from.x + dx * t - p.x, from.y + dy * t - p.y) >= p.r + CONFIG.ballRadiusM + margin;
  });
}

export function mateDestinations(S: SimBall[], mi: number, from: P): P[] {
  const m = S[mi];
  const out: P[] = [];
  const mg = 1;
  const push = (p: P) => {
    if (p.x < mg || p.x > COURT_W - mg || p.y < mg || p.y > COURT_H - mg) return;
    const d = distTo(from, p);
    if (d < 1 || d > CONFIG.kantokuMateRangeM || !reach(from, p) || (!CONFIG.legacyPostClear && !clearOfPosts(from, p))) return;
    if (out.some((q) => distTo(q, p) < 0.5)) return;
    out.push(p);
  };
  if (m.nextGate >= 2 && m.nextGate <= 3) {
    const gt = GATES[m.nextGate - 1];
    const dv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gt.dir];
    for (const back of [1.5, 2.5, 3.5]) for (const side of [-0.4, 0, 0.4]) push({ x: gt.x - dv[0] * back - dv[1] * side, y: gt.y - dv[1] * back + dv[0] * side });
  } else if (m.nextGate === POLE_STEP) {
    const th = Math.atan2(from.y - LAYOUT.pole.y, from.x - LAYOUT.pole.x);
    for (const a of [-40, 0, 40]) for (const r of [2, 3]) push({ x: LAYOUT.pole.x + Math.cos(th + (a * Math.PI) / 180) * r, y: LAYOUT.pole.y + Math.sin(th + (a * Math.PI) / 180) * r });
  }
  const rivals = S.map((_, i) => i).filter((i) => S[i].team !== m.team && inPlay(S[i])).sort((a, b) => distTo(m, S[a]) - distTo(m, S[b])).slice(0, 3);
  for (const ri of rivals) {
    const r = S[ri];
    const th = Math.atan2(from.y - r.y, from.x - r.x);
    for (const a of [-60, -30, 0, 30, 60]) for (const rad of [2.5, 4.5]) push({ x: r.x + Math.cos(th + (a * Math.PI) / 180) * rad, y: r.y + Math.sin(th + (a * Math.PI) / 180) * rad });
  }
  return out;
}

/**
 * Lo que vale el turno de mi compañera `mi` si queda en `pos`, según su certeza y lo que los rivales que juegan antes pueden hacerle: la mejor de sus opciones, con los dobles.
 *  - pasar su puerta (o llegar al poste) y luego tocar una rival con el golpe continuo;
 *  - tocar una rival (touch y spark que la saca) y luego, desde donde queda, pasar su puerta;
 * todo × (1 − la probabilidad de que una rival que juega antes la toque ahí). Una compañera que no vuelve a jugar vale 0.
 */
export function mateTurnValue(S: SimBall[], mi: number, pos: P, w: Weights, F: FutureCtx, R: { heapSparkP: number; cont?: number }, exitChain = true): number {
  const m: SimBall = { ...S[mi], x: pos.x, y: pos.y };
  if (m.outBall || m.nextGate > POLE_STEP || m.nextGate < 2) return 0;
  const first = F.seq.indexOf(mi);
  if (first < 0) return 0;
  const rivalBase = F.rivalBase ?? F.base;
  const rErr = (ri: number, d: number) => errorsAt(rivalBase, F.rivalProfiles ? F.rivalProfiles[ri] : NEUTRAL_PROFILE, d);
  // Que la bola llegue viva a su turno (Chris, 2026-10-26, turno 54a: la 2 quedó donde 5, 7, 9 y 1 podían tocarla con 27-32 % cada una y el ataque que preparaba se valoró casi completo): sobrevive si NINGUNA de las rivales que
  // juegan antes la toca ni la saca (con pasar su puerta y tocar, y las cadenas de touches): Π (1 − amenaza). Antes contaba solo la mayor (`legacyMateSurvival`).
  let defended = 0, survive = 1;
  const chains = !w.legacyMateSurvival && !w.legacyChains && !w.legacyChainRisk && CONFIG.kantokuChainDepth >= 2;
  const S2 = chains ? S.map((b, i) => (i === mi ? m : b)) : S;
  const model = chains ? new ChainModel(S2, rErr, R.cont ?? CONFIG.kantokuContinuationAttack, exitChain, 1) : null;
  for (const ri of new Set(F.seq.slice(0, first))) {
    const r = S[ri];
    if (r.team === m.team || !inPlay(r)) continue;
    const t = Math.min(1, Math.max(touchThreat(r, pos, rErr(ri, distTo(r, pos)), exitChain), model ? model.chain(ri, mi, CONFIG.kantokuChainDepth) : 0));
    defended = Math.max(defended, t);
    survive *= 1 - t;
  }
  if (!w.legacyMateSurvival) defended = 1 - survive;
  const goal = goalOf(m.nextGate);
  const myErr = (d: number) => errorsAt(F.base, F.profiles[mi], d);
  const gatePts = (m.nextGate >= POLE_STEP ? CONFIG.polePoints : CONFIG.gatePoints) * w.point;
  const gErr = myErr(distTo(m, goal));
  const pPass = scoreProbability(m, m.nextGate, gErr, true);
  let bestExit = 0, attack = 0;
  for (let ri = 0; ri < S.length; ri++) {
    const r = S[ri];
    if (r.team === m.team || !inPlay(r)) continue;
    const d = distTo(m, r);
    if (d < 0.3) continue;
    const vt = rivalWorth(S, ri, w, F, S, mi) + R.heapSparkP * (w.outRivalBase + w.outRivalPerPoint * r.points);
    if (m.nextGate <= 3) bestExit = Math.max(bestExit, exitChainThreat(m, r, gErr) * vt);
    if (!reach(m, r)) continue;
    const pT = touchProbability(myErr(d), d, true);
    const at = { ...m, x: r.x, y: r.y };
    const pAt = scoreProbability(at, m.nextGate, myErr(distTo(at, goal)), true);
    attack = Math.max(attack, pT * (vt + R.heapSparkP * pAt * gatePts));
  }
  return (1 - Math.min(1, defended)) * Math.max(pPass * gatePts + bestExit, attack);
}

const RISK_WEIGHTS = [1, 0.5, 0.25]; // peso de la 1.ª, 2.ª y 3.ª bola rival que va a jugar

/**
 * Amenaza avanzada de `r` sobre mi bola `b`: el valor esperado del intento de touch del rival (normalizado por lo que vale acertar con spark que saca mi bola), no solo la
 * probabilidad de acertar. Con la tabla de intentos (`attackTable.json`, según la distancia de mi bola a la línea, el ángulo y la distancia del tiro): acierta y spark (gana el touch y,
 * con la probabilidad de la tabla, saca mi bola), sale mi bola por el impacto sin touch (gana solo eso), salen las dos o solo la suya (pierde el turno), o falla y su bola sale (pierde
 * el turno). Los valores salen de los pesos del kantoku. Cerca de la línea, con ángulo y distancia en que un intento suele fallar o salirse, la amenaza baja (incluso a 0: el rival no se anima).
 */
function attackThreat(r: SimBall, b: SimBall, pTouch: number, w: Weights, who: 'human' | 'cpu'): number {
  const dx = b.x - r.x, dy = b.y - r.y, D = Math.hypot(dx, dy);
  if (D < 0.3 || r.nextGate === 1) return pTouch;
  const lines = [b.x, COURT_W - b.x, b.y, COURT_H - b.y];
  const k = lines.indexOf(Math.min(...lines));
  const n = [[-1, 0], [1, 0], [0, -1], [0, 1]][k];
  const phi = (Math.acos(clamp((dx * n[0] + dy * n[1]) / D, -1, 1)) * 180) / Math.PI;
  const o = attackOutcome(who, lines[k], phi, D);
  if (!o) return pTouch;
  const full = w.touchRivalBase + w.outRivalBase;
  if (full <= 1e-6) return pTouch;
  const gain = w.outRivalBase, lose = w.shooterOutLater;
  const ev = pTouch * (o.d * (w.touchRivalBase + o.exp * gain) + o.c * gain + o.b * (gain - lose) - o.b2 * lose) - (1 - pTouch) * o.a * lose;
  return Math.max(0, ev) / full;
}

/** Probabilidad de que mi bola `c` (que cubre o castiga) llegue viva a su turno: ninguna rival que juega antes que ella la toca (touch directo o pasando su puerta). */
export function coverSurvival(S: SimBall[], c: number, firstIdx: Map<number, number>, my: number, rivalErr: (i: number, d: number) => ErrorBase, exitChain = true): number {
  const kc = firstIdx.get(c) ?? 99;
  let sv = 1;
  for (const [r2, k2] of firstIdx) {
    if (k2 >= kc || S[r2].team === my) continue;
    sv *= 1 - Math.min(1, touchThreat(S[r2], S[c], rivalErr(r2, distTo(S[r2], S[c])), exitChain));
  }
  return sv;
}

/**
 * «Enviar a marcar» (Chris, 2026-10-27): la rival `ri` toca a una compañera suya `mj` y, con el spark, la manda junto a mi bola `bi`; `mj` juega después de `ri` y antes de que mi bola vuelva a jugar (`firstIdx` = el turno en que
 * juega cada bola), y desde junto a ella la toca o pasa su puerta y la toca (puerta + touch). P = P(ri toca a mj) × continuación `K` × P(el spark la deja junto a mi bola) × P(ataque desde ahí). Es la versión rival del touch a compañeras.
 */
export function sendThreat(S: SimBall[], ri: number, bi: number, firstIdx: Map<number, number>, my: number, rivalErr: (i: number, d: number) => ErrorBase, K: number, exitChain = true): number {
  if (CONFIG.kantokuSendSparkP <= 0) return 0;
  const kr = firstIdx.get(ri) ?? 99, kb = firstIdx.get(bi) ?? 99;
  let best = 0;
  for (const [mj, km] of firstIdx) {
    if (mj === ri || S[mj].team === my || !inPlay(S[mj]) || km <= kr || km >= kb) continue;
    const dMB = distTo(S[mj], S[bi]);
    if (dMB < 1 || dMB > CONFIG.kantokuMateRangeM) continue;
    const dRM = distTo(S[ri], S[mj]);
    const pT = inPlay(S[ri]) || S[ri].nextGate === 1 ? touchThreat(S[ri], S[mj], rivalErr(ri, dRM), exitChain) : 0;
    if (pT < 0.05) continue;
    const th = Math.atan2(S[mj].y - S[bi].y, S[mj].x - S[bi].x);
    const spot = { x: S[bi].x + Math.cos(th) * 2.5, y: S[bi].y + Math.sin(th) * 2.5 }; // el spark la deja a ≈ 2,5 m de mi bola, del lado de donde viene
    const at = { ...S[mj], x: spot.x, y: spot.y };
    const pAttack = Math.max(touchProbability(rivalErr(mj, 2.5), 2.5, true), exitChainThreat(at, S[bi], rivalErr(mj, 2.5)));
    best = Math.max(best, pT * K * CONFIG.kantokuSendSparkP * pAttack);
  }
  return best;
}

/**
 * Exposición de mi bola `bi` en el tablero `S`: la probabilidad de que alguna de las próximas rivales la toque, la saque o la mande a marcar (touch directo, cadenas y «enviar a marcar»), sin contar mi cobertura. Es la medida
 * que usan las pruebas de comportamiento para comparar dónde queda una bola; no entra en la valoración. Con `lineWeights` el touch directo se valora como en el planificador (valor esperado del intento del rival cerca de la línea, `attackThreat`).
 */
export function exposureOf(S: SimBall[], bi: number, F: FutureCtx, K = CONFIG.kantokuContinuationAttack, rivals = 5, lineWeights?: Weights): number {
  const firstIdx = new Map<number, number>();
  F.seq.forEach((i, k) => { if (!firstIdx.has(i)) firstIdx.set(i, k); });
  const my = S[bi].team;
  const rivalBase = F.rivalBase ?? F.base;
  const rErr = (i: number, d: number) => errorsAt(rivalBase, F.rivalProfiles ? F.rivalProfiles[i] : NEUTRAL_PROFILE, d);
  const model = new ChainModel(S, rErr, K, true, 3);
  let safe = 1, n = 0;
  for (const [ri] of firstIdx) {
    if (S[ri].team === my || (!inPlay(S[ri]) && S[ri].nextGate !== 1)) continue;
    if (n++ >= rivals) break;
    let direct = Math.max(touchThreat(S[ri], S[bi], rErr(ri, distTo(S[ri], S[bi])), true), inPlay(S[ri]) ? model.chain(ri, bi, CONFIG.kantokuChainDepth) : 0);
    if (lineWeights) direct = attackThreat(S[ri], S[bi], direct, lineWeights, F.rivalProfiles ? 'cpu' : 'human'); // con la defensa de la línea: cerca de ella el intento del rival vale menos
    const send = sendThreat(S, ri, bi, firstIdx, my, rErr, K, true);
    safe *= 1 - Math.min(1, 1 - (1 - direct) * (1 - send));
  }
  return 1 - safe;
}

/**
 * Términos del kantoku v2 (iteración C). Premia acomodar bolas mías donde su dueño pasa su puerta (`posProb`), castiga la MEJOR opción de las próximas bolas rivales
 * (`risk`: pasar su puerta o tocar una bola mía, con su certeza y el pasto; incluye la bola mía que acaba de volver a entrar y las rivales aún en la salida), premia las
 * bolas mías en su zona de entrada y sin ángulo sencillo para el rival (`zone`), premia tener cerca otra bola mía para encadenar touch y spark (`support`) y el poste
 * (`poleBonus`). No usa los puntos esperados ni la exposición a mano.
 */
function certaintyTermsV2(init: SimBall[], out: Outcome, si: number, mode: 'stroke' | 'spark', ctx: PlanCtx, w: Weights, F: FutureCtx) {
  const my = ctx.team;
  const R = ruleOf(w);
  const S = out.balls;
  let v = 0;
  const T = ctx.terms;
  const bm = balanceMul(ctx, w); // el ataque pesa 1/bm (ver `balanceMul`)
  const add = (k: string, x: number) => { if (k === 'oportunidadTouch' || k === 'sparkPropio' || k === 'preparaTurno') x /= bm; v += x; if (T) T[k] = (T[k] ?? 0) + x; };
  const goalDist = (o: SimBall) => distTo(o, goalOf(Math.min(o.nextGate, POLE_STEP)));
  const ownErr = (i: number, o: SimBall) => errorsAt(F.base, F.profiles[i], goalDist(o));
  const rivalBase = F.rivalBase ?? F.base;
  const rivalErr = (i: number, d: number) => errorsAt(rivalBase, F.rivalProfiles ? F.rivalProfiles[i] : NEUTRAL_PROFILE, d);
  const pPass = (i: number, o: SimBall) => scoreProbability(o, o.nextGate, ownErr(i, o), true);
  // Tsunagi: cadenas de touches del rival hacia mis bolas, y mis bolas que se acercan a su puerta con un puente
  const chainsOn = !w.legacyChains && CONFIG.kantokuChainDepth >= 2;
  const rivalModel = chainsOn && !w.legacyChainRisk ? new ChainModel(S, (i, d) => rivalErr(i, d), R.cont, !w.legacyExitChain, 1) : null;
  const ownModel = chainsOn ? new ChainModel(S, (i, d) => errorsAt(F.base, F.profiles[i], d), R.cont, false, 2) : null;
  const pPassB = (i: number) => Math.max(pPass(i, S[i]), ownModel && !w.legacyBridges ? CONFIG.kantokuBridgeWeight * ownModel.bridgePass(i) : 0);
  const nextMate = F.seq.find((i) => S[i].team === my);

  // 1. Acomodar: mejora de la probabilidad de pasar su puerta de las bolas mías que se movieron.
  const mineIdx: number[] = [];
  let mateGain = 0; // lo que ganan las compañeras que se mueven (acomodo y turno que preparan): para la jugada de varios beneficios
  for (let i = 0; i < S.length; i++) {
    const b = S[i];
    if (b.team !== my || !inPlay(b)) continue;
    mineIdx.push(i);
    const moved = (mode === 'stroke' && i === si) || b.x !== init[i].x || b.y !== init[i].y;
    if (!moved) continue;
    const dPass = pPass(i, b) - (inPlay(init[i]) ? pPass(i, init[i]) : 0);
    add('acomodo', w.posProb * (1 + (i === nextMate ? w.nextMateBonus : 0)) * dPass);
    if (i !== si || mode === 'spark') mateGain += dPass;
  }

  // 2. Riesgo: la mejor opción de las próximas bolas rivales; y la amenaza sobre cada bola mía (para la zona).
  const RW = w.riskWeights ?? RISK_WEIGHTS;
  const rivals = [...new Set(F.seq.filter((i) => S[i].team !== my && S[i].nextGate !== FINISHED))].slice(0, RW.length);
  const mine = mineIdx.map((i) => S[i]);
  const threat = new Map<number, number>();
  const threatBy = new Map<number, Map<number, number>>(); // amenaza sobre cada bola mía por rival (índice de la rival): para juntarse, que solo cuenta a quien juega antes que la compañera
  // Golpe continuo y touch: la bola que pasó una puerta vuelve a jugar antes que el rival, y un touch da el spark y, si sale bien, otro golpe. Los rivales a su alcance se
  // atacan en cadena (de cerca a lejos): sacar uno y seguir con el siguiente desde el mismo sitio. `handled[ri]` = la parte de su amenaza que se da por resuelta: la
  // probabilidad de lograr ese touch y el spark (`kantokuContinuationAttack`) por la de haber resuelto antes los anteriores. Así la oportunidad cuenta a favor y no solo el
  // peligro de quedar cerca de ellos, y con dos rivales vale más que con uno.
  const sh = S[si];
  const attackK = R.cont;
  const handled = new Map<number, number>();
  if (mode === 'stroke' && attackK > 0 && inPlay(sh) && (out.gate || out.touched.length > 0)) {
    let chain = 1;
    const targets = [...new Set(F.seq.filter((i) => S[i].team !== my && inPlay(S[i])))].sort((a, b) => distTo(sh, S[a]) - distTo(sh, S[b]));
    for (const ri of targets) {
      const r = S[ri];
      const d = distTo(sh, r);
      const touched = out.touched.includes(ri);
      if (!touched && (d > w.exposureReach + 2 || !reach(sh, r))) continue;
      const step = attackK * (touched ? 1 : touchProbability(errorsAt(F.base, F.profiles[si], d), d, true));
      handled.set(ri, chain * step);
      add('oportunidadTouch', chain * step * rivalWorth(S, ri, w, F, init, si));
      chain *= step;
    }
  }
  // Reglas avanzadas (iteración D): orden de los turnos, para saber qué compañeras juegan antes que cada rival
  const adv = !!w.advanced;
  const who = F.rivalProfiles ? 'cpu' : 'human';
  const firstIdx = new Map<number, number>();
  F.seq.forEach((i, k) => { if (!firstIdx.has(i)) firstIdx.set(i, k); });
  const mates = [...firstIdx.keys()].filter((i) => S[i].team === my && inPlay(S[i]) && i !== si);
  const K = R.cont;
  const teamTouch = (t: number, target: SimBall) => {
    const d = distTo(S[t], target);
    return d < 0.3 || !reach(S[t], target) ? 0 : K * touchProbability(errorsAt(F.base, F.profiles[t], d), d, true);
  };
  const tmat = new Map<string, number>(); // amenaza del rival ri sobre mi bola bi (sin la recogida): para el apoyo según el orden de turnos
  let risk = 0;
  // Una compañera que «cubre» (recoge mi bola, castiga el fallo del rival, neutraliza a una rival) puede ser sacada antes por una rival que juega antes que ella (Chris, 2026-10-27, turno 32: la 7 saca a la 8 que cubría):
  // su cobertura solo cuenta con la probabilidad de que llegue viva a su turno. `legacyCover` lo apaga.
  const cover = new Map<number, number>();
  const coverOf = (c: number) => (w.legacyCover ? 1 : 1 - CONFIG.kantokuCoverWeight * (1 - (cover.get(c) ?? 1)));
  if (!w.legacyCover) for (const c of mates) cover.set(c, coverSurvival(S, c, firstIdx, my, rivalErr, !w.legacyExitChain));
  // «Enviar a marcar» (Chris, 2026-10-27): la rival `ri` toca a una compañera suya `mj` y, con el spark, la manda junto a mi bola `bi`; `mj` juega después de `ri` y antes de que mi bola pueda salir de ahí, y desde junto a ella la toca o
  // pasa su puerta y la toca (puerta + touch). P = P(ri toca a mj) × continuación × P(el spark la deja junto a mi bola) × P(ataque desde ahí). `legacySend` lo apaga.
  const sendFor = (ri: number, bi: number): number => (w.legacySend ? 0 : sendThreat(S, ri, bi, firstIdx, my, rivalErr, R.cont, !w.legacyExitChain));
  let sendMax = 0, restSum = 0;
  const detail = ctx.detail;
  if (detail) detail.risk = [];
  rivals.forEach((ri, k) => {
    const r = S[ri];
    const ir = firstIdx.get(ri) ?? 99;
    // una compañera que juega antes que este rival puede tocarlo y sacarlo: su amenaza queda en pie solo en parte
    const neutral = adv ? mates.reduce((m, t) => ((firstIdx.get(t) ?? 99) < ir ? Math.max(m, teamTouch(t, r) * coverOf(t)) : m), 0) : 0;
    const free = (1 - (handled.get(ri) ?? 0)) * (1 - neutral); // la parte de su amenaza que sigue en pie
    // Pasar su puerta vale un punto; tocar y sacar una bola mía vale ≈ 7 veces más. Antes el riesgo comparaba las dos PROBABILIDADES (pasar 42 % contra tocar 16 % → contaba solo pasar) y la posición de mi bola no
    // importaba mientras el rival pudiera pasar su puerta (Chris, 2026-10-24: la blanca 8 al centro frente a la puerta 2, a la vista de la roja 9). `kantokuRiskByValue` pone la opción de pasar en la misma escala.
    const passUnit = R.passScale !== undefined && !w.legacyRiskByValue ? R.passScale : CONFIG.kantokuRiskByValue && !w.legacyRiskByValue ? Math.min(1, ((r.nextGate >= POLE_STEP ? CONFIG.polePoints : CONFIG.gatePoints) * w.point) / Math.max(1e-6, w.touchRivalBase + w.outRivalBase)) : 1;
    let best = free * passThreat(r, rivalErr(ri, goalDist(r))) * passUnit;
    // solo la rival que juega justo después (la primera de la lista): con todas, cada rival en la salida sumaba su «pasar la puerta» y dejaba de compensar pasar la puerta 1
    const comboOn = k === 0 && !w.legacyCombo && CONFIG.kantokuComboRisk && (inPlay(r) || r.nextGate === 1);
    const tAdj = new Map<number, number>(); // probabilidad de tocar cada bola mía (con recogida), para las combinaciones
    const optVals: number[] = []; // valor de cada opción de touch de esta rival (la mayor cuenta entera y el resto, en parte: `kantokuRiskRest`)
    const row: RiskRow | null = detail ? { rival: r.n, weight: RW[k], free, pass: best, touches: [], best: 0 } : null;
    for (const bi of mineIdx) {
      const b = S[bi];
      const pTouch = Math.max(touchThreat(r, b, rivalErr(ri, distTo(r, b)), !w.legacyExitChain), rivalModel && inPlay(r) ? rivalModel.chain(ri, bi, CONFIG.kantokuChainDepth) : 0);
      let t = adv ? attackThreat(r, b, pTouch, w, who) : pTouch;
      let punish = 1; // fracción de la amenaza que queda tras el castigo al fallo (solo para el riesgo; juntarse y la zona miran la amenaza completa: si el rival acierta, la segunda bola también corre peligro)
      // Intento lejano: si el rival falla, su bola queda junto a mi bola y mis bolas que juegan después la tocan (o pasan su puerta y la sacan): ese riesgo del rival resta a su amenaza (Chris, 2026-10-27)
      if (adv && !w.legacyFailPunish && CONFIG.kantokuFailPunish > 0 && t > 0 && inPlay(r)) {
        const d = distTo(r, b), far = clamp((d - CONFIG.kantokuFailFromM) / Math.max(0.5, CONFIG.kantokuFailFullM - CONFIG.kantokuFailFromM), 0, 1);
        if (far > 0) {
          const dd = Math.max(d, 0.3), spot = { x: b.x + ((r.x - b.x) / dd) * 1.5, y: b.y + ((r.y - b.y) / dd) * 1.5 }; // un tiro corto o largo queda cerca de mi bola
          let pn = 1;
          for (const ci of firstIdx.keys()) {
            if (S[ci].team !== my || !inPlay(S[ci]) || (firstIdx.get(ci) ?? 99) <= ir) continue;
            const dc = distTo(S[ci], spot);
            const pc = dc < 0.3 ? 0 : Math.max(reach(S[ci], spot) ? K * touchProbability(errorsAt(F.base, F.profiles[ci], dc), dc, true) : 0, exitChainThreat(S[ci], spot, errorsAt(F.base, F.profiles[ci], dc)));
            pn *= 1 - pc * coverOf(ci);
          }
          const full = Math.max(1e-6, w.touchRivalBase + w.outRivalBase);
          const t0 = t;
          t -= Math.min(CONFIG.kantokuFailMaxCut * t, far * CONFIG.kantokuFailPunish * (1 - pTouch) * (1 - pn) * (w.shooterOutLater / full));
          punish = t0 > 0 ? t / t0 : 1;
          t = t0;
        }
      }
      // El «doble» del rival: toca mi bola (el spark la saca) y, desde donde queda junto a ella, pasa su puerta con el golpe extra. Cuenta el punto de la puerta (o del poste) como fracción de lo que
      // vale tocar y sacar mi bola; es más que nada cuando mi bola está en la zona de entrada de la puerta del rival (Chris: «doble ángulo» frente a la puerta 2).
      if (!w.legacyTouchPass && !comboOn && R.touchPass > 0 && inPlay(r) && pTouch > 0) {
        const at = { ...r, x: b.x, y: b.y };
        const unit = ((r.nextGate >= POLE_STEP ? CONFIG.polePoints : CONFIG.gatePoints) * w.point) / Math.max(1e-6, w.touchRivalBase + w.outRivalBase);
        t *= 1 + R.touchPass * unit * R.cont * passThreat(at, rivalErr(ri, distTo(at, goalOf(Math.min(r.nextGate, POLE_STEP)))));
      }
      tmat.set(`${ri},${bi}`, free * t);
      // ... y una compañera que juega antes que el rival puede tocar mi bola para recogerla
      if (adv) t *= 1 - mates.reduce((m, tm) => (tm !== bi && (firstIdx.get(tm) ?? 99) < ir ? Math.max(m, teamTouch(tm, b) * coverOf(tm)) : m), 0);
      const send = sendFor(ri, bi);
      sendMax = Math.max(sendMax, free * send);
      const tb = 1 - (1 - t * punish) * (1 - send); // con lo que la rival puede mandar a marcar
      const val = free * (1 + w.riskPerPoint * b.points) * tb;
      optVals.push(val);
      best = Math.max(best, val);
      tAdj.set(bi, tb);
      row?.touches.push({ ball: b.n, pTouch, threat: tb, weighted: val, send: send > 0.005 ? send : undefined });
      t = 1 - (1 - t) * (1 - send);
      if (!threatBy.has(bi)) threatBy.set(bi, new Map());
      threatBy.get(bi)!.set(ri, Math.min(1, RW[k] * free * t));
      // la bola puede ser tocada por cualquiera de los rivales que juegan pronto: probabilidad de que alguno lo logre (antes, solo el mayor)
      threat.set(bi, w.legacyThreatUnion || !CONFIG.kantokuThreatUnion ? Math.max(threat.get(bi) ?? 0, RW[k] * free * t) : 1 - (1 - (threat.get(bi) ?? 0)) * (1 - Math.min(1, RW[k] * free * t)));
    }
    // Doble ángulo (Chris, 2026-10-26): dos oportunidades seguidas del rival que juega después. Se valora la combinación, no solo la mejor opción:
    //  bola y bola: toca una de mis bolas y, con el golpe extra, va por otra (pierdo las dos);  puerta y bola: pasa su puerta y luego toca mi bola;  bola y puerta: toca mi bola y luego pasa su puerta.
    // El segundo golpe vale lo que da el segundo evento (la otra bola, o el punto de la puerta en la misma escala que «pasar su puerta»: `passUnit`), por la probabilidad de lograr el primero y de que salga el golpe extra.
    if (comboOn) {
      const vOf = (b: SimBall) => 1 + w.riskPerPoint * b.points;
      const goal = goalOf(Math.min(r.nextGate, POLE_STEP));
      const pPass = passThreat(r, rivalErr(ri, goalDist(r)));
      const second = CONFIG.kantokuComboScale;
      let combo = 0, kind = '';
      const take = (v: number, kd: string) => { if (v > combo) { combo = v; kind = kd; } };
      for (const a of mineIdx) {
        const tA = tAdj.get(a) ?? 0;
        if (tA <= 0) continue;
        const A = S[a];
        for (const bb of mineIdx) {
          if (bb === a) continue;
          const dAB = distTo(A, S[bb]);
          const pAB = dAB < 0.25 ? 0 : rivalModel ? rivalModel.touch(ri, a, bb) : reach(A, S[bb]) ? touchProbability(rivalErr(ri, dAB), dAB, true) : 0;
          take(free * tA * (vOf(A) + second * R.cont * pAB * vOf(S[bb])), `bola y bola (${A.n} y ${S[bb].n})`);
        }
        const at = { ...r, x: A.x, y: A.y };
        // mi bola delante de la puerta del rival: el touch es fácil y desde ahí pasa su puerta; el punto vale más que `passUnit` (`kantokuComboFrontUnit`)
        const gt = r.nextGate <= 3 ? GATES[r.nextGate - 1] : null;
        const dv = gt ? { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gt.dir] : null;
        const front = !w.legacyComboFront && !!gt && !!dv && (A.x - gt.x) * dv[0] + (A.y - gt.y) * dv[1] < -0.5 && Math.hypot(A.x - gt.x, A.y - gt.y) <= CONFIG.kantokuComboFrontM;
        take(free * tA * (vOf(A) + second * R.cont * passThreat(at, rivalErr(ri, distTo(at, goal))) * (front ? Math.max(passUnit, CONFIG.kantokuComboFrontUnit) : passUnit)), `bola y puerta (${A.n})`);
      }
      for (const bb of mineIdx) {
        const ex = r.nextGate === 1 ? touchThreat(r, S[bb], rivalErr(ri, distTo(r, S[bb])), !w.legacyExitChain) : exitChainThreat(r, S[bb], rivalErr(ri, distTo(r, S[bb])));
        take(free * (pPass * passUnit + second * ex * vOf(S[bb])), `puerta y bola (${S[bb].n})`);
      }
      // Si el golpe pasó una puerta (golpe continuo) la bola aún se mueve antes de que el rival juegue: la combinación cuenta solo en parte (`kantokuComboContinuation`)
      const part = mode === 'stroke' && out.gate ? CONFIG.kantokuComboContinuation : 1;
      if (combo > best) { const extra = (combo - best) * part; best += extra; if (row) row.combo = { kind, value: best }; }
    }
    // Lo demás que la rival podría hacer además de su mejor opción (encadena y se lleva más de una bola: el turno 23 de la partida 20261027-114432 sacó cinco): cuenta en parte, y así una bola nueva en una zona expuesta se nota
    // aunque otra bola mía ya sea la peor (`legacyRiskRest` lo apaga).
    if (!w.legacyRiskRest && CONFIG.kantokuRiskRest > 0 && optVals.length > 1) {
      const top = Math.max(...optVals);
      const rest = optVals.reduce((a, v) => a + v, 0) - top;
      restSum += RW[k] * rest;
      best += CONFIG.kantokuRiskRest * rest;
    }
    if (row) { row.best = best; detail!.risk!.push(row); }
    risk += RW[k] * best;
  });
  void mine; void bestOption; void restSum;
  // Con muchas de mis bolas fuera la cancha queda abierta: sin compañeras que cubran o castiguen el fallo, la rival manda bolas a marcar sin miedo; el riesgo pesa más (solo si alguna rival puede mandar: `sendMax`)
  if (!w.legacyOpenField && CONFIG.kantokuOpenField > 0) {
    const covers = mates.reduce((a, c) => a + coverOf(c), 0); // compañeras que de verdad llegan vivas a su turno (una que una rival puede sacar antes no cuenta)
    const open = 1 - Math.min(covers, 3) / 3;
    risk *= 1 + CONFIG.kantokuOpenField * open * Math.min(1, sendMax / CONFIG.kantokuOpenSendP);
  }
  add('riesgo', -(w.risk * risk));

  // 2b. Agari pendiente: la bola lista para el poste con turnos por delante espera cerca de él (el agari llega en las últimas vueltas de esa bola)
  if (!w.legacyAgari) {
    for (const bi of mineIdx) {
      if (S[bi].nextGate !== POLE_STEP) continue;
      const left = turnsAfter(F, bi) + (mode === 'stroke' && bi === si ? 1 : 0);
      if (agariEarly(left, ctx.clock) && !agariAllowed(S, bi, ctx, CONFIG.polePoints)) add('agariListo', CONFIG.kantokuAgariReady * pPass(bi, S[bi]));
    }
  }

  // 2c. Juntarse (Chris, 2026-10-25): juntar mis bolas solo está bien sin amenaza (rivales lejos o la que amenaza está fuera). Si una rival en juego puede llegar a la bola que se junta (directo, con cadenas o pasando su puerta,
  // según el orden de turnos y la certeza de quien amenaza: es la amenaza `threat` de arriba), cuesta `kantokuJoinPenalty` × esa amenaza, y la evaluación decide si compensa.
  if (!w.legacyJoin && CONFIG.kantokuJoinPenalty > 0) {
    for (const bi of mineIdx) {
      const moved = (mode === 'stroke' && bi === si) || S[bi].x !== init[bi].x || S[bi].y !== init[bi].y;
      if (!moved) continue;
      if (mode === 'stroke' && out.touched.some((t) => S[t].team === my)) continue; // tocar a una compañera: el spark que sigue la lleva a otro lado, no es juntarse
      // juntarse = quedar a ≤ `kantokuJoinM` de una bola mía de la que antes no estaba cerca (pasar de un par a otro también cuenta)
      const joined = mineIdx.some((j) => j !== bi && distTo(S[j], S[bi]) <= CONFIG.kantokuJoinM && !(inPlay(init[j]) && inPlay(init[bi]) && distTo(init[j], init[bi]) <= CONFIG.kantokuJoinM));
      const wasJoined = false;
      // ... salvo con el spark que deja a una compañera en su zona de entrada junto a otra que pasa la misma puerta (Chris, turno 28: «facilita un flujo de puntos»): dos bolas listas para el mismo arco pasan una tras otra
      const flow = mode === 'spark' && !w.legacyZoneSpark && CONFIG.kantokuZonePassP > 0 && !startRivalNext(S, my, F) && S[bi].nextGate >= 2 && S[bi].nextGate <= 3 && pPass(bi, S[bi]) >= CONFIG.kantokuZonePassP
        && mineIdx.some((j) => j !== bi && distTo(S[j], S[bi]) <= CONFIG.kantokuJoinM && S[j].nextGate === S[bi].nextGate);
      // Ventana del doble (v1.4, Chris, turno 12 de la partida 20261027-205516): juntarse se castiga por lo que una rival puede hacer con las dos bolas JUNTAS, es decir, antes de que la compañera vuelva a jugar y se
      // lleve la ventaja (pasar su puerta ayudada por la bola que llegó). Una rival que juega después de la compañera (la roja 5, aún sin salir) ya no ve el par: ve la bola sola, y eso lo cuentan el riesgo y la exposición.
      // `legacyJoinWindow` cuenta a todas las rivales, como antes.
      let jt = threat.get(bi) ?? 0;
      if (!w.legacyJoinWindow) {
        const partners = mineIdx.filter((j) => j !== bi && distTo(S[j], S[bi]) <= CONFIG.kantokuJoinM && !(inPlay(init[j]) && inPlay(init[bi]) && distTo(init[j], init[bi]) <= CONFIG.kantokuJoinM));
        const ordP = Math.max(...partners.map((j) => firstIdx.get(j) ?? 99)); // la última compañera que juega (la ventana más amplia)
        let free2 = 1;
        for (const [ri, v] of threatBy.get(bi) ?? []) if ((firstIdx.get(ri) ?? 99) < ordP) free2 *= 1 - v;
        jt = 1 - free2;
      }
      if (joined && !wasJoined && !flow) add('juntarse', -CONFIG.kantokuJoinPenalty * Math.min(1, jt));
    }
  }

  // 2e. Exposición propia (Chris, 2026-10-27): la bola que acaba de moverse (la que golpea o la que recibe el spark) paga lo expuesta que queda ahora, además del riesgo de la mejor opción de cada rival (que no distingue una bola nueva
  // de otra que ya estaba expuesta: en la partida 20261027-114432 las 77 reentradas valían igual). Amenaza completa (directa, cadenas y mandar a marcar), sin contar mi cobertura. `legacyOwnExposure` lo apaga.
  // Solo en la reentrada: en la salida de la puerta 1 y en los golpes normales ya cuenta el riesgo de la mejor opción y el término empeoraba `gate1` S4.
  if (!w.legacyOwnExposure && CONFIG.kantokuOwnExposure > 0 && mode === 'stroke' && init[si].outBall && S[si].team === my && inPlay(S[si])) {
    const horizon = F.turns ? Math.min(1, F.turns[si] / 2) : 1; // a una bola que casi no vuelve a jugar le importa menos quedar expuesta (modelo de ritmo)
    add('exposicion', -CONFIG.kantokuOwnExposure * horizon * (1 + w.riskPerPoint * S[si].points) * Math.min(1, threat.get(si) ?? 0));
  }

  // 3. Zona: bolas mías con buena probabilidad de pasar y sin un ángulo de tiro sencillo para el rival.
  for (const bi of mineIdx) add('zona', w.zone * pPassB(bi) * (1 - Math.min(1, threat.get(bi) ?? 0)));

  // 2d. Una bola a la que le quedan pocos turnos no se esconde (Chris, 2026-10-26): si le quedan ≤ `kantokuLateTurns` turnos (el actual cuenta), acercarse a su puerta vale más (la probabilidad de pasarla en su próximo turno)
  if (!w.legacyLateProgress && CONFIG.kantokuLateProgress > 0 && mode === 'stroke' && S[si].team === my && inPlay(S[si]) && inPlay(init[si]) && !out.gate) {
    const left = turnsAfter(F, si) + 1;
    // v1.4 (turno 44 de la partida 20261027-205516): acercarse a la puerta solo rinde si la bola vuelve a jugar. La 4 tenía 39 % de volver y cobró el premio entero (2,6) por quedar a 3,4 m de la roja 9; ahora cobra 0,39 de él. `legacyLateAgain` lo deja entero.
    const again = !w.legacyLateAgain && F.pAgain ? Math.min(1, F.pAgain[si]) : 1;
    if (left <= CONFIG.kantokuLateTurns) add('avanza', again * CONFIG.kantokuLateProgress * (pPass(si, S[si]) - pPass(si, init[si])));
  }

  // 3a. Lugar de espera pegado a la línea, con ángulo en diagonal a su puerta (Chris, 2026-10-24: la blanca 8 se puso al centro, frente a la puerta 2, a la vista de la roja 9; lo ideal es lo más cerca de la
  // línea con ángulo de pase). Premia a mis bolas de las puertas 2 y 3 que esperan antes de su puerta, a ≤ `kantokuLineSpotM` de la línea y a ≤ 5 m de la puerta, descontando la amenaza que ya tienen.
  if (!w.legacyLineSpot && R.lineSpot > 0) {
    for (const bi of mineIdx) {
      const b = S[bi];
      if (b.nextGate < 2 || b.nextGate > 3) continue;
      const g = GATES[b.nextGate - 1];
      const dv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[g.dir];
      const before = (b.x - g.x) * dv[0] + (b.y - g.y) * dv[1] < -0.5; // antes de la puerta (del lado desde el que se pasa)
      if (!before || Math.hypot(b.x - g.x, b.y - g.y) > 5 || Math.min(b.x, COURT_W - b.x, b.y, COURT_H - b.y) > CONFIG.kantokuLineSpotM) continue;
      add('lineaDiagonal', R.lineSpot * (1 - Math.min(1, threat.get(bi) ?? 0)));
    }
  }

  // 3b. Compañeras: con el spark propio se lleva a una compañera a un lugar mejor para SU turno (frente a su puerta, en una zona de ataque o donde pueda hacer un doble).
  // Spark: el turno de la bola que se movió, antes y después. Golpe: si toca a una compañera, el spark que vendrá (con probabilidad `heapSparkP`) al mejor de los destinos posibles.
  if (!w.legacyMateSpark && R.mateWeight > 0) {
    const MW = R.mateWeight;
    const exitC = !w.legacyExitChain;
    if (mode === 'spark' && S[si].team === my && inPlay(S[si])) {
      const prep = MW * (mateTurnValue(S, si, S[si], w, F, R, exitC) - mateTurnValue(init, si, init[si], w, F, R, exitC));
      add('preparaTurno', prep);
      mateGain += prep / 3;
    } else if (mode === 'stroke') {
      for (const t of out.touched) {
        const mate = S[t];
        if (mate.team !== my || !inPlay(mate) || t === si) continue;
        const cur = mateTurnValue(S, t, mate, w, F, R, exitC);
        let best = 0;
        for (const d of mateDestinations(S, t, S[si])) best = Math.max(best, mateTurnValue(S, t, d, w, F, R, exitC) - cur);
        add('sparkPropio', MW * R.heapSparkP * best);
        mateGain += (MW * R.heapSparkP * best) / 3;
      }
    }
  }

  // 3c. Jugada de varios beneficios (Chris, 2026-10-26, turno 28): punto + sacar una rival + acomodar a una compañera valen más juntos que por separado (además de dejar el flujo de puntos de las que siguen).
  if (!w.legacyRivalDanger && CONFIG.kantokuMultiBonus > 0) {
    const expelled = S.some((b, i) => b.team !== my && !init[i].outBall && b.outBall && b.nextGate !== FINISHED);
    const n = (out.gate ? 1 : 0) + (expelled ? 1 : 0) + (mateGain >= CONFIG.kantokuMultiMateGain ? 1 : 0);
    if (n >= 2) add('combinado', CONFIG.kantokuMultiBonus * (n - 1));
  }

  // 4. Apoyo: las bolas que aún no pasan, con otra bola mía que juega pronto a 1-6 m con línea limpia (touch y spark).
  const soon = [...new Set(F.seq.slice(0, 6).filter((i) => S[i].team === my && inPlay(S[i])))];
  for (const bi of mineIdx) {
    const need = 1 - pPass(bi, S[bi]); // el apoyo no cuenta los puentes propios (probado: debilitaba al kantoku)
    if (need < 0.05) continue;
    let s = 0;
    for (const ai of soon) {
      if (ai === bi) continue;
      const d = distTo(S[ai], S[bi]);
      if (d < 1 || d > 6 || !reach(S[ai], S[bi])) continue;
      // Ventana (reglas avanzadas): los rivales que juegan entre ahora y el turno de la compañera pueden atacar la bola antes de que llegue; si están fuera o lejos, la ventana está abierta
      const open = adv ? 1 - rivals.reduce((m, ri) => ((firstIdx.get(ri) ?? 99) < (firstIdx.get(ai) ?? 99) ? Math.max(m, tmat.get(`${ri},${bi}`) ?? 0) : m), 0) : 1;
      s = Math.max(s, open * touchProbability(ownErr(ai, S[ai]), d, true));
    }
    add('apoyo', w.support * need * s);
  }
  // 4b. El mismo apoyo, pero del rival (reglas avanzadas): juntar bolas rivales cuando mis bolas que juegan entre ellas están fuera o no pueden atacar. Una ventana abierta para el rival
  // resta; atacar o sacar una de las bolas rivales la cierra (también si mi bola está fuera y los rivales a su alrededor se pueden juntar sin miedo).
  if (adv) {
    const rivalAll = [...firstIdx.keys()].filter((i) => S[i].team !== my && inPlay(S[i]));
    const soonR = rivalAll.filter((i) => (firstIdx.get(i) ?? 99) < 6);
    const myAll = [...firstIdx.keys()].filter((i) => S[i].team === my && inPlay(S[i]));
    for (const rb of rivalAll) {
      const needR = 1 - passThreat(S[rb], rivalErr(rb, goalDist(S[rb])));
      if (needR < 0.05) continue;
      let s = 0;
      for (const ra of soonR) {
        if (ra === rb) continue;
        const d = distTo(S[ra], S[rb]);
        if (d < 1 || d > 6 || !reach(S[ra], S[rb])) continue;
        // mis bolas que juegan antes que ra pueden atacar a rb o a ra (touch y spark) y cerrar la ventana
        const closing = myAll.reduce((m, mi) => ((firstIdx.get(mi) ?? 99) < (firstIdx.get(ra) ?? 99) ? Math.max(m, teamTouch(mi, S[rb]), teamTouch(mi, S[ra])) : m), 0);
        s = Math.max(s, (1 - closing) * touchProbability(rivalErr(ra, d), d, true));
      }
      add('apoyoRival', -(R.rivalSupport * w.support * needR * s));
    }
  }

  // 4b2. Montón mío: un rival que llega a una bola de mi montón (touch directo, pasando su puerta y quedando cerca, o mandando una bola suya con spark) y sigue con la cadena de touches saca varias
  // en su turno. Aquí solo el riesgo extra de las bolas del montón después de la primera (la primera ya la cuenta el riesgo normal). Se descuenta lo que mis compañeras que juegan antes que ese rival pueden
  // mover a tiempo (touch y spark, con su certeza): con compañeras certeras y turnos a favor, juntarse rinde; si no, conviene separarlas.
  if (!w.legacyHeapRisk && R.heapRisk > 0 && mineIdx.length >= 2) {
    const seen = new Set<string>();
    let multi = 0;
    const rivalMates = [...firstIdx.keys()].filter((i) => S[i].team !== my && inPlay(S[i]));
    for (const bi of mineIdx) {
      const g = mineIdx.filter((j) => distTo(S[j], S[bi]) <= CONFIG.kantokuHeapRadiusM);
      const key = g.join(',');
      if (g.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const centre = { ...S[g[0]], x: g.reduce((s, j) => s + S[j].x, 0) / g.length, y: g.reduce((s, j) => s + S[j].y, 0) / g.length };
      rivals.forEach((ri, k) => {
        const r = S[ri];
        const ir = firstIdx.get(ri) ?? 99;
        let entry = 0, first = g[0];
        for (const j of g) {
          const t = touchThreat(r, S[j], rivalErr(ri, distTo(r, S[j])), !w.legacyExitChain);
          if (t > entry) { entry = t; first = j; }
        }
        // mandar una bola rival al montón con spark: la toca y la manda al centro, sin que mis bolas que juegan antes de ella puedan tocarla
        for (const qi of rivalMates) {
          if (qi === ri) continue;
          const d = distTo(r, S[qi]);
          if (d < 0.3 || !reach(r, S[qi])) continue;
          const iq = firstIdx.get(qi) ?? 99;
          const cover = mates.reduce((m, tm) => ((firstIdx.get(tm) ?? 99) < iq ? Math.max(m, teamTouch(tm, centre)) : m), 0);
          const p = touchProbability(rivalErr(ri, d), d, true) * R.heapSparkP * (1 - cover);
          if (p > entry) { entry = p; first = g.reduce((a, j) => (distTo(S[j], S[qi]) < distTo(S[a], S[qi]) ? j : a), g[0]); }
        }
        if (entry < 0.02) return;
        let chain = 1, extra = 0, prev = S[first];
        for (const j of g.filter((x) => x !== first).sort((a, b) => distTo(S[first], S[a]) - distTo(S[first], S[b]))) {
          const d = distTo(prev, S[j]);
          chain *= R.cont * touchProbability(rivalErr(ri, d), d, true);
          extra += chain * (1 + w.riskPerPoint * S[j].points);
          prev = S[j];
        }
        const moved = mates.reduce((m, tm) => ((firstIdx.get(tm) ?? 99) < ir ? Math.max(m, ...g.map((j) => (j === tm ? 0 : teamTouch(tm, S[j])))) : m), 0);
        multi += RW[k] * entry * extra * (1 - moved);
      });
    }
    add('montonRiesgo', -(w.risk * R.heapRisk * multi));
  }

  // 4c. Montón: una compañera en juego dentro de un montón de rivales, sin rival activa que juegue antes y pueda tocarla, vale lo que pueda tocar y sacar en su turno (cadena de touches).
  // Si lo que se juega es un touch a una compañera, se estima que su spark la deja en el montón con probabilidad `kantokuHeapSparkP`.
  if (!w.legacyHeap && R.heapValue > 0) {
    const heapAt = (mi: number, pos: P): number => {
      const first = F.seq.indexOf(mi);
      if (first < 0) return 0;
      let defended = 0;
      for (const ri of new Set(F.seq.slice(0, first))) {
        const r = S[ri];
        if (r.team === my || !inPlay(r)) continue; // fuera, en la salida o en meta: no defiende
        defended = Math.max(defended, touchThreat(r, pos, rivalErr(ri, distTo(r, pos)), !w.legacyExitChain));
      }
      const targets = [...new Set(F.seq.filter((i) => S[i].team !== my && inPlay(S[i])))]
        .filter((i) => distTo(pos, S[i]) <= CONFIG.kantokuHeapRadiusM && reach(pos, S[i]))
        .sort((a, b) => distTo(pos, S[a]) - distTo(pos, S[b]));
      if (targets.length < 2) return 0; // un montón son al menos dos
      let chain = 1, val = 0;
      for (const ri of targets) {
        const r = S[ri];
        const d = distTo(pos, r);
        const step = R.cont * touchProbability(errorsAt(F.base, F.profiles[mi], d), d, true);
        // tocar y sacar (el spark de expulsión): vale el touch y la bola rival que sale
        val += chain * step * (rivalWorth(S, ri, w, F, S, mi) + w.outRivalBase + w.outRivalPerPoint * r.points);
        chain *= step;
      }
      return R.heapValue * (1 - defended) * val;
    };
    if (mode === 'spark' && S[si].team === my && inPlay(S[si])) add('montonValor', heapAt(si, S[si]));
    else if (mode === 'stroke') {
      for (const t of out.touched) {
        if (S[t].team !== my || !inPlay(S[t])) continue;
        let best = 0;
        for (const c of rivalClusters(S, my)) best = Math.max(best, heapAt(t, c));
        add('montonValor', R.heapSparkP * best);
      }
    }
  }

  // 5. Poste: llegar (+2 y sale del juego) vale un extra, y el rival que llega lo resta.
  for (let i = 0; i < S.length; i++) {
    if (S[i].nextGate === FINISHED && init[i].nextGate !== FINISHED) add('poste', w.poleBonus * (S[i].team === my ? 1 : -1));
  }
  return v;
}

/** Centros de los montones de bolas rivales en juego (dos o más a `kantokuHeapRadiusM` entre sí), hasta tres, de los más poblados. */
function rivalClusters(S: SimBall[], my: number): P[] {
  const rivals = S.filter((b) => b.team !== my && inPlay(b));
  const found: { c: P; n: number }[] = [];
  for (const r of rivals) {
    const g = rivals.filter((o) => distTo(o, r) <= CONFIG.kantokuHeapRadiusM);
    if (g.length < 2) continue;
    const c = { x: g.reduce((s, o) => s + o.x, 0) / g.length, y: g.reduce((s, o) => s + o.y, 0) / g.length };
    if (found.every((f) => distTo(f.c, c) > 1)) found.push({ c, n: g.length });
  }
  return found.sort((a, b) => b.n - a.n).slice(0, 3).map((f) => f.c);
}

/**
 * Términos del kantoku (pesos con `certainty`): cuánto mejora la posición de mis bolas movidas según la certeza de su dueño, la exposición a
 * un touch del rival que juega después (y de los que juegan más tarde), el poste, y los puntos que se esperan sumar aún con los turnos que
 * quedan (diferencia propia - rival).
 */
function certaintyTerms(init: SimBall[], out: Outcome, si: number, mode: 'stroke' | 'spark', ctx: PlanCtx, w: Weights, F: FutureCtx) {
  const my = ctx.team;
  const S = out.balls;
  let v = 0;
  const nextMate = F.seq.find((i) => S[i].team === my);
  // Acomodar: mejora de la probabilidad de pasar su puerta (o llegar al poste) de las bolas mías que se movieron.
  for (let i = 0; i < S.length; i++) {
    const b = S[i];
    if (b.team !== my || !inPlay(b)) continue;
    const moved = (mode === 'stroke' && i === si) || b.x !== init[i].x || b.y !== init[i].y;
    if (!moved) continue;
    const prob = (o: SimBall) => scoreProbability(o, o.nextGate, errorsAt(F.base, F.profiles[i], distTo(o, goalOf(o.nextGate))));
    const before = inPlay(init[i]) ? prob(init[i]) : 0;
    v += w.posProb * (1 + (i === nextMate ? w.nextMateBonus : 0)) * (prob(b) - before);
  }
  // Exposición: solo cuentan los rivales que todavía juegan, el que va justo después y los que van más tarde (con menos peso).
  const rivals = F.seq.filter((i) => S[i].team !== my && inPlay(S[i]));
  if (rivals.length) {
    const nextRival = rivals[0];
    const later = [...new Set(rivals.slice(1))].filter((i) => i !== nextRival);
    const hit = (ri: number, b: SimBall) => {
      const d = distTo(S[ri], b);
      return d <= w.exposureReach && reach(S[ri], b) ? touchProbability(errorsAt(F.base, F.profiles[ri], d), d) : 0;
    };
    for (const b of S) {
      if (b.team !== my || !inPlay(b)) continue;
      let pl = 0;
      for (const ri of later) pl = Math.max(pl, hit(ri, b));
      const p = Math.max(hit(nextRival, b), w.exposureLater * pl);
      v -= w.exposure * (1 + w.exposurePerPoint * b.points) * p * (out.gate ? w.exposureContinuation : 1);
    }
  }
  // Poste: llegar (+2 y sale del juego) vale un extra, y el rival que llega lo resta.
  for (let i = 0; i < S.length; i++) {
    if (S[i].nextGate === FINISHED && init[i].nextGate !== FINISHED) v += w.poleBonus * (S[i].team === my ? 1 : -1);
  }
  // Puntos esperados al terminar, con los turnos que le quedan a cada bola (el último turno siempre es de una blanca).
  const turns = new Array<number>(S.length).fill(0);
  if (F.turns) F.turns.forEach((t, i) => { turns[i] = t; });
  else for (const i of F.seq) turns[i]++;
  let diff = 0;
  for (let i = 0; i < S.length; i++) {
    const b = S[i];
    const d = distTo(b, goalOf(Math.min(b.nextGate, POLE_STEP)));
    const e = errorsAt(F.base, F.profiles[i], d);
    // con turnos fraccionarios (esperados), interpola entre los enteros vecinos
    const n0 = Math.floor(turns[i]), f = turns[i] - n0;
    const efp = f > 1e-6 ? (1 - f) * expectedFuturePoints(b, n0, e, w) + f * expectedFuturePoints(b, n0 + 1, e, w) : expectedFuturePoints(b, n0, e, w);
    diff += (b.team === my ? 1 : -1) * efp;
  }
  return v + w.efp * diff;
}

/** Constantes de reglas del kantoku: las del archivo de pesos (v3 entrenado) o, si faltan, las de `config.ts`. */
const ruleOf = (w: Weights) => ({
  cont: w.contAttack ?? CONFIG.kantokuContinuationAttack,
  heapRisk: w.heapRisk ?? CONFIG.kantokuHeapRisk,
  heapValue: w.heapValue ?? CONFIG.kantokuHeapValue,
  heapSparkP: w.heapSparkP ?? CONFIG.kantokuHeapSparkP,
  rivalSupport: w.rivalSupport ?? CONFIG.kantokuRivalSupport,
  lineSpot: w.lineSpot ?? CONFIG.kantokuLineSpotBonus,
  mateWeight: w.mateWeight ?? CONFIG.kantokuMateWeight,
  passScale: w.passScale, // sin valor: la del interruptor `kantokuRiskByValue`
  touchPass: w.touchPass ?? CONFIG.kantokuTouchPassScale,
});

/**
 * Excepciones en las que la bola SÍ puede ir al poste antes de tiempo: que ir dé el juego perfecto (el equipo llega a `perfectPoints`), o que sea la última bola del equipo y el partido ya esté decidido
 * (sus puntos superan a los del rival más todo lo que aún le puede sumar).
 */
/** ¿Todavía es temprano para el agari? Sí si a la bola le quedan más de `kantokuAgariTurns` turnos o si falta más de `kantokuAgariMinClock` de reloj (la estimación de turnos se queda corta a media partida). */
export const agariEarly = (turnsLeft: number, clock: number) => turnsLeft > CONFIG.kantokuAgariTurns || clock > CONFIG.kantokuAgariMinClock;

export function agariAllowed(S: SimBall[], si: number, ctx: PlanCtx, extra = 0): boolean {
  const my = ctx.team;
  const pts = S.reduce((s, b) => s + (b.team === my ? b.points : 0), 0) + extra; // extra: los puntos del poste si la bola aún no ha llegado
  if (pts >= CONFIG.perfectPoints) return true;
  if (S.some((b, i) => i !== si && b.team === my && b.nextGate !== FINISHED)) return false;
  const rival = S.reduce((s, b) => s + (b.team !== my ? b.points : 0), 0);
  const potential = S.reduce((s, b) => {
    if (b.team === my || b.nextGate === FINISHED) return s;
    return s + (b.nextGate <= 3 ? (4 - b.nextGate) * CONFIG.gatePoints : 0) + CONFIG.polePoints;
  }, 0);
  return pts > rival + potential;
}

/** Amenaza sobre la bola `si` de las próximas bolas rivales (tocarla directo o pasando su puerta y quedando cerca): la mayor. */
export function ballThreat(S: SimBall[], si: number, ctx: PlanCtx): number {
  const F = ctx.future!;
  const rivalBase = F.rivalBase ?? F.base;
  const rivals = [...new Set(F.seq.filter((i) => S[i].team !== ctx.team && S[i].nextGate !== FINISHED))].slice(0, 3);
  let t = 0;
  for (const ri of rivals) {
    const d = distTo(S[ri], S[si]);
    const err = errorsAt(rivalBase, F.rivalProfiles ? F.rivalProfiles[ri] : NEUTRAL_PROFILE, d);
    t = Math.max(t, touchThreat(S[ri], S[si], err, true));
  }
  return t;
}

/**
 * Probabilidad de la jugada «pasar su puerta y atacar» de la bola `si` (puertas 1 a 3) contra la mejor rival en juego: P(pasar la puerta) × P(touch con el golpe continuo desde donde queda, a 1, 3 o 6 m más allá)
 * × P(el spark la saca). Puerta 1: `touchThreat` desde la salida; puertas 2 y 3: `exitChainThreat`. Con la certeza de quien tira la bola.
 */
export function attackPlay(S: SimBall[], si: number, F: FutureCtx): number {
  const b = S[si];
  if (b.outBall || b.nextGate > 3) return 0;
  const goal = goalOf(b.nextGate);
  const err = errorsAt(F.base, F.profiles[si], b.nextGate === 1 ? 4 : Math.max(1, distTo(b, goal)));
  let best = 0;
  for (const r of S) {
    if (r.team === b.team || !inPlay(r)) continue;
    if (b.nextGate === 1) {
      // salida de la puerta 1: la rival tiene que estar cerca (≤ 8 m de donde puede quedar la bola tras la puerta, con línea limpia)
      let t = 0;
      for (const s of EXIT_STOPS) {
        const stop = { x: LAYOUT.gates[0].x, y: LAYOUT.gates[0].y - s };
        const d = distTo(stop, r);
        if (d >= 0.5 && d <= 8 && reach(stop, r)) t = Math.max(t, touchProbability(err, d, true));
      }
      best = Math.max(best, scoreProbability(b, 1, err, true) * t);
    } else best = Math.max(best, exitChainThreat(b, r, err));
  }
  return best * CONFIG.kantokuAttackSparkP;
}

/** Mejor probabilidad de tocar a una rival en juego desde donde está la bola `si` (línea limpia), con su certeza. */
export function bestTouchOdds(S: SimBall[], si: number, F: FutureCtx): number {
  const b = S[si];
  let best = 0;
  for (const r of S) {
    if (r.team === b.team || !inPlay(r)) continue;
    const d = distTo(b, r);
    if (d < 0.3 || d > CONFIG.kantokuTouchMaxM || !reach(b, r)) continue;
    best = Math.max(best, touchProbability(errorsAt(F.base, F.profiles[si], d), d, true));
  }
  return best;
}

/**
 * Doble ángulo (Chris, 2026-10-26): probabilidad conjunta de las dos oportunidades seguidas de la rival que juega justo después contra mis bolas, bola y bola: toca una de mis bolas y con el golpe extra va por otra (contra una rival en la salida, «tocar» ya incluye pasar la puerta 1 y rodar hasta la bola).
 * Solo ese tipo (dos bolas MÍAS) descarta jugadas: «bola y puerta» y «puerta y bola» son la amenaza simple de una rival bien colocada (la tiene toda bola a tiro) y los valora el riesgo (`kantokuComboRisk`);
 * descartarlas también impedía mandar a una compañera a atacar un montón rival (`heap.test.ts`, `matespark.test.ts`).
 * Con la certeza de quien tira y el error de un buen jugador humano para el rival (o el del modelo). 0 si no hay rival que juegue después o no hay dos bolas mías (ni puerta) que combinar.
 */
/** ¿La próxima rival en jugar está en la salida de la puerta 1? Su amenaza (pasar la puerta 1 y encadenar) no se parece a la de una rival en juego: las exenciones del spark de zona no valen (turno 36 frente al turno 28). */
export function startRivalNext(S: SimBall[], my: number, F: FutureCtx): boolean {
  const ri = F.seq.find((i) => S[i].team !== my && S[i].nextGate !== FINISHED && !S[i].outBall);
  return ri !== undefined && S[ri].nextGate === 1;
}

export function doubleAngle(S: SimBall[], my: number, F: FutureCtx, K: number): number {
  const ri = F.seq.find((i) => S[i].team !== my && S[i].nextGate !== FINISHED && !S[i].outBall);
  if (ri === undefined) return 0;
  const r = S[ri];
  if (!(inPlay(r) || r.nextGate === 1)) return 0;
  const rivalBase = F.rivalBase ?? F.base;
  const rErr = (d: number) => errorsAt(rivalBase, F.rivalProfiles ? F.rivalProfiles[ri] : NEUTRAL_PROFILE, d);
  const mine = S.map((_, i) => i).filter((i) => S[i].team === my && inPlay(S[i]));
  if (!mine.length) return 0;
  let best = 0;
  for (const a of mine) {
    const A = S[a];
    const tA = touchThreat(r, A, rErr(distTo(r, A)), true);
    if (tA <= 0.01) continue;
    for (const b of mine) {
      if (b === a) continue;
      const d = distTo(A, S[b]);
      if (d < 0.25 || d > CONFIG.kantokuJoinM || !reach(A, S[b])) continue; // dos bolas mías JUNTAS (un montón): a más distancia es una cadena de touches, que valora el riesgo
      best = Math.max(best, tA * K * touchProbability(rErr(d), d, true)); // bola y bola
    }
  }
  // «puerta y bola» no entra aquí: su probabilidad conjunta es la de la amenaza simple de pasar y tocar (la tiene toda bola a tiro de una rival que sale); el riesgo ya la valora (`kantokuComboRisk`)
  return best;
}

/** Un golpe a probar: la mira y, en el spark de expulsión, la fuerza de sobra como múltiplo de la del triángulo. */
interface Candidate { aim: P; powerMul?: number; far?: boolean; }

const barsOfBall = (n: number) => CONFIG.playerBars[Math.floor((n - 1) / 2) % CONFIG.playerBars.length];

/**
 * Cuánto se pasa la mira del blanco en un intento de touch (regla del kantoku): `kantokuTouchOvershootPerM` × la distancia (+1 m a 5 m, +2 m a 10 m), sin pasar del espacio que queda
 * entre el blanco y la línea (menos `kantokuTouchLineMarginM`), para no salirse de la cancha.
 */
export function touchOvershoot(origin: P, target: P): number {
  const dx = target.x - origin.x, dy = target.y - origin.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return 0;
  const ux = dx / d, uy = dy / d;
  // el punto de parada queda a `kantokuTouchLineMarginM` de cada línea (en perpendicular, no a lo largo del tiro: de lado el espacio real es menor)
  const mg = CONFIG.kantokuTouchLineMarginM;
  const tx = ux > 1e-6 ? (COURT_W - mg - target.x) / ux : ux < -1e-6 ? (mg - target.x) / ux : Infinity;
  const ty = uy > 1e-6 ? (COURT_H - mg - target.y) / uy : uy < -1e-6 ? (mg - target.y) / uy : Infinity;
  const space = Math.min(tx, ty);
  return Math.max(0, Math.min(CONFIG.kantokuTouchOvershootPerM * d, space));
}

/** Golpes a probar: hacia puntos de interés (puerta, rivales, compañeras, acomodo) con varios largos, más un anillo de direcciones. */
export function candidates(origin: P, si: number, balls: SimBall[], mode: 'stroke' | 'spark', pinned: number, extraEntry = false, touchRule = false, heap = false, nearPole = false, lineSpots = false, farEntry = false): Candidate[] {
  const sh = balls[si];
  const list: Candidate[] = [];
  // Kantoku, tiro de salida a la puerta 1: no apunta a quedarse a menos de `kantokuLineMarginM` de la línea (un error de fuerza o el pasto la sacan). El resto de los golpes sí puede esconderse junto
  // a la línea a propósito (`tests/advanced.test.ts`, «la línea como opción»).
  const keepIn = touchRule && mode === 'stroke' && !extraEntry;
  const add = (theta: number, L: number, edgeOk = true) => {
    const aim = { x: origin.x + Math.cos(theta) * L, y: origin.y + Math.sin(theta) * L };
    if (aim.x < -1 || aim.x > COURT_W + 1 || aim.y < -1 || aim.y > COURT_H + 1 || L < 0.4) return;
    const mg = CONFIG.kantokuLineMarginM;
    if (keepIn && !edgeOk && (aim.x < mg || aim.x > COURT_W - mg || aim.y < mg || aim.y > COURT_H - mg)) return;
    const shown = clampAimToPosts(origin, aim); // la mira no traspasa postes (igual que en la escena)
    if (distTo(origin, shown) < 0.4) return;
    list.push({ aim });
  };
  const toward = (p: P, offs: number[], dAng: number[], edgeOk = true) => {
    const d = distTo(origin, p);
    if (d < 0.5) return;
    const th = Math.atan2(p.y - origin.y, p.x - origin.x);
    for (const a of dAng) for (const o of offs) add(th + (a * Math.PI) / 180, d + o, edgeOk);
  };
  const g = sh.nextGate;
  // Puerta (o poste) propia: pasarla y quedar en distintos puntos más allá
  if (g === 1) toward({ x: GATES[0].x, y: GATES[0].y }, [0.5, 1.5, 3, 5, 8, 11], [0], false);
  else if (g >= POLE_STEP) {
    toward({ x: goalOf(g).x, y: goalOf(g).y }, [0, 0.3], [-2, 0, 2]);
    if (nearPole) toward({ x: goalOf(g).x, y: goalOf(g).y }, [-0.9, -1.6], [-4, 0, 4]); // agari: quedarse cerca del poste sin tocarlo
  }
  else {
    const gt = GATES[g - 1];
    const dv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gt.dir];
    toward({ x: gt.x + dv[0] * 0.5, y: gt.y + dv[1] * 0.5 }, [0.3, 1.5, 3, 5], [-3, 0, 3]);
    toward({ x: gt.x - dv[0] * 2, y: gt.y - dv[1] * 2 }, [0], [0]); // acomodarse delante de la puerta
  }
  // Otras bolas en juego (rivales y compañeras): touch, o en un spark, empujarlas
  for (let i = 0; i < balls.length; i++) {
    if (i === si || i === pinned || !inPlay(balls[i])) continue;
    if (distTo(origin, balls[i]) > 12) continue;
    toward(balls[i], mode === 'stroke' && touchRule ? [touchOvershoot(origin, balls[i])] : [0.3, 1, 2.5], [-3, 0, 3], true);
  }
  // Spark de una compañera: llevarla a donde mejor juegue su turno (frente a su puerta, cerca de rivales para atacar; `mateDestinations`)
  if (touchRule && mode === 'spark' && sh.team === balls[pinned].team) for (const d of mateDestinations(balls, si, origin)) toward(d, [0], [0], true);
  // Spark de una compañera: mandarla al centro de un montón de rivales (parar justo en el centro o un poco antes o después)
  if (heap && mode === 'spark' && sh.team === balls[pinned].team) for (const c of rivalClusters(balls, sh.team)) toward(c, [-0.4, 0, 0.4], [-2, 0, 2]);
  if (mode === 'spark' && sh.team !== (balls[pinned]?.team ?? sh.team)) toward(knockOutTarget(origin), [0.5, 2, 5], [0]);
  // Anillo de direcciones: salidas de emergencia y colocaciones seguras
  const ring = mode === 'spark' ? 16 : 12;
  for (let k = 0; k < ring; k++) for (const L of mode === 'spark' ? [3, 7, 12] : [2.5, 6]) add((k / ring) * Math.PI * 2, L);
  if (extraEntry) {
    // Bola fuera: más formas de volver a entrar (abanico hacia dentro de la cancha, de golpes que no entran a golpes largos), para poder
    // elegir otra dirección, entrar más corto o entrar lejos de las bolas.
    const inward = origin.x < 0 ? 0 : origin.x > COURT_W ? Math.PI : origin.y < 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let a = -80; a <= 80; a += 10) for (const L of [0.3, 0.8, 1.5, 2.5, 4]) add(inward + (a * Math.PI) / 180, L);
    // Posiciones pegadas a la línea en otros tramos alcanzables (Chris, 2026-10-27, v1.2): el kantoku real suele elegir la línea, donde la bola es difícil de tocar; el abanico anterior llegaba a 4 m del lugar por donde salió.
    if (lineSpots) {
      const onX = origin.x < 0 || origin.x > COURT_W; // salió por un lado (línea vertical) o por arriba/abajo (horizontal)
      for (const depth of [0.5, 1]) for (let t = -10; t <= 10; t += 1.5) {
        const p = onX
          ? { x: origin.x < 0 ? depth : COURT_W - depth, y: origin.y + t }
          : { x: origin.x + t, y: origin.y < 0 ? depth : COURT_H - depth };
        if (p.x < 0.5 || p.x > COURT_W - 0.5 || p.y < 0.5 || p.y > COURT_H - 0.5) continue;
        toward(p, [0], [0]);
      }
    }
    // Reentrada lejos (v1.3, Chris, 2026-10-27, partida 20261027-181359 turno 14): la bola 4 volvió a entrar detrás del 2.º arco, a 18 m, cuando la esquina opuesta de la cancha estaba mucho menos expuesta (0,35 contra 0,79 del lugar elegido) y ningún candidato llegaba allí.
    // Una cuadrícula gruesa de destinos en toda la cancha (cada 3 m, lejos de lo que ya cubren el abanico y la línea); el error del golpe largo lo mide el planificador con sus muestras.
    if (farEntry) {
      const n0 = list.length;
      for (let x = 1.5; x <= COURT_W - 1.4; x += 3) for (let y = 1.5; y <= COURT_H - 1.4; y += 3) {
        const p = { x, y };
        if (distTo(origin, p) < 4.5) continue;
        toward(p, [0], [0]);
      }
      for (let k = n0; k < list.length; k++) list[k].far = true;
    }
  }
  return list;
}

/**
 * Spark de expulsión: direcciones hacia todas las líneas de la cancha, con la mira un metro pasada la línea y la fuerza de sobra (`kantokuKnockoutOvershootM`
 * más allá de la línea, hasta `kantokuKnockoutMaxPower` de la barra), para que ni el error de fuerza ni el pasto la dejen adentro.
 */
function knockoutCandidates(origin: P, shooterN: number): Candidate[] {
  const list: Candidate[] = [];
  const sweet = barsOfBall(shooterN).power.sweetSpot;
  const maxMul = CONFIG.kantokuKnockoutMaxPower / sweet;
  const N = 24;
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    const ux = Math.cos(th), uy = Math.sin(th);
    // distancia hasta la primera línea de la cancha en esa dirección
    const tx = ux > 1e-6 ? (COURT_W - origin.x) / ux : ux < -1e-6 ? -origin.x / ux : Infinity;
    const ty = uy > 1e-6 ? (COURT_H - origin.y) / uy : uy < -1e-6 ? -origin.y / uy : Infinity;
    const line = Math.min(tx, ty);
    if (!isFinite(line) || line < 0.2) continue;
    const aimD = line + 1;
    const mul = Math.min(maxMul, (line + CONFIG.kantokuKnockoutOvershootM) / aimD);
    list.push({ aim: { x: origin.x + ux * aimD, y: origin.y + uy * aimD }, powerMul: Math.max(1, mul) });
  }
  return list;
}

/**
 * Descarta los tiros cuyo margen de error puede tocar una bola que no se debe tocar: con una bola fuera, cualquiera (es falta, Art. 17
 * cl. 4); en un golpe normal, las ya sparkeadas en el turno (Art. 15 cl. 4). Si ninguno tiene margen, deja los de más margen.
 */
function safeCandidates(cands: Candidate[], origin: P, si: number, balls: SimBall[], sparked: number[], F: FutureCtx): Candidate[] {
  const protectedIdx = balls[si].outBall ? balls.map((_, i) => i).filter((i) => i !== si && inPlay(balls[i])) : sparked.filter((i) => inPlay(balls[i]));
  if (!protectedIdx.length) return cands;
  const rated = cands.map((c) => {
    const shown = clampAimToPosts(origin, c.aim);
    const e = errorsAt(F.base, F.profiles[si], distTo(origin, shown));
    return { c, clear: Math.min(...protectedIdx.map((i) => pathClearance(origin, shown, e, balls[i]))) };
  });
  const safe = rated.filter((r) => r.clear >= 0);
  return (safe.length ? safe : rated.sort((a, b) => b.clear - a.clear).slice(0, 8)).map((r) => r.c);
}

export interface Plan { aim: P; value: number; tried: number; powerMul?: number; }

/**
 * Elige el mejor golpe para la bola `si`. En un spark, `pinned` es la bola que golpea (queda fija) y `si` la sparkeada,
 * que arranca pegada a ella en la dirección del golpe. Devuelve la mira para ese golpe (con fuerza para que la bola
 * recorra exactamente la distancia elegida) o null si no hay ninguno.
 */
export function planShot(balls: SimBall[], si: number, mode: 'stroke' | 'spark', pinned: number, ctx: PlanCtx): Plan | null {
  resetChainCache();
  const origin = mode === 'spark' ? balls[pinned] : balls[si];
  const scored: { c: Candidate; init: SimBall[]; value: number; touch: boolean; gate: boolean; board: SimBall[]; touchRival: boolean; touchP: number; touchLine: boolean; touchValuable: boolean; cluster: boolean; movedN: number; touchDist: number; end?: { x: number; y: number } }[] = [];
  const w0 = ctx.weights ?? handWeights;
  const newTouch = !!(w0.certainty && ctx.future && !w0.legacyTouch);
  let cands = candidates(origin, si, balls, mode, pinned, !!(w0.certainty && ctx.future && mode === 'stroke' && balls[si].outBall), newTouch, !!(w0.certainty && ctx.future && !w0.legacyHeap), !!(w0.certainty && ctx.future && !w0.legacyAgari), !!(w0.certainty && ctx.future && !w0.legacyLineCands), !!(w0.certainty && ctx.future && !w0.legacyFarEntry && PLANNER_FLAGS.farEntry));
  if (PLANNER_FLAGS.safetyFilter && w0.certainty && ctx.future && mode === 'stroke') cands = safeCandidates(cands, origin, si, balls, ctx.sparked ?? [], ctx.future);
  const knockout = !!(w0.certainty && ctx.future && mode === 'spark' && balls[si].team !== balls[pinned].team && PLANNER_FLAGS.knockoutBoost);
  if (knockout) cands = [...cands, ...knockoutCandidates(origin, balls[pinned].n)];
  const shotOf = (c: Candidate) => {
    const sb0 = barsOfBall(balls[mode === 'spark' ? pinned : si].n);
    return c.powerMul ? { power: Math.min(1, sb0.power.sweetSpot * c.powerMul), acc: sb0.accuracy.sweetSpot } : undefined;
  };
  const doubleOn = !!(w0.certainty && ctx.future && !w0.legacyDouble && CONFIG.kantokuDoubleMax > 0);
  const safePointOn = !!(w0.certainty && ctx.future && !w0.legacySafePoint && CONFIG.kantokuSafePointP > 0 && balls[si].nextGate >= 2 && balls[si].nextGate <= 3 && !balls[si].outBall);
  const longTouchOn = !!(w0.certainty && ctx.future && !w0.legacyLongTouch && CONFIG.kantokuTouchMaxM > 0 && !balls[si].outBall);
  const attackRuleOn = !!(w0.certainty && ctx.future && !w0.legacyAttackRule && CONFIG.kantokuAttackRule && !balls[si].outBall && balls[si].nextGate <= 3);
  const agariOn = !!(w0.certainty && ctx.future && !w0.legacyAgari && balls[si].team === ctx.team && balls[si].nextGate >= POLE_STEP);
  const heldBack: typeof scored = [];
  let minThreat = 1;
  const agariTurnsLeft = agariOn ? turnsAfter(ctx.future!, si) + (mode === 'stroke' ? 1 : 0) : 0;
  for (const c of cands) {
    const init = balls.map((b) => ({ ...b }));
    const out = simulate(init, si, c.aim, mode, pinned, ctx.sparked ?? [], ctx.rng, shotOf(c));
    if (mode === 'spark' && !out.sparkOk) continue; // bola tocada en el campo exterior o spark corto: falta
    // Spark de expulsión: la bola debe salir sin chocar antes con otras bolas (si no, no es una expulsión segura)
    if (c.powerMul && (!out.balls[si].outBall || out.balls.some((o, i) => i !== si && i !== pinned && (o.x !== balls[i].x || o.y !== balls[i].y)))) continue;
    // Spark a una bola rival (v1.4, Chris, turno 48 de la partida 20261027-205516): la 8 apuntó a sacar a la roja 3 y en esa dirección estaba la blanca 10: salió la 10 y la 3 se quedó. Si la bola rival choca con una bola mía, el candidato
    // se descarta (`legacySparkClear` lo deja como antes); y que una bola mía salga cuenta como pérdida en `evaluate` (`propiaFuera`).
    if (mode === 'spark' && w0.certainty && ctx.future && !w0.legacySparkClear && balls[si].team !== balls[pinned].team && out.balls.some((o, i) => i !== pinned && i !== si && o.team === balls[pinned].team && (o.outBall !== balls[i].outBall || o.x !== balls[i].x || o.y !== balls[i].y))) continue;
    const entry = { c, init, value: evaluate(init, out, si, mode, ctx), touch: mode === 'stroke' && out.touched.length > 0, gate: out.gate && inPlay(out.balls[si]), board: out.balls, touchRival: out.touched.some((t) => out.balls[t].team !== balls[si].team), touchP: out.touched.length && ctx.future ? Math.min(...out.touched.map((t) => { const d = distTo(init[si], init[t]); return touchProbability(errorsAt(ctx.future!.base, ctx.future!.profiles[si], d), d, true); })) : 1, touchLine: out.touched.some((t) => Math.min(init[t].x, COURT_W - init[t].x, init[t].y, COURT_H - init[t].y) <= CONFIG.kantokuLineTouchEdgeM), touchValuable: out.touched.some((t) => init[t].team !== init[si].team && (init[t].nextGate >= POLE_STEP || init[t].points >= CONFIG.kantokuLineTouchPoints)), cluster: out.touched.some((t) => init.filter((o, j) => j !== si && o.team === init[t].team && inPlay(o) && distTo(o, init[t]) <= CONFIG.kantokuHeapRadiusM).length >= 2), movedN: out.balls.filter((o, i) => i !== si && inPlay(init[i]) && (Math.abs(o.x - init[i].x) > 0.02 || Math.abs(o.y - init[i].y) > 0.02)).length, touchDist: out.touched.length ? Math.min(...out.touched.map((t) => distTo(init[si], init[t]))) : 0, end: { x: out.balls[si].x, y: out.balls[si].y } };
    if (agariOn) {
      if (out.balls[si].nextGate === FINISHED && init[si].nextGate !== FINISHED && agariEarly(agariTurnsLeft, ctx.clock) && !agariAllowed(out.balls, si, ctx)) { heldBack.push(entry); continue; }
      if (out.balls[si].nextGate !== FINISHED) minThreat = Math.min(minThreat, ballThreat(out.balls, si, ctx));
    }
    scored.push(entry);
  }
  if (ctx.trace) {
    ctx.trace.candidates = cands.length;
    ctx.trace.scored = scored.length;
    if (agariOn) ctx.trace.agari = { turnsLeft: agariTurnsLeft, limit: CONFIG.kantokuAgariTurns, heldBack: heldBack.length, minThreat, threatLimit: CONFIG.kantokuAgariThreat, released: !heldBack.length ? null : !scored.length ? 'sinAlternativas' : minThreat >= CONFIG.kantokuAgariThreat ? 'amenaza' : null };
  }
  // Agari (llegar al poste y salir del juego): antes de que a la bola le queden `kantokuAgariTurns` turnos o menos no va al poste, salvo que ir sea el juego perfecto o el final decidido (`agariAllowed`),
  // o que la bola vaya a ser sacada casi seguro en cualquier alternativa (la amenaza mínima sobre ella ≥ `kantokuAgariThreat`); si no queda otra jugada, también va.
  if (heldBack.length && (!scored.length || minThreat >= CONFIG.kantokuAgariThreat)) scored.push(...heldBack);
  if (!scored.length) return null;
  // Spark que acomoda a una compañera (Chris, 2026-10-26, turno 28): lo que importa no es un punto exacto sino quedar DENTRO de la zona desde donde pasa su puerta (`zones.entryZone`: la probabilidad de pasar desde ahí ≥
  // `kantokuZonePassP`). Esos candidatos se prueban siempre (aunque no estén entre los mejores por valor exacto) y con más muestras de error (`kantokuZoneSamples`): el promedio del valor es, en la práctica, la probabilidad de quedar en la zona
  // por lo que vale estar en ella. Tampoco los descarta la regla del doble ángulo.
  const zoneOn = !!(w0.certainty && ctx.future && !w0.legacyZoneSpark && CONFIG.kantokuZonePassP > 0 && mode === 'spark' && balls[si].team === balls[pinned].team && !startRivalNext(balls, ctx.team, ctx.future));
  const inZone = (e: (typeof scored)[number]) => {
    if (!zoneOn) return false;
    const b = e.board[si];
    if (!inPlay(b) || b.nextGate < 2 || b.nextGate > POLE_STEP) return false;
    return scoreProbability(b, b.nextGate, errorsAt(ctx.future!.base, ctx.future!.profiles[si], distTo(b, goalOf(b.nextGate))), true) >= CONFIG.kantokuZonePassP;
  };
  // Doble ángulo (regla fija, Chris, 2026-10-26): no se deja una bola mía donde la rival que juega después tenga dos oportunidades seguidas (bola y bola, puerta y bola, bola y puerta) con probabilidad conjunta
  // ≥ `kantokuDoubleMax`; con un solo ángulo difícil sí. No pasar la puerta 1 (o cualquier otra jugada segura) sigue siendo una opción. Si todas las jugadas dejan un doble, se conservan todas.
  if (doubleOn) {
    const K = ruleOf(w0).cont;
    // Las jugadas que siguen con un golpe continuo (pasan una puerta o tocan una bola) no cuentan: la bola aún se mueve antes de que el rival juegue (el riesgo ya las trata con `exposureContinuation`)
    // Se descartan las que superan el umbral Y son claramente peores que la mejor (`kantokuDoubleMargin`): una bola mía sola a tiro de la rival que sale ya tiene un «doble» de ≈ 0,3 (pasar y tocar), que no se evita; lo que se evita es empeorarlo
    // Tampoco cuenta mandar a una compañera con el spark a atacar un montón rival (a `kantokuHeapRadiusM` de dos o más rivales): esa jugada la valora `heapValue` (`heap.test.ts`)
    const inRivalHeap = (e: (typeof scored)[number]) => mode === 'spark' && e.board.filter((o, j) => j !== si && o.team !== ctx.team && inPlay(o) && distTo(o, e.board[si]) <= CONFIG.kantokuHeapRadiusM).length >= 2;
    // ... ni dejar a una compañera en su zona de entrada con el spark (Chris, turno 28: la 10 frente al 2º arco): igual que pasar una puerta, es una jugada que suma un punto probable
    const exempt = (e: (typeof scored)[number]) => (mode === 'stroke' && (e.gate || e.touch)) || inRivalHeap(e) || inZone(e);
    const dbl = scored.map((e) => (exempt(e) ? 0 : doubleAngle(e.board, ctx.team, ctx.future!, K)));
    const floor = Math.max(CONFIG.kantokuDoubleMax, Math.min(...dbl.filter((v, i) => !exempt(scored[i]))) + CONFIG.kantokuDoubleMargin);
    const keep = scored.filter((_, i) => dbl[i] < floor);
    if (keep.length && keep.length < scored.length) scored.splice(0, scored.length, ...keep);
  }
  // Punto seguro primero (regla fija, Chris, 2026-10-26): si la bola puede pasar su puerta casi seguro, un touch a una rival solo gana si la probabilidad de acertarlo es muy alta (`kantokuSureTouchP`; más baja si va ganando con
  // tiempo, más alta si va perdiendo o queda poco), o si la rival es de valor claro (lista para el poste o con ≥ 3 puntos). Un touch lejano y dudoso no debe ganarle a un punto seguro; después de pasar viene el golpe continuo.
  if (safePointOn && mode === 'stroke' && scored.some((e) => e.gate)) {
    const b0 = balls[si];
    const pPass = scoreProbability(b0, b0.nextGate, errorsAt(ctx.future!.base, ctx.future!.profiles[si], distTo(b0, goalOf(b0.nextGate))), true);
    if (pPass >= CONFIG.kantokuSafePointP) {
      const lead = ctx.lead ?? 0, frac = ctx.clock / (CONFIG.matchMinutes * 60);
      const need = lead >= 3 && frac > 0.4 ? CONFIG.kantokuSureTouchP - 0.1 : lead <= -3 || frac < 0.2 ? Math.min(0.99, CONFIG.kantokuSureTouchP + 0.06) : CONFIG.kantokuSureTouchP;
      const keep = scored.filter((e) => !(e.touchRival && !e.touchValuable && e.touchP < need));
      if (keep.length && keep.length < scored.length) scored.splice(0, scored.length, ...keep);
    }
  }
  // Touch lejano (regla fija, Chris, 2026-10-25): un kantoku real no se arriesga a tocar una bola que está lejos (cuanto más lejos, más fácil errar), salvo que el mismo tiro mueva varias bolas (toca una y ésta empuja a otra) o que el blanco esté dentro de un grupo de bolas rivales (a `kantokuHeapRadiusM` de otra: un montón, donde un touch puede sacar varias). Se descartan los intentos
  // de touch a más de `kantokuTouchMaxM` que tocan una sola bola; si no queda ninguno, se conserva todo.
  if (longTouchOn && mode === 'stroke') {
    // ... y, con una certeza normal, tampoco a una bola pegada a la línea que no está cerca (> `kantokuLineTouchMaxM`): si falla, la bola propia sale o queda a merced; salvo que la bola valga claramente la pena
    // (está lista para el poste o ya suma ≥ `kantokuLineTouchPoints` puntos).
    const far = (e: (typeof scored)[number]) => e.touch && e.movedN <= 1 && !e.cluster && (e.touchDist > CONFIG.kantokuTouchMaxM || (e.touchLine && !e.touchValuable && e.touchDist > CONFIG.kantokuLineTouchMaxM) || (!e.touchValuable && e.touchP < CONFIG.kantokuTouchMinP));
    const keep = scored.filter((e) => !far(e));
    if (keep.length && keep.length < scored.length) scored.splice(0, scored.length, ...keep);
  }
  // Regla de ataque (fija, para cualquier kantoku): con una rival a tiro de la salida de la puerta que la bola necesita pasar, la bola pasa y ataca; en el golpe continuo, ataca si la rival está a buen tiro
  if (attackRuleOn && mode === 'stroke') {
    const ps = attackPlay(balls, si, ctx.future!);
    if (ps >= (balls[si].nextGate === 1 ? CONFIG.kantokuAttackPlayGate1 : CONFIG.kantokuAttackPlayGate23)) {
      let keep = scored.filter((e) => e.gate);
      if (keep.length) {
        // ... y se queda donde mejor ataca: de las jugadas que pasan, las que dejan la bola con las mejores probabilidades de touch (≥ `kantokuAttackKeep` de la mejor)
        const odds = keep.map((e) => bestTouchOdds(balls.map((o, i) => (i === si ? { ...o, x: e.end!.x, y: e.end!.y } : o)), si, ctx.future!));
        const top = Math.max(...odds);
        if (top > 0) keep = keep.filter((_, i) => odds[i] >= CONFIG.kantokuAttackKeep * top);
        scored.splice(0, scored.length, ...keep);
      }
    }
    if (ctx.continuation && bestTouchOdds(balls, si, ctx.future!) >= CONFIG.kantokuAttackTouch) {
      const keep = scored.filter((e) => e.touchRival);
      if (keep.length) scored.splice(0, scored.length, ...keep);
    }
  }
  // El pasto desvía un poco cada golpe: los mejores se repiten varias veces y se promedia, para no elegir un golpe
  // que solo sale bien con suerte (por ejemplo, rozando otra bola).
  scored.sort((a, b) => b.value - a.value);
  let best: Plan | null = null;
  const w = ctx.weights ?? handWeights;
  if (w.errorSamples > 0 && ctx.future) {
    // Kantoku: los mejores candidatos se simulan varias veces con el error del jugador que tira (según la distancia) y se promedia.
    const F = ctx.future;
    const shooter = mode === 'spark' ? pinned : si;
    const sb = CONFIG.playerBars[Math.floor((balls[shooter].n - 1) / 2) % CONFIG.playerBars.length];
    // En la expulsión por spark se prueban con error todas las direcciones hacia las líneas (no solo las mejores por valor, que empatan): gana la más segura y, a igual
    // seguridad, la más corta (la línea más cercana).
    const top = scored.slice(0, w.topN);
    // Reentrada (v1.3): los destinos lejanos casi nunca están entre los `topN` por valor exacto (empatan con los de la línea sin error); se miden con error los mejores (`kantokuReentryTried`) y con más muestras
    const farTried = w.certainty && !w.legacyFarEntry && PLANNER_FLAGS.farEntry && mode === 'stroke' ? scored.slice(w.topN).filter((x) => x.c.far).slice(0, CONFIG.kantokuReentryTried) : [];
    // Intento de touch: además de los mejores por valor exacto, los mejores candidatos de touch (los "más allá" casi empatan sin error y solo el error los distingue)
    const touchExtra = newTouch && mode === 'stroke' ? scored.slice(w.topN).filter((x) => x.touch).slice(0, CONFIG.kantokuTouchTried) : [];
    const zoneTried = zoneOn ? scored.slice(w.topN).filter(inZone).slice(0, CONFIG.kantokuZoneExtra) : [];
    const zoneSet = new Set<(typeof scored)[number]>(zoneOn ? [...top, ...zoneTried].filter(inZone) : []);
    const tried = knockout ? [...top, ...scored.slice(w.topN).filter((x) => x.c.powerMul)] : [...top, ...touchExtra, ...zoneTried, ...farTried];
    for (const s of tried) {
      const bars = { power: Math.min(1, sb.power.sweetSpot * (s.c.powerMul ?? 1)), acc: sb.accuracy.sweetSpot };
      const err = errorsAt(F.base, F.profiles[shooter], mode === 'spark' ? distTo(origin, clampAimToPosts(origin, s.c.aim)) : shotDistance(origin, clampAimToPosts(origin, s.c.aim), balls[si].nextGate));
      let total = 0;
      const samples = knockout ? Math.max(w.errorSamples, CONFIG.kantokuKnockoutSamples) : newTouch && s.touch ? Math.max(w.errorSamples, CONFIG.kantokuTouchSamples) : zoneSet.has(s) ? Math.max(w.errorSamples, CONFIG.kantokuZoneSamples) : s.c.far ? Math.max(w.errorSamples, CONFIG.kantokuReentrySamples) : !w.legacyLongSpot && mode === 'stroke' && !s.touch && !s.gate && distTo(origin, s.c.aim) >= CONFIG.kantokuLongSpotM ? Math.max(w.errorSamples, CONFIG.kantokuLongSpotSamples) : w.errorSamples; // la expulsión se mide con más muestras: debe ser casi segura
      for (let r = 0; r < samples; r++) {
        const shot = applyShotError(s.c.aim, bars, drawShotError(err, ctx.rng));
        const out = simulate(s.init, si, shot.aim, mode, pinned, ctx.sparked ?? [], ctx.rng, { power: shot.power, acc: shot.acc });
        total += mode === 'spark' && !out.sparkOk ? -(w.foul + w.shooterOutLater) : evaluate(s.init, out, si, mode, { ...ctx, noise: 0 });
        // Agari por accidente: el golpe no iba al poste pero con el error (o el pasto) lo toca antes de tiempo. Se castiga igual que ir a propósito, para que prefiera pasar con margen.
        if (agariOn && agariEarly(agariTurnsLeft, ctx.clock) && out.balls[si].nextGate === FINISHED && s.init[si].nextGate !== FINISHED && !agariAllowed(out.balls, si, ctx)) total -= CONFIG.kantokuAgariAccidentPenalty;
      }
      const value = total / samples + gauss(ctx.rng) * ctx.noise;
      ctx.trace?.tried.push({ aim: s.c.aim, powerMul: s.c.powerMul, value, touch: s.touch });
      const cur = best as Plan | null;
      const nearer = knockout && !!cur && Math.abs(value - cur.value) < 1e-6 && distTo(origin, s.c.aim) < distTo(origin, cur.aim); // solo en la expulsión por spark
      if (!cur || value > cur.value + (knockout ? 1e-6 : 0) || nearer) best = { aim: s.c.aim, value: nearer ? cur!.value : value, tried: scored.length, powerMul: s.c.powerMul };
    }
    return best;
  }
  for (const s of scored.slice(0, 6)) {
    let total = s.value;
    for (let r = 0; r < 3; r++) {
      const out = simulate(s.init, si, s.c.aim, mode, pinned, ctx.sparked ?? [], ctx.rng);
      total += evaluate(s.init, out, si, mode, { ...ctx, noise: 0 }) - 0;
    }
    const value = total / 4;
    if (!best || value > best.value) best = { aim: s.c.aim, value, tried: scored.length };
  }
  return best;
}

// ---------- Explicación de la decisión (registro de partidas) ----------

export interface ShotExplanation {
  aim: P;
  powerMul?: number;
  value: number; // valor medio con error (el que comparó el planificador)
  chosen: boolean;
  kind: string; // tipo de jugada
  /** Qué pasa si el golpe sale exacto (barras en el triángulo). */
  intended: { gate: number; touched: number[]; out: number[]; shooterOut: boolean; foul: boolean; pole: boolean; sparkOk: boolean };
  terms: Record<string, number>; // lo que aporta cada término de la valoración al golpe exacto
}

export interface Explanation {
  alternatives: ShotExplanation[]; // la elegida primero y hasta cuatro más, por valor
  risk: RiskRow[]; // reparto del riesgo del golpe elegido (golpe exacto)
  agari?: NonNullable<PlanTrace['agari']> & { chosenIsAgari: boolean; why: string | null };
  candidates: number;
  scored: number;
}

/** Tipo de jugada, en palabras, a partir de lo que pasa si el golpe sale exacto. */
function shotKind(init: SimBall[], out: Outcome, si: number, mode: 'stroke' | 'spark', pinned: number): string {
  const was = init[si], now = out.balls[si];
  if (mode === 'spark') {
    const own = was.team === init[pinned].team;
    if (own) return now.nextGate === FINISHED ? 'spark propio: poste' : out.gate ? 'spark propio: puerta' : 'spark propio: acomodo';
    return now.outBall ? 'spark: expulsar bola rival' : 'spark: mover bola rival';
  }
  if (was.nextGate === 1) return out.gate ? 'salida: puerta 1' : 'salida (no pasa la puerta 1)';
  if (was.outBall) return 'reentrada';
  if (now.nextGate === FINISHED && was.nextGate !== FINISHED) return 'agari: poste';
  if (out.touched.length) return out.touched.some((t) => init[t].team !== was.team) ? 'touch a rival' : 'touch a compañera';
  if (out.gate) return `puerta ${was.nextGate}`;
  return 'acomodo';
}

/** Qué pasa si el golpe sale exacto: tipo de jugada y resultado esperado. */
function describeOutcome(was: SimBall[], init: SimBall[], out: Outcome, si: number, mode: 'stroke' | 'spark', pinned: number): Pick<ShotExplanation, 'kind' | 'intended'> {
  return {
    kind: shotKind(init, out, si, mode, pinned),
    intended: {
      gate: out.gate ? 1 : 0,
      touched: out.touched.map((i) => was[i].n),
      out: out.balls.flatMap((b, i) => (!was[i].outBall && b.outBall && !(i === si && mode === 'stroke') ? [b.n] : [])),
      shooterOut: out.shooterOut, foul: out.foul, pole: out.balls[si].nextGate === FINISHED && was[si].nextGate !== FINISHED, sparkOk: out.sparkOk,
    },
  };
}

/** Lo que pretendía un golpe que no sale del planificador (apertura o jugada simple): el golpe exacto simulado con otra semilla. */
export function describeShot(balls: SimBall[], si: number, mode: 'stroke' | 'spark', pinned: number, sparked: number[], aim: P, powerMul?: number): Pick<ShotExplanation, 'kind' | 'intended'> {
  const shooter = mode === 'spark' ? pinned : si;
  const sb = barsOfBall(balls[shooter].n);
  const init = balls.map((b) => ({ ...b }));
  const out = simulate(init, si, aim, mode, pinned, sparked, mulberry32(4242), powerMul ? { power: Math.min(1, sb.power.sweetSpot * powerMul), acc: sb.accuracy.sweetSpot } : undefined);
  return describeOutcome(balls, init, out, si, mode, pinned);
}

/**
 * Explica la decisión ya tomada: simula (con otra semilla, sin tocar el azar de la partida) el golpe elegido y las mejores alternativas que el planificador midió con error, y desglosa
 * la valoración de cada una en sus términos. Solo para el registro; no influye en ninguna jugada.
 */
export function explainPlan(balls: SimBall[], si: number, mode: 'stroke' | 'spark', pinned: number, ctx: PlanCtx, plan: Plan, trace: PlanTrace): Explanation {
  const rng = mulberry32(4242);
  const shooter = mode === 'spark' ? pinned : si;
  const sb = barsOfBall(balls[shooter].n);
  const shotOf = (mul?: number) => (mul ? { power: Math.min(1, sb.power.sweetSpot * mul), acc: sb.accuracy.sweetSpot } : undefined);
  const picks: { aim: P; powerMul?: number; value: number; chosen: boolean }[] = [{ aim: plan.aim, powerMul: plan.powerMul, value: plan.value, chosen: true }];
  for (const t of [...trace.tried].sort((a, b) => b.value - a.value)) {
    if (picks.length >= CONFIG.explainAlternatives) break;
    if (picks.some((p) => Math.abs(p.aim.x - t.aim.x) < 1e-9 && Math.abs(p.aim.y - t.aim.y) < 1e-9 && p.powerMul === t.powerMul)) continue;
    picks.push({ aim: t.aim, powerMul: t.powerMul, value: t.value, chosen: false });
  }
  let risk: RiskRow[] = [];
  let chosenOut: Outcome | null = null;
  const alternatives = picks.map((p) => {
    const init = balls.map((b) => ({ ...b }));
    const out = simulate(init, si, p.aim, mode, pinned, ctx.sparked ?? [], rng, shotOf(p.powerMul));
    const terms: Record<string, number> = {};
    const detail: { risk?: RiskRow[] } = {};
    evaluate(init, out, si, mode, { ...ctx, rng, noise: 0, terms, detail, trace: undefined });
    if (p.chosen) { risk = detail.risk ?? []; chosenOut = out; }
    return { aim: p.aim, powerMul: p.powerMul, value: p.value, chosen: p.chosen, ...describeOutcome(balls, init, out, si, mode, pinned), terms } as ShotExplanation;
  });
  const ex: Explanation = { alternatives, risk, candidates: trace.candidates, scored: trace.scored };
  const co = chosenOut as Outcome | null;
  if (trace.agari && co) {
    const isAgari = co.balls[si].nextGate === FINISHED && balls[si].nextGate !== FINISHED;
    const a = trace.agari;
    const why = !isAgari ? null : !agariEarly(a.turnsLeft, ctx.clock) ? 'quedan pocos turnos a la bola' : agariAllowed(co.balls, si, ctx) ? 'juego perfecto o partido decidido' : a.released === 'amenaza' ? 'su bola iba a ser sacada casi seguro' : a.released === 'sinAlternativas' ? 'no había otra jugada' : 'sin excepción (revisar)';
    ex.agari = { ...a, chosenIsAgari: isAgari, why };
  }
  return ex;
}
