// Prueba de regresión del planificador de la CPU (src/game/cpuPlanner.ts) con los pesos a mano (`handWeights`):
// sobre tableros fijos y azar con semilla, debe elegir exactamente lo mismo que el planificador anterior (tests/planner-golden.json).
// Uso: `npm test` compara · `node scripts/run-node.mjs tests/planner.test.ts grabar` vuelve a grabar (solo si el cambio de decisiones es intencional).
import { readFileSync, writeFileSync } from 'node:fs';
import { COURT_H, COURT_W } from '../src/game/court';
import { planShot } from '../src/game/cpuPlanner';
import type { BallState } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

import { CONFIG } from '../src/config';
// El golden se grabó con el rebote contra postes en 0,45; el juego usa 0,35 desde 2026-10-26 (pedido de Chris): se fija aquí para no depender de ese valor de ajuste.
CONFIG.bounce = 0.45;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function board(seed: number): BallState[] {
  const r = lcg(seed);
  const balls: BallState[] = [];
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

/** Decisiones del planificador: golpes normales y sparks, sin ruido y con ruido de valoración (niveles bajos). */
function decisions() {
  const out: ({ aim: { x: number; y: number }; value: number } | null)[] = [];
  const rng = mulberry32(777);
  for (const noise of [0, 0.7]) {
    for (let b = 0; b < (noise ? 14 : 40); b++) {
      const balls = board(500 + b);
      for (const si of [0, 1, 2, 3]) {
        const p = planShot(balls, si, 'stroke', -1, { team: balls[si].team, clock: noise ? 100 : 900, noise, rng });
        out.push(p ? { aim: p.aim, value: p.value } : null);
      }
    }
    for (let b = 0; b < (noise ? 6 : 15); b++) {
      const balls = board(900 + b);
      balls[0].nextGate = 2; balls[1].nextGate = 3; balls[0].outBall = false; balls[1].outBall = false;
      balls[1].x = balls[0].x + 0.2; balls[1].y = balls[0].y;
      const p = planShot(balls, 1, 'spark', 0, { team: 0, clock: noise ? 100 : 900, noise, rng });
      out.push(p ? { aim: p.aim, value: p.value } : null);
    }
  }
  return out;
}

const got = decisions();
if (process.argv[2] === 'grabar') {
  writeFileSync('tests/planner-golden.json', JSON.stringify(got));
  console.log(`Grabadas ${got.length} decisiones en tests/planner-golden.json`);
} else {
  const want = JSON.parse(readFileSync('tests/planner-golden.json', 'utf8')) as typeof got;
  let diffs = 0;
  want.forEach((w, i) => {
    const g = got[i];
    const same = (!w && !g) || (w && g && Math.abs(w.aim.x - g.aim.x) < 1e-9 && Math.abs(w.aim.y - g.aim.y) < 1e-9 && Math.abs(w.value - g.value) < 1e-9);
    if (!same) { diffs++; if (diffs <= 10) console.log(`decisión ${i}: esperada ${JSON.stringify(w)}, obtenida ${JSON.stringify(g)}`); }
  });
  const ok = diffs === 0 && want.length === got.length;
  console.log(`${ok ? '✓' : '✗'} planificador con pesos a mano: ${want.length} decisiones ${ok ? 'idénticas al anterior' : `(${diffs} distintas)`}`);
  process.exit(ok ? 0 : 1);
}
