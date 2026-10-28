// Salida de la puerta 1 del kantoku. En el gateball real es común y válido dejar una o algunas bolas sin pasar la puerta 1 a propósito (Chris, 2026-10-22); el entrenamiento v3 lo descubrió
// solo. Por eso NO se exige «pasar siempre». Se exige que espere con sentido:
//  S1 oportunidad clara (una rival en juego a tiro de la salida de la puerta 1, con o sin otra): pasa y ataca, no espera (lo mismo que mide continuation.test.ts, con el rival tipo humano);
//  S2 poco tiempo (le quedan ≤ 2 turnos): pasa aunque no haya nada que atacar;
//  S3 necesita puntos (va perdiendo por 9 con pocos turnos): pasa;
//  S4 cuando pasa, no queda a merced de la bola rival siguiente: queda a ≤ 5 m de la salida en ≤ 10 % y la tocan o la sacan en ≤ 35 % (el rival, una persona: pasa su puerta 1 y sigue con el golpe continuo).
// Sin exigencia (solo se imprime): cuánto espera con el tablero vacío y todo el tiempo, sobre todo en la primera vuelta (el campeón de antes casi nunca; el v3 sí, ver `npm run waitdiag -- --human`).
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { turnsLeft } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { championV1 } from '../scripts/trainLib';
import type { Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

const rival: Brain = { kind: 'kantoku', file: championV1 };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const human = { base: CONFIG.humanRivalError };
const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));
const neutral = (m: Match) => { m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })); };

/** Juega el turno de la bola que toca (continuo y spark incluidos); devuelve qué bolas tocó o sacó y si pasó la puerta 1 en el primer golpe. */
function playTurn(m: Match, brain: Brain, errors: object) {
  const touched = new Set<number>(), knocked = new Set<number>();
  let passed1 = false;
  for (let guard = 0, fresh = true; guard < 8; guard++, fresh = false) {
    const plan = cpuPlan(m, 3, { brain, errors: errors as never });
    if (fresh && m.b.nextGate === 1) m.b.x = plan.startX;
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (guard === 0 && res.shotGate === 1) passed1 = true;
    for (const e of res.events) { if (e.type === 'touch') e.balls.forEach((n) => touched.add(n)); if (e.type === 'out') knocked.add(e.ball); }
    const t = m.proceed();
    if (t === 'turn' || t === 'end') break;
  }
  return { touched, knocked, passed1 };
}

/** Veces (de N) que la blanca 2 pasa la puerta 1 en su turno con ese tablero y ese reloj. */
function passRate(over: Record<number, Partial<BallState>>, clock: number, N: number, seed: number, firstRoundDone = true) {
  let passes = 0, left = 0;
  for (let t = 0; t < N; t++) {
    const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(seed + t) });
    m.clock = clock; m.firstRoundDone = firstRoundDone;
    neutral(m);
    left = turnsLeft(m);
    if (playTurn(m, kantokuBrain, own).passed1) passes++;
  }
  return { passes, N, left };
}
const show = (r: { passes: number; N: number; left: number }) => `${r.passes}/${r.N} (le quedan ${r.left} turnos)`;

// S0 (solo informa)
const s0 = passRate({}, 1700, 30, 100);
const s0b = passRate({}, 1700, 30, 150, false);
console.log(`   S0 tablero vacío y tiempo de sobra: pasa ${show(s0)}; en la primera vuelta (nadie ha jugado): pasa ${show(s0b)} (sin exigencia: esperar ahí es la táctica)`);

// S1 oportunidad clara
const s1a = passRate({ 1: { x: 16.5, y: 8, nextGate: 2 } }, 900, 30, 200);
const s1b = passRate({ 1: { x: 16.5, y: 8, nextGate: 2 }, 3: { x: 19, y: 9, nextGate: 2 } }, 900, 30, 300);
check(s1a.passes >= 0.9 * s1a.N, `S1 una rival cerca de la salida: pasa y ataca ${show(s1a)}`);
check(s1b.passes >= 0.9 * s1b.N, `S1 dos rivales cerca de la salida: pasa y ataca ${show(s1b)}`);

// S2 poco tiempo
const s2 = passRate({}, 90, 30, 400);
check(s2.left <= 2 && s2.passes >= 0.9 * s2.N, `S2 poco tiempo, tablero vacío: pasa ${show(s2)}`);

// S3 necesita puntos
const behind = { 1: { x: 6, y: 4, nextGate: 3, points: 3 }, 3: { x: 12, y: 9, nextGate: 3, points: 3 }, 5: { x: 14, y: 5, nextGate: 3, points: 3 } };
const s3 = passRate(behind, 450, 30, 500);
check(s3.left <= 3 && s3.passes >= 0.9 * s3.N, `S3 pierde por 9 con pocos turnos: pasa ${show(s3)}`);

// S4 cuando pasa, no queda a merced de la bola rival siguiente
const TRIALS = 60;
let passes = 0, near = 0, hit = 0;
for (let t = 0; t < TRIALS; t++) {
  const rnd = mulberry32(4000 + t * 13);
  const over: Record<number, Partial<BallState>> = {};
  const k = Math.floor(rnd() * 3); // rojas ya en juego
  const placed: { x: number; y: number }[] = [];
  for (let i = 0; i < k; i++) {
    for (;;) {
      const c = { x: 2 + rnd() * 17, y: 2 + rnd() * 11 };
      if (placed.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 1.2)) { placed.push(c); over[[1, 3, 5][i]] = { ...c, nextGate: 2 }; break; }
    }
  }
  const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(900 + t) });
  neutral(m);
  const mine = playTurn(m, kantokuBrain, own);
  if (!mine.passed1 && m.balls[1].nextGate < 2) continue; // esperó: no se mide aquí
  passes++;
  if (Math.hypot(m.balls[1].x - 18, m.balls[1].y - 11) <= 5) near++;
  if (m.turn === 2 && m.stage !== 'done') {
    const r = playTurn(m, rival, human);
    if (r.touched.has(2) || r.knocked.has(2) || m.balls[1].outBall) hit++;
  }
}
const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;
console.log(`   ${TRIALS} salidas: pasa ${passes} · queda a ≤ 5 m de la salida ${near} (${pc(near, passes)}) · el rival tipo humano la toca o la saca ${hit} (${pc(hit, passes)})`);
check(passes >= 10, `hay salidas suficientes para medir (${passes})`);
check(near <= 0.1 * passes, `S4 cuando pasa, queda a ≤ 5 m de la salida en ≤ 10 % (${pc(near, passes)})`);
check(hit <= 0.35 * passes, `S4 ... y la siguiente bola rival la toca o la saca en ≤ 35 % (${pc(hit, passes)})`);
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
