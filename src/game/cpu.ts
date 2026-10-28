import { CONFIG, LAYOUT } from '../config';
import { COURT_H, COURT_W, GATES, clampAimToPosts } from './court';
import { Rng, gauss } from './rng';
import { ErrorBase, drawShotError } from './certainty';
import type { Explanation, ShotExplanation } from './cpuPlanner';

/** Plan de un golpe de la CPU: dónde apuntar y en qué punto detener cada barra (ya con el error del nivel). */
export interface CpuPlan {
  startX: number; // dónde coloca la bola en el área de salida
  aim: { x: number; y: number };
  power: number; // posición (0-1) donde detiene la barra de fuerza
  acc: number; // ... y la de rumbo
  ideal?: { aim: { x: number; y: number }; power: number; acc: number }; // el golpe sin error (para medir en los scripts)
  decision?: Decision; // por qué eligió este golpe (solo si se pidió `explain`, para el registro de partidas)
}

/** Por qué la CPU eligió un golpe: de dónde salió (libro de aperturas, planificador o jugada simple), qué tipo de jugada es y, si lo hizo el planificador, sus alternativas y términos. */
export interface Decision {
  source: 'apertura' | 'planificador' | 'simple' | 'cadena final';
  kind: string;
  intended: ShotExplanation['intended'];
  explanation?: Explanation;
  opening?: string;
  /** Último turno (o penúltimo sin rivales que ataquen): la cadena de golpes que más puntos suma esperados (`lastTurn.ts`). */
  chain?: { turn: 'ultimo' | 'penultimo'; value: number; nodes: number };
}

type P = { x: number; y: number };

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Hacia dónde conviene tirar una bola que va por la puerta `nextGate` (4 = poste), sin error.
 * Si la bola está mal puesta para cruzar la puerta (muy cerca, del lado equivocado o en ángulo), la acomoda
 * en un punto de espera delante de la puerta.
 */
export function idealTarget(pos: P, nextGate: number, outBall: boolean): P {
  let t: P;
  if (nextGate === 1) {
    t = { x: GATES[0].x, y: GATES[0].y - 1 };
  } else if (nextGate >= 4) {
    t = { x: LAYOUT.pole.x, y: LAYOUT.pole.y };
  } else {
    const g = GATES[nextGate - 1];
    const [dx, dy] = DIRS[g.dir];
    const rx = pos.x - g.x, ry = pos.y - g.y;
    const side = rx * dx + ry * dy; // < 0: antes de la puerta (lado correcto)
    const lateral = Math.abs(-rx * dy + ry * dx);
    if (side < -0.8 && lateral < 0.3 * -side) t = { x: g.x + dx, y: g.y + dy };
    else t = { x: clamp(g.x - dx * 2, 0.8, COURT_W - 0.8), y: clamp(g.y - dy * 2, 0.8, COURT_H - 0.8) };
  }
  if (outBall) {
    // Desde fuera solo hay que volver a entrar: un tiro corto hacia el objetivo.
    const d = Math.hypot(t.x - pos.x, t.y - pos.y) || 1;
    const k = Math.min(1, 2.5 / d);
    t = { x: pos.x + (t.x - pos.x) * k, y: pos.y + (t.y - pos.y) * k };
  }
  return t;
}

/** ¿Puede pasar la puerta (o llegar al poste) de un tiro directo desde `pos`? Si no, conviene acomodarse antes. */
export function canScoreNow(pos: P, nextGate: number): boolean {
  if (nextGate === 1 || nextGate >= 4) return true;
  const g = GATES[nextGate - 1];
  const [dx, dy] = DIRS[g.dir];
  const rx = pos.x - g.x, ry = pos.y - g.y;
  const side = rx * dx + ry * dy;
  return side < -0.8 && Math.abs(-rx * dy + ry * dx) < 0.3 * -side;
}

export interface Rival { x: number; y: number; points: number; nextGate: number; }
export interface Mate { x: number; y: number; nextGate: number; }

/** Situación del partido para decidir: segundos de partido que quedan, ventaja de la CPU en puntos y qué tan estratégica es (0-1). */
export interface CpuCtx { clock: number; lead: number; strategy: number; rng: Rng; }

/**
 * Touch: la bola rival más valiosa (más puntos) que se alcanza en línea recta, sin postes de por medio y a menos
 * de `maxDist` metros. Un touch da spark (sacar la bola rival) y un golpe más.
 */
export function pickTouchTarget(pos: P, rivals: Rival[], maxDist = 9): P | null {
  let best: Rival | null = null;
  for (const r of rivals) {
    const d = Math.hypot(r.x - pos.x, r.y - pos.y);
    if (d < 0.6 || d > maxDist) continue;
    const reach = clampAimToPosts(pos, r);
    if (Math.hypot(reach.x - r.x, reach.y - r.y) > 0.01) continue; // hay un poste en el camino
    if (!best || r.points > best.points || (r.points === best.points && d < Math.hypot(best.x - pos.x, best.y - pos.y))) best = r;
  }
  return best ? { x: best.x, y: best.y } : null;
}

/** ¿El tramo from→to pasa a más de `margin` metros del centro de todas las bolas dadas? */
function segmentClear(from: P, to: P, balls: P[], margin: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len2 = dx * dx + dy * dy || 1;
  return balls.every((b) => {
    const t = clamp(((b.x - from.x) * dx + (b.y - from.y) * dy) / len2, 0, 1);
    return Math.hypot(from.x + dx * t - b.x, from.y + dy * t - b.y) > margin;
  });
}

/**
 * Bola fuera: un golpe que toque otra bola es falta, así que entre varias direcciones de entrada (la ideal y giros hacia
 * los lados) elige la primera que termina dentro de la cancha sin pasar cerca de otra bola.
 */
export function clearEntry(pos: P, ideal: P, others: P[]): P {
  const dx = ideal.x - pos.x, dy = ideal.y - pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const margin = 2 * CONFIG.ballRadiusM + 0.15;
  for (const deg of [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75]) {
    const a = (deg * Math.PI) / 180;
    const t = { x: pos.x + (dx * Math.cos(a) - dy * Math.sin(a)), y: pos.y + (dx * Math.sin(a) + dy * Math.cos(a)) };
    const inside = t.x > 0.6 && t.x < COURT_W - 0.6 && t.y > 0.6 && t.y < COURT_H - 0.6;
    if (inside && segmentClear(pos, t, others, margin)) return t;
  }
  return { x: pos.x + dx / d, y: pos.y + dy / d };
}

export const distTo = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
export const goalOf = (nextGate: number): P => (nextGate >= 4 ? LAYOUT.pole : GATES[nextGate - 1]);
export const reach = (from: P, to: P) => distTo(clampAimToPosts(from, to), to) <= 0.01; // sin postes de por medio

/**
 * Qué tirar con una bola en juego (puerta 1 ya pasada). Compara el valor de cada opción:
 *  - puntuar su puerta o el poste, si está bien puesta (más cerca = más probable);
 *  - touch a una bola rival: vale más cuanto más puntos tiene y si está por puntuar (puerta 3 o poste); sacarla de la
 *    cancha la frena y el touch da un golpe más;
 *  - touch a una bola propia que está lista para pasar su puerta: el spark la manda a puntuar y da un golpe más;
 *  - acomodarse para la puerta, si nada de lo anterior se puede.
 * Con poco tiempo vale más puntuar que atacar; si va ganando, juega más seguro; si va perdiendo, ataca más.
 * Según su `strategy`, a veces la CPU juega el criterio simple de antes (touch al rival más valioso salvo que pueda puntuar cerca).
 */
export function chooseTarget(pos: P, nextGate: number, rivals: Rival[], mates: Mate[], ctx: CpuCtx): P {
  const own = idealTarget(pos, nextGate, false);
  const canScore = canScoreNow(pos, nextGate);
  const lateGame = ctx.clock < 150;
  if (ctx.rng() > ctx.strategy) {
    const near = distTo(pos, goalOf(nextGate)) <= 5;
    return (!(near && canScore) && pickTouchTarget(pos, rivals)) || own;
  }
  let best: { v: number; t: P } = { v: canScore ? 0 : 0.35, t: own };
  const consider = (v: number, t: P) => { if (v > best.v) best = { v, t }; };
  if (canScore) {
    const p = clamp(1 - distTo(pos, goalOf(nextGate)) / 14, 0.3, 0.95);
    consider((nextGate >= 4 ? 2 : 1.5) * p * (lateGame ? 1.5 : 1) * (ctx.lead >= 5 ? 1.2 : 1), own);
  }
  for (const r of rivals) {
    const d = distTo(pos, r);
    if (d < 0.6 || d > 12 || !reach(pos, r)) continue;
    const danger = r.nextGate >= 4 ? 1.5 : r.nextGate === 3 ? 0.6 : 0;
    const p = clamp(1 - d / 14, 0.35, 0.95);
    consider((1.2 + 0.4 * r.points + danger) * p * (lateGame ? 0.5 : 1) * (ctx.lead <= -4 ? 1.3 : 1), { x: r.x, y: r.y });
  }
  for (const m of mates) {
    const d = distTo(pos, m);
    if (d < 0.6 || d > 12 || !reach(pos, m)) continue;
    if (!canScoreNow(m, m.nextGate) || distTo(m, goalOf(m.nextGate)) > 7) continue; // solo si el spark la deja pasar su puerta
    consider(1.4 * clamp(1 - d / 14, 0.35, 0.95) * (lateGame ? 0.7 : 1), { x: m.x, y: m.y });
  }
  return best.t;
}

/** Hacia dónde sparkear una bola rival: al borde más cercano y un poco más allá, para sacarla de la cancha. */
export function knockOutTarget(pos: P): P {
  const d = [pos.x, COURT_W - pos.x, pos.y, COURT_H - pos.y];
  const k = d.indexOf(Math.min(...d));
  const over = 1.2;
  if (k === 0) return { x: -over, y: pos.y };
  if (k === 1) return { x: COURT_W + over, y: pos.y };
  if (k === 2) return { x: pos.x, y: -over };
  return { x: pos.x, y: COURT_H + over };
}

/** Error de ejecución de un nivel de la CPU (0-3). */
export const levelError = (level: number): ErrorBase => {
  const lv = CONFIG.cpuLevels[clamp(level, 0, CONFIG.cpuLevels.length - 1)];
  return { aimErr: lv.aimErr, powerErr: lv.powerErr, accErr: lv.accErr };
};

/** Aplica a un tiro (mira, fuerza y rumbo en el triángulo) la desviación sorteada `e`: lo que la CPU hace de verdad o lo que simula con error. */
export function applyShotError(target: P, bars: { power: number; acc: number }, e: { dx: number; dy: number; dp: number; da: number }) {
  return {
    aim: { x: clamp(target.x + e.dx, -1, COURT_W + 1), y: clamp(target.y + e.dy, -1, COURT_H + 1) },
    power: clamp(bars.power * (1 + e.dp), 0.03, 1),
    acc: clamp(bars.acc + e.da, 0, 1),
  };
}

/** Plan completo con un error dado: dónde coloca la bola, la mira y dónde detiene cada barra. */
export function makePlanWith(target: P, bars: { power: number; acc: number }, err: ErrorBase, rng: Rng): CpuPlan {
  const startX = clamp((LAYOUT.startArea.x1 + LAYOUT.startArea.x2) / 2 + gauss(rng) * err.aimErr * 0.2, LAYOUT.startArea.x1, LAYOUT.startArea.x2);
  return { startX, ...applyShotError(target, bars, drawShotError(err, rng)) };
}

/** Plan completo: objetivo + errores de puntería según el nivel de la CPU (0-3). */
export function makePlan(target: P, bars: { power: number; acc: number }, level: number, rng: Rng): CpuPlan {
  return makePlanWith(target, bars, levelError(level), rng);
}
