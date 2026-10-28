// Ritmo según la cancha (`src/game/pace.ts`, Chris, 2026-10-27): cuántos golpes encadena cada turno y cuánto reloj consume la vuelta.
//  A  tablero con muchas bolas a punto de encadenar (juntas, frente a su puerta): la vuelta es larga, a cada bola le tocan pocos turnos;
//  B  tablero con bolas aisladas, lejos de su meta o fuera: la vuelta es corta, a cada bola le tocan más turnos;
//  C  el promedio de reloj de antes (`phase.upcomingTurns` sin el modelo) da lo mismo en los dos tableros: no distingue;
//  D  las probabilidades de volver a jugar son coherentes: entre 0 y 1, bajan a medida que queda menos reloj y valen 0/1 en los extremos.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { BallState, Match } from '../src/game/match';
import { PaceCtx, paceOf, turnStrokes } from '../src/game/pace';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, g: number, out = false): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: out, points: 1 });
const ctx = (m: Match): PaceCtx => ({ team: 1, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError, profiles: m.profiles });
const mk = (balls: BallState[], clock: number) => { const m = Match.fromBalls(balls, { turn: 0, rng: mulberry32(1) }); m.clock = clock; m.turnStarts = 40; m.shots = 60; m.firstRoundDone = true; return m; };

// A: diez bolas a punto de pasar la puerta 2 (entrada a 2-3 m), juntas de a pares: cada turno encadena golpes
const A = Array.from({ length: 10 }, (_, k) => ball(k + 1, 11 + (k % 5) * 0.9, 1.6 + Math.floor(k / 5) * 1.0, 2));
// B: seis bolas fuera de la cancha (primero tienen que volver a entrar) y cuatro aisladas lejos de su puerta
const B = Array.from({ length: 10 }, (_, k) => (k < 6 ? ball(k + 1, -0.2, 3 + k * 2, 2, true) : ball(k + 1, [19, 1, 19, 1][k - 6], [14, 14, 1, 7.5][k - 6], 3)));
const mA = mk(A, 600), mB = mk(B, 600);
const pA = paceOf(mA, ctx(mA)), pB = paceOf(mB, ctx(mB));
const sum = (S: BallState[], c: PaceCtx) => S.reduce((t, _, i) => t + turnStrokes(S, i, c).mean, 0);
const gA = sum(mA.balls, ctx(mA)), gB = sum(mB.balls, ctx(mB));
check(gA > 1.5 * gB, `A una vuelta con bolas a punto de encadenar da más golpes (${gA.toFixed(1)}) que una de bolas aisladas o fuera (${gB.toFixed(1)})`);
check(pA.seq.length < pB.seq.length, `A ... y con el mismo reloj caben menos turnos (${pA.seq.length} contra ${pB.seq.length})`);
const tA = pA.turns.reduce((a, b) => a + b, 0) / 10, tB = pB.turns.reduce((a, b) => a + b, 0) / 10;
check(tA < tB, `A ... y a cada bola le tocan menos turnos (${tA.toFixed(2)} contra ${tB.toFixed(2)})`);
check(pA.pAgain[9] < pB.pAgain[9], `A ... y la última bola de la vuelta vuelve a jugar con menos probabilidad (${pA.pAgain[9].toFixed(2)} contra ${pB.pAgain[9].toFixed(2)})`);
check(Math.abs(upcomingTurns(mA).length - upcomingTurns(mB).length) <= 1, `C el promedio de reloj de antes casi no distingue los dos tableros (${upcomingTurns(mA).length} y ${upcomingTurns(mB).length} turnos; el modelo: ${pA.seq.length} y ${pB.seq.length})`);
// D
const probs = [...pA.pAgain, ...pB.pAgain];
check(probs.every((p) => p >= 0 && p <= 1), 'D las probabilidades de volver a jugar están entre 0 y 1');
const longClock = paceOf(mk(A, 1700), ctx(mA)), shortClock = paceOf(mk(A, 120), ctx(mA));
check(longClock.pAgain[9] > pA.pAgain[9] && pA.pAgain[9] >= shortClock.pAgain[9], `D con más reloj la bola vuelve a jugar con más probabilidad (${shortClock.pAgain[9].toFixed(2)} → ${pA.pAgain[9].toFixed(2)} → ${longClock.pAgain[9].toFixed(2)})`);
check(longClock.turns.reduce((a, b) => a + b, 0) > pA.turns.reduce((a, b) => a + b, 0), 'D ... y esperan más turnos en total');
const ended = mk(A, 0); ended.ending = true;
check(paceOf(ended, ctx(ended)).turns.every((t) => t <= 1), 'D con el tiempo terminado solo queda, a lo sumo, la última blanca');
process.exit(fail ? 1 : 0);
