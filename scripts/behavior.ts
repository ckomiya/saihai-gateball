// Pruebas de comportamiento como parte de la aptitud del entrenamiento (iteración G, v4). Cada escenario es un tablero literal de la partida 20261026-162635 (los turnos que Chris reportó) y mide, con
// `reps` semillas, si el cerebro candidato juega como un kantoku real. `behaviorScore` devuelve la fracción cumplida (0–1) y el detalle por escenario. Es la versión rápida de `tests/balance.test.ts`,
// `exposure2.test.ts` y `survival.test.ts` (que siguen siendo las pruebas de verdad): aquí no se exige nada, solo se puntúa. Para agregar un escenario basta una entrada más en `SCENARIOS`.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { cpuPlan, futureOf, kantokuLevelErrors } from '../src/game/cpuDriver';
import { exposureOf } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { weightsFor } from '../src/game/weights';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile } from '../src/game/weights';

const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const B34 = [[1, 16.75, 1.33, 3, 0, 2], [2, 19.12, 15.35, 2, 1, 1], [3, 20.35, 11.27, 3, 1, 2], [4, 9.96, 1.88, 2, 0, 1], [5, 14.2, 0.04, 3, 0, 2], [6, 2.88, 11.16, 2, 0, 1], [7, 18.88, 15.35, 4, 1, 3], [8, 18.11, 15.35, 2, 1, 1], [9, 19.34, 0.13, 2, 0, 1], [10, 18.86, 14.99, 2, 0, 1]];
const B54B = [[1, 1.23, 13.99, 3, 0, 2], [2, 10.48, 10.64, 2, 0, 1], [3, 8.28, 14.13, 3, 0, 2], [4, 7.8, 0.42, 3, 0, 2], [5, 1.59, 10.82, 4, 0, 3], [6, 14.01, 14.84, 2, 0, 1], [7, 7.79, -0.35, 4, 1, 3], [8, -0.35, 7.62, 2, 1, 1], [9, 1.8, 12.12, 3, 0, 2], [10, 20.01, 14.87, 2, 0, 1]];
const T12 = [[1, 2.063, 6.326, 2, 0, 1], [2, 6.507, -0.35, 2, 1, 1], [3, 18, 15.5, 1, 0, 0], [4, 10.088, 14.057, 2, 0, 1], [5, 9.622, 0.22, 2, 0, 1], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 6.736, 15.35, 2, 1, 1]];
const T42 = [[1, 5.218, 2.473, 3, 0, 2], [2, 19.118, 15.35, 2, 1, 1], [3, 20.35, 11.273, 3, 1, 2], [4, 20.35, 6.501, 2, 1, 1], [5, 9.014, 13.682, 3, 0, 2], [6, 7.942, 14.051, 2, 0, 1], [7, 18.823, 15.35, 4, 1, 3], [8, 13.202, 13.902, 2, 0, 1], [9, 9.121, 2.195, 2, 0, 1], [10, 18.875, 13.806, 2, 0, 1]];
const T28 = [[1, 2.429, 1.529, 3, 0, 2], [2, 13.244, 13.878, 2, 0, 1], [3, 6.228, -0.35, 3, 1, 2], [4, 9.963, 1.882, 2, 0, 1], [5, 14.195, 0.043, 3, 0, 2], [6, 2.882, 11.158, 2, 0, 1], [7, 19.029, 15.079, 4, 0, 3], [8, 10.388, 14.585, 2, 0, 1], [9, 15.628, -0.35, 3, 1, 1], [10, 10.573, 14.509, 2, 0, 1]];
const T54A = [[1, 1.234, 13.99, 3, 0, 2], [2, 18.423, 9.044, 2, 0, 1], [3, 8.28, 14.132, 3, 0, 2], [4, 18.62, 9.009, 2, 0, 1], [5, 1.595, 10.824, 4, 0, 3], [6, 14.009, 14.844, 2, 0, 1], [7, 7.985, 0.358, 4, 0, 3], [8, -0.35, 7.621, 2, 1, 1], [9, 1.802, 12.123, 3, 0, 2], [10, 20.013, 14.867, 2, 0, 1]];

// Casos de la partida 20261027-114432 (kantoku-v1.0 de blancas contra Chris): reentradas en zonas vulnerables. Tableros literales del registro (`partidas/`); `logged` = dónde dejó la bola en la partida.
const C16 = [[1, -0.35, 5.196, 2, 1, 1], [2, -0.35, 2.247, 2, 1, 1], [3, 10.395, 0.018, 2, 0, 1], [4, 5.624, 15.076, 3, 0, 2], [5, 2.19, 5.503, 2, 0, 1], [6, 9.686, 15.35, 2, 1, 1], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 4.468, -0.35, 2, 1, 1], [10, 18, 15.5, 1, 0, 0]];
const C22 = [[1, 9.777, 1.416, 2, 0, 1], [2, -0.35, 2.247, 2, 1, 1], [3, 10.395, 0.018, 2, 0, 1], [4, 5.624, 15.076, 3, 0, 2], [5, 2.19, 5.503, 2, 0, 1], [6, 6.866, 10.099, 2, 0, 1], [7, 18, 15.5, 1, 0, 0], [8, 7.041, 0.649, 2, 0, 1], [9, 3.743, 9.061, 2, 0, 1], [10, 2.341, 0.745, 2, 0, 1]];
const C26 = [[1, 18.671, 1.046, 2, 0, 1], [2, 2.702, -0.35, 2, 1, 1], [3, 9.228, 13.086, 3, 0, 2], [4, 3.301, 14.877, 3, 0, 2], [5, 10.588, 15.35, 3, 1, 2], [6, 5.798, 15.35, 2, 1, 1], [7, 18, 15.5, 1, 0, 0], [8, -0.35, 1.126, 2, 1, 1], [9, 12.219, 12.181, 2, 0, 1], [10, 0.751, -0.35, 2, 1, 1]];
const C32 = [[1, 14.639, 9.287, 4, 0, 3], [2, 2.702, -0.35, 2, 1, 1], [3, 7.69, 13.682, 3, 0, 2], [4, -0.35, 1.73, 3, 1, 2], [5, 10.588, 15.35, 3, 1, 2], [6, 3.515, 15.35, 3, 1, 2], [7, 2.92, 1.639, 3, 0, 2], [8, 0.005, 3.455, 2, 0, 1], [9, 8.449, 13.291, 2, 0, 1], [10, 1.436, 0.033, 2, 0, 1]];
const C34 = [[1, 16.704, 11.913, 4, 0, 3], [2, 10.056, 2.372, 2, 0, 1], [3, 16.396, 14.703, 4, 0, 3], [4, -0.35, 1.73, 3, 1, 2], [5, 10.588, 15.35, 3, 1, 2], [6, 3.515, 15.35, 3, 1, 2], [7, 2.92, 1.639, 3, 0, 2], [8, 0.005, 3.455, 2, 0, 1], [9, 8.965, 0.759, 2, 0, 1], [10, 1.436, 0.033, 2, 0, 1]];
const C40 = [[1, 16.704, 11.913, 4, 0, 3], [2, 6.665, 15.35, 2, 1, 1], [3, 16.396, 14.703, 4, 0, 3], [4, 7.946, 12.982, 3, 0, 2], [5, 17.145, 12.282, 3, 0, 2], [6, 5.922, 15.01, 3, 0, 2], [7, -0.35, 4.181, 3, 1, 2], [8, 1.75, 0.074, 2, 0, 1], [9, 10.314, 15.35, 3, 1, 2], [10, 1.445, -0.35, 2, 1, 1]];
const C42 = [[1, 11.149, 7.882, 4, 0, 3], [2, 6.665, 15.35, 2, 1, 1], [3, 8.146, 13.541, 4, 0, 3], [4, 7.946, 12.982, 3, 0, 2], [5, 6.498, 14.44, 3, 0, 2], [6, 5.922, 15.01, 3, 0, 2], [7, -0.35, 4.181, 3, 1, 2], [8, 1.75, 0.074, 2, 0, 1], [9, 10.314, 15.35, 3, 1, 2], [10, 10.017, 2.003, 2, 0, 1]];
/** Exposición (`exposureOf`: touch directo, cadenas y «enviar a marcar», sin contar mi cobertura) de la bola `ball` en el tablero de `rows` con la bola en `at` y el turno en la bola siguiente. */
const exposureAt = (rows: number[][], ball: number, clock: number, at: [number, number] | null, m0?: Match): number => {
  const m = m0 ?? Match.fromBalls(mk(rows), { turn: ball % 10, rng: mulberry32(1) });
  if (!m0) { m.clock = clock - 15; m.turnStarts = 41; m.firstRoundDone = true; if (at) { m.balls[ball - 1].x = at[0]; m.balls[ball - 1].y = at[1]; m.balls[ball - 1].outBall = false; } }
  return exposureOf(m.balls, ball - 1, futureOf(m, { errors: { ...kantokuLevelErrors(), rivalIsHuman: true } } as never));
};
/** Exposición con la defensa de la línea del planificador (el valor esperado del intento del rival cerca de la línea): una bola pegada a la línea queda menos expuesta. */
const exposureLine = (m: Match, ball: number) => exposureOf(m.balls, ball - 1, futureOf(m, { errors: { ...kantokuLevelErrors(), rivalIsHuman: true } } as never), undefined, 5, weightsFor(kantokuBrain, 'medio'));
// Reentrada v1.2 (Chris, 2026-10-27): con las rojas dominando (cinco en juego, todas mis blancas fuera) hay que entrar, por la línea u otro lugar poco expuesto.
const DOMINAN = [[1, 9.5, 3.5, 2, 0, 1], [2, -0.35, 6, 2, 1, 1], [3, 12, 6.5, 2, 0, 1], [4, 6, 15.35, 2, 1, 1], [5, 5.5, 9, 3, 0, 2], [6, 20.35, 9, 2, 1, 1], [7, 13, 11, 3, 0, 2], [8, 3, 15.35, 2, 1, 1], [9, 8.5, 12.5, 2, 0, 1], [10, 15, -0.35, 2, 1, 1]];
// Sin amenaza (las rivales lejos o fuera): también hay que entrar.
const SIN_AMENAZA = [[1, 18, 15.5, 1, 0, 0], [2, 20.35, 8, 2, 1, 1], [3, 18, 15.5, 1, 0, 0], [4, 18, 15.5, 1, 0, 0], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 18, 15.5, 1, 0, 0]];
// Casos de la partida 20261027-181359 (kantoku-v1.2 de blancas contra Chris), tableros literales del registro. Las pruebas con más semillas y contraste están en `tests/partida1027b.test.ts`.
const G9 = [[1, 18, 15.5, 1, 0, 0], [2, -0.35, 5.848, 2, 1, 1], [3, 10.139, 0.243, 2, 0, 1], [4, 18.382, 3.106, 2, 0, 1], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 18, 15.5, 1, 0, 0]];
const G33 = [[1, 7.877, 0.055, 2, 0, 1], [2, 0.794, 12.171, 2, 0, 1], [3, 12.937, 0.521, 2, 0, 1], [4, 20.35, 3.103, 2, 1, 1], [5, 20.35, 8.309, 2, 1, 1], [6, 19.402, -0.35, 2, 1, 1], [7, 18, 15.5, 1, 0, 0], [8, 18.02, 15.35, 2, 1, 1], [9, -0.35, 2.794, 2, 1, 1], [10, -0.35, 12.869, 2, 1, 1]];
const G154 = [[1, 20.35, 5.26, 3, 1, 2], [2, 9.328, 0.72, 2, 0, 1], [3, 10.082, 7.367, 5, 0, 5], [4, 9.823, 1.988, 2, 0, 1], [5, 16.305, 15.35, 3, 1, 2], [6, 10.526, 2.133, 2, 0, 1], [7, 9.912, 7.378, 5, 0, 5], [8, 8.78, 1.127, 2, 0, 1], [9, 20.35, 2.102, 3, 1, 2], [10, 10.94, 2.501, 2, 0, 1]];
const whitePoints = (rows: number[][]) => rows.filter((r) => r[0] % 2 === 0).reduce((s, r) => s + r[5], 0);
// Casos de la partida 20261027-205516 (kantoku-v1.3 de blancas contra Chris), tableros literales del registro; las pruebas con más semillas y contraste están en `tests/partida1027c.test.ts`.
const H127 = [[1, 8.24, -0.35, 2, 1, 1], [2, 16.615, 1.632, 2, 0, 1], [3, 2.461, 14.329, 4, 0, 3], [4, 12.257, 0.273, 2, 0, 1], [5, 13.141, 14.978, 3, 0, 2], [6, 11.264, 4.957, 2, 0, 1], [7, 8.82, 15.023, 3, 0, 2], [8, 2.417, 14.134, 2, 0, 1], [9, 8.851, -0.024, 2, 0, 1], [10, 2.664, 15.002, 3, 0, 2]];
const H7 = [[1, 18, 15.5, 1, 0, 0], [2, 8.82, 0.75, 2, 0, 1], [3, 9.03, 14.02, 3, 0, 2], [4, 18, 15.5, 1, 0, 0], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 18, 15.5, 1, 0, 0]];
const H23 = [[1, 18, 15.5, 5, 0, 0], [2, 8.67, -0.35, 2, 1, 1], [3, 4.24, 14.48, 3, 0, 2], [4, 10.19, -0.03, 2, 0, 1], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 5, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 5, 0, 0], [10, 18, 15.5, 1, 0, 0]];
const H122 = [[1, 8.24, -0.35, 2, 1, 1], [2, 16.615, 1.632, 2, 0, 1], [3, 2.47, 14.32, 4, 0, 3], [4, 0.51, 3.2, 2, 0, 1], [5, 9.64, 15.35, 3, 1, 2], [6, 8.33, -0.35, 2, 1, 1], [7, 3.09, 15.35, 3, 1, 2], [8, 2.04, 12.14, 2, 0, 1], [9, 8.85, -0.02, 2, 0, 1], [10, 2.66, 15, 3, 0, 2]];
export interface ExposureCase { name: string; turn: number; rows: number[][]; ball: number; clock: number; logged: [number, number]; margin: number }
/** `margin` < 0: debe quedar menos expuesta que en la partida (relativo, p. ej. -0,10 = al menos 10 % menos); ≥ 0: no peor que en la partida más `margin`. Los casos T22, T26, T32, T34 y T42 son tableros en que casi toda la cancha está expuesta (la mejor casilla de reentrada da 0,5-0,86; la de la partida 0,81-1,00): ahí no se exige mejorar, solo no empeorar; quedarse fuera a propósito no vale. */
export const EXPOSURE_CASES: ExposureCase[] = [
  { name: 'T16 (bola 6)', turn: 16, rows: C16, ball: 6, clock: 1349.4, logged: [6.866, 10.099], margin: -0.1 },
  { name: 'T22 (bola 2)', turn: 22, rows: C22, ball: 2, clock: 1213.9, logged: [4.947, 5.118], margin: 0.05 },
  { name: 'T26 (bola 6)', turn: 26, rows: C26, ball: 6, clock: 1034.9, logged: [8.184, 1.981], margin: 0.03 },
  { name: 'T32 (bola 2)', turn: 32, rows: C32, ball: 2, clock: 845.4, logged: [10.056, 2.372], margin: 0.1 },
  { name: 'T34 (bola 4)', turn: 34, rows: C34, ball: 4, clock: 773.3, logged: [7.946, 12.982], margin: 0.12 },
  { name: 'T40 (bola 10)', turn: 40, rows: C40, ball: 10, clock: 661.3, logged: [10.017, 2.003], margin: -0.2 },
  { name: 'T42 (bola 2)', turn: 42, rows: C42, ball: 2, clock: 597.1, logged: [3.554, 10.421], margin: 0.05 },
];
const loggedExposure = new Map<string, number>();
const exposureScenario = (c: ExposureCase): Scenario => ({
  name: `${c.name} la reentrada entra y no queda más expuesta que en la partida`, rows: c.rows, turn: c.ball - 1, clock: c.clock, strokes: 1,
  ok: (m) => {
    if (!loggedExposure.has(c.name)) loggedExposure.set(c.name, exposureAt(c.rows, c.ball, c.clock, c.logged));
    const ref = loggedExposure.get(c.name)!;
    const b = m.balls[c.ball - 1];
    if (b.outBall) return false; // quedarse fuera a propósito gasta el turno
    const e = exposureAt(c.rows, c.ball, c.clock, null, m);
    return c.margin < 0 ? e <= ref * (1 + c.margin) : e <= ref + c.margin;
  },
});

const EMPTY = Array.from({ length: 10 }, (_, i) => [i + 1, 18, 15.5, 1, 0, 0]);
interface Scenario { name: string; rows: number[][]; turn: number; clock: number; spark?: number; neutral?: boolean; firstRound?: boolean; strokes: number; ok: (m: Match, kinds: string[]) => boolean }
const d = (a: { x: number; y: number }, x: number, y: number) => Math.hypot(a.x - x, a.y - y);
export const SCENARIOS: Scenario[] = [
  { name: 'S2 con poco tiempo y tablero vacío pasa la puerta 1', rows: EMPTY, turn: 1, clock: 90, neutral: true, strokes: 1, ok: (_m, k) => k[0].includes('puerta 1') },
  { name: 'T34 punto seguro: pasa el 2º arco en vez de tocar la 5', rows: B34, turn: 3, clock: 935, strokes: 1, ok: (_m, k) => k[0].startsWith('puerta') },
  { name: 'T54b con pocos turnos avanza hacia la puerta 3', rows: B54B, turn: 3, clock: 600, strokes: 3, ok: (m) => d(m.balls[3], 10, 13) <= 8 },
  { name: 'T12 la reentrada de la 2 no queda pegada a la 5', rows: T12, turn: 1, clock: 1510, strokes: 1, ok: (m) => d(m.balls[1], 9.622, 0.22) >= 3 },
  { name: 'T42 la reentrada de la 2 no sale ni se pega a la 5', rows: T42, turn: 1, clock: 744, strokes: 1, ok: (m) => !m.balls[1].outBall && d(m.balls[1], 9.014, 13.682) >= 4 },
  { name: 'T28 el spark deja a la 10 frente al 2º arco', rows: T28, turn: 7, clock: 1090, spark: 9, strokes: 1, ok: (m) => d(m.balls[9], 10.5, 2.2) <= 2.5 },
  { name: 'T54a el spark no deja a la 2 en (10,5; 10,6)', rows: T54A, turn: 3, clock: 396.7, spark: 1, strokes: 1, ok: (m) => d(m.balls[1], 10.48, 10.64) >= 1.2 },
  ...EXPOSURE_CASES.map(exposureScenario),
  { name: 'Rivales dominando: la 2 reentra (no se queda fuera) por la línea o un lugar poco expuesto (≤ 0,45)', rows: DOMINAN, turn: 1, clock: 900, strokes: 1, ok: (m) => !m.balls[1].outBall && exposureLine(m, 2) <= 0.45 },
  { name: 'T4 (partida 1027b): la 4 recién salida de la puerta 1 no se saca de la cancha a propósito', rows: G9, turn: 3, clock: 1692.6, strokes: 1, ok: (m) => !m.balls[3].outBall },
  { name: 'T14 (partida 1027b): la 4 reentra lejos del 2º arco (exposición ≤ 0,6; en la partida 0,79)', rows: G33, turn: 3, clock: 1333.4, strokes: 1, ok: (m) => !m.balls[3].outBall && exposureAt(G33, 4, 1333.4, null, Object.assign(m, { turn: 4 })) <= 0.6 },
  { name: 'Último turno (partida 1027b): la 4 con 16 s suma ≥ 2 puntos encadenando compañeras (en la partida, 1)', rows: G154, turn: 3, clock: 16.4, strokes: 30, ok: (m) => m.teamScore(1) - whitePoints(G154) >= 2 },
  { name: 'T48 (partida 1027c): el spark a la roja 3 la saca sin sacar la blanca 10', rows: H127, turn: 7, clock: 221, spark: 2, strokes: 1, ok: (m) => m.balls[2].outBall && !m.balls[9].outBall },
  { name: 'T4 (partida 1027c): con la roja 3 frente al 3er arco la 4 no va a la apertura del 3er arco', rows: H7, turn: 3, clock: 1706, firstRound: true, strokes: 1, ok: (_m, k) => !k[0].includes('[apertura gate3]') },
  { name: 'T12 (partida 1027c): sin amenaza real la 2 reentra a ≤ 4 m de la 4 para ayudarle con la puerta', rows: H23, turn: 1, clock: 1494, strokes: 1, ok: (m) => !m.balls[1].outBall && d(m.balls[1], m.balls[3].x, m.balls[3].y) <= 4 },
  { name: 'T44 (partida 1027c): la 4, con pocas ganas de volver a jugar, no se acomoda junto a la roja 9 (≥ 6 m)', rows: H122, turn: 3, clock: 286, strokes: 1, ok: (m) => d(m.balls[3], 8.85, -0.02) >= 6 },
  { name: 'Sin amenaza: la 2 reentra siempre', rows: SIN_AMENAZA, turn: 1, clock: 900, strokes: 1, ok: (m) => !m.balls[1].outBall },
];

export function behaviorScore(file: AnyWeightFile, reps = 4, seed0 = 500): { score: number; detail: Record<string, number> } {
  const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };
  const brain = { kind: 'kantoku', file } as const;
  const detail: Record<string, number> = {};
  let ok = 0, total = 0;
  for (const sc of SCENARIOS) {
    let good = 0;
    for (let r = 0; r < reps; r++) {
      const m = Match.fromBalls(mk(sc.rows), { turn: sc.turn, rng: mulberry32(seed0 + r), sparkBall: sc.spark });
      m.clock = sc.clock; m.shots = sc.firstRound ? 6 : 100; m.turnStarts = sc.firstRound ? 6 : 40; m.firstRoundDone = !sc.firstRound;
      if (sc.neutral) m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })); // como `tests/gate1.test.ts`
      const kinds: string[] = [];
      for (let g = 0; g < sc.strokes; g++) {
        const plan = cpuPlan(m, 3, { brain, errors, explain: true });
        kinds.push((plan.decision?.kind ?? '') + (plan.decision?.opening ? ` [apertura ${plan.decision.opening}]` : ''));
        if (m.b.nextGate === 1) m.b.x = plan.startX; // el lugar de salida que eligió
        let res = m.shoot(plan.aim, plan.power, plan.acc);
        for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
        if (!res) { m.forceStop(); res = m.resolution!; }
        const tr = m.proceed(); if (tr === 'turn' || tr === 'end') break;
      }
      if (sc.ok(m, kinds)) good++;
    }
    detail[sc.name] = good / reps;
    ok += good; total += reps;
  }
  void CONFIG;
  return { score: ok / total, detail };
}

if (process.argv[1]?.endsWith('behavior.ts') || process.argv[1]?.includes('behavior')) {
  // uso: npm run behavior [-- --file ruta.json] [--reps 4]
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--file'), ri = argv.indexOf('--reps');
  const file = JSON.parse(readFileSync(fi >= 0 ? argv[fi + 1] : 'src/game/cpuWeights.json', 'utf8')) as AnyWeightFile;
  const t0 = Date.now();
  const r = behaviorScore(file, ri >= 0 ? Number(argv[ri + 1]) : 4);
  for (const [k, v] of Object.entries(r.detail)) console.log(`${(100 * v).toFixed(0).padStart(4)} %  ${k}`);
  console.log(`Comportamiento: ${(100 * r.score).toFixed(0)} % (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
