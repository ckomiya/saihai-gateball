// Último turno con el partido ya ganado (Chris, 2026-10-28, v1.4, partida 20261028-073420, golpe 121): la blanca 8 (última bola) ya había tocado a la 2, la 7, la 1 y la 3 y no intentó el touch a la blanca 10 (sin tocar este turno,
// a 12,9 m, frente a la puerta 3) para pasar la puerta 3 con el spark. La cadena final solo miraba las bolas a menos de 12 m. Ahora `kantokuLastReachM` (18 m) las incluye; `legacyLastReach` vuelve a lo de la v1.4 (la prueba distingue).
// Tablero literal del registro (tests/fixtures/partidas/partida-20261028-073420-nivel5.json).
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { WeightFile2 } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };
// golpe 121 · turno 47.10 · reloj 0 · bola 8 (ya tocó a 2, 7, 1 y 3)
const G121 = [[1, 7.967, 1.604, 2, 0, 1], [2, 3.238, 3.481, 4, 0, 3], [3, 7.989, 1.998, 2, 0, 1], [4, 9.878, 7.62, 5, 0, 5], [5, 10.123, 0.731, 3, 0, 2], [6, 10.121, 7.402, 5, 0, 5], [7, 7.016, 2.442, 2, 0, 1], [8, 6.407, 1.65, 3, 0, 2], [9, 17.868, -0.35, 3, 1, 2], [10, 9.076, 14.308, 3, 0, 2]];
const N = 24;
const aimsAtTen = (legacyLastReach: boolean) => {
  const brain = { kind: 'kantoku' as const, file: { ...kantokuBrain.file, legacyLastReach } as WeightFile2 };
  let n = 0;
  for (let r = 0; r < N; r++) {
    const m = Match.fromBalls(mk(G121), { turn: 7, rng: mulberry32(500 + r), sparked: [1, 6, 0, 2] } as never);
    m.clock = 0; m.turnStarts = 41; m.firstRoundDone = true; m.shots = 100;
    const plan = cpuPlan(m, 7, { brain, errors });
    if (Math.hypot(plan.aim.x - 9.076, plan.aim.y - 14.308) < 2.5) n++;
  }
  return n;
};
const nuevo = aimsAtTen(false), viejo = aimsAtTen(true);
console.log(`   apunta a la blanca 10: ${nuevo}/${N} (alcance ${CONFIG.kantokuLastReachM} m) contra ${viejo}/${N} (legacyLastReach: alcance 12 m, v1.4)`);
check(nuevo >= 16, `último turno ganado: la 8 apunta al touch a la blanca 10 (${nuevo}/${N} ≥ 16)`);
check(viejo <= 2, `... y con legacyLastReach no (${viejo}/${N}): la prueba distingue`);
process.exit(fail ? 1 : 0);
