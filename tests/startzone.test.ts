// «Suponer que el rival pasa la puerta 1» (Chris, 2026-10-26): como kantoku, cualquiera puede pasar la puerta 1 si se concentra; nunca se deja una bola en la salida de la puerta 1 contando con que el rival falle.
//  A  la amenaza de una bola rival en el área de salida (pasar la puerta 1 y tocar con el golpe continuo) usa una probabilidad de pasar pesimista (≥ 90 %, `kantokuStartPassP`), aunque el modelo de error del rival diga que
//     la pasa poco: con un error del rival muy grande, la amenaza sigue siendo ≥ 85 % de la mejor probabilidad de touch desde donde puede quedar;
//  B  el kantoku no deja su bola en la zona de salida de la puerta 1 (≤ 5 m de donde puede quedar una bola tras pasarla) si hay una bola rival en el área de salida que juega antes que su siguiente compañera (≤ 10 % de los turnos);
//  C  con una rival en juego bien colocada para su puerta 2 (modelo ≥ 60 %), la amenaza de «pasar y tocar» se mide con su probabilidad, no con la pesimista (el criterio se aplicó solo a la puerta 1: ver BACKLOG).
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { CONFIG } from '../src/config';
import { touchProbability } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { EXIT_STOPS, touchThreat } from '../src/game/threat';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 0): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};

// A. amenaza con un modelo que dice que el rival casi no pasa la puerta 1
{
  const target = { x: 17.5, y: 7 };
  const rival = ball(1, 18, 15.5, 1);
  const bad = { aimErr: 0.5, powerErr: 0.3, accErr: 1.5 }; // un rival que casi nunca pasa la puerta 1
  const best = Math.max(...EXIT_STOPS.map((s) => touchProbability(bad, Math.hypot(target.x - 18, target.y - (11 - s)), true)));
  const pess = touchThreat(rival, target, bad), saved = CONFIG.kantokuStartPassP;
  CONFIG.kantokuStartPassP = 0;
  const model = touchThreat(rival, target, bad);
  CONFIG.kantokuStartPassP = saved;
  check(pess >= 0.85 * best && model < 0.5 * pess, `A amenaza desde la salida con un rival torpe: pesimista ${pess.toFixed(2)} (≥ 85 % de la mejor probabilidad de touch ${best.toFixed(2)}), con el modelo ${model.toFixed(2)}`);
}
// B. el turno completo de la blanca 2 con la roja 3 esperando en la salida y la blanca 4 después
{
  const T = 40;
  let near = 0;
  for (let t = 0; t < T; t++) {
    const m = Match.fromBalls(board({ 2: ball(2, 18, 15.5, 1), 3: ball(3, 18, 15.5, 1), 4: ball(4, 18, 15.5, 1) }), { turn: 1, rng: mulberry32(50 + t) });
    m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
    m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
    for (let g = 0; g < 5; g++) {
      const plan = cpuPlan(m, 3, { brain: kantokuBrain, errors: { ...kantokuLevelErrors(), rivalIsHuman: true } });
      if (g === 0) m.b.x = plan.startX;
      let res = m.shoot(plan.aim, plan.power, plan.acc);
      for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
      if (!res) { m.forceStop(); res = m.resolution!; }
      const tr = m.proceed(); if (tr === 'turn' || tr === 'end') break;
    }
    const b = m.balls[1];
    if (b.nextGate >= 2 && !b.outBall && Math.min(...EXIT_STOPS.map((s) => Math.hypot(b.x - 18, b.y - (11 - s)))) <= 5) near++;
  }
  check(near <= 0.1 * T, `B la blanca 2 no termina su turno a ≤ 5 m de la salida de la puerta 1 con la roja 3 esperando en la salida: ${near}/${T}`);
}
process.exit(fail ? 1 : 0);
