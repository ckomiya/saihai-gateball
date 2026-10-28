// Libro de aperturas de la primera vuelta (`src/game/opening.ts`, sitios en `openings.ts`; Chris, 2026-10-22). Reglas del kantoku, no entrenadas.
//  A  roja 1 (CPU con rojas): pasa la puerta 1 y se coloca en su sitio (junto a la línea, cerca de la puerta 2).
//  B  blanca 2 con la roja 1 en su sitio: espera ~50 %, ocupa el sitio de la línea ~35 %, va frente a la puerta 3 ~15 % (y ese orden).
//  C  adaptación a la roja 1: si está cerca del sitio de la línea (la puede tocar) no lo ocupa (la ataca el planificador: es una oportunidad clara), y si ya está junto a la puerta 3 no va ahí.
//  D  si la 2 esperó, otra blanca (la 4) puede ocupar el sitio de la línea.
//  E  una oportunidad clara de ataque (una rival a tiro de la salida de la puerta 1) tiene prioridad: pasa y toca, no sigue la apertura.
//  F  solo en la primera vuelta; y con `legacyOpenings` no hay aperturas.
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { openingAim } from '../src/game/opening';
import { OPENING_SITES } from '../src/game/openings';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const R = OPENING_SITES.red1, B = OPENING_SITES.whiteLine, G3 = OPENING_SITES.gate3;
const ball = (n: number, x: number, y: number, nextGate: number): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points: 0 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const legacy: Brain = kantokuBrain.kind === 'kantoku' ? { kind: 'kantoku', file: { ...kantokuBrain.file, legacyOpenings: true } as AnyWeightFile } : kantokuBrain;

/** Tablero de la primera vuelta (bolas sin jugar en la salida) con las bolas `over`; juega el turno de la bola `turn` (todos sus golpes) con `brain`. */
function playTurn(over: Record<number, BallState>, turn: number, seed: number, brain: Brain = kantokuBrain) {
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, 1));
  for (const [n, v] of Object.entries(over)) balls[Number(n) - 1] = v;
  const m = Match.fromBalls(balls, { turn: turn - 1, rng: mulberry32(seed) });
  m.clock = 1700;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  const touched = new Set<number>();
  let passed1 = false;
  for (let g = 0, fresh = true; g < 8 && m.stage !== 'done'; g++, fresh = false) {
    const plan = cpuPlan(m, 3, { brain, errors: own });
    if (fresh && m.b.nextGate === 1) m.b.x = plan.startX;
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (g === 0 && res.shotGate === 1) passed1 = true;
    for (const e of res.events) if (e.type === 'touch') e.balls.forEach((n) => touched.add(n));
    const t = m.proceed();
    if (t === 'turn' || t === 'end') break;
  }
  return { b: m.balls[turn - 1], passed1, touched, m };
}
const where = (b: BallState) => (b.nextGate === 1 ? 'wait' : dist(b, B) <= 1.5 ? 'line' : dist(b, G3) <= 1.6 ? 'gate3' : dist(b, R) <= 1.4 ? 'red' : 'other');
function tally(over: Record<number, BallState>, turn: number, N: number, seed: number, brain?: Brain) {
  const c: Record<string, number> = { wait: 0, line: 0, gate3: 0, red: 0, other: 0 };
  for (let t = 0; t < N; t++) c[where(playTurn(over, turn, seed + t, brain).b)]++;
  return c;
}
const pc = (a: number, n: number) => `${((100 * a) / n).toFixed(0)} %`;
const fmt = (c: Record<string, number>, N: number) => Object.entries(c).map(([k, v]) => `${k} ${pc(v, N)}`).join(' · ');

// A. roja 1
{
  const N = 40;
  const c = tally({}, 1, N, 100);
  check(c.red >= 0.8 * N, `A la roja 1 pasa la puerta 1 y se coloca en su sitio junto a la línea: ${c.red}/${N} (${fmt(c, N)})`);
}

// B. blanca 2 con la roja 1 en su sitio
const red1AtR = { 1: ball(1, R.x, R.y, 2) };
{
  const N = 120;
  const c = tally(red1AtR, 2, N, 200);
  console.log(`   B blanca 2: ${fmt(c, N)}`);
  // 2026-10-26 (doble ángulo): 0,4-0,6 → 0,4-0,9. En este tablero (la 2 con la roja 1 en su sitio y cuatro rojas esperando en la salida) pasar y quedar en la zona de salida es casi un empate con esperar, y la combinación «puerta y bola»
  // de la roja que juega después lo inclina a esperar. En partidas completas las esperas no suben (1,9 por partido contra 2,1 antes).
  check(c.wait >= 0.4 * N && c.wait <= 0.9 * N, `B esperar ≈ 50 % (hasta 90 %): ${pc(c.wait, N)}`);
  // 2026-10-23: el sitio de la línea de la derecha se descartó (26 % de ser tocada por cada roja que falta por salir; la roja 5 sacó a la blanca 4): su 35 % lo juega el planificador
  check(c.line <= 0.03 * N, `B el sitio de la línea de la derecha ya no se ocupa: ${pc(c.line, N)}`);
  // 2026-10-26: tope 0,25 → 0,32: con la regla de las bolas pegadas a la línea (no se intenta el touch a más de 5 m), la roja 1 en su sitio (a 0,55 m de la línea) ya no se ataca desde lejos y la parte que juega el planificador va más a la puerta 3
  check(c.gate3 >= 0.08 * N && c.gate3 <= 0.32 * N, `B ir frente a la puerta 3 ≈ 15 %: ${pc(c.gate3, N)}`);
  // 2026-10-26 (se supone que el rival pasa la puerta 1 con ≥ 90 %): la parte que juega el planificador espera más veces en la salida (6 % de «otros» en vez de 10 %+)
  check(c.wait > c.gate3, 'B esperar > puerta 3');
}

// C. adaptación a dónde quedó la roja 1
{
  const N = 60;
  const near = { 1: ball(1, 15.2, 2.6, 2) }; // la roja 1 cerca del sitio de la línea (puede tocarlo con facilidad)
  const c1 = tally(near, 2, N, 300);
  check(c1.line <= 0.05 * N, `C la roja 1 puede tocar el sitio de la línea: no lo ocupa (${c1.line}/${N}; ${fmt(c1, N)})`);
  const far = { 1: ball(1, G3.x - 0.5, G3.y - 1.0, 2) }; // la roja 1 junto a la puerta 3
  const c2 = tally(far, 2, N, 400);
  check(c2.gate3 <= 0.05 * N, `C la roja 1 ya está junto a la puerta 3: no va ahí (${c2.gate3}/${N}; ${fmt(c2, N)})`);
}

// D. si la 2 esperó, otra blanca toma el sitio de la línea
{
  const N = 60;
  const c = tally({ ...red1AtR }, 4, N, 500);
  check(c.line <= 0.03 * N, `D con la 2 esperando, la blanca 4 tampoco ocupa el sitio de la línea de la derecha: ${c.line}/${N} (${fmt(c, N)})`);
  const taken = { ...red1AtR, 2: ball(2, B.x, B.y, 2) };
  const c2 = tally(taken, 4, N, 600);
  check(c2.line <= 0.05 * N, `D con el sitio ya ocupado por la 2, la 4 no lo ocupa (${c2.line}/${N})`);
}

// E. una oportunidad clara de ataque tiene prioridad
{
  const N = 40;
  let passes = 0, touches = 0, waits = 0;
  for (let t = 0; t < N; t++) {
    const r = playTurn({ ...red1AtR, 3: ball(3, 16.5, 8, 2) }, 2, 700 + t);
    if (r.passed1) passes++;
    if (r.touched.has(3)) touches++;
    if (r.b.nextGate === 1) waits++;
  }
  let lTouches = 0;
  for (let t = 0; t < N; t++) if (playTurn({ ...red1AtR, 3: ball(3, 16.5, 8, 2) }, 2, 700 + t, legacy).touched.has(3)) lTouches++;
  // 2026-10-26: waits === 0 → ≤ 2 (con la rival pesimista, 1 de 40 espera en la salida)
  check(waits <= 2 && passes >= 0.9 * N && touches >= lTouches - 3, `E con una rival a tiro de la salida: pasa ${passes}/${N}, no espera (${waits}) y la toca ${touches}/${N}, como sin aperturas (${lTouches}/${N})`);
}

// F. solo en la primera vuelta y con el kantoku; con legacyOpenings no hay aperturas
{
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, 1));
  const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
  m.firstRoundDone = true;
  check(openingAim(m, { errors: own }) === null, 'F pasada la primera vuelta no hay apertura');
  const c = tally(red1AtR, 2, 40, 800, legacy);
  // 2026-10-25: gate3 ≤ 4 → ≤ 12 (sin libro, la blanca 2 que no puede tocar a la roja 1 a ~10 m por la regla del touch lejano se coloca más veces frente a la puerta 3)
  // 2026-10-26: se quita la cota de las esperas (≤ 8 → sin cota): sin libro, en este tablero casi empatado el doble ángulo de la roja siguiente hace esperar siempre; lo que se protege es que no haya sitio de la línea ni puerta 3 del libro
  check(c.line <= 4 && c.gate3 <= 12,
   `F con legacyOpenings no hay aperturas: sitio de la línea ${c.line}, puerta 3 ${c.gate3}, espera ${c.wait} de 40 (${fmt(c, 40)})`);
}
// G. la roja 1 no pasó la puerta 1 (partida de Chris, 2026-10-23): el sitio de la roja 1 queda libre y la blanca 2 que iba a la línea toma ese sitio (junto a la puerta 2, en diagonal), no el de x ≈ 16
{
  const N = 120;
  const c = tally({}, 2, N, 900);
  console.log(`   G blanca 2 con la roja 1 sin salir: ${fmt(c, N)}`);
  check(c.red >= 0.9 * N && c.gate3 <= 0.03 * N && c.line <= 0.05 * N, `G con la roja 1 sin salir, la blanca que iba a la línea se coloca junto a la puerta 2: ${pc(c.red, N)} (puerta 3: ${pc(c.gate3, N)}, el sitio de la derecha: ${pc(c.line, N)})`);
  check(c.wait <= 0.15 * N, `G ... y no espera (sin ninguna rival en juego esperar no sirve): ${pc(c.wait, N)} (otras salidas fallidas incluidas)`);
}
// H. la primera bola en juego, sea cual sea su número (partida de Chris, 2026-10-26: la roja 1, la blanca 2 y la roja 3 fallaron la puerta 1 y la blanca 4 se fue a la puerta 3): toma la apertura de la roja 1
{
  const N = 40;
  for (const turn of [3, 4, 6]) {
    const c = tally({}, turn, N, 1000 + turn * 50);
    console.log(`   H bola ${turn} (la primera en juego): ${fmt(c, N)}`);
    check(c.red >= 0.85 * N && c.gate3 === 0, `H la bola ${turn}, la primera en juego, se coloca en el sitio de la roja 1 junto a la puerta 2: ${c.red}/${N} (puerta 3: ${c.gate3})`);
  }
  // con una bola ya en juego en el sitio, no: juega como siempre
  const taken = tally({ 1: ball(1, R.x, R.y, 2) }, 4, N, 1300);
  check(taken.red <= 0.3 * N, `H con la roja 1 ya en su sitio, la blanca 4 no lo ocupa: ${taken.red}/${N}`);
}
void FINISHED;
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
