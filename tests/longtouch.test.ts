// Touch lejano (Chris, 2026-10-25): un kantoku real no se arriesga a tocar una bola lejana (cuanto más lejos, más fácil errar), salvo que el mismo tiro toque varias bolas. Regla fija
// (`kantokuTouchMaxM`, 9 m; `legacyLongTouch` la apaga para comparar):
//  A  una rival sola a 12 m: sin la regla la ataca; con ella, no;
//  B  dos rivales alineadas a 12-13 m (el tiro toca las dos): sí puede atacarlas;
//  C  la rival a 6 m (cerca): la ataca como siempre;
//  D  partido de Chris, golpe 17: la bola 6 recién pasó la puerta 1, su compañera 4 queda expuesta cerca de la salida y la rival 5 está a 10 m: toca a su compañera, no a la rival lejana.
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const legacy: Brain = { kind: 'kantoku', file: { ...(kantokuBrain as { file: AnyWeightFile }).file, legacyLongTouch: true } as AnyWeightFile };

/** Veces (de N) que el primer golpe de la blanca `turn+1` intenta tocar una de las bolas `targets`. */
function attempts(b: BallState[], turn: number, targets: number[], N: number, brain: Brain, seed: number, strokesInTurn = 0) {
  let n = 0;
  for (let t = 0; t < N; t++) {
    const m = Match.fromBalls(b, { turn, rng: mulberry32(seed + t) });
    m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true; m.strokesInTurn = strokesInTurn;
    m.profiles = m.profiles.map((_, i) => ({ ...CONFIG.playerCertainty[Math.floor(i / 2) % CONFIG.playerCertainty.length] })); // la certeza de cada jugador (la bola 4 es «certera de largo»)
    const plan = cpuPlan(m, 3, { brain, errors: own, explain: true });
    if (plan.decision?.intended.touched.some((x) => targets.includes(x))) n++;
  }
  return n;
}
const N = 20;
// Partida de Chris (`tests/fixtures/partidas/partida-20261025-194443-nivel5.json`): golpe 9 (la blanca 4 tira a tocar la roja 3 a 11,8 m) y golpe 17 (la blanca 6 recién pasó la puerta 1, su compañera 4 queda expuesta y la rival 5 está a 10 m)
const LOG = 'tests/fixtures/partidas/partida-20261025-194443-nivel5.json';
const fromLog = (shot: number): BallState[] => JSON.parse(readFileSync(LOG, 'utf8')).shots[shot - 1].before.map((b: { n: number; x: number; y: number; gate: number; out: boolean; pts: number }) => ({ n: b.n, team: (b.n % 2 === 1 ? 0 : 1) as 0 | 1, x: b.x, y: b.y, vx: 0, vy: 0, nextGate: b.gate, outBall: b.out, points: b.pts }));
if (!existsSync(LOG)) { console.log('   omitidas las pruebas A, B y D: falta archivo local ' + LOG + ''); } else {
  // A. una rival sola a ~12 m
  const A = fromLog(9);
  const on = attempts(A, 3, [3], N, kantokuBrain, 100), off = attempts(A, 3, [3], N, legacy, 100);
  check(on === 0 && off >= 0.3 * N, `A una rival sola a 11,8 m: con la regla la ataca ${on}/${N}, sin la regla ${off}/${N}`);
  // B. dos rivales alineadas detrás una de otra (el mismo tiro toca las dos): sí puede atacarlas
  const B = fromLog(9).map((b) => (b.n === 7 ? { ...b, x: 8.36, y: 12.0, nextGate: 2, points: 1 } : b));
  const onB = attempts(B, 3, [3, 7], N, kantokuBrain, 200), offB = attempts(B, 3, [3, 7], N, legacy, 200);
  check(onB >= 0.25 * N, `B dos rivales juntas a 12 m (el tiro toca las dos): puede atacarlas (${onB}/${N}; sin la regla ${offB}/${N})`);
  // D. golpe 17
  const D = fromLog(17);
  const far = attempts(D, 5, [5], N, kantokuBrain, 400, 1); // bola 5 (rival a 10 m)
  const mate = attempts(D, 5, [4], N, kantokuBrain, 400, 1); // bola 4 (su compañera expuesta)
  check(far <= 1 && mate >= 0.8 * N, // 2026-10-26: far 0 → ≤ 1 (con el rebote en 0,35, 1/20 intenta aún el touch lejano: ruido del planificador)
    `D golpe 17: toca a su compañera expuesta ${mate}/${N} y no a la rival lejana ${far}/${N}`);
}
// C. rival cerca
{
  const C = board({ 4: ball(4, 9, 0.6, 2), 3: ball(3, 9, 6.6, 2) });
  const on = attempts(C, 3, [3], N, kantokuBrain, 300), off = attempts(C, 3, [3], N, legacy, 300);
  check(on >= 0.5 * N && Math.abs(on - off) <= 3, `C una rival a 6 m: la ataca igual que antes (${on}/${N} contra ${off}/${N})`);
}
void CONFIG;
process.exit(fail ? 1 : 0);
