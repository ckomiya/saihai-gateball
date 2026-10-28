// Tres casos de la partida 20261027-181359 (Chris, kantoku-v1.2 de blancas), con los tableros literales del registro (`partidas/`). Cada uno se mide contra el mismo archivo de pesos con la pieza nueva apagada
// (`legacySelfOut`, `legacyFarEntry`, `legacyLastTurn`), para comprobar que la prueba de verdad distingue.
//  A  turno 4 (golpe 9): la bola 4 acababa de pasar la puerta 1 y se sacó de la cancha a propósito (cuesta 1,25 contra 4 a 6 de quedarse expuesta). Salir cuesta ahora el turno de reentrar (`kantokuSelfOutCost`).
//  B  turno 14 (golpe 33): la bola 4 reentró a 18 m, detrás del 2.º arco (exposición 0,79) cuando la esquina opuesta estaba a 0,35. Ahora hay candidatos de reentrada en toda la cancha.
//  C  último turno (golpe 154): con 16 s de reloj, la 4 solo pasó la puerta (1 punto) teniendo cuatro compañeras junto al 2.º arco. En el último turno no hay riesgo: se busca la cadena que más puntos suma.
//     Y el penúltimo turno sin rivales que ataquen se trata igual.
import { kantokuLevelBase } from '../src/config';
import { cpuPlan, futureOf, kantokuLevelErrors } from '../src/game/cpuDriver';
import { exposureOf } from '../src/game/cpuPlanner';
import { endTurnOf } from '../src/game/lastTurn';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { WeightFile2 } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const errorsNow = { ...kantokuLevelErrors(), rivalIsHuman: true };
const errors = errorsNow;
const file = kantokuBrain.file as WeightFile2;
const NEW = { kind: 'kantoku' as const, file };
const OLD = (flags: Partial<WeightFile2>) => ({ kind: 'kantoku' as const, file: { ...file, ...flags } as WeightFile2 });

// golpe 9 · turno 4.2 · reloj 1692,6 · bola 4
const T4 = [[1, 18, 15.5, 1, 0, 0], [2, -0.35, 5.848, 2, 1, 1], [3, 10.139, 0.243, 2, 0, 1], [4, 18.382, 3.106, 2, 0, 1], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 18, 15.5, 1, 0, 0]];
// golpe 33 · turno 14.1 · reloj 1333,4 · bola 4 (reentrada)
const T14 = [[1, 7.877, 0.055, 2, 0, 1], [2, 0.794, 12.171, 2, 0, 1], [3, 12.937, 0.521, 2, 0, 1], [4, 20.35, 3.103, 2, 1, 1], [5, 20.35, 8.309, 2, 1, 1], [6, 19.402, -0.35, 2, 1, 1], [7, 18, 15.5, 1, 0, 0], [8, 18.02, 15.35, 2, 1, 1], [9, -0.35, 2.794, 2, 1, 1], [10, -0.35, 12.869, 2, 1, 1]];
// golpe 154 · turno 62.1 · reloj 16,4 · bola 4 (último turno del partido)
const T62 = [[1, 20.35, 5.26, 3, 1, 2], [2, 9.328, 0.72, 2, 0, 1], [3, 10.082, 7.367, 5, 0, 5], [4, 9.823, 1.988, 2, 0, 1], [5, 16.305, 15.35, 3, 1, 2], [6, 10.526, 2.133, 2, 0, 1], [7, 9.912, 7.378, 5, 0, 5], [8, 8.78, 1.127, 2, 0, 1], [9, 20.35, 2.102, 3, 1, 2], [10, 10.94, 2.501, 2, 0, 1]];

const board = (rows: number[][], turn: number, clock: number, seed: number) => {
  const m = Match.fromBalls(mk(rows), { turn, rng: mulberry32(seed) });
  m.clock = clock; m.turnStarts = 41; m.firstRoundDone = true; m.shots = 40;
  return m;
};
const roll = (m: Match, plan: { aim: { x: number; y: number }; power: number; acc: number }) => {
  let res = m.shoot(plan.aim, plan.power, plan.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return res;
};

// A. no salir a propósito
{
  const N = 40;
  // la partida se jugó con la certeza ×0,6; con la actual (×0,53) quedarse es menos arriesgado y la versión vieja sale menos, así que el contraste se mide con la certeza de entonces
  const errors06 = { base: kantokuLevelBase(), executionScale: 0.6, planningScale: 0.6, rivalIsHuman: true };
  const outs = (brain: typeof NEW, errors = errorsNow) => {
    let n = 0;
    for (let r = 0; r < N; r++) {
      const m = board(T4, 3, 1692.6, 500 + r);
      roll(m, cpuPlan(m, 3, { brain, errors }));
      if (m.balls[3].outBall) n++;
    }
    return n;
  };
  const nuevo = outs(NEW), viejo = outs(OLD({ legacySelfOut: true }), errors06), nuevo06 = outs(NEW, errors06);
  check(nuevo <= 2, `A turno 4: la bola 4 sale de la cancha en ${nuevo}/${N} partidas con semillas distintas (≤ 2; fuera por error de ejecución, no por decisión)`);
  check(viejo >= nuevo06 + 3, `A ... con la certeza de la partida (×0,6) la v1.2 (legacySelfOut) sale en ${viejo}/${N} y la v1.3 en ${nuevo06}/${N} (la prueba distingue: al menos 3 más)`);
  const m = board(T4, 3, 1692.6, 500);
  const plan = cpuPlan(m, 3, { brain: NEW, errors, explain: true });
  check(!plan.decision?.intended.shooterOut, `A la jugada elegida (${plan.decision?.kind}) no saca la bola ni sin error`);
}

// B. reentrar lejos de donde esperan las rivales
{
  const N = 12;
  const run = (brain: typeof NEW) => {
    let expo = 0, outs = 0;
    for (let r = 0; r < N; r++) {
      const m = board(T14, 3, 1333.4, 500 + r);
      roll(m, cpuPlan(m, 3, { brain, errors }));
      if (m.balls[3].outBall) { outs++; continue; }
      m.turn = 4; // juega la 5: el riesgo se mide como en el planificador, con la bola 4 ya adentro
      expo += exposureOf(m.balls, 3, futureOf(m, { errors } as never));
    }
    return { expo: expo / Math.max(1, N - outs), outs };
  };
  const nuevo = run(NEW), viejo = run(OLD({ legacyFarEntry: true }));
  console.log(`   exposición media de la reentrada: ${nuevo.expo.toFixed(2)} (v1.3) contra ${viejo.expo.toFixed(2)} (v1.2); en la partida 0,79`);
  check(nuevo.outs === 0, `B la bola 4 entra en las ${N} semillas`);
  check(nuevo.expo <= 0.6, `B exposición media ${nuevo.expo.toFixed(2)} ≤ 0,60 (la de la partida, 0,79)`);
  check(viejo.expo >= 0.7 && viejo.expo >= nuevo.expo + 0.15, `B ... y con legacyFarEntry vuelve a ${viejo.expo.toFixed(2)} (la prueba distingue)`);
}

// C. último turno: la mayor cadena de puntos
{
  const N = 12;
  const m0 = board(T62, 3, 16.4, 1);
  const F0 = futureOf(m0, { errors } as never);
  check(endTurnOf(m0, F0) === 'ultimo', `C con 16 s de reloj el turno de la 4 es el último (el modelo de ritmo no deja turnos después): ${endTurnOf(m0, F0)}`);
  const mid = board(T62.map((r) => (r[0] === 1 ? [1, 12, 6, 3, 0, 2] : r)), 3, 900, 1); // la roja 1 en juego: sí puede atacar
  check(endTurnOf(mid, futureOf(mid, { errors } as never)) === null, 'C con 900 s de reloj y una roja en juego es un turno normal');
  const pen = board(T62, 3, 45, 1);
  const kindPen = endTurnOf(pen, futureOf(pen, { errors } as never));
  check(kindPen === 'penultimo', `C con 45 s y todas las rojas fuera o en meta (nadie puede atacar) es el penúltimo: ${kindPen}`);
  const pts = (brain: typeof NEW, clock: number) => {
    let total = 0, strokes = 0;
    for (let r = 0; r < N; r++) {
      const m = board(T62, 3, clock, 500 + r);
      const p0 = m.teamScore(1);
      for (let g = 0; g < 30; g++) {
        roll(m, cpuPlan(m, 3, { brain, errors }));
        strokes++;
        const tr = m.proceed();
        if (tr === 'turn' || tr === 'end') break;
      }
      total += m.teamScore(1) - p0;
    }
    return { avg: total / N, strokes: strokes / N };
  };
  const nuevo = pts(NEW, 16.4), viejo = pts(OLD({ legacyLastTurn: true }), 16.4);
  console.log(`   puntos del turno: ${nuevo.avg.toFixed(2)} en ${nuevo.strokes.toFixed(1)} golpes (v1.3) contra ${viejo.avg.toFixed(2)} en ${viejo.strokes.toFixed(1)} (v1.2); en la partida 1`);
  check(nuevo.avg >= 1.6, `C último turno: ${nuevo.avg.toFixed(2)} puntos en promedio (≥ 1,6; la partida sumó 1)`);
  check(nuevo.avg >= 1.5 * viejo.avg, `C ... al menos 1,5 veces lo de la valoración de un golpe (${viejo.avg.toFixed(2)})`);
  const pen2 = pts(NEW, 45);
  console.log(`   penúltimo (45 s): ${pen2.avg.toFixed(2)} puntos`);
  check(pen2.avg >= 1.4, `C penúltimo turno sin rivales que ataquen: ${pen2.avg.toFixed(2)} puntos (≥ 1,4)`);
}
process.exit(fail ? 1 : 0);
