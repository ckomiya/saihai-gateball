// Mide cuánto tarda el planificador de la CPU por golpe sobre tableros fijos (con azar de semilla fija).
// Uso: npm run bench:plan
import { planShot, SimBall } from '../src/game/cpuPlanner';
import { COURT_H, COURT_W } from '../src/game/court';
import { mulberry32 } from '../src/game/rng';
import { CONFIG } from '../src/config';
import { genomeToFile, initialGenome, resolveWeights } from '../src/game/weights';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const rng = mulberry32(12345);
// --kantoku: mide el planificador con los pesos del kantoku (certeza, puntos esperados y simulación con error)
const kantoku = process.argv.includes('--kantoku');
const sims = process.env.BENCH_K !== undefined ? { topN: Number(process.env.BENCH_TOPN ?? 8), errorSamples: Number(process.env.BENCH_K) } : undefined;
const weights = kantoku ? resolveWeights(genomeToFile(initialGenome(), sims), 'medio') : undefined;
const profiles = Array.from({ length: 10 }, (_, i) => ({ ...CONFIG.playerCertainty[Math.floor(i / 2) % CONFIG.playerCertainty.length] }));
const futureFor = (si: number) => (kantoku ? { seq: Array.from({ length: 10 }, (_, k) => (si + 1 + k) % 10), profiles, base: CONFIG.kantokuBaseError } : undefined);

function board(seed: number): SimBall[] {
  const r = lcg(seed);
  const balls: SimBall[] = [];
  for (let n = 1; n <= 10; n++) {
    const nextGate = 1 + Math.floor(r() * 4);
    const outBall = nextGate > 1 && r() < 0.15;
    balls.push({
      n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, nextGate, outBall, points: nextGate - 1,
      x: nextGate === 1 ? 18 : 1 + r() * (COURT_W - 2), y: nextGate === 1 ? 15.5 : 1 + r() * (COURT_H - 2), vx: 0, vy: 0,
    });
  }
  return balls;
}

const times: number[] = [];
let calls = 0;
for (let b = 0; b < 12; b++) {
  const balls = board(100 + b);
  for (const si of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const t0 = performance.now();
    planShot(balls, si, 'stroke', -1, { team: balls[si].team, clock: 900, noise: 0.3, rng, weights, future: futureFor(si) });
    times.push(performance.now() - t0);
    calls++;
  }
}
// sparks: la bola 1 golpea y la 2 es la tocada (colocadas juntas en juego)
for (let b = 0; b < 6; b++) {
  const balls = board(200 + b);
  balls[0].nextGate = 2; balls[1].nextGate = 3;
  balls[1].outBall = false; balls[0].outBall = false;
  balls[1].x = balls[0].x + 0.2; balls[1].y = balls[0].y;
  const t0 = performance.now();
  planShot(balls, 1, 'spark', 0, { team: 0, clock: 900, noise: 0.3, rng, weights, future: futureFor(0) });
  times.push(performance.now() - t0);
  calls++;
}
times.sort((a, b) => a - b);
const avg = times.reduce((s, t) => s + t, 0) / times.length;
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(`${kantoku ? 'kantoku' : 'pesos a mano'} · planShot: ${calls} llamadas · media ${avg.toFixed(1)} ms · mediana ${p(0.5).toFixed(1)} ms · p90 ${p(0.9).toFixed(1)} ms · máx ${times[times.length - 1].toFixed(1)} ms`);
