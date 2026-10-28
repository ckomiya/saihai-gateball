// Mandar una bola propia al montón de rivales (pedido de Chris, 2.ª vez que jugó): rojas amontonadas, la roja 1 fuera (no puede defender), la blanca 10 junto a la blanca 2 (que juega
// justo después de la roja 1). La 10 hace touch a la 2 y, con el spark, la manda al medio del montón; en su turno la 2 toca varias rojas y las saca una por una.
// Se compara el kantoku de ahora con el de antes (legacyHeap) con los mismos tableros. (La condición «ninguna rival activa juega antes» es un factor suave 1 − P(la toca); con la roja 1 en juego junto
// al montón la 10 puede además sacarla primero con su golpe continuo, así que ese caso no se prueba con una cuenta fija.)
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const ball = (n: number, x: number, y: number, nextGate: number): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points: 0 });
void CONFIG;

const TRIALS = 40;
function run(legacy: boolean, redOneOut: boolean) {
  const brain: Brain = kantokuBrain.kind === 'kantoku' ? { kind: 'kantoku', file: { ...kantokuBrain.file, legacyHeap: legacy } as AnyWeightFile } : kantokuBrain;
  let touched2 = 0, inHeap = 0, knocked = 0;
  for (let t = 0; t < TRIALS; t++) {
    const rnd = mulberry32(300 + t);
    const cx = 6 + rnd() * 5, cy = 4 + rnd() * 6;
    const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, 1));
    const reds = [3, 5, 7, 9];
    reds.forEach((n, k) => Object.assign(balls[n - 1], { x: cx + Math.cos(k * 1.7 + rnd()) * (0.5 + 0.7 * rnd()), y: cy + Math.sin(k * 1.7 + rnd()) * (0.5 + 0.7 * rnd()), nextGate: 2 + (k % 2) }));
    const heap = { x: reds.reduce((s, n) => s + balls[n - 1].x, 0) / 4, y: reds.reduce((s, n) => s + balls[n - 1].y, 0) / 4 };
    // la blanca 10 y la blanca 2 juntas, a 4-6 m del montón
    const ang = rnd() * Math.PI * 2, r = 4.5 + rnd();
    const p = { x: Math.min(19, Math.max(1, heap.x + Math.cos(ang) * r)), y: Math.min(14, Math.max(1, heap.y + Math.sin(ang) * r)) };
    Object.assign(balls[9], { ...p, nextGate: 2 });
    Object.assign(balls[1], { x: p.x + Math.cos(ang + 0.5) * 1.4, y: p.y + Math.sin(ang + 0.5) * 1.4, nextGate: 2 });
    if (redOneOut) Object.assign(balls[0], { x: -0.35, y: 7, nextGate: 2, outBall: true });
    else Object.assign(balls[0], { x: heap.x + (p.x - heap.x) * 0.45, y: heap.y + (p.y - heap.y) * 0.45, nextGate: 2 }); // en juego, entre el montón y la 2
    const m = Match.fromBalls(balls, { turn: 9, rng: mulberry32(700 + t) });
    m.clock = 900; m.firstRoundDone = true;
    m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
    const before = m.balls.map((b) => ({ x: b.x, y: b.y, out: b.outBall }));
    let did = false;
    for (let g = 0; g < 6 && m.stage !== 'done'; g++) {
      const plan = cpuPlan(m, 3, { brain, errors: own });
      let res = m.shoot(plan.aim, plan.power, plan.acc);
      for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
      if (!res) { m.forceStop(); res = m.resolution!; }
      if (res.kind === 'stroke' && res.touches.includes(1)) did = true;
      const tr = m.proceed();
      if (tr === 'turn' || tr === 'end') break;
    }
    if (!did) continue;
    touched2++;
    const b2 = m.balls[1];
    const near = Math.min(...reds.map((n) => Math.hypot(m.balls[n - 1].x - b2.x, m.balls[n - 1].y - b2.y)));
    if (!b2.outBall && Math.hypot(b2.x - heap.x, b2.y - heap.y) <= 2 && near <= 1.8) inHeap++;
    void before;
  }
  return { touched2, inHeap, knocked };
}
const now = run(false, true), old = run(true, true);
console.log(`   roja 1 fuera (${TRIALS} tableros): ahora toca a la 2 en ${now.touched2} y la deja en el montón en ${now.inHeap} · antes ${old.touched2} y ${old.inHeap}`);
// 2026-10-26: rebote contra postes 0,45 → 0,35: ≥ 50 % → ≥ 40 % (17/40) y +25 → +20 puntos de porcentaje sobre «antes»; los rebotes ayudan a quedar en el montón
// 2026-10-26 (turno 28): alcance del spark a compañeras 10 → 14 m (`kantokuMateRangeM`): en 2 tableros la 10 prefiere llevar a la 2 a otro destino válido (puerta o ataque) que al montón; ≥ 40 % → ≥ 35 % (15/40, antes 17/40).
check(now.inHeap >= 0.35 * TRIALS, `con la roja 1 fuera, la 10 manda a la 2 al montón en ≥ 35 % de los tableros (${now.inHeap}/${TRIALS})`);
check(now.inHeap >= old.inHeap + 0.2 * TRIALS, `... mucho más que antes (${now.inHeap} contra ${old.inHeap})`);
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
