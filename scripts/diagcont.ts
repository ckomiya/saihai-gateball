// Diagnóstico de `continuation.test.ts`: ¿por qué un candidato no pasa la puerta 1 con rivales cerca de la salida? Compara generaciones del entrenamiento y, al candidato, le cambia de a un gen
// por el del campeón actual. Uso: npm run diagcont -- [--dir training/f] [--trials 30]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain, WeightFile2 } from '../src/game/weights';
import { fileFromGenome } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dir = str('dir', 'training/f'), TRIALS = Number(str('trials', '30'));
const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));
function gateRate(over: Record<number, Partial<BallState>>, brain: Brain, base: number) {
  let g = 0;
  for (let k = 0; k < TRIALS; k++) {
    const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(base + k) });
    const plan = cpuPlan(m, 3, { brain, errors: kantokuLevelErrors() });
    m.b.x = plan.startX;
    const res = m.shoot(plan.aim, plan.power, plan.acc);
    let r = res;
    for (let i = 0; i < 900 && !r && m.stage === 'rolling'; i++) if (m.step(1 / 60)) r = m.resolution;
    if (!r) { m.forceStop(); r = m.resolution!; }
    if (r.shotGate === 1) g++;
  }
  return g;
}
const CASES: Record<number, Partial<BallState>>[] = [{ 1: { x: 16.5, y: 8, nextGate: 2 } }, { 1: { x: 16.5, y: 8, nextGate: 2 }, 3: { x: 19, y: 9, nextGate: 2 } }];
const test = (name: string, file: AnyWeightFile) => {
  const brain: Brain = { kind: 'kantoku', file };
  console.log(`${name.padEnd(46)} ${CASES.map((c, i) => `${gateRate(c, brain, 4000 + i * 100)}/${TRIALS}`).join('  ')}`);
};
const champ = (kantokuBrain as { file: WeightFile2 }).file;
const next = JSON.parse(readFileSync('candidatos-descartados/cpuWeights.F-gen28.json', 'utf8')) as WeightFile2;
// Segunda ronda: el candidato con contAttack del campeón, más cada gen que difiere
const clone = () => { const f = JSON.parse(JSON.stringify(next)) as WeightFile2; f.rules = { ...f.rules, contAttack: champ.rules!.contAttack }; return f; };
test('next con contAttack del campeón', clone());
for (const k of ['lineSpot', 'mateWeight', 'passScale', 'touchPass'] as const) { const f = clone(); delete f.rules![k]; test(`  + sin rules.${k} (valor de config)`, f); }
{ const f = clone(); f.rules = { ...champ.rules }; test('  + todas las reglas del campeón', f); }
{ const f = clone(); f.base = { ...champ.base }; test('  + toda la base del campeón', f); }
{ const f = clone(); f.mult = JSON.parse(JSON.stringify(champ.mult)); test('  + todos los multiplicadores del campeón', f); }
{ const f = clone(); f.base = { ...champ.base }; f.mult = JSON.parse(JSON.stringify(champ.mult)); test('  + base y multiplicadores del campeón (solo reglas nuevas distintas)', f); }

for (const k of Object.keys(champ.base) as (keyof WeightFile2['base'])[]) {
  if (Math.abs(champ.base[k] - next.base[k]) < 1e-9) continue;
  const f = clone(); f.base[k] = champ.base[k];
  test(`  + base.${k} del campeón (campeón ${champ.base[k].toFixed(2)}, next ${next.base[k].toFixed(2)})`, f);
}
