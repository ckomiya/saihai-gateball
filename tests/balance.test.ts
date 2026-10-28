// Balance entre puntos y ataque (partida 20261026-162635, turnos 28, 34 y 54): tres casos con el tablero literal del registro.
//  - T28: el destino frente al segundo arco para la 10 (a 12,7 m de la 8) entra entre los destinos del spark (alcance `kantokuMateRangeM`, antes 10 m).
//  - T34: la 4 puede pasar el 2º arco casi seguro y va perdiendo por 5: pasa la puerta en vez de tocar la roja 5 (punto seguro primero); `legacySafePoint` la deja tocar.
//  - T54b: con 2 turnos por jugar y la 4 en el 2º arco, avanza hacia la puerta 3 y no se esconde en la esquina; `legacyLateProgress` la deja esconderse.
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { mateDestinations } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const B28 = [[1, 2.43, 1.53, 3, 0, 2], [2, 13.24, 13.88, 2, 0, 1], [3, 6.23, -0.35, 3, 1, 2], [4, 9.96, 1.88, 2, 0, 1], [5, 14.2, 0.04, 3, 0, 2], [6, 2.88, 11.16, 2, 0, 1], [7, 19.03, 15.08, 4, 0, 3], [8, 7.26, 14.12, 2, 0, 1], [9, 15.63, -0.35, 2, 1, 1], [10, 10.57, 14.66, 2, 0, 1]];
const B34 = [[1, 16.75, 1.33, 3, 0, 2], [2, 19.12, 15.35, 2, 1, 1], [3, 20.35, 11.27, 3, 1, 2], [4, 9.96, 1.88, 2, 0, 1], [5, 14.2, 0.04, 3, 0, 2], [6, 2.88, 11.16, 2, 0, 1], [7, 18.88, 15.35, 4, 1, 3], [8, 18.11, 15.35, 2, 1, 1], [9, 19.34, 0.13, 2, 0, 1], [10, 18.86, 14.99, 2, 0, 1]];
const B54 = [[1, 1.23, 13.99, 3, 0, 2], [2, 10.48, 10.64, 2, 0, 1], [3, 8.28, 14.13, 3, 0, 2], [4, 7.8, 0.42, 3, 0, 2], [5, 1.59, 10.82, 4, 0, 3], [6, 14.01, 14.84, 2, 0, 1], [7, 7.79, -0.35, 4, 1, 3], [8, -0.35, 7.62, 2, 1, 1], [9, 1.8, 12.12, 3, 0, 2], [10, 20.01, 14.87, 2, 0, 1]];
const errorsNow = () => ({ ...kantokuLevelErrors(), rivalIsHuman: true });
const N = 12;

function firstStrokes(rows: number[][], turnIdx: number, clock: number, seed: number, legacy: object, strokes: number) {
  const m = Match.fromBalls(mk(rows), { turn: turnIdx, rng: mulberry32(seed) });
  m.clock = clock; m.turnStarts = 40; m.firstRoundDone = true;
  const kinds: string[] = [];
  for (let g = 0; g < strokes; g++) {
    const plan = cpuPlan(m, 3, { brain: { kind: 'kantoku', file: { ...(kantokuBrain as any).file, ...legacy } } as any, errors: errorsNow(), explain: true });
    kinds.push(plan.decision!.kind);
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    const tr = m.proceed(); if (tr === 'turn' || tr === 'end') break;
  }
  return { m, kinds };
}

// T28: destinos del spark de la 10 desde la 8 (a 12,7 m)
{
  const S = mk(B28) as any[];
  const dests = mateDestinations(S, 9, { x: 10.6, y: 14.7 });
  const gate2 = dests.filter((d) => Math.hypot(d.x - 9.8, d.y - 1.9) <= 2.2);
  check(CONFIG.kantokuMateRangeM >= 13 && gate2.length > 0, `T28: entre los destinos de la 10 hay ${gate2.length} frente al 2º arco (alcance ${CONFIG.kantokuMateRangeM} m)`);
}
// T34
for (const [label, legacy, expectGate] of [['con la regla', {}, true], ['legacySafePoint', { legacySafePoint: true }, false]] as const) {
  let gate = 0, touch = 0;
  // v1.3: el contraste de la regla vieja se mide con la certeza de antes (×0,6): con ×0,53 el pase de la puerta es tan seguro que hasta sin la regla pasa (el cambio es brusco entre 0,55 y 0,56); la regla nueva se mide con la certeza actual
  const keep = [CONFIG.kantokuLevelErrorScale, CONFIG.kantokuLevelPlanScale];
  if (!expectGate) { CONFIG.kantokuLevelErrorScale = 0.6; CONFIG.kantokuLevelPlanScale = 0.6; }
  for (let t = 0; t < N; t++) { const { kinds } = firstStrokes(B34, 3, 935, 100 + t, legacy, 1); if (kinds[0].startsWith('puerta')) gate++; if (kinds[0].startsWith('touch')) touch++; }
  [CONFIG.kantokuLevelErrorScale, CONFIG.kantokuLevelPlanScale] = keep;
  check(expectGate ? gate === N : touch >= N * 0.75, `T34 (${label}): ${gate} pasan la puerta y ${touch} tocan de ${N}`);
}
// T54b (v1.4: reloj 316 → 800 s; el modelo de ritmo da a esta bola 0,04 turnos con 316 s y 2,2 con 800: el tablero quería «2 turnos por jugar», que antes salían de un promedio de reloj por turno)
for (const [label, legacy, expectNear] of [['con la regla', {}, true], ['legacyLateProgress', { legacyLateProgress: true }, false]] as const) {
  let near = 0;
  for (let t = 0; t < N; t++) { const { m } = firstStrokes(B54, 3, 800, 300 + t, legacy, 3); if (Math.hypot(m.balls[3].x - 10, m.balls[3].y - 13) <= 8) near++; }
  check(expectNear ? near === N : near <= N * 0.25, `T54b (${label}): la 4 queda a ≤ 8 m de la puerta 3 en ${near} de ${N}`);
}
process.exit(fail ? 1 : 0);
