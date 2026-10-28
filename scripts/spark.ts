// Spark de expulsión del kantoku: cuando decide sacar una bola rival con el spark, ¿cuántas veces sale de verdad y por qué falla?
// Uso: npm run spark -- [--games 40] [--brain champion|ruta] [--seed 11000]
// «Decide sacarla» = el golpe sin error (la mira y la fuerza elegidas, barras en el triángulo) la saca de la cancha. Cada fallo se explica repitiendo el spark
// con un solo error a la vez: fuerza, rumbo o mira; si ni así sale, ¿chocó con otra bola o la fuerza ya era corta sin error?
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { CpuPlan } from '../src/game/cpu';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { AnyWeightFile, Brain } from '../src/game/weights';
import { playMatch } from './selfplay';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GAMES = Number(str('games', '40'));
const SEED = Number(str('seed', '11000'));
const bs = str('brain', 'champion');
const brain: Brain = bs === 'champion' ? kantokuBrain : { kind: 'kantoku', file: JSON.parse(readFileSync(bs, 'utf8')) as AnyWeightFile };
const err = kantokuLevelErrors();

/** Repite el spark de `balls` (turno `turn`, bola tocada `si`) con ese golpe; devuelve si la bola sale y si otra bola se movió. */
function replay(balls: BallState[], turn: number, si: number, sparked: number[], shot: { aim: { x: number; y: number }; power: number; acc: number }) {
  const m = Match.fromBalls(balls, { turn, rng: mulberry32(1), sparkBall: si, sparked });
  const before = m.balls.map((b) => ({ x: b.x, y: b.y }));
  let res = m.shoot(shot.aim, shot.power, shot.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  const hitOthers = m.balls.some((b, i) => i !== si && i !== turn && (Math.abs(b.x - before[i].x) > 1e-6 || Math.abs(b.y - before[i].y) > 1e-6));
  return { out: m.balls[si].outBall && res.kind === 'spark', hitOthers };
}

interface Rec { balls: BallState[]; turn: number; si: number; sparked: number[]; plan: CpuPlan; sweet: { p: number; a: number }; ball: BallState }
let decided = 0, notDecided = 0, ok = 0;
const causes: Record<string, number> = {};
const bump = (k: string) => { causes[k] = (causes[k] ?? 0) + 1; };
for (let g = 0; g < GAMES; g++) {
  let rec: Rec | null = null;
  playMatch({
    seed: SEED + g, levels: [3, 3], errors: err, brains: [brain, brain],
    profiles: [Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[i % 4] })), Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + 1) % 4] }))],
    errorScales: [{ exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }, { exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }],
    onShot: (m, team, plan) => {
      rec = null;
      const o = m.sparkBall;
      if (!o || o.team === team || !plan.ideal) return;
      rec = { balls: m.balls.map((b) => ({ ...b })), turn: m.turn, si: m.balls.indexOf(o), sparked: [...m.sparkedThisTurn].map((x) => m.balls.indexOf(x)), plan, sweet: { p: m.sweetSpot(), a: m.bars().accuracy.sweetSpot }, ball: o };
    },
    onResult: (m, res) => {
      const r = rec; rec = null;
      if (!r) return;
      const ideal = replay(r.balls, r.turn, r.si, r.sparked, r.plan.ideal!);
      if (!ideal.out) { notDecided++; return; } // no pretendía sacarla (o el plan ideal ya no la saca)
      decided++;
      if (res.kind === 'spark' && r.ball.outBall) { ok++; return; }
      const p = r.plan, id = p.ideal!;
      const only = (k: 'power' | 'acc' | 'aim') => replay(r.balls, r.turn, r.si, r.sparked, { aim: k === 'aim' ? p.aim : id.aim, power: k === 'power' ? p.power : id.power, acc: k === 'acc' ? p.acc : id.acc });
      const actual = replay(r.balls, r.turn, r.si, r.sparked, p);
      if (argv.includes('--debug')) {
        const st = r.balls[r.turn], tg = r.balls[r.si];
        const others = r.balls.filter((x, i) => i !== r.si && i !== r.turn && x.nextGate >= 2 && x.nextGate <= 4 && !x.outBall).map((x) => `(${x.x.toFixed(1)},${x.y.toFixed(1)})`).join(' ');
        console.log(`  DEBUG striker (${st.x.toFixed(2)},${st.y.toFixed(2)}) rival (${tg.x.toFixed(2)},${tg.y.toFixed(2)}) ideal aim (${id.aim.x.toFixed(2)},${id.aim.y.toFixed(2)}) p ${id.power.toFixed(2)}/${p.power.toFixed(2)} a ${id.acc.toFixed(2)}/${p.acc.toFixed(2)} aim real (${p.aim.x.toFixed(2)},${p.aim.y.toFixed(2)}) otras ${others}`);
      }
      const failed = (k: 'power' | 'acc' | 'aim') => !only(k).out;
      if (failed('power')) bump('fuerza corta (el error de fuerza solo ya la deja adentro)');
      else if (failed('acc')) bump('rumbo desviado (el error de rumbo solo)');
      else if (failed('aim')) bump('mira desviada (el error de mira solo)');
      else if (actual.hitOthers) bump('choque con otra bola (con la combinación de errores)');
      else {
        bump('combinación de errores sin choque');
      }
    },
  });
}
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
console.log(`Spark de expulsión del kantoku (${GAMES} partidos, kantoku contra kantoku): decidió sacar la bola rival ${decided} veces (no la sacaba ni sin error: ${notDecided}) · salió de verdad ${ok} (${pc(ok, decided)})`);
for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  fallo · ${k}: ${v} (${pc(v, decided)})`);
if (!Object.keys(causes).length) console.log('  sin fallos');
