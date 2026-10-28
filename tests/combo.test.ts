// Doble ángulo (Chris, 2026-10-26): un lugar desde donde la rival que juega después tiene dos oportunidades seguidas. El riesgo valora la combinación (no solo la mejor opción) de tres tipos:
//  bola y bola: toca una de mis bolas y, con el golpe extra, va por otra;  puerta y bola: pasa su puerta y luego toca mi bola;  bola y puerta: toca mi bola y luego pasa su puerta.
//  A  cada tipo de doble cuesta más que antes (`legacyCombo`) en su caso, y el riesgo desglosa cuál es la combinación;
//  B  con un solo ángulo difícil (una bola lejana, sin segunda oportunidad) el riesgo no cambia: es aceptable;
//  C  regla fija (`kantokuDoubleMax`, 0,2, solo bola y bola con las dos bolas juntas): el kantoku no deja dos bolas juntas a tiro de la rival que juega después (`startdouble.test.ts`); con un solo ángulo difícil sí (D);
//     no pasar la puerta 1 (o cualquier jugada segura) sigue siendo una opción.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { Outcome, RiskRow, doubleAngle, evaluate } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};

const future = (m: Match) => ({ seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError });

/** Riesgo (términos «riesgo» y combinación) de dejar las blancas como están, con la roja 1 jugando después; `legacy` = el riesgo de antes. */
function riesgo(over: Record<number, BallState>, legacy: boolean, extra: Record<string, unknown> = { legacyFailPunish: true }) {
  const balls = board(over);
  const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
  m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  const terms: Record<string, number> = {};
  const detail: { risk?: RiskRow[] } = {};
  const out: Outcome = { balls, touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true };
  evaluate(balls, out, 1, 'stroke', {
    team: 1, clock: 1200, noise: 0, rng: mulberry32(2), weights: { ...weightsFor(kantokuBrain, 'medio'), legacyCombo: legacy, ...extra }, terms, detail,
    future: { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError },
  });
  const row = detail.risk?.find((r) => r.rival === 1);
  return { risk: -terms.riesgo, combo: row?.combo?.kind ?? '' };
}

// A. bola y bola: dos blancas a 2,2 m una de otra y la roja 1 a 4 m de la primera
{
  const o = { 1: ball(1, 15, 6, 2), 2: ball(2, 11, 6, 2), 4: ball(4, 11, 8.2, 2) };
  const on = riesgo(o, false), off = riesgo(o, true);
  check(on.risk > off.risk * 1.05 && on.combo.startsWith('bola y bola'), `A bola y bola: el riesgo sube de ${off.risk.toFixed(2)} a ${on.risk.toFixed(2)} (${on.combo})`);
}
// puerta y bola: la roja 1 ante su puerta 2 (8, 2) y mi blanca detrás de ella (en la zona de salida, a 3 m de la puerta)
{
  const o = { 1: ball(1, 14, 4, 2), 2: ball(2, 5, 3, 3) };
  const on = riesgo(o, false), off = riesgo(o, true);
  check(on.risk > off.risk * 1.05 && on.combo.startsWith('puerta y bola'), `A puerta y bola: el riesgo sube de ${off.risk.toFixed(2)} a ${on.risk.toFixed(2)} (${on.combo})`);
}
// bola y puerta: mi blanca en la entrada de la puerta 2 de la roja, a 5 m de ella
{
  const o = { 1: ball(1, 15.5, 5.5, 2), 2: ball(2, 10.5, 2, 3) };
  const on = riesgo(o, false), off = riesgo(o, true);
  // 2026-10-27 (Chris): mi bola DELANTE de la puerta del rival (aquí en su zona de entrada, a 5 m de él): el touch es fácil y luego sigue a su puerta, muy peligroso. Con el riesgo por valor este doble había quedado por debajo de pasar la
  // puerta sola (0,88 → 0,84); ahora el punto de la puerta cuenta `kantokuComboFrontUnit` y el riesgo vuelve a subir. Se exige que suba ≥ 5 %, y que con `legacyComboFront` (lo de antes) no suba.
  check(on.risk > off.risk * 1.05 && on.combo.startsWith('bola y puerta'), `A bola y puerta, mi bola delante de la puerta: el riesgo sube de ${off.risk.toFixed(2)} a ${on.risk.toFixed(2)} (${on.combo})`);
  const old = riesgo(o, false, { legacyFailPunish: true, legacyComboFront: true });
  check(on.risk > old.risk * 1.05, `A ... y más que sin el aumento (${old.risk.toFixed(2)} → ${on.risk.toFixed(2)})`);
}
// B. un solo ángulo difícil: una blanca a 13 m de la roja, lejos de su puerta y sin otra bola cerca
{
  const o = { 1: ball(1, 18, 1.5, 3), 2: ball(2, 5, 12, 3) };
  const on = riesgo(o, false), off = riesgo(o, true);
  check(on.risk - off.risk <= 0.08 && on.risk <= 0.35, `B un solo ángulo difícil (13 m, sin segunda oportunidad): el riesgo casi no cambia y es bajo (${off.risk.toFixed(2)} → ${on.risk.toFixed(2)}; los tres dobles de arriba suben 0,25 a 0,3)`);
}
// C. el caso del turno 36 (dos o tres blancas juntas frente a la puerta 2 con la roja siguiente en la salida) está en `startdouble.test.ts`.
// D. un solo ángulo difícil es aceptable: la medida de doble ángulo queda bajo el umbral y no se descarta nada
{
  const lone = board({ 1: ball(1, 18, 1.5, 3), 2: ball(2, 5, 12, 3) });
  const m = Match.fromBalls(lone, { turn: 1, rng: mulberry32(1) });
  m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
  const d = doubleAngle(lone, 1, future(m), CONFIG.kantokuContinuationAttack);
  const two = board({ 1: ball(1, 15, 6, 2), 2: ball(2, 11, 6, 2), 4: ball(4, 11, 8.2, 2) });
  const m2 = Match.fromBalls(two, { turn: 1, rng: mulberry32(1) });
  m2.clock = 1200; m2.turnStarts = 30; m2.firstRoundDone = true;
  const d2 = doubleAngle(two, 1, future(m2), CONFIG.kantokuContinuationAttack);
  check(d < CONFIG.kantokuDoubleMax && d2 >= CONFIG.kantokuDoubleMax, `D un solo ángulo difícil (${d.toFixed(2)}) es aceptable; dos bolas juntas a tiro (${d2.toFixed(2)}) pasan el umbral ${CONFIG.kantokuDoubleMax}`);
}
// E. mi bola LEJOS del rival y una compañera lista para castigar el fallo (Chris, 2026-10-27): si el rival falla el touch, su bola queda junto a la mía, expuesta a mis bolas que juegan después (tocan o pasan su puerta y la sacan).
//    La amenaza baja respecto de `legacyFailPunish` (sin castigo); y no baja cuando mi bola está cerca del rival (el castigo empieza a `kantokuFailFromM`).
{
  const withMate = { 1: ball(1, 18, 1.5, 3), 2: ball(2, 5, 12, 3), 4: ball(4, 6.5, 13.3, 3) };
  const noPun = { legacyFailPunish: true }, pun = { legacyFailPunish: false };
  const a0 = riesgo(withMate, false, noPun), a1 = riesgo(withMate, false, pun);
  check(a1.risk < a0.risk * 0.8, `E mi bola lejos (13 m) con una compañera lista para castigar el fallo: la amenaza baja (${a0.risk.toFixed(2)} → ${a1.risk.toFixed(2)})`);
  const near = { 1: ball(1, 18, 1.5, 3), 2: ball(2, 15, 3, 3), 4: ball(4, 13.5, 4.3, 3) };
  const n0 = riesgo(near, false, noPun), n1 = riesgo(near, false, pun);
  check(Math.abs(n1.risk - n0.risk) <= 0.02 * Math.max(0.01, n0.risk) + 1e-9, `E ... y no baja cuando mi bola está cerca del rival (3 m: ${n0.risk.toFixed(2)} → ${n1.risk.toFixed(2)})`);
}
process.exit(fail ? 1 : 0);
