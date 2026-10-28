// Turno 28 (partida 20261026-162635): el spark que acomoda a una compañera se mide por quedar DENTRO de la zona desde donde pasa su puerta (`scoreProbability` ≥ `kantokuZonePassP`, la zona de entrada de `zones.ts`),
// no en un punto exacto. La 8 tocó a la 10 y el kantoku la mandó a atacar a la roja 7 en vez de dejarla frente al 2º arco junto a la 4. Causas (con los números del registro): la regla del doble ángulo descartaba todos
// los destinos de zona (bola y bola 0,22-0,28 contra 0,20) y `juntarse` los castigaba con −1,14 aunque las dos esperan el mismo arco (un flujo de puntos); además esos candidatos competían con pocas muestras.
// `legacyZoneSpark` vuelve a lo de antes.
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { scoreProbability } from '../src/game/certainty';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const T28 = [[1, 2.429, 1.529, 3, 0, 2], [2, 13.244, 13.878, 2, 0, 1], [3, 6.228, -0.35, 3, 1, 2], [4, 9.963, 1.882, 2, 0, 1], [5, 14.195, 0.043, 3, 0, 2], [6, 2.882, 11.158, 2, 0, 1], [7, 19.029, 15.079, 4, 0, 3], [8, 10.388, 14.585, 2, 0, 1], [9, 15.628, -0.35, 3, 1, 1], [10, 10.573, 14.509, 2, 0, 1]];
const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };
const N = 12;

function run(legacy: boolean) {
  let front = 0, inZone = 0;
  for (let s = 0; s < N; s++) {
    const m = Match.fromBalls(mk(T28), { turn: 7, rng: mulberry32(70 + s), sparkBall: 9 });
    m.clock = 1090; m.turnStarts = 40; m.firstRoundDone = true;
    const brain = { kind: 'kantoku', file: { ...(kantokuBrain as any).file, ...(legacy ? { legacyZoneSpark: true } : {}) } } as any;
    const plan = cpuPlan(m, 3, { brain, errors });
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    const b = m.balls[9];
    if (Math.hypot(b.x - 10.5, b.y - 2.2) <= 2.5) front++;
    if (!b.outBall && scoreProbability(b, b.nextGate, CONFIG.humanRivalError, true) >= CONFIG.kantokuZonePassP) inZone++;
  }
  return { front, inZone };
}
const now = run(false), old = run(true);
check(now.front >= 0.75 * N, `T28: la 10 queda frente al 2º arco en ${now.front} de ${N} (antes ${old.front} de ${N})`);
check(now.inZone > old.inZone, `T28: la 10 queda dentro de su zona de entrada (pasa ≥ ${CONFIG.kantokuZonePassP * 100} %) en ${now.inZone} de ${N} (antes ${old.inZone})`);
process.exit(fail ? 1 : 0);
