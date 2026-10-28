// Turno 54a (partida 20261026-162635): la 4 toca a la 2 y la manda con el spark a (10,48; 10,64), donde las rivales 5, 7, 9 y 1 (que juegan antes que la 2) la tocan con 27-32 % cada una. `mateTurnValue` descontaba solo a la mayor
// (≈ 32 %) y el ataque que preparaba la 2 se valoraba casi completo (+6,2). Ahora la compañera sobrevive hasta su turno solo si fallan TODAS las rivales que juegan antes (Π (1 − amenaza), con las cadenas de touches).
// (La roja 3, con 94 %, juega DESPUÉS de la 2 en el orden de turnos: no cuenta.) `legacyMateSurvival` vuelve a lo de antes.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { mateTurnValue } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { scaleError } from '../src/game/certainty';
import { upcomingTurns } from '../src/game/phase';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const B = [[1, 1.234, 13.99, 3, 0, 2], [2, 18.423, 9.044, 2, 0, 1], [3, 8.28, 14.132, 3, 0, 2], [4, 18.62, 9.009, 2, 0, 1], [5, 1.595, 10.824, 4, 0, 3], [6, 14.009, 14.844, 2, 0, 1], [7, 7.985, 0.358, 4, 0, 3], [8, -0.35, 7.621, 2, 1, 1], [9, 1.802, 12.123, 3, 0, 2], [10, 20.013, 14.867, 2, 0, 1]];
const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };
const mkm = (seed: number) => { const m = Match.fromBalls(mk(B), { turn: 3, rng: mulberry32(seed), sparkBall: 1 }); m.clock = 396.7; m.turnStarts = 40; m.firstRoundDone = true; return m; };

// (a) el orden de turnos: antes de la 2 juegan 5, 7, 9 y 1; la 3 juega después
const m0 = mkm(1);
const seq = upcomingTurns(m0);
const first2 = seq.indexOf(1);
const before = new Set(seq.slice(0, first2).map((i) => i + 1));
check([5, 7, 9, 1].every((n) => before.has(n)) && !before.has(3), `orden de turnos: antes de la 2 juegan ${[...before].filter((n) => n % 2 === 1).join(', ')}; la 3 juega después`);

// (b) el valor de preparar el turno de la 2 en ese punto
const F = { seq, profiles: m0.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError };
const w = weightsFor(kantokuBrain, 'final');
const at = { x: 10.48, y: 10.64 };
const vNew = mateTurnValue(mk(B) as any, 1, at, w, F as any, { heapSparkP: CONFIG.kantokuHeapSparkP });
const vOld = mateTurnValue(mk(B) as any, 1, at, { ...w, legacyMateSurvival: true }, F as any, { heapSparkP: CONFIG.kantokuHeapSparkP });
check(vNew < 0.5 * vOld, `valor del turno de la 2 en (10,5; 10,6): ${vNew.toFixed(2)} (antes ${vOld.toFixed(2)}): menos de la mitad`);

// (c) la elección: deja de preferir ese punto expuesto
const N = 16;
let minDist = 99;
const spotRate = (legacy: boolean) => {
  let n = 0;
  for (let s = 0; s < N; s++) {
    const m = mkm(90 + s);
    const brain = { kind: 'kantoku', file: { ...(kantokuBrain as any).file, ...(legacy ? { legacyMateSurvival: true } : {}) } } as any;
    const plan = cpuPlan(m, 3, { brain, errors });
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (Math.hypot(m.balls[1].x - at.x, m.balls[1].y - at.y) < 1.2) n++;
    for (const r of [5, 7, 9, 1]) minDist = Math.min(minDist, Math.hypot(m.balls[r - 1].x - m.balls[1].x, m.balls[r - 1].y - m.balls[1].y));
  }
  return n;
};
const nNew = spotRate(false), nOld = spotRate(true);
// 2026-10-27 (adopción del v4, riesgo por valor): con él también el modo anterior evita el punto (0 de 16 en ambos), así que `nNew < nOld` ya no puede cumplirse. Medido: en los 32 casos la 2 queda a ≥ 10 m de las rivales 5, 7, 9 y 1.
// Se exige lo que importa: no queda junto al punto expuesto y no queda a menos de 8 m de ninguna rival que juegue antes.
check(nNew <= nOld && nNew === 0 && minDist >= 8, `la 2 no queda junto a (10,5; 10,6) (${nNew} de ${N}; antes ${nOld} de ${N}) y queda a ≥ 8 m de toda rival que juega antes (mínimo ${minDist.toFixed(1)} m)`);
process.exit(fail ? 1 : 0);
