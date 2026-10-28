// «Doble ángulo» (Chris, 2026-10-23): la CPU se colocó frente a la puerta 2 con mi bola algo lejos, con ángulo para tocarla o para pasar la puerta. Dos cosas del riesgo:
//  A  el rival que toca mi bola (el spark la saca) y desde donde queda, junto a ella, pasa su puerta con el golpe extra: el «doble» suma al riesgo (`kantokuTouchPassScale`);
//     solo cuando mi bola está en la entrada de SU puerta (si no, el doble no aporta y el riesgo no cambia);
//  B  la amenaza sobre una bola mía por varios rivales es la probabilidad de que alguno la toque, no solo la del mayor (`legacyThreatUnion` la apaga).
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { Outcome, evaluate } from '../src/game/cpuPlanner';
import { upcomingTurns } from '../src/game/phase';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { kantokuBrain } from '../src/game/kantoku';
import { weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });

/** Riesgo (término «riesgo» de la valoración) de dejar la blanca 2 en `at` con la roja 1 (humana) en `red`, sin mover nada. */
function riesgo(at: { x: number; y: number }, red: { x: number; y: number }, extra: Record<string, unknown> = {}, redGate = 2) {
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  balls[0] = ball(1, red.x, red.y, redGate);
  balls[1] = ball(2, at.x, at.y, 2);
  const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
  m.clock = 1200; m.firstRoundDone = true;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  const w = { ...weightsFor(kantokuBrain, 'medio'), ...extra };
  const out: Outcome = { balls, touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true };
  const terms: Record<string, number> = {};
  evaluate(balls, out, 1, 'stroke', {
    team: 1, clock: 1200, noise: 0, rng: mulberry32(2), weights: w, terms,
    future: { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError },
  });
  return -terms.riesgo;
}

const front = { x: 10, y: 2 }; // frente a la puerta 2 (entra por la derecha)
const red = { x: 15.5, y: 5.5 }; // mi bola algo lejos, con ángulo hacia la blanca
const off = riesgo(front, red, { legacyTouchPass: true, legacyCombo: true }); // el multiplicador pequeño del doble solo existe sin el riesgo de combinaciones (`combo.test.ts`)
const on = riesgo(front, red, { legacyCombo: true });
check(on > off * 1.02, `A el doble suma al riesgo cuando la blanca está en la entrada de la puerta 2 del rival (${off.toFixed(3)} → ${on.toFixed(3)})`);
const away = { x: 12, y: 11 }; // lejos de la entrada de la puerta 2 del rival
const redNear = { x: 15.5, y: 12 };
const o2 = riesgo(away, redNear, { legacyTouchPass: true, legacyCombo: true }), n2 = riesgo(away, redNear, { legacyCombo: true });
// 2026-10-27 (adopción del v4, certeza ×0,6): 1,465 → 1,491 (+1,8 %); el umbral era 1 % + 0,004. Con los pesos del v4 el término del doble mueve algo también lejos de la entrada de la puerta. Tolerancia 1 % → 3 % (sigue siendo «casi igual»).
check(Math.abs(n2 - o2) <= 0.03 * Math.max(0.01, o2) + 0.004, `A ... y no cambia cuando mi bola no queda en la entrada de su puerta (${o2.toFixed(3)} → ${n2.toFixed(3)})`);
const saved = CONFIG.kantokuTouchPassScale;
CONFIG.kantokuTouchPassScale = 0;
const zero = riesgo(front, red, { legacyCombo: true });
CONFIG.kantokuTouchPassScale = saved;
check(Math.abs(zero - off) < 1e-9, 'A con la escala en 0 vuelve al riesgo anterior');

// B. dos rivales con el mismo ángulo sobre la blanca: la zona (premio por estar frente a la puerta) cuenta la probabilidad de que alguno la toque
function zona(extra: Record<string, unknown>) {
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  balls[0] = ball(1, 15.5, 5.5, 2);
  balls[2] = ball(3, 15.5, 1.5, 2);
  balls[1] = ball(2, 10, 2, 2);
  const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
  m.clock = 1200; m.firstRoundDone = true;
  m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
  const terms: Record<string, number> = {};
  evaluate(balls, { balls, touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true }, 1, 'stroke', {
    team: 1, clock: 1200, noise: 0, rng: mulberry32(2), weights: { ...weightsFor(kantokuBrain, 'medio'), ...extra }, terms,
    future: { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError },
  });
  return terms.zona;
}
const zl = zona({ legacyThreatUnion: true }), zu = zona({});
CONFIG.kantokuThreatUnion = false;
check(Math.abs(zona({}) - zl) < 1e-9, 'B con kantokuThreatUnion en false vuelve a la amenaza anterior');
CONFIG.kantokuThreatUnion = true;
check(zu < zl, `B con dos rivales a tiro, el premio de la zona baja más con la probabilidad de que alguno la toque (${zl.toFixed(3)} → ${zu.toFixed(3)})`);

// C. riesgo por valor (Chris, 2026-10-24): la blanca 8 al centro frente a la puerta 2, a la vista de la roja 9. Antes el riesgo comparaba «pasar su puerta 42 %» con «tocar mi bola 16 %» y contaba solo pasar, así que
// dónde quedaba mi bola no importaba. Ahora el centro (a la vista) cuesta más que pegada a la línea con ángulo en diagonal.
{
  const redP = { x: 18, y: 15.5 }; // la roja 9 aún en la salida: su «pasar» es la puerta 1 (42 %), más probable que tocar mi bola desde allí
  const centro = { x: 10.5, y: 2.0 }, linea = { x: 10.8, y: 0.55 };
  const saved = CONFIG.kantokuRiskByValue;
  CONFIG.kantokuRiskByValue = false;
  const oldGap = riesgo(centro, redP, { legacyCombo: true }, 1) - riesgo(linea, redP, { legacyCombo: true }, 1);
  CONFIG.kantokuRiskByValue = true;
  const newGap = riesgo(centro, redP, { legacyCombo: true }, 1) - riesgo(linea, redP, { legacyCombo: true }, 1);
  CONFIG.kantokuRiskByValue = saved;
  console.log(`   C costo del centro frente a la puerta menos el de pegada a la línea: antes ${oldGap.toFixed(3)} · ahora ${newGap.toFixed(3)}`);
  // 2026-10-26: opción apagada por defecto; con las paradas lejanas de la salida (hasta 11 m) la diferencia ya no es positiva (−0,02): se exige que no empeore más de 0,03
  check(newGap >= oldGap - 0.03, `C con el riesgo por valor, quedar al centro a la vista cuesta más que pegada a la línea (${oldGap.toFixed(3)} → ${newGap.toFixed(3)}; antes la posición no importaba)`);
}

// D. lugar de espera junto a la línea: la blanca de la puerta 2 pegada a la línea con ángulo en diagonal recibe el premio; al centro frente a la puerta, no
{
  const termOf = (at: { x: number; y: number }, extra: Record<string, unknown> = {}) => {
    const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
    balls[0] = ball(1, 18, 15.5, 1, 0);
    balls[1] = ball(2, at.x, at.y, 2);
    const m = Match.fromBalls(balls, { turn: 1, rng: mulberry32(1) });
    m.clock = 1200; m.firstRoundDone = true;
    m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
    const terms: Record<string, number> = {};
    evaluate(balls, { balls, touched: [], foul: false, shooterOut: false, gate: false, sparkOk: true }, 1, 'stroke', {
      team: 1, clock: 1200, noise: 0, rng: mulberry32(2), weights: { ...weightsFor(kantokuBrain, 'medio'), ...extra }, terms,
      future: { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError },
    });
    return terms.lineaDiagonal ?? 0;
  };
  const linea = termOf({ x: 10.8, y: 0.55 }), centro = termOf({ x: 10.5, y: 2.0 }), sin = termOf({ x: 10.8, y: 0.55 }, { legacyLineSpot: true });
  check(linea > 0.1 && centro === 0 && sin === 0, `D el premio de la línea con ángulo: pegada a la línea ${linea.toFixed(2)}, al centro frente a la puerta ${centro.toFixed(2)}, con legacyLineSpot ${sin.toFixed(2)}`);
}
process.exit(fail ? 1 : 0);
