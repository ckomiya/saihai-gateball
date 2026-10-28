// Golpe continuo del kantoku (v2): con una bola rival cerca de la salida de la puerta 1, pasar la puerta es lo bueno (el golpe continuo deja atacar primero:
// touch y spark para sacar la bola rival), no un peligro. La generación 42 del afinado, sin la corrección, pasaba la puerta 1 solo el 40 % (33 % con dos rivales).
//  - pasa la puerta 1 en casi todos los intentos y
//  - con la bola rival a tiro, la toca en el mismo turno en la mayoría.
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));

/** Turno completo de la bola 2 (la del kantoku): ¿pasó la puerta 1, tocó a un rival y cuántas bolas rivales sacó de la cancha en el turno? */
function turn(over: Record<number, Partial<BallState>>, seed: number, brain: Brain) {
  const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(seed) });
  let gate = false, touch = false;
  const out = new Set<number>();
  for (let guard = 0; guard < 10; guard++) {
    const plan = cpuPlan(m, 3, { brain, errors: kantokuLevelErrors() });
    if (guard === 0 && m.b.nextGate === 1) m.b.x = plan.startX;
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (res.shotGate === 1) gate = true;
    if (res.touches.length) touch = true;
    for (const e of res.events) if (e.type === 'out' && e.ball % 2 === 1) out.add(e.ball); // bolas rivales (impares) sacadas
    const t = m.proceed();
    if (t === 'turn' || t === 'end') break;
  }
  return { gate, touch, out: out.size };
}

const TRIALS = 60;
const CASES: [string, Record<number, Partial<BallState>>][] = [
  ['una bola rival cerca de la salida', { 1: { x: 16.5, y: 8, nextGate: 2 } }],
  ['dos bolas rivales cerca de la salida', { 1: { x: 16.5, y: 8, nextGate: 2 }, 3: { x: 19, y: 9, nextGate: 2 } }],
];
const brains: [string, Brain][] = [['campeón actual', kantokuBrain], ['campeón con las reglas avanzadas', { kind: 'kantoku', file: { ...(kantokuBrain as { file: AnyWeightFile }).file, advanced: true } as AnyWeightFile }]];
if (existsSync('src/game/cpuWeights.next.json')) brains.push(['siguiente (next)', { kind: 'kantoku', file: JSON.parse(readFileSync('src/game/cpuWeights.next.json', 'utf8')) as AnyWeightFile }]);
for (const [bn, brain] of brains) {
  const touchRate: number[] = [];
  CASES.forEach(([name, over], ci) => {
    let g = 0, t = 0, o1 = 0, o2 = 0;
    for (let k = 0; k < TRIALS; k++) {
      const r = turn(over, 4000 + ci * 100 + k, brain);
      if (r.gate) g++;
      if (r.gate && r.touch) t++;
      if (r.out >= 1) o1++;
      if (r.out >= 2) o2++;
    }
    touchRate.push(t);
    // El campeón actual debe además tocar al rival en la mayoría; el archivo siguiente (en estudio) solo debe pasar la puerta 1
    const touchOk = t >= 0.6 * TRIALS; // con la regla de ataque (2026-10-25) también el candidato tiene que atacar
    check(g >= 0.9 * TRIALS && touchOk, `${bn} · ${name}: pasa la puerta 1 en ${g}/${TRIALS}, toca a un rival en el mismo turno en ${t}/${TRIALS}, saca al menos una en ${o1}/${TRIALS} y las dos en ${o2}/${TRIALS}`);
  });
  // Con dos rivales la oportunidad es mayor (tras el spark hay otro golpe para ir por la segunda): atacar no debe bajar claramente
  check(touchRate[1] >= touchRate[0] - 0.1 * TRIALS, `${bn}: con dos rivales toca ${touchRate[1]}/${TRIALS}, con uno ${touchRate[0]}/${TRIALS} (no debe ser claramente menor: máx. ${(0.1 * TRIALS).toFixed(0)} menos)`);
}
void CONFIG;
process.exit(fail ? 1 : 0);
