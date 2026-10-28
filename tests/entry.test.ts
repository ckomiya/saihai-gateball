// Bola fuera y entrada tapada (Art. 17 cl. 4): un golpe de bola fuera que toca otra bola es FALTA, nunca touch; y el kantoku no debe tirar por una
// entrada en la que el margen de error de su tiro toca una bola.
//  1) Regla en el motor: la bola tocada vuelve a su sitio, la que golpea queda fuera y no hay touch ni spark.
//  2) Entrada tapada: una bola fuera del kantoku con bolas rivales en el camino de entrada; con el error de ejecución del nivel «Kantoku IA»
//     casi nunca debe tocarlas.
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { PLANNER_FLAGS } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import type { Brain } from '../src/game/weights';
import { championV1 } from '../scripts/trainLib';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

/** Diez bolas: todas en la salida salvo las indicadas (n → estado). */
function board(over: Record<number, Partial<BallState>>): BallState[] {
  const sa = { x: 18, y: 15.5 }; // área de salida
  return Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: sa.x, y: sa.y, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));
}

// ---------- 1. La regla ----------
{
  const m = Match.fromBalls(board({ 2: { x: -0.2, y: 6, nextGate: 3, outBall: true, points: 1 }, 1: { x: 1.2, y: 6, nextGate: 2 } }), { turn: 1, rng: () => 0.5 });
  const bars = m.bars();
  let res = m.shoot({ x: 3, y: 6 }, bars.power.sweetSpot, bars.accuracy.sweetSpot);
  for (let i = 0; i < 600 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  const ev = res!.events;
  check(ev.some((e) => e.type === 'strokerOut' && e.foul === 'touchedOther'), 'bola fuera que toca otra bola: es falta');
  check(!ev.some((e) => e.type === 'touch') && res!.touches.length === 0 && res!.next === 'turn', 'no cuenta como touch ni da spark');
  check(Math.abs(m.balls[0].x - 1.2) < 1e-6 && Math.abs(m.balls[0].y - 6) < 1e-6, 'la bola tocada vuelve a su sitio');
  check(m.balls[1].outBall && m.balls[1].x < 0, 'la que golpea queda fuera');
}

// ---------- 2. Entrada tapada ----------
const OUT = { x: -0.2, y: 6 };
const toward = { x: 9, y: 13 }; // hacia la puerta 3
const len = Math.hypot(toward.x - OUT.x, toward.y - OUT.y);
const dir = { x: (toward.x - OUT.x) / len, y: (toward.y - OUT.y) / len };
const at = (t: number, lateral = 0) => ({ x: OUT.x + dir.x * t - dir.y * lateral, y: OUT.y + dir.y * t + dir.x * lateral });
const CASES: [string, Record<number, Partial<BallState>>, boolean][] = [
  // [nombre, bolas, ¿sin el filtro de seguridad el escenario debe dar faltas? (comprueba que la prueba discrimina)]
  ['una bola a 1,5 m en la línea de entrada', { 1: { ...at(1.5), nextGate: 2 } }, false],
  ['una bola a 3 m en la línea de entrada', { 1: { ...at(3), nextGate: 2 } }, false],
  ['dos bolas a 2,5 m dejando 0,5 m de hueco', { 1: { ...at(2.5, -0.45), nextGate: 2 }, 3: { ...at(2.5, 0.45), nextGate: 2 } }, false],
  ['una bola pegada a la entrada, de frente', { 1: { x: 1, y: 6, nextGate: 3 } }, false],
  ['una bola a 6 m con 0,45 m de margen lateral (el pasto y el error la pueden tocar)', { 1: { ...at(6, 0.45), nextGate: 2 } }, true],
  ['una bola a 8 m con 0,5 m de margen lateral', { 1: { ...at(8, -0.5), nextGate: 2 } }, false],
  ['dos bolas a 7 m con 0,8 m de hueco', { 1: { ...at(7, -0.6), nextGate: 2 }, 3: { ...at(7, 0.6), nextGate: 2 } }, false],
];
const TRIALS = 40;

/** Tiros del kantoku desde fuera en el escenario; devuelve cuántos terminan en falta. */
// v1.3: la medición «sin filtro» se hace sin los candidatos de reentrada lejanos (`PLANNER_FLAGS.farEntry`): con ellos rodea la entrada tapada por sí mismo (0 faltas sin filtro) y la prueba dejaría de medir el filtro, que es lo que mide
const V1: Brain = { kind: 'kantoku', file: championV1 };
function foulsIn(over: Record<number, Partial<BallState>>, ci: number, brain: Brain = kantokuBrain) {
  let f = 0;
  for (let t = 0; t < TRIALS; t++) {
    const balls = board({ 2: { ...OUT, nextGate: 3, outBall: true, points: 1 }, ...over });
    const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(9000 + ci * 1000 + t) });
    m.firstRoundDone = true;
    m.clock = 900;
    const plan = cpuPlan(m, 3, { brain, errors: kantokuLevelErrors() });
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 600 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (res!.foul) f++;
  }
  return f;
}

let total = 0, fouls = 0;
CASES.forEach(([name, over, discriminates], ci) => {
  // El filtro se prueba con el v1 (para el que se diseñó: sin filtro hacía faltas); el v2 (campeón actual) además evita estos casos por sí mismo
  PLANNER_FLAGS.safetyFilter = false;
  PLANNER_FLAGS.farEntry = false;
  const without = foulsIn(over, ci, V1);
  PLANNER_FLAGS.safetyFilter = true;
  PLANNER_FLAGS.farEntry = true;
  const f = foulsIn(over, ci);
  const f1 = foulsIn(over, ci, V1);
  total += TRIALS; fouls += f;
  check(f <= 1 && f1 <= 1, `${name}: ${f} faltas en ${TRIALS} tiros del campeón actual y ${f1} del v1 (v1 sin el filtro: ${without})`);
  if (discriminates) check(without >= 1, `  … y sin el filtro de seguridad el v1 sí hace faltas en el escenario (${without} ≥ 1; eran ≥ 3 antes de que el touch apuntara más allá del blanco: elige menos tiros peligrosos): la prueba discrimina`);
});
console.log(`   total con el filtro: ${fouls} faltas en ${total} tiros`);
void CONFIG;
process.exit(fail ? 1 : 0);
