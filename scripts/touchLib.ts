// Clasificación de un intento de touch del kantoku (la usan scripts/touchshort.ts y tests/touchattempt.test.ts).
import { CONFIG } from '../src/config';
import { CpuPlan } from '../src/game/cpu';
import { BallState, Match, inPlay } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

export type Kind = 'hit' | 'short' | 'past' | 'out' | 'nohit-noshooter';
export interface Attempt { kind: Kind; dist: number; over: number; handed: boolean; shooterOut: boolean }

/** Repite el golpe de `balls` (turno `turn`) con esa mira, fuerza y rumbo; devuelve la resolución y las bolas al final. */
export function replay(balls: BallState[], turn: number, shot: { aim: { x: number; y: number }; power: number; acc: number }) {
  const m = Match.fromBalls(balls, { turn, rng: mulberry32(1) });
  let res = m.shoot(shot.aim, shot.power, shot.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return { res, balls: m.balls };
}

export function classify(before: BallState[], turn: number, plan: CpuPlan, res: { touches: number[]; strokerOut: boolean }, after: BallState[]): Attempt | null {
  const ideal = replay(before, turn, plan.ideal!);
  if (!ideal.res.touches.length || ideal.res.kind !== 'stroke') return null; // no pretendía un touch
  const o = before[turn];
  const target = before[ideal.res.touches[0]];
  const D = Math.hypot(target.x - o.x, target.y - o.y);
  const aimD = Math.hypot(plan.ideal!.aim.x - o.x, plan.ideal!.aim.y - o.y);
  const over = aimD - D; // cuánto más allá de la bola apuntaba
  const f = after[turn];
  const ux = (plan.aim.x - o.x), uy = (plan.aim.y - o.y), L = Math.hypot(ux, uy) || 1;
  const t = ((f.x - o.x) * ux + (f.y - o.y) * uy) / L; // hasta dónde llegó sobre la línea del golpe
  const short = t < D - 2 * CONFIG.ballRadiusM - 0.05;
  const handed = !res.touches.length && after.some((b, i) => i !== turn && b.team !== o.team && inPlay(b) && Math.hypot(b.x - f.x, b.y - f.y) < 1.5);
  if (res.touches.length) return { kind: 'hit', dist: D, over, handed: false, shooterOut: res.strokerOut };
  return { kind: res.strokerOut ? 'out' : short ? 'short' : 'past', dist: D, over, handed, shooterOut: res.strokerOut };
}

