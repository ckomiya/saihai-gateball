// Agari (上がり: llegar al poste y salir del juego) — Chris, 2026-10-23: llevar la bola al poste muy pronto es una desventaja (el equipo queda con menos bolas para atacar, defender y hacer tsunagi, y el rival
// avanza sin peligro); el momento normal es la última o penúltima vuelta de esa bola. Regla del kantoku (`kantokuAgariTurns` = 2, el turno actual cuenta; `legacyAgari` la apaga para comparar):
//  A  una bola lista para el poste (a 3 m, con buena línea) con muchos turnos por delante no va;
//  B  con 2 turnos o menos, sí va;
//  C  excepciones: el poste da el juego perfecto (25 puntos); la bola será sacada casi seguro en cualquier alternativa; es la última bola del equipo y el partido ya está decidido
//     (y como control, la misma posición con el partido sin decidir: no va).
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { ballThreat } from '../src/game/cpuPlanner';
import { upcomingTurns } from '../src/game/phase';
import { kantokuBrain } from '../src/game/kantoku';
import { turnsLeft } from '../src/game/phase';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const ball = (n: number, x: number, y: number, nextGate: number, points = 0): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const legacy: Brain = kantokuBrain.kind === 'kantoku' ? { kind: 'kantoku', file: { ...kantokuBrain.file, legacyAgari: true } as AnyWeightFile } : kantokuBrain;

/** Veces (de N) que la blanca 2 llega al poste en su turno con ese tablero y ese reloj. */
function agariRate(over: Record<number, BallState>, clock: number, N: number, seed: number, brain: Brain = kantokuBrain) {
  let done = 0, left = 0;
  for (let t = 0; t < N; t++) {
    const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
    for (const [n, v] of Object.entries(over)) balls[Number(n) - 1] = v;
    const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(seed + t) });
    m.clock = clock; m.firstRoundDone = true;
    m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
    left = turnsLeft(m);
    for (let g = 0; g < 4 && m.stage !== 'done'; g++) {
      const plan = cpuPlan(m, 3, { brain, errors: own });
      let res = m.shoot(plan.aim, plan.power, plan.acc);
      for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
      if (!res) { m.forceStop(); res = m.resolution!; }
      const tr = m.proceed();
      if (tr === 'turn' || tr === 'end') break;
    }
    if (m.balls[1].nextGate === FINISHED) done++;
  }
  return { done, N, left };
}
const show = (r: { done: number; N: number; left: number }) => `${r.done}/${r.N} (le quedan ${r.left} turnos al reloj)`;

// Tablero base: la blanca 2 lista para el poste (a 3 m, de frente)
const ready = { 2: ball(2, 12.8, 7.5, 4, 3), 4: ball(4, 18, 15.5, 1), 6: ball(6, 18, 15.5, 1), 1: ball(1, 1.2, 1.2, 2, 1), 3: ball(3, 1.2, 13.8, 2, 1) }; // compañeras en la salida y rojas lejos: nada más atractivo que el poste

// A. muchos turnos por delante: no va
const a = agariRate(ready, 1500, 30, 100), aL = agariRate(ready, 1500, 30, 100, legacy);
check(a.left > 2 && a.done <= 0.1 * a.N, `A con muchos turnos por delante no va al poste: ${show(a)} (sin la regla: ${aL.done}/${aL.N})`);
check(aL.done >= 0.5 * aL.N, `A ... y sin la regla sí iba (${aL.done}/${aL.N}): la prueba discrimina`);

// B. con 2 turnos o menos: va
const b = agariRate(ready, 100, 30, 200);
check(b.left <= 2 && b.done >= 0.6 * b.N, `B con 2 turnos o menos va al poste: ${show(b)}`);

// C. excepciones
{
  // juego perfecto: las demás blancas ya en meta con 20 puntos, la 2 con 3: el poste da 25
  const perfect = { ...ready, 4: ball(4, 18, 15.5, FINISHED, 5), 6: ball(6, 18, 15.5, FINISHED, 5), 8: ball(8, 18, 15.5, FINISHED, 5), 10: ball(10, 18, 15.5, FINISHED, 5) };
  const c = agariRate(perfect, 1500, 30, 300);
  check(c.left > 2 && c.done >= 0.6 * c.N, `C el poste da el juego perfecto (25 puntos): va aunque falten muchos turnos: ${show(c)}`);
  // la bola será sacada casi seguro: un anillo de rojas a su alrededor; control: sin el anillo no va
  const ring: Record<number, BallState> = { ...ready };
  [[1, 10.2, 5.4], [3, 12.6, 5.2], [5, 14.6, 7.4], [7, 12.6, 9.8], [9, 10.0, 9.6]].forEach(([n, x, y]) => { ring[n] = ball(n, x, y, 2, 1); });
  // La excepción se decide con `ballThreat` (la amenaza sobre la bola de las próximas rivales) frente a `kantokuAgariThreat`. No se puede probar con una decisión: con rojas tan cerca el planificador prefiere atacarlas
  // (también sin la regla), así que se prueba la medida: con el anillo la amenaza supera el límite en la bola y en las posiciones de alrededor; sin el anillo no.
  const threatOf = (over: Record<number, BallState>, at: { x: number; y: number }) => {
    const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
    for (const [n, v] of Object.entries(over)) balls[Number(n) - 1] = v;
    Object.assign(balls[1], at);
    const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
    m.clock = 1500; m.firstRoundDone = true;
    return ballThreat(balls, 1, { team: 1, clock: 1500, noise: 0, rng: mulberry32(2), future: { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError } });
  };
  const spots = [{ x: 12.8, y: 7.5 }, { x: 11.5, y: 7.5 }, { x: 10, y: 6.4 }, { x: 11.2, y: 8.6 }];
  const tRing = Math.min(...spots.map((p) => threatOf(ring, p))), tFree = Math.max(...spots.map((p) => threatOf({ ...ready, 1: ball(1, 18, 2, 2, 1) }, p)));
  console.log(`   C amenaza sobre la bola: con el anillo ${tRing.toFixed(2)} (mínima en 4 posiciones) · sin anillo ${tFree.toFixed(2)} (máxima) · límite ${CONFIG.kantokuAgariThreat}`);
  check(tRing >= CONFIG.kantokuAgariThreat && tFree < 0.5, `C la bola será sacada casi seguro y no tiene dónde protegerse: la excepción se cumple con el anillo (${tRing.toFixed(2)} ≥ ${CONFIG.kantokuAgariThreat}) y no sin él (${tFree.toFixed(2)})`);
  // última bola del equipo y el partido decidido: las blancas 4-10 en meta (4 puntos cada una), la 2 con 3; las rojas casi sin opciones
  const whites = { 4: ball(4, 18, 15.5, FINISHED, 4), 6: ball(6, 18, 15.5, FINISHED, 4), 8: ball(8, 18, 15.5, FINISHED, 4), 10: ball(10, 18, 15.5, FINISHED, 4) };
  const decided = { 2: ready[2], ...whites, 1: ball(1, 18, 15.5, FINISHED, 5), 3: ball(3, 5, 12, 3, 1) };
  const undecided = { 2: ready[2], ...whites, 1: ball(1, 18, 15.5, FINISHED, 5), 3: ball(3, 5, 12, 2, 1), 5: ball(5, 4, 3, 2, 1), 7: ball(7, 6, 5, 2, 1), 9: ball(9, 8, 4, 2, 1) };
  const e = agariRate(decided, 1500, 30, 500), eControl = agariRate(undecided, 1500, 30, 500);
  console.log(`   C última bola: decidido ${show(e)} · sin decidir ${show(eControl)}`);
  check(e.done >= 0.6 * e.N && eControl.done <= 0.1 * eControl.N, `C última bola del equipo y partido decidido: va (${e.done}/${e.N}); sin decidir no (${eControl.done}/${eControl.N})`);
}
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
