// Tsunagi (つなぎ, puentes) — Chris, 2026-10-23. Una rival lejos de mi bola no está tan lejos si cerca tiene bolas que le sirven de puente: toca una, gana el spark y un golpe extra desde ahí, toca la siguiente,
// queda frente a la puerta (o la pasa) y ataca. El riesgo (`ChainModel` en threat.ts, cadenas de 2 y 3 pasos y «pasar su puerta y tocar») ya no mira solo lo que la rival logra con un tiro.
// Caso de Chris: mi blanca 6 detrás de la puerta 3; la roja 7, que ya pasó la puerta 2, está lejos de la puerta 3 pero tiene dos bolas cerca que le sirven de puente.
//  A  la amenaza de la roja 7 sobre mi bola es mucho mayor con las bolas de puente que sin ellas, y la cadena que encuentra pasa por los puentes;
//  B  el valor de dejar la bola detrás de la puerta 3 frente a una posición sin puentes baja claramente con los tsunagi (frente al kantoku sin ellos), y sin puentes no cambia;
//  C  el kantoku no deja su bola ahí: con los puentes termina detrás de la puerta 3 casi nunca;
//  D  al revés: con una compañera cerca de su recorrido (un puente propio), la probabilidad de pasar su puerta que cuenta el kantoku sube.
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { evaluate, Outcome } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { ChainModel } from '../src/game/threat';
import { weightsFor, type AnyWeightFile, type Brain, type WeightFile2 } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 0): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const base = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const BEHIND = { x: 12.6, y: 13.0 }; // detrás de la puerta 3 (10, 13), que se pasa de izquierda a derecha
const SAFE = { x: 15.5, y: 4.0 };    // una posición sin puentes cerca
const red7 = ball(7, 4.0, 7.0, 3, 3);  // ya pasó la puerta 2; lejos de la puerta 3
const bridges = { 1: ball(1, 6.2, 9.2, 2, 1), 3: ball(3, 8.0, 11.4, 2, 1) }; // dos bolas de puente en el camino
const withBridges = (mine: { x: number; y: number }) => base({ 6: ball(6, mine.x, mine.y, 3, 2), 7: red7, ...bridges });
const noBridges = (mine: { x: number; y: number }) => base({ 6: ball(6, mine.x, mine.y, 3, 2), 7: red7 });
const kfile = () => (kantokuBrain as { file: WeightFile2 }).file;
const brainWith = (legacy: boolean): Brain => ({ kind: 'kantoku', file: { ...kfile(), legacyChains: legacy } as AnyWeightFile });

// A. la amenaza
const model = (S: BallState[]) => new ChainModel(S, () => CONFIG.humanRivalError, CONFIG.kantokuContinuationAttack, true);
{
  const c1 = model(withBridges(BEHIND)).best(6, 5, 3), c0 = model(noBridges(BEHIND)).best(6, 5, 3);
  console.log(`   A amenaza de la roja 7 sobre mi bola detrás de la puerta 3 (rival humano): con puentes ${c1.p.toFixed(2)} (camino ${c1.path.map((i) => i + 1).join('→')}${c1.gate ? ' y pasa su puerta' : ''}) · sin puentes ${c0.p.toFixed(2)}`);
  check(c1.p >= 0.15 && c1.p >= 3 * Math.max(c0.p, 0.01), `A con los dos puentes la cadena de la roja 7 llega a mi bola (${c1.p.toFixed(2)}), sin ellos casi no (${c0.p.toFixed(2)})`);
  check(c1.path.length >= 3 && (c1.path[1] === 0 || c1.path[1] === 2), 'A la cadena pasa por una de las bolas de puente');
}

// B. valor de dejar la bola ahí, con y sin tsunagi (el mismo kantoku con `legacyChains`)
function value(S: BallState[], legacy: boolean, cpuRival = false) {
  const init = S.map((b) => ({ ...b }));
  const m = Match.fromBalls(init, { turn: 5, rng: mulberry32(1) });
  m.clock = 1500; m.firstRoundDone = true;
  const out: Outcome = { balls: S.map((b) => ({ ...b })), touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true };
  return evaluate(init, out, 5, 'stroke', { team: 1, clock: 1500, noise: 0, rng: mulberry32(2), weights: weightsFor(brainWith(legacy), 'medio'), future: { seq: upcomingTurns(m), profiles: m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })), base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: cpuRival ? scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale) : CONFIG.humanRivalError, rivalProfiles: cpuRival ? m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })) : undefined } });
}
{
  // Δ = valor(posición segura) − valor(detrás de la puerta 3): cuánto prefiere no dejarla ahí. Con puentes debe subir con los tsunagi
  const d = (legacy: boolean, bridged: boolean, cpu: boolean) => (bridged ? value(withBridges(SAFE), legacy, cpu) - value(withBridges(BEHIND), legacy, cpu) : value(noBridges(SAFE), legacy, cpu) - value(noBridges(BEHIND), legacy, cpu));
  for (const cpu of [false, true]) {
    const gainWith = d(false, true, cpu) - d(true, true, cpu), gainWithout = d(false, false, cpu) - d(true, false, cpu);
    const who = cpu ? 'rival CPU certera' : 'rival humano';
    console.log(`   B (${who}) cuánto más conviene la posición segura con los tsunagi: con puentes ${gainWith.toFixed(2)} · sin puentes ${gainWithout.toFixed(2)}`);
    // Contra la CPU certera ya hay amenaza directa sobre esa posición y la cadena casi no suma (solo se imprime); contra una persona la cadena es lo que cambia el valor
    if (!cpu) check(gainWith >= 0.04 && gainWith >= gainWithout + 0.015, // 0,02 → 0,015: con la amenaza como unión de rivales (2026-10-23) la diferencia es un poco menor, el sentido y la prueba C siguen igual
       `B (${who}) con las bolas de puente, dejar la bola detrás de la puerta 3 vale ${gainWith.toFixed(2)} menos que antes (sin puentes ${gainWithout.toFixed(2)})`);
    check(Math.abs(gainWithout) <= 0.15, `B (${who}) sin puentes casi no cambia (${gainWithout.toFixed(2)})`);
  }
}

// C. el kantoku no deja su bola ahí
{
  const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
  const run = (legacy: boolean, N: number) => {
    let behind = 0;
    for (let t = 0; t < N; t++) {
      const m = Match.fromBalls(withBridges({ x: 14.5, y: 11.5 }), { turn: 5, rng: mulberry32(900 + t) });
      m.clock = 1500; m.firstRoundDone = true;
      m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
      const plan = cpuPlan(m, 3, { brain: brainWith(legacy), errors: own });
      let res = m.shoot(plan.aim, plan.power, plan.acc);
      for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
      if (!res) m.forceStop();
      const b = m.balls[5];
      if (!b.outBall && Math.hypot(b.x - BEHIND.x, b.y - BEHIND.y) <= 2.2) behind++;
    }
    return behind;
  };
  const N = 24, now = run(false, N), before = run(true, N);
  check(now <= 0.1 * N && now <= before, `C con los puentes, el kantoku deja su bola detrás de la puerta 3 en ${now}/${N} (sin los tsunagi: ${before}/${N})`);
}

// D. al revés: aprovechar sus propios puentes para acercarse a su puerta
{
  const S0 = base({ 4: ball(4, 15.5, 6.5, 2, 1) });                                 // mi blanca 4 lejos de la puerta 2 (8, 2), sola
  const S1 = base({ 4: ball(4, 15.5, 6.5, 2, 1), 6: ball(6, 12.5, 4.2, 2, 1) });   // ... con una compañera en su camino (un puente)
  const mine = (S: BallState[]) => new ChainModel(S, () => ({ aimErr: 0.022, powerErr: 0.009, accErr: 0.009 }), CONFIG.kantokuContinuationAttack, false);
  const p0 = mine(S0).bridgePass(3), p1 = mine(S1).bridgePass(3);
  console.log(`   D probabilidad de acercarse y pasar la puerta 2 con un puente propio: sola ${p0.toFixed(2)} · con una compañera en su camino ${p1.toFixed(2)}`);
  check(p0 === 0 && p1 >= 0.1, `D con una compañera en su camino la bola cuenta con pasar su puerta encadenando (${p1.toFixed(2)}); sola no (${p0.toFixed(2)})`);
}
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
