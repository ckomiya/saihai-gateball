// La otra cara del montón (pedido de Chris): si el kantoku sabe mandar una bola al montón rival, también debe cuidarse de que se lo hagan. El riesgo de siempre mira bola por bola (la MEJOR opción de cada
// rival); el paso 4b2 del planificador suma el riesgo de las bolas del montón después de la primera (un rival que llega al montón —touch directo, pasando su puerta y quedando cerca, o mandando una bola
// suya con spark— y sigue con la cadena de touches), menos lo que mis compañeras que juegan antes que ese rival pueden mover a tiempo (según su certeza).
// Prueba directa de la valoración (no de una decisión, que mezcla muchos términos): se valora el MISMO tablero con las tres blancas juntas y con ellas separadas, con el kantoku de ahora y con el de antes
// (legacyHeapRisk). Δ = valor(separadas) − valor(juntas): lo que premia separarlas. Lo que importa es cuánto sube Δ con el término nuevo:
//  (el peso heapRisk lo fija la prueba en 1: no depende de lo que haya entrenado el campeón)
//  J1 la roja 1 puede llegar al montón (touch directo a ~5 m): Δ sube claramente (conviene separarlas).
//  J2 sin rival que pueda llegar (la roja 1 fuera): Δ no cambia (se mantienen juntas como antes).
//  J3 la roja 1 puede llegar, pero la blanca 10, que juega antes que ella, puede tocar a las del montón y moverlas: Δ sube menos que en J1.
//  J5 la misma compañera, certera o torpe: con la certera separar vale menos.
//  J4 el rival llega al montón mandando una bola suya con spark (la roja 3 junto a la 1, que la toca): Δ sube aunque la roja 1 no pueda tocar el montón directamente.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { evaluate, Outcome } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { weightsFor, type AnyWeightFile, type Brain, type WeightFile2 } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, outBall = false): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall, points: 0 });

const JOINED = { 2: [10.2, 3.2], 4: [10.9, 4.4], 6: [11.6, 3.4] }; // tres blancas juntas delante de la puerta 2
const SPREAD = { 2: [10.2, 3.2], 4: [14.5, 3], 6: [6.5, 9] }; // las mismas, separadas ≥ 4 m
function board(extra: Record<number, BallState>, arrangement: Record<number, number[]>): BallState[] {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
  for (const [n, [x, y]] of Object.entries(arrangement)) b[Number(n) - 1] = ball(Number(n), x, y, 3);
  b[7] = ball(8, 17.5, 11, 2); // la blanca que juega, lejos del montón
  for (const [n, v] of Object.entries(extra)) b[Number(n) - 1] = v;
  return b;
}

// El peso del riesgo del montón (`heapRisk`) lo fija la prueba (REF = 1), no el campeón: el campeón lo entrena (el v3 lo dejó en 0,07) y los umbrales no pueden depender de ese valor.
const REF = 1;
function value(extra: Record<number, BallState>, arrangement: Record<number, number[]>, legacy: boolean, mateFactor = 1, hr = REF) {
  const f = kantokuBrain.kind === 'kantoku' ? (kantokuBrain.file as WeightFile2) : null;
  const brain: Brain = f ? { kind: 'kantoku', file: { ...f, legacyHeapRisk: legacy, rules: { ...f.rules, heapRisk: hr } } as AnyWeightFile } : kantokuBrain;
  const balls = board(extra, arrangement);
  const m = Match.fromBalls(balls, { turn: 7, rng: mulberry32(1) });
  m.clock = 900; m.firstRoundDone = true;
  const weights = weightsFor(brain, 'medio');
  const base = scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale);
  const out: Outcome = { balls: balls.map((b) => ({ ...b })), touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true };
  return evaluate(balls.map((b) => ({ ...b })), out, 7, 'stroke', { team: 1, clock: 900, noise: 0, rng: mulberry32(2), weights, future: { seq: upcomingTurns(m), profiles: m.profiles.map((_, i) => (i === 9 ? { short: mateFactor, medium: mateFactor, long: mateFactor } : { short: 1, medium: 1, long: 1 })), base, rivalBase: CONFIG.humanRivalError } });
}
/** Cuánto sube el premio por separar las blancas con el término nuevo. */
function gain(extra: Record<number, BallState>, mateFactor = 1, hr = REF) {
  const d = (legacy: boolean) => value(extra, SPREAD, legacy, mateFactor, hr) - value(extra, JOINED, legacy, mateFactor, hr);
  return d(false) - d(true);
}

const reach = { 1: ball(1, 13.8, 8.2, 2) }; // roja 1 a ~5 m del montón, línea libre, juega justo después de la 8... (la 10 está fuera del partido)
const none = { 1: ball(1, -0.35, 6, 2, true) };
const covered = { ...reach, 10: ball(10, 8, 7.5, 2) }; // la blanca 10 (a ~4,5 m del montón, fuera de él) juega antes que la roja 1 y puede tocar a las del montón
const spark = { 1: ball(1, 14.5, 6.5, 2), 3: ball(3, 14.6, 7.4, 2) }; // roja 1 junto a la roja 3
const g1 = gain(reach), g2 = gain(none), g3 = gain(covered), g4 = gain({ ...spark, 3: ball(3, 14.6, 7.4, 2) });
console.log(`   Δ extra por separar las blancas · J1 rival que llega ${g1.toFixed(2)} · J2 sin rival ${g2.toFixed(2)} · J3 con compañera que juega antes ${g3.toFixed(2)} · J4 spark rival ${g4.toFixed(2)}`);
check(g1 >= 0.3, `J1 con un rival que puede llegar al montón, separar las bolas vale ${g1.toFixed(2)} más que antes (≥ 0,3, con heapRisk ${REF})`);
check(Math.abs(g2) <= 0.05, `J2 sin rival que pueda llegar, el premio por separar no cambia (${g2.toFixed(2)})`);
check(g3 <= 0.6 * g1, `J3 con una compañera que juega antes y puede moverlas, separar vale menos que sin ella (${g3.toFixed(2)} contra ${g1.toFixed(2)})`);
check(g4 >= 0.3, `J4 con un rival que puede mandar una bola suya al montón con spark, separar vale ${g4.toFixed(2)} más que antes (≥ 0,1)`);
const coveredFar = { ...reach, 10: ball(10, 3, 6, 2) }; // la blanca 10 a ~8 m del montón: ahí su certeza importa
const g5a = gain(coveredFar, 0.6), g5b = gain(coveredFar, 2.5);
console.log(`   J5 certeza de la compañera que juega antes: certera ${g5a.toFixed(2)} · torpe ${g5b.toFixed(2)}`);
check(g5a < g5b, `J5 con una compañera certera separar vale menos que con una torpe (${g5a.toFixed(2)} contra ${g5b.toFixed(2)}): con compañeras certeras, juntarse rinde más`);
// El término escala con el peso: con la mitad del peso, la mitad del efecto (±25 %); y con peso 0 desaparece
const gHalf = gain(reach, 1, REF / 2), gZero = gain(reach, 1, 0);
console.log(`   escala con heapRisk: ${REF} → ${g1.toFixed(2)} · ${REF / 2} → ${gHalf.toFixed(2)} · 0 → ${gZero.toFixed(2)}`);
check(Math.abs(gHalf - g1 / 2) <= 0.25 * g1, `con la mitad del peso, la mitad del efecto (${gHalf.toFixed(2)} contra ${(g1 / 2).toFixed(2)})`);
check(Math.abs(gZero) <= 0.01, `con heapRisk 0 el término desaparece (${gZero.toFixed(2)})`);
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
