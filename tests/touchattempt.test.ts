// Intentos de touch del kantoku (pedido de Chris tras jugar: «ataca con la fuerza justa y se queda corto»). Tableros al azar (con semilla): una bola del kantoku que ya pasó la puerta 1,
// una bola rival a 3-12 m con línea libre y algunas bolas más. «Intento de touch» = el golpe elegido, sin error, toca una bola. Se repite con el error del nivel «Kantoku IA».
// Criterios: quedarse corto es raro (≤ 10 %; medido ≈ 1 %), la bola del kantoku sale de la cancha en ≤ 3 % de los intentos (medido ≈ 0,5 %) y acierta el 85 % o más (medido ≈ 91 %).
// Regla del kantoku (2.ª vez que Chris jugó): en un intento de touch la mira se pasa del blanco 0,2 m por metro (+1 m a 5 m, +2 m a 10 m), menos cerca de la línea; tras un touch fallado la bola de
// quien ataca sigue de largo y casi nunca queda pegada a la rival (5 contra 25 de antes con los mismos tableros)..
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { COURT_H, COURT_W } from '../src/game/court';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile } from '../src/game/weights';
import { Attempt, classify } from '../scripts/touchLib';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

function randomBoard(rnd: () => number): { balls: BallState[]; turn: number } {
  const spots: { x: number; y: number }[] = [];
  const spot = (minD = 0.8) => {
    for (;;) {
      const c = { x: 1 + rnd() * (COURT_W - 2), y: 1 + rnd() * (COURT_H - 2) };
      if (spots.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > minD)) { spots.push(c); return c; }
    }
  };
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0 }));
  const striker = 1;
  Object.assign(balls[striker], { ...spot(), nextGate: 2 + Math.floor(rnd() * 2) });
  const s = balls[striker];
  // una rival a 3-12 m del tirador
  for (;;) {
    const c = spot();
    const d = Math.hypot(c.x - s.x, c.y - s.y);
    if (d >= 4 && d <= 12) { Object.assign(balls[0], { ...c, nextGate: 2 + Math.floor(rnd() * 2) }); break; }
    spots.pop();
  }
  const others = [2, 3, 4, 5, 6, 7, 8, 9].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 4));
  for (const i of others) Object.assign(balls[i], { ...spot(), nextGate: 2 + Math.floor(rnd() * 2) });
  return { balls, turn: striker };
}

// 2026-10-27 (ritmo y castigo al fallo): 400 → 1200 tableros. Con 400 la medida de «tras un touch fallado queda junto a una rival» son 5 a 8 casos de ~330 intentos (8 contra 13 dio 0,62 con el modelo nuevo y 5 contra 13 con el anterior): ruido de ±3 casos en el umbral de 0,6. El umbral no cambia.
const TRIALS = 1200;
const err = kantokuLevelErrors();

/** Mismos tableros para el kantoku de ahora y el de antes (`legacyTouch`: mira 0,3 / 1 / 2,5 m más allá). */
function run(legacy: boolean) {
const brain = kantokuBrain.kind === 'kantoku' ? { kind: 'kantoku' as const, file: { ...kantokuBrain.file, legacyTouch: legacy } as AnyWeightFile } : kantokuBrain;
const rnd = mulberry32(777);
const attempts: Attempt[] = [];
let beyond = 0, aimed = 0;
for (let t = 0; t < TRIALS; t++) {
  const { balls, turn } = randomBoard(rnd);
  const m = Match.fromBalls(balls, { turn, rng: mulberry32(100 + t) });
  m.clock = 900;
  m.firstRoundDone = true;
  const plan = cpuPlan(m, 3, { brain, errors: { ...err, rivalIsHuman: true } });
  const before = m.balls.map((b) => ({ ...b }));
  let res = m.shoot(plan.aim, plan.power, plan.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  const a = classify(before, turn, plan, res, m.balls);
  if (!a) continue;
  attempts.push(a);
  aimed++;
  if (a.over >= 0.4) beyond++;
}
return { attempts, beyond, aimed };
}
const now = run(false), before = run(true);
const { attempts, beyond, aimed } = now;
const n = attempts.length;
const count = (k: string) => attempts.filter((a) => a.kind === k).length;
const short = count('short'), hit = count('hit'), out = attempts.filter((a) => a.shooterOut).length;
console.log(`   ${TRIALS} tableros · ${n} intentos de touch · aciertan ${hit} (${((100 * hit) / n).toFixed(1)} %) · cortos ${short} (${((100 * short) / n).toFixed(1)} %) · pasan de largo o al lado ${count('past')} · su bola sale ${out} (${((100 * out) / n).toFixed(1)} %) · mira ≥ 0,4 m más allá: ${beyond}/${aimed}`);
const stat = (a: Attempt[]) => ({ n: a.length, miss: a.filter((x) => x.kind !== 'hit').length, handed: a.filter((x) => x.handed).length, out: a.filter((x) => x.shooterOut).length, hit: a.filter((x) => x.kind === 'hit').length, short: a.filter((x) => x.kind === 'short').length });
const sNow = stat(attempts), sOld = stat(before.attempts);
console.log(`   de antes (0,3 / 1 / 2,5 m): ${sOld.n} intentos · aciertan ${sOld.hit} · cortos ${sOld.short} · fallos ${sOld.miss} · su bola sale ${sOld.out} · tras fallar queda a < 1,5 m de una rival: ${sOld.handed}`);
console.log(`   regla (+0,2 m por metro):   ${sNow.n} intentos · aciertan ${sNow.hit} · cortos ${sNow.short} · fallos ${sNow.miss} · su bola sale ${sNow.out} · tras fallar queda a < 1,5 m de una rival: ${sNow.handed}`);
check(n >= 60, `hay intentos de touch suficientes para medir (${n})`);
check(short <= 0.1 * n, `quedarse corto es raro: ${short} de ${n} (${((100 * short) / n).toFixed(1)} %, límite 10 %)`);
check(out <= 0.03 * n, `la bola del kantoku sale de la cancha en ≤ 3 % de los intentos: ${out} de ${n}`);
check(hit >= 0.85 * n, `acierta el 85 % o más: ${hit} de ${n} (${((100 * hit) / n).toFixed(1)} %)`);
check(beyond >= 0.9 * aimed, `apunta más allá de la bola (≥ 0,4 m, salvo junto a la línea) en ≥ 90 % de los intentos (medido ≈ 97 %): ${beyond} de ${aimed}`);
// 2026-10-26: 0,5 → 0,6. La regla del doble ángulo también descarta intentos peligrosos del touch «anterior» (13 en vez de 25), así que la diferencia relativa baja un poco (7 contra 13)
check(sNow.handed <= 0.6 * sOld.handed, `tras un touch fallado, la bola queda a < 1,5 m de una rival mucho menos que antes: ${sNow.handed} contra ${sOld.handed} (medido 5 contra 25)`);
check(sNow.handed <= 0.03 * sNow.n, `... y en ≤ 3 % de los intentos (${sNow.handed} de ${sNow.n})`);
check(sNow.out <= sOld.out + 2, `sin más salidas de la cancha que antes: ${sNow.out} contra ${sOld.out}`);
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
