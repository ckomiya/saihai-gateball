// Calibración del rival humano y modelo de amenaza (iteración C).
//  - Un buen jugador humano (CONFIG.humanRivalError) acierta un touch ≈ la mitad de las veces hasta 6 m y ≈ 1 de cada 5 a 13 m (referencia de Chris).
//  - La CPU con su error (×0,4) es mucho más certera.
//  - La amenaza del rival baja con la distancia, un poste de por medio la anula, y un rival aún en la salida amenaza la zona de salida de la puerta 1.
//  - El piso del peso del riesgo se aplica en todas las fases.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError, touchProbability } from '../src/game/certainty';
import type { BallState } from '../src/game/match';
import { touchThreat } from '../src/game/threat';
import { genes2, genomeToFile2, resolveWeights } from '../src/game/weights';
import { championV1 } from '../scripts/trainLib';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const near = (v: number, target: number, tol: number) => Math.abs(v - target) <= tol;

const human = CONFIG.humanRivalError;
const cpu = scaleError(kantokuLevelBase(), CONFIG.kantokuLevelErrorScale);
const p6 = touchProbability(human, 6, true), p13 = touchProbability(human, 13, true);
check(near(p6, 0.5, 0.04), `buen jugador humano: touch a 6 m ${(100 * p6).toFixed(0)} % (referencia ≈ 50 %)`);
check(near(p13, 0.2, 0.04), `buen jugador humano: touch a 13 m ${(100 * p13).toFixed(0)} % (referencia ≈ 20 %)`);
// 2026-10-26: la certeza del nivel «Kantoku IA» baja a la de un buen jugador humano × `kantokuLevelErrorScale` (antes base × 0,4: touch a 6 m 97 %, a 13 m 63 %). Un poco mejor que el humano medio (50 % y 20 %), no sobrehumana.
const c6 = touchProbability(cpu, 6, true), c13 = touchProbability(cpu, 13, true);
check(c6 >= p6 && c6 <= 0.8 && c13 >= p13 && c13 <= 0.4, `CPU (humano ×${CONFIG.kantokuLevelErrorScale}): touch a 6 m ${(100 * c6).toFixed(0)} % y a 13 m ${(100 * c13).toFixed(0)} % (un poco más certera que el humano medio: ${(100 * p6).toFixed(0)} % y ${(100 * p13).toFixed(0)} %)`);

const ball = (x: number, y: number, nextGate = 2): BallState => ({ n: 1, team: 0, x, y, vx: 0, vy: 0, nextGate, outBall: false, points: 0 });
const rival = ball(12, 8);
const d = (dist: number) => touchThreat(rival, ball(12 - dist, 8), human);
check(d(2) > d(6) && d(6) > d(10) && d(10) > d(13), 'la amenaza baja con la distancia');
// un poste de por medio anula la amenaza: gate 2 está en (8, 2) con postes en (8, 1,8) y (8, 2,2)
check(touchThreat(ball(10, 1.8), ball(6, 1.8), human, false) === 0 && touchThreat(ball(10, 5), ball(6, 5), human) > 0, 'un poste de por medio anula el touch directo');
// ... pero no la jugada «pasar su puerta y quedar cerca»: el rival pasa la puerta 2 y toca la bola que está justo más allá
check(touchThreat(ball(10, 1.8), ball(6, 1.8), human) > 0.3, 'con el golpe continuo, la bola justo más allá de la puerta sí está amenazada (puerta 2)');
// un rival aún en la salida amenaza la zona de salida de la puerta 1 (la pasa y toca con el golpe continuo) y casi no amenaza lejos de ella
const atStart = ball(18, 15.5, 1);
check(touchThreat(atStart, ball(17, 8), human) > 0.15 && touchThreat(atStart, ball(2, 2), human) < 0.2, // 2026-10-26: 0,1 → 0,2: con la probabilidad de pasar pesimista (≥ 90 %) un touch humano a ~16 m (15 %) cuenta casi entero
   `un rival en la salida amenaza cerca de la puerta 1 (${(100 * touchThreat(atStart, ball(17, 8), human)).toFixed(0)} %) y casi nada lejos (${(100 * touchThreat(atStart, ball(2, 2), human)).toFixed(0)} %)`);
// una bola rival fuera no amenaza (primero tiene que volver a entrar)
check(touchThreat({ ...rival, outBall: true }, ball(10, 8), human) === 0, 'una bola rival fuera no amenaza');

// El piso del riesgo se aplica en todas las fases, aunque el genoma lo baje
const genes = genes2(championV1);
const file = genomeToFile2(genes.map((g) => g.init), genes);
file.base.risk = 0.1;
const saved = CONFIG.kantokuRiskFloor;
CONFIG.kantokuRiskFloor = 1.5;
check((['inicio', 'medio', 'final'] as const).every((ph) => resolveWeights(file, ph).risk >= 1.5), 'el piso del riesgo se aplica en inicio, medio y final');
CONFIG.kantokuRiskFloor = saved;
process.exit(fail ? 1 : 0);
