// El modelo de probabilidades con pasto (src/game/certainty.ts) debe coincidir con la física real. Si cambian la fricción, `grassBumpiness`, el tamaño de
// bola o puerta, esta prueba falla: hay que volver a medir `grassSigma`, `grassCrossSigma` y `GATE_EFFECTIVE_HALF_OPENING`.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { drawShotError, scaleError, scoreProbability, touchProbability } from '../src/game/certainty';
import { applyShotError } from '../src/game/cpu';
import { GATES } from '../src/game/court';
import { Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

const err = scaleError(kantokuLevelBase(), CONFIG.kantokuLevelErrorScale);
const N = 300;
const rng = mulberry32(11);
const board = (over: Record<number, object>) => Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));

function gatePass(gate: number, from: { x: number; y: number }) {
  const g = GATES[gate - 1];
  const dv = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[g.dir];
  const aim = { x: g.x + dv[0], y: g.y + dv[1] };
  let ok = 0;
  for (let k = 0; k < N; k++) {
    const m = Match.fromBalls(board({ 2: { ...from, nextGate: gate } }) as never, { turn: 1, rng });
    const bars = m.bars();
    const shot = applyShotError(aim, { power: bars.power.sweetSpot, acc: bars.accuracy.sweetSpot }, drawShotError(err, rng));
    let res = m.shoot(shot.aim, shot.power, shot.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (res!.shotGate === gate) ok++;
  }
  return ok / N;
}

function touch(d: number) {
  let ok = 0;
  for (let k = 0; k < N; k++) {
    const target = { x: 7 + d, y: 7 };
    const m = Match.fromBalls(board({ 2: { x: 7, y: 7, nextGate: 2 }, 1: { ...target, nextGate: 2 } }) as never, { turn: 1, rng });
    const bars = m.bars();
    const shot = applyShotError(target, { power: bars.power.sweetSpot, acc: bars.accuracy.sweetSpot }, drawShotError(err, rng));
    let res = m.shoot(shot.aim, shot.power, shot.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (res!.touches.length) ok++;
  }
  return ok / N;
}

let fail = 0;
const TOL = 0.09; // el modelo y la física difieren como mucho 9 puntos (300 tiros: el ruido de la física es ≈ ±5 puntos)
const check = (name: string, real: number, model: number) => {
  const ok = Math.abs(real - model) <= TOL;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}: física ${(100 * real).toFixed(0)} % · modelo con pasto ${(100 * model).toFixed(0)} %`);
};
for (const [name, gate, from] of [
  ['puerta 1 desde la salida (4,5 m)', 1, { x: 18, y: 15.5 }],
  ['puerta 2 de frente a 6 m', 2, { x: 14, y: 2 }],
  ['puerta 2 de frente a 9 m', 2, { x: 17, y: 2 }],
] as const) check(name, gatePass(gate, from), scoreProbability(from, gate, err, true));
for (const d of [3, 9]) check(`touch a una bola a ${d} m`, touch(d), touchProbability(err, d, true));
process.exit(fail ? 1 : 0);
