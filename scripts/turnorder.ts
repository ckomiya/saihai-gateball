// Caso de Chris (iteración C, partida real): bola de la CPU fuera, por detrás del arco 3 (franja inferior); una bola de Chris en juego frente al arco 2, cerca de la línea.
// ¿La CPU vuelve a entrar y se queda a ≤4 m de esa bola? Según qué turno le toque a esa bola de Chris (1.ª, 2.ª, 3.ª, 4.ª o 5.ª en jugar después de la CPU): una bola de la CPU
// se queda quieta toda la ronda, así que le toca el turno a las cinco bolas de Chris.
// Uso: npm run turnorder [-- --brain ruta]   (sin --brain compara pesos a mano, v1 y el campeón actual)
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { Brain, WeightFile, handBrain } from '../src/game/weights';
import { readFileSync } from 'node:fs';

const v1: Brain = { kind: 'kantoku', file: JSON.parse(readFileSync('src/game/cpuWeights.v1.json', 'utf8')) as WeightFile };
const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));

const THREAT = { x: 11, y: 1.6 }; // bola de Chris frente al arco 2 (entra por la derecha), cerca de la línea superior
const humanErr = { base: CONFIG.humanRivalError };

function trial(brain: Brain, threatBall: number, seed: number) {
  const over: Record<number, Partial<BallState>> = {
    2: { x: 10, y: 15.2, nextGate: 2, outBall: true, points: 1 }, // CPU: bola blanca 2, fuera, por detrás del arco 3
    [threatBall]: { ...THREAT, nextGate: 2 },
  };
  const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(seed) });
  m.firstRoundDone = true;
  m.clock = 900;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  let fresh = true;
  for (let g = 0; g < 6; g++) {
    const plan = cpuPlan(m, 3, { brain, errors: { ...kantokuLevelErrors(), rivalIsHuman: true } });
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    const t = m.proceed();
    fresh = false;
    if (t === 'turn' || t === 'end') break;
  }
  const b = m.balls[1];
  return { entered: !b.outBall, dist: b.outBall ? NaN : Math.hypot(b.x - THREAT.x, b.y - THREAT.y) };
}

const N = 40;
void humanErr;
const argIdx = process.argv.indexOf('--brain');
const only = argIdx >= 0 ? process.argv[argIdx + 1] : '';
const list: [string, Brain][] = only
  ? [[only, { kind: 'kantoku', file: JSON.parse(readFileSync(only, 'utf8')) }]]
  : [['pesos a mano', handBrain], ['v1', v1], ['v2 (actual)', kantokuBrain]];
for (const [name, brain] of list) {
  const cells: string[] = [];
  for (const [label, ball] of [['1.ª', 3], ['2.ª', 5], ['3.ª', 7], ['4.ª', 9], ['5.ª', 1]] as const) {
    let near = 0, ok = 0, sum = 0;
    for (let t = 0; t < N; t++) {
      const r = trial(brain, ball, 4000 + t);
      if (r.entered) { ok++; sum += r.dist; if (r.dist <= 4) near++; }
    }
    cells.push(`${label}: ${String(Math.round((100 * near) / Math.max(1, ok))).padStart(3)} % (${(sum / Math.max(1, ok)).toFixed(1)} m)`);
  }
  console.log(`${name.padEnd(18)} a ≤4 m de la bola de Chris, según su turno · ${cells.join(' · ')}`);
}
