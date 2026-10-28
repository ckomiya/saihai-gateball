// Certeza del nivel «Kantoku IA» = buen jugador humano (Chris, 2026-10-26): un kantoku real, sin una certeza demasiado alta, no pide un touch a una bola rival que está algo lejos y pegada a la línea (es demasiado
// arriesgado: si falla, su bola puede salir o quedar a merced del rival). Con tirador de certeza normal:
//  A  bola rival pegada a la línea a distancia media (6-8 m) o larga (11-12 m): no intenta el touch (≤ 15 % de las veces). La certeza sola no basta (con ella el touch a 6,5 m se intenta 20/24: vale 3,3 y el spark la saca):
//     por eso hay una regla fija (`kantokuLineTouchMaxM`, 5 m) para bolas pegadas a la línea;
//  B  la misma bola cerca (3 m): sí la ataca (≥ 60 %), la certeza nueva no la vuelve pasiva;
//  C  valor claro: una bola rival en la línea lista para el poste y con 4 puntos sí vale el riesgo: el intento sigue permitido.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const NEW = { ...kantokuLevelErrors(), rivalIsHuman: true };
const OLD = { base: CONFIG.kantokuBaseError, executionScale: 0.4, planningScale: 0.4, rivalIsHuman: true };
const normal = { short: 1, medium: 1, long: 1 };

/** Veces (de N) que el primer golpe de la blanca 2 intenta tocar la bola rival `target` (la decisión sin error). */
function attempts(b: BallState[], target: number, errors: typeof NEW, N: number, seed: number) {
  let n = 0;
  for (let t = 0; t < N; t++) {
    const m = Match.fromBalls(b, { turn: 1, rng: mulberry32(seed + t) });
    m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
    m.profiles = m.profiles.map(() => ({ ...normal }));
    const plan = cpuPlan(m, 3, { brain: kantokuBrain, errors, explain: true });
    if (plan.decision?.intended.touched.includes(target)) n++;
  }
  return n;
}
const N = 24;
const shooter = ball(2, 12, 7, 3);
const withoutRule = <T>(f: () => T): T => { const k = CONFIG.kantokuLineTouchMaxM; CONFIG.kantokuLineTouchMaxM = 99; try { return f(); } finally { CONFIG.kantokuLineTouchMaxM = k; } };
for (const [label, red] of [['6,5 m', ball(1, 12, 0.5, 2)], ['8 m', ball(1, 7, 0.5, 2)], ['12 m', ball(1, 3, 0.5, 2)]] as const) {
  const b = board({ 2: shooter, 1: red });
  const nw = attempts(b, 1, NEW, N, 100), od = attempts(b, 1, OLD, N, 100), sin = withoutRule(() => attempts(b, 1, NEW, N, 100));
  console.log(`   bola rival en la línea a ${label}: certeza nueva ${nw}/${N} · certeza anterior ${od}/${N} · certeza nueva sin la regla de la línea ${sin}/${N}`);
  check(nw <= 0.15 * N, `A bola rival pegada a la línea a ${label}: con la certeza nueva casi no intenta el touch (${nw}/${N})`);
}
{
  const b = board({ 2: shooter, 1: ball(1, 12, 0.5, 2) });
  const sin = withoutRule(() => attempts(b, 1, NEW, N, 100));
  check(sin >= 0.4 * N, `A ... y la prueba discrimina: sin la regla de la línea, a 6,5 m lo intenta ${sin}/${N} (la certeza sola no basta: el touch vale 3,3 + el spark que la saca)`);
}
{
  const near = board({ 2: ball(2, 12, 3.5, 3), 1: ball(1, 12, 0.5, 2) });
  const nw = attempts(near, 1, NEW, N, 300);
  check(nw >= 0.6 * N, `B la misma bola a 3 m: la ataca (${nw}/${N})`);
}
{
  // C. valor claro: la bola rival en la línea ya suma 4 puntos y va al poste; vale el riesgo
  const valuable = board({ 2: shooter, 1: ball(1, 12, 0.5, 4, 4) });
  const nw = attempts(valuable, 1, NEW, N, 400);
  console.log(`   C bola rival en la línea a 6,5 m lista para el poste con 4 puntos: la ataca ${nw}/${N}`);
  check(nw >= 0.4 * N, `C valor claro (lista para el poste, 4 puntos): el intento sigue permitido (${nw}/${N})`);
}
void kantokuLevelBase;
process.exit(fail ? 1 : 0);
