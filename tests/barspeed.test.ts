// Velocidad del selector de precisión según lo lejos que va el tiro (Chris, 2026-10-26: de muy lejos el indicador no se sentía más rápido).
// Antes dependía de la posición de la barra de fuerza, que en el triángulo queda casi siempre igual; ahora depende de los metros que va a recorrer la bola.
//  A  la velocidad sube con la distancia: mínima hasta `accuracyNearM`, máxima desde `accuracyFarM`, y un tiro lejano va al menos 1,5 veces más rápido que uno de la puerta 1;
//  B  `Match.travelDistance` coincide con lo que recorre la bola de verdad (en el triángulo: la distancia a la mira);
//  C  con la misma fuerza (en el triángulo) la velocidad cambia con la distancia a la mira, que es justo lo que antes no pasaba.
import { CONFIG } from '../src/config';
import { BallState, FINISHED, Match, accuracySpeedFactor } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

const f = (d: number) => accuracySpeedFactor(d);
check(f(1) === CONFIG.accuracySpeedMin && f(CONFIG.accuracyNearM) === CONFIG.accuracySpeedMin && f(CONFIG.accuracyFarM) === CONFIG.accuracySpeedMax && f(25) === CONFIG.accuracySpeedMax, `A mínima hasta ${CONFIG.accuracyNearM} m (${f(1)}) y máxima desde ${CONFIG.accuracyFarM} m (${f(25)})`);
check(f(4.5) < f(8) && f(8) < f(12) && f(12) < f(15), `A crece con la distancia: 4,5 m ${f(4.5).toFixed(2)} · 8 m ${f(8).toFixed(2)} · 12 m ${f(12).toFixed(2)} · 15 m ${f(15).toFixed(2)}`);
check(f(15) >= 1.5 * f(4.5), `A un tiro de 15 m va ${(f(15) / f(4.5)).toFixed(1)} veces más rápido que uno de la puerta 1 (≥ 1,5)`);

const ball = (n: number, x: number, y: number, g: number): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: false, points: 1 });
const board = () => {
  const b = Array.from({ length: 10 }, (_, i) => ({ ...ball(i + 1, 18, 15.5, FINISHED), points: 0 }));
  b[0] = ball(1, 2, 4, 2);
  return b;
};
const mk = (seed: number) => { const m = Match.fromBalls(board(), { turn: 0, rng: mulberry32(seed) }); return m; };
// B
{
  const sweet = mk(1).sweetSpot();
  let worst = 0;
  for (const d of [3, 6, 10, 14]) {
    const m = mk(2);
    const aim = { x: 2 + d, y: 4 };
    const predicted = m.travelDistance(aim, sweet);
    m.shoot(aim, sweet, m.bars().accuracy.sweetSpot);
    for (let i = 0; i < 1800 && m.stage === 'rolling'; i++) if (m.step(1 / 60)) break;
    const real = Math.hypot(m.b.x - 2, m.b.y - 4);
    worst = Math.max(worst, Math.abs(real - predicted));
  }
  check(worst <= 0.5, `B la distancia prevista coincide con la que recorre la bola (error máximo ${worst.toFixed(2)} m en tiros de 3 a 14 m)`);
}
// C
{
  const sweet = mk(1).sweetSpot();
  const near = accuracySpeedFactor(mk(3).travelDistance({ x: 6.5, y: 4 }, sweet)); // 4,5 m
  const far = accuracySpeedFactor(mk(3).travelDistance({ x: 16.5, y: 4 }, sweet)); // 14,5 m
  check(far > 1.4 * near, `C con la misma fuerza (en el triángulo), 14,5 m va a ${far.toFixed(2)} y 4,5 m a ${near.toFixed(2)}`);
}
process.exit(fail ? 1 : 0);
