// Ajusta el modelo de ritmo (`src/game/pace.ts`) a los turnos reales de `npm run pacedata` (.build/pacedata.json): golpes por turno predichos contra los reales y búsqueda de los parámetros.
// Uso: npm run pacefit [-- --search]
import { readFileSync } from 'node:fs';
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { BallState } from '../src/game/match';
import { PaceCtx, turnStrokes } from '../src/game/pace';

type Row = { seconds: number; strokes: number; ball: number; clock: number; gate: number; side: number; before: { n: number; x: number; y: number; gate: number; out: boolean; pts: number }[] };
const rows: Row[] = JSON.parse(readFileSync('.build/pacedata.json', 'utf8'));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const prep = rows.map((r) => {
  const S: BallState[] = r.before.map((b) => ({ n: b.n, team: (b.n % 2 === 1 ? 0 : 1) as 0 | 1, x: b.x, y: b.y, vx: 0, vy: 0, nextGate: b.gate, outBall: b.out, points: b.pts }));
  const own = Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + r.side) % 4] }));
  const profiles = S.map((b) => (b.team === r.side ? own[Math.floor((b.n - 1) / 2)] : { short: 1, medium: 1, long: 1 }));
  const ctx: PaceCtx = { team: r.side as 0 | 1, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError, profiles, rivalProfiles: undefined };
  return { S, ctx, i: r.ball - 1 };
});
const predict = () => prep.map((p) => turnStrokes(p.S, p.i, p.ctx).mean);
const mse = (pred: number[]) => mean(pred.map((p, k) => (p - rows[k].strokes) ** 2));
const report = () => {
  const pred = predict();
  const mp = mean(pred), ma = mean(rows.map((r) => r.strokes));
  const cov = mean(pred.map((p, k) => (p - mp) * (rows[k].strokes - ma))), vp = mean(pred.map((p) => (p - mp) ** 2)), va = mean(rows.map((r) => (r.strokes - ma) ** 2));
  console.log(`golpes por turno: predicho ${mp.toFixed(2)} · real ${ma.toFixed(2)} · ECM ${mse(pred).toFixed(2)} (constante: ${va.toFixed(2)}) · correlación ${(cov / Math.sqrt(vp * va)).toFixed(2)}`);
  const idx = pred.map((_, k) => k).sort((a, b) => pred[a] - pred[b]);
  for (let q = 0; q < 5; q++) { const part = idx.slice(Math.floor((q * idx.length) / 5), Math.floor(((q + 1) * idx.length) / 5)); console.log(`   quintil ${q + 1}: predice ${mean(part.map((k) => pred[k])).toFixed(2)} · real ${mean(part.map((k) => rows[k].strokes)).toFixed(2)} · segundos reales ${mean(part.map((k) => rows[k].seconds)).toFixed(0)}`); }
};
console.log(`${rows.length} turnos`);
report();
if (process.argv.includes('--search')) {
  const cfg = CONFIG as unknown as Record<string, number>;
  let best = { e: mse(predict()), v: {} as Record<string, number> };
  for (const tw of [0.3, 0.6, 0.9]) for (const kp of [0.6, 0.85, 1]) for (const sw of [0, 0.6, 1.2]) for (const mx of [6, 9, 14]) {
    cfg.kantokuPaceTouchW = tw; cfg.kantokuPaceKappa = kp; cfg.kantokuPaceSparkW = sw; cfg.kantokuPaceTouchMaxM = mx;
    const e = mse(predict());
    if (e < best.e) best = { e, v: { kantokuPaceTouchW: tw, kantokuPaceKappa: kp, kantokuPaceSparkW: sw, kantokuPaceTouchMaxM: mx } };
  }
  console.log('\nmejor combinación:', best.v, 'ECM', best.e.toFixed(2));
  Object.assign(cfg, best.v);
  report();
}
