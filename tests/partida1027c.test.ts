// Cuatro casos de la partida 20261027-205516 (Chris, kantoku-v1.3 de blancas), con los tableros literales del registro. Cada uno se mide contra el mismo archivo con la pieza apagada
// (`legacySparkClear`, `legacyOpeningRivals`, `legacyJoinWindow`, `legacyLateAgain`/`legacyLongSpot`), para comprobar que la prueba distingue.
//  A  turno 48 (golpe 127): la 8 sparkeó a la roja 3 apuntando a sacarla y en esa dirección estaba la blanca 10: salió la 10 y la 3 se quedó. El spark a una rival descarta las direcciones donde choca con una bola mía.
//  B  turno 4 (golpe 7): la 4 fue a la apertura frente al 3.er arco con la roja 3 a 1,9 m (el radio era 1,6 m). La apertura se descarta si cualquier bola está cerca del sitio o una rival puede alcanzarlo.
//  C  turno 12 (golpe 23): la 2 reentró a 5 m de la 4 y no junto a ella. Juntarse solo cuenta la amenaza de las rivales que juegan antes que la compañera; sin amenaza real, se acerca.
//  D  turno 44 (golpe 122): la 4 (39 % de volver a jugar) cobró entero el premio de avanzar y quedó a 3,4 m de la roja 9, con 98 % de que la toque. El premio se pondera por la probabilidad de volver a jugar.
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
const file = kantokuBrain.file as WeightFile2;
const NEW = { kind: 'kantoku' as const, file };
const OLD = (flags: Partial<WeightFile2>) => ({ kind: 'kantoku' as const, file: { ...file, ...flags } as WeightFile2 });
const N = 24;

// golpe 127 · turno 48.2 · spark de la bola 3 con la 8 · reloj 221
const G127 = [[1, 8.24, -0.35, 2, 1, 1], [2, 16.615, 1.632, 2, 0, 1], [3, 2.461, 14.329, 4, 0, 3], [4, 12.257, 0.273, 2, 0, 1], [5, 13.141, 14.978, 3, 0, 2], [6, 11.264, 4.957, 2, 0, 1], [7, 8.82, 15.023, 3, 0, 2], [8, 2.417, 14.134, 2, 0, 1], [9, 8.851, -0.024, 2, 0, 1], [10, 2.664, 15.002, 3, 0, 2]];
// golpe 7 · turno 4.1 · la 4 sale (apertura) con la roja 3 frente al 3.er arco · reloj 1706
const G7 = [[1, 18, 15.5, 1, 0, 0], [2, 8.82, 0.75, 2, 0, 1], [3, 9.03, 14.02, 3, 0, 2], [4, 18, 15.5, 1, 0, 0], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 18, 15.5, 1, 0, 0]];
// golpe 23 · turno 12.1 · reentrada de la 2 junto a la 4 · reloj 1494
const G23 = [[1, 10.1, 13.49, 2, 0, 1], [2, 8.67, -0.35, 2, 1, 1], [3, 4.24, 14.48, 3, 0, 2], [4, 10.19, -0.03, 2, 0, 1], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 3.53, 14.56, 2, 0, 1], [8, 18, 15.5, 1, 0, 0], [9, 8.28, 14.42, 2, 0, 1], [10, 18, 15.5, 1, 0, 0]];
// golpe 122 · turno 44.11 · la 4 se acomoda al final de su cadena · reloj 286
const G122 = [[1, 8.24, -0.35, 2, 1, 1], [2, 16.615, 1.632, 2, 0, 1], [3, 2.47, 14.32, 4, 0, 3], [4, 0.51, 3.2, 2, 0, 1], [5, 9.64, 15.35, 3, 1, 2], [6, 8.33, -0.35, 2, 1, 1], [7, 3.09, 15.35, 3, 1, 2], [8, 2.04, 12.14, 2, 0, 1], [9, 8.85, -0.02, 2, 0, 1], [10, 2.66, 15, 3, 0, 2]];

const roll = (m: Match, plan: { aim: { x: number; y: number }; power: number; acc: number }) => {
  let res = m.shoot(plan.aim, plan.power, plan.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return res;
};

// A. el spark a la roja 3 no saca a la 10
{
  const run = (brain: typeof NEW) => {
    let only3 = 0, ownOut = 0, tenOut = 0;
    for (let r = 0; r < N; r++) {
      const m = Match.fromBalls(mk(G127), { turn: 7, rng: mulberry32(500 + r), sparkBall: 2, sparked: [] });
      m.clock = 221; m.turnStarts = 61; m.firstRoundDone = true; m.shots = 100;
      const before = m.balls.map((b) => ({ ...b }));
      roll(m, cpuPlan(m, 3, { brain, errors }));
      const out = m.balls.filter((o, i) => o.outBall && !before[i].outBall).map((o) => o.n);
      if (out.length === 1 && out[0] === 3) only3++;
      if (out.some((n) => n % 2 === 0)) ownOut++;
      if (out.includes(10)) tenOut++;
    }
    return { only3, ownOut, tenOut };
  };
  const a = run(NEW), b = run(OLD({ legacySparkClear: true }));
  console.log(`   v1.4: sale solo la 3 en ${a.only3}/${N}, sale una mía en ${a.ownOut}; v1.3: solo la 3 en ${b.only3}, la 10 sale en ${b.tenOut}`);
  check(a.only3 >= 0.8 * N && a.ownOut <= 1, `A turno 48: el spark saca a la roja 3 sin sacar una bola mía (${a.only3}/${N}, mías fuera ${a.ownOut})`);
  check(b.tenOut >= 0.4 * N, `A ... y con legacySparkClear vuelve a sacar a la 10 (${b.tenOut}/${N}): la prueba distingue`);
}

// B. la apertura frente al 3.er arco no se usa con una roja cerca
{
  const run = (brain: typeof NEW) => {
    let g3 = 0;
    for (let r = 0; r < 40; r++) {
      const m = Match.fromBalls(mk(G7), { turn: 3, rng: mulberry32(500 + r) });
      m.clock = 1706; m.turnStarts = 6; m.firstRoundDone = false;
      const plan = cpuPlan(m, 3, { brain, errors, explain: true });
      if (plan.decision?.opening === 'gate3') g3++;
    }
    return g3;
  };
  const a = run(NEW), b = run(OLD({ legacyOpeningRivals: true }));
  check(a === 0, `B turno 4: la apertura frente al 3.er arco no se elige con la roja 3 a 1,9 m (${a}/40)`);
  check(b >= 4, `B ... y con legacyOpeningRivals sí (${b}/40): la prueba distingue`);
}

// C. juntarse solo cuenta a las rivales que juegan antes que la compañera
{
  const near4 = (rows: number[][], brain: typeof NEW) => {
    let near = 0;
    for (let r = 0; r < N; r++) {
      const m = Match.fromBalls(mk(rows), { turn: 1, rng: mulberry32(500 + r) });
      m.clock = 1494; m.turnStarts = 61; m.firstRoundDone = true; m.shots = 100;
      roll(m, cpuPlan(m, 3, { brain, errors }));
      const b = m.balls[1], c = m.balls[3];
      if (!b.outBall && Math.hypot(b.x - c.x, b.y - c.y) <= 4) near++;
    }
    return near;
  };
  const fin = (rows: number[][], dead: number[]) => rows.map((r) => (dead.includes(r[0]) ? [r[0], 18, 15.5, 5, 0, 0] : r));
  const sinAmenaza = fin(G23, [1, 7, 9]); // queda la roja 3, lejos, y la 5 sin salir (juega después de la 4)
  const a = near4(sinAmenaza, NEW), b = near4(sinAmenaza, OLD({ legacyJoinWindow: true }));
  check(a >= 0.9 * N && b >= 0.9 * N, `C turno 12 sin amenaza real (roja 3 lejos y la 5 sin salir): la 2 reentra a ≤ 4 m de la 4 (${a}/${N}; v1.3 ${b}/${N})`);
  // el costo de juntarse en el tablero real: la ventana (solo la roja 3 juega antes que la 4) lo baja
  const juntarse = (brain: typeof NEW) => {
    const brain2 = { kind: 'kantoku' as const, file: { ...(brain.file as WeightFile2), sims: { topN: 100, errorSamples: 5 } } as WeightFile2 };
    const m = Match.fromBalls(mk(G23), { turn: 1, rng: mulberry32(1) });
    m.clock = 1494; m.turnStarts = 61; m.firstRoundDone = true; m.shots = 100;
    const keep = CONFIG.explainAlternatives; CONFIG.explainAlternatives = 400;
    const plan = cpuPlan(m, 3, { brain: brain2, errors, explain: true });
    CONFIG.explainAlternatives = keep;
    const alts = plan.decision!.explanation!.alternatives.filter((x) => Math.hypot(x.aim.x - 9.1, x.aim.y - 0.3) < 0.6);
    return alts.length ? Math.min(...alts.map((x) => x.terms.juntarse ?? 0)) : NaN;
  };
  const ja = juntarse(NEW), jb = juntarse(OLD({ legacyJoinWindow: true }));
  console.log(`   término «juntarse» de reentrar junto a la 4 en el tablero real: ${ja.toFixed(2)} (v1.4) contra ${jb.toFixed(2)} (v1.3)`);
  check(jb <= -1.0 && ja >= 0.5 * jb, `C el costo de juntarse baja de ${jb.toFixed(2)} a ${ja.toFixed(2)}, menos de la mitad (solo la roja 3 juega antes que la 4)`);
}

// D. el premio de avanzar pesa por la probabilidad de volver a jugar
{
  const far9 = (brain: typeof NEW) => {
    let far = 0;
    for (let r = 0; r < N; r++) {
      const m = Match.fromBalls(mk(G122), { turn: 3, rng: mulberry32(500 + r), sparked: [4, 2, 0, 7, 5] });
      m.clock = 286; m.turnStarts = 61; m.firstRoundDone = true; m.shots = 100; m.strokesInTurn = 10;
      roll(m, cpuPlan(m, 3, { brain, errors }));
      const b = m.balls[3];
      if (Math.hypot(b.x - 8.85, b.y + 0.02) >= 6) far++;
    }
    return far;
  };
  const a = far9(NEW), b = far9(OLD({ legacyLateAgain: true, legacyLongSpot: true }));
  console.log(`   la 4 termina a ≥ 6 m de la roja 9: ${a}/${N} (v1.4) contra ${b}/${N} (v1.3); en la partida quedó a 3,4 m`);
  check(a >= 0.75 * N, `D turno 44: la 4 no se acomoda junto a la roja 9 (${a}/${N} a ≥ 6 m)`);
  check(b <= 0.25 * N, `D ... y con legacyLateAgain/legacyLongSpot sí (${b}/${N} a ≥ 6 m): la prueba distingue`);
}
process.exit(fail ? 1 : 0);
