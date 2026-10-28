// Regla de ataque (fija, para cualquier kantoku; Chris, 2026-10-25): con una rival cerca de la salida de la puerta que la bola necesita pasar, la bola pasa y ataca (touch con el golpe continuo y spark que saca).
//  - Puerta 1: casi siempre (`continuation.test.ts` la prueba con una y dos rivales cerca de la salida).
//  - Puertas 2 y 3: según la distancia y la probabilidad de acertar. Probabilidad de «pasar y tocar» × spark ≥ `kantokuAttackPlayGate23` (0,6): va; si es muy difícil (por debajo), la regla no interviene y la bola
//    puede elegir otra jugada (la decisión es la misma que sin la regla).
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { attackPlay } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const file = (kantokuBrain as { file: AnyWeightFile }).file;
const brains: [string, Brain][] = [['campeón actual', kantokuBrain]];
if (existsSync('src/game/cpuWeights.next.json')) brains.push(['siguiente (next)', { kind: 'kantoku', file: JSON.parse(readFileSync('src/game/cpuWeights.next.json', 'utf8')) as AnyWeightFile }]);
const legacyOf = (b: Brain): Brain => (b.kind === 'kantoku' ? { kind: 'kantoku', file: { ...b.file, legacyAttackRule: true } as AnyWeightFile } : b);
void file;

/** Turno completo de la blanca 2: ¿pasó su puerta, tocó a la roja y la sacó? */
function turn(b: BallState[], seed: number, brain: Brain) {
  const m = Match.fromBalls(b, { turn: 1, rng: mulberry32(seed) });
  m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  let gate = false, touch = false, out = false;
  let first = '';
  for (let g = 0; g < 10; g++) {
    const plan = cpuPlan(m, 3, { brain, errors: own });
    if (g === 0) first = `${plan.aim.x.toFixed(2)},${plan.aim.y.toFixed(2)}`;
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (res.shotGate > 0) gate = true;
    if (res.touches.length) touch = true;
    for (const e of res.events) if (e.type === 'out' && e.ball % 2 === 1) out = true;
    const t = m.proceed();
    if (t === 'turn' || t === 'end') break;
  }
  return { gate, touch, out, first };
}
const playOf = (b: BallState[]) => {
  const m = Match.fromBalls(b, { turn: 1, rng: mulberry32(1) });
  m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  return attackPlay(b, 1, { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError });
};

const TRIALS = 40;
// Puerta 2 (8, 2, se pasa hacia la izquierda): la blanca en su entrada; la roja cerca de lo que hay más allá (buena) o muy lejos (difícil)
// Puerta 3 (10, 13, hacia la derecha): igual
const SCENES: [string, number, Record<number, BallState>, Record<number, BallState>][] = [
  ['puerta 2', 2, { 2: ball(2, 11, 2.3, 2) }, { 1: ball(1, 4.5, 5.5, 3) }],
  ['puerta 3', 3, { 2: ball(2, 7, 12.8, 3) }, { 1: ball(1, 14.5, 9.5, 2) }],
];
const HARD: Record<string, Record<number, BallState>> = { 'puerta 2': { 1: ball(1, 19, 13, 2) }, 'puerta 3': { 1: ball(1, 1, 2, 2) } };
for (const [name, gate, mine, good] of SCENES) {
  const goodB = board({ ...mine, 2: { ...mine[2], nextGate: gate }, ...good });
  const hardB = board({ ...mine, 2: { ...mine[2], nextGate: gate }, ...HARD[name] });
  const pg = playOf(goodB), ph = playOf(hardB);
  console.log(`   ${name}: probabilidad de pasar y atacar · rival a buena distancia ${pg.toFixed(2)} · rival muy lejos ${ph.toFixed(2)} (umbral ${CONFIG.kantokuAttackPlayGate23})`);
  check(pg >= CONFIG.kantokuAttackPlayGate23 && ph < CONFIG.kantokuAttackPlayGate23, `${name}: con la rival a buena distancia la jugada supera el umbral; con la rival muy lejos, no`);
  for (const [bn, brain] of brains) {
    let g = 0, t = 0, o = 0, same = 0;
    for (let k = 0; k < TRIALS; k++) {
      const r = turn(goodB, 9000 + k, brain);
      if (r.gate) g++;
      if (r.gate && r.touch) t++;
      if (r.out) o++;
      if (turn(hardB, 9500 + k, brain).first === turn(hardB, 9500 + k, legacyOf(brain)).first) same++;
    }
    check(g >= 0.9 * TRIALS && t >= 0.6 * TRIALS, `${bn} · ${name} con la rival a buena distancia: pasa ${g}/${TRIALS}, toca en el mismo turno ${t}/${TRIALS}, saca ${o}/${TRIALS}`);
    if (bn.startsWith('siguiente')) {
      let lg = 0, lt = 0;
      for (let k = 0; k < TRIALS; k++) { const r = turn(goodB, 9000 + k, legacyOf(brain)); if (r.gate) lg++; if (r.gate && r.touch) lt++; }
      console.log(`   ${bn} · ${name} SIN la regla: pasa ${lg}/${TRIALS}, toca ${lt}/${TRIALS} (informativo)`);
    }
    check(same === TRIALS, `${bn} · ${name} con la rival muy lejos la regla no interviene: misma jugada que sin ella en ${same}/${TRIALS}`);
  }
}
process.exit(fail ? 1 : 0);
