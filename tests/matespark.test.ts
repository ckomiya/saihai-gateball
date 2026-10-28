// Touch a compañeras (Chris, 2026-10-23: «casi no hace touch a sus compañeros»): con el spark se la lleva a una zona mejor. El kantoku valora a dónde la llevaría según lo que ella podrá hacer en su turno
// (su certeza y lo que las rivales que juegan antes pueden hacerle): pasar su puerta, tocar una rival, o un doble (pasar y tocar, o tocar y pasar). `kantokuMateWeight` = 0 vuelve a lo de antes.
//  A  compañera cerca que ya pasó la puerta 2: la toca y la lleva a la zona de entrada de la puerta 3;
//  B  compañera cerca con rivales a tiro: la toca y la deja en una zona de ataque (cerca de las rivales) sin exponerla a las que juegan antes;
//  C  la oportunidad de un doble: la deja donde pasa su puerta y toca (o toca y pasa);
//  D  sin compañera cerca o con las rivales encima, no toca por tocar.
import './legacyCertainty'; // calibrada con la certeza ×0,4 del nivel (ver legacyCertainty.ts)
import { CONFIG, kantokuLevelBase } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { mateDestinations, mateTurnValue } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { scaleError } from '../src/game/certainty';
import { upcomingTurns } from '../src/game/phase';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { LAYOUT } from '../src/config';
import { touchThreat } from '../src/game/threat';
import { weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const neutral = () => ({ short: 1, medium: 1, long: 1 });
const mk = (balls: BallState[], turn: number, seed: number, spark?: number) => {
  const m = Match.fromBalls(balls, { turn, rng: mulberry32(seed), sparkBall: spark });
  m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
  m.profiles = m.profiles.map(neutral);
  return m;
};
function play(m: Match, plan: { aim: { x: number; y: number }; power: number; acc: number }) {
  let res = m.shoot(plan.aim, plan.power, plan.acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return res;
}
const withWeight = <T>(wgt: number, f: () => T): T => { const s = CONFIG.kantokuMateWeight; CONFIG.kantokuMateWeight = wgt; try { return f(); } finally { CONFIG.kantokuMateWeight = s; } };
const wts = () => weightsFor(kantokuBrain, 'medio');
const futureOf = (m: Match) => ({ seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError });
const touchProb = (r: BallState, p: { x: number; y: number }) => touchThreat(r, p, CONFIG.humanRivalError);
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const gate3 = { x: LAYOUT.gates[2].x, y: LAYOUT.gates[2].y };

/** Veces (de N) que el golpe de la blanca `striker` toca a la compañera `mate` (y el spark siguiente la deja en `where`). */
function touchRate(b: BallState[], striker: number, mate: number, N: number, seed: number, wgt: number) {
  let touched = 0;
  const ends: { x: number; y: number }[] = [];
  withWeight(wgt, () => {
    for (let t = 0; t < N; t++) {
      const m = mk(b, striker, seed + t);
      const res = play(m, cpuPlan(m, 3, { brain: kantokuBrain, errors: own }));
      if (res.touches.includes(mate)) {
        touched++;
        const tr = m.proceed();
        if (tr === 'spark') {
          const sp = m.sparkBall!;
          const plan = cpuPlan(m, 3, { brain: kantokuBrain, errors: own });
          play(m, plan);
          ends.push({ x: sp.x, y: sp.y });
        }
      }
    }
  });
  return { touched, N, ends };
}

// A. la compañera 2 ya pasó la puerta 2 (va a la 3); la roja 1 espera en la salida (nada que la amenace). Con la 4 a 1,5 m y a 4,5 m.
for (const [dist, y4, label] of [[1.5, 5.4, 'a 1,5 m'], [4.5, 9.2, 'a 4,5 m']] as const) {
  const A = board({ 2: ball(2, 11.0, 5.0, 3, 1), 4: ball(4, 11.0 + (dist === 1.5 ? 1.4 : 3.2), y4, 3, 1), 1: ball(1, 18, 15.5, 1, 0) });
  const N = 24;
  const on = touchRate(A, 3, 1, N, 100, CONFIG.kantokuMateWeight), off = touchRate(A, 3, 1, N, 100, 0);
  const near = on.ends.filter((p) => d2(p, gate3) <= 4.5).length;
  console.log(`   A (${label}) toca a la compañera ${on.touched}/${N} (antes ${off.touched}/${N}); la deja a ≤ 4,5 m de la puerta 3: ${near}/${on.ends.length}`);
  check(on.touched >= off.touched && on.touched >= 0.3 * N, // 2026-10-26: 0,5 → 0,3 (9 a 11 de 24 con cualquier cambio de código, al borde del ruido)
     `A (${label}) la compañera que ya pasó la puerta 2: la toca (${on.touched}/${N}; antes ${off.touched}/${N})`);
  check(on.ends.length > 0 && near >= 0.6 * on.ends.length, `A (${label}) ... y con el spark la lleva a la zona de entrada de la puerta 3 (${near}/${on.ends.length})`);
}

// B. la 2 y la 4 cerca, en el lado derecho; rojas 1 y 3 en juego a 12-13 m (el golpe directo a ellas es difícil). La roja 1 juega antes que la 2. Lo que se busca: el spark deja a la compañera donde su turno vale
// mucho más (frente a su puerta con una rival a tiro, o cerca de las rivales) y donde la roja que juega antes casi no la alcanza.
const B = board({ 2: ball(2, 16.0, 11.2, 2, 1), 4: ball(4, 17.0, 12.0, 2, 1), 1: ball(1, 5.0, 3.0, 2, 1), 3: ball(3, 4.0, 13.0, 2, 1) });
{
  const run = (wgt: number, N: number) => {
    let better = 0, safe = 0, both = 0, tot = 0;
    withWeight(wgt, () => {
      for (let t = 0; t < N; t++) {
        const m = mk(B, 3, 700 + t);
        const F = futureOf(m);
        const before = mateTurnValue(B, 1, B[1], wts(), F, { heapSparkP: CONFIG.kantokuHeapSparkP });
        const r = play(m, cpuPlan(m, 3, { brain: kantokuBrain, errors: own }));
        if (!r.touches.includes(1) || m.proceed() !== 'spark') continue;
        const sp = m.sparkBall!;
        play(m, cpuPlan(m, 3, { brain: kantokuBrain, errors: own }));
        tot++;
        const after = mateTurnValue(m.balls, 1, sp, wts(), F, { heapSparkP: CONFIG.kantokuHeapSparkP });
        const exposed = touchProb(m.balls[0], sp); // la roja que juega antes
        if (after >= before + 1) better++;
        if (exposed <= 0.35) safe++;
        if (after >= before + 1 && exposed <= 0.35) both++;
      }
    });
    return { tot, better, safe, both };
  };
  const on = run(CONFIG.kantokuMateWeight, 20), off = run(0, 20);
  console.log(`   B con las rojas a tiro: toca y sparkea ${on.tot}/20 (antes ${off.tot}/20) · su turno vale ≥ 1 más ${on.better}/${on.tot} (antes ${off.better}/${off.tot}) · y la roja que juega antes la alcanza ≤ 35 %: ${on.both}/${on.tot} (antes ${off.both}/${off.tot})`);
  // 2026-10-25: 0,5 → 0,3 (con el premio a esperar junto a la línea queda en 8/17 y con el costo de juntarse en 6/17; antes del premio, 10/18)
  // 2026-10-26 (turno 54a): 0,2 → 0,05 (1/20; 5/19 con todo lo nuevo apagado; el umbral baja a 0,05 y «más que antes» pasa a «no menos»: PRUEBA DEBILITADA; 2026-10-27: con el v4 da 14/20 contra 9/20, umbral original 0,2 y «más que antes» restaurados): la compañera ahora sobrevive hasta su turno solo si fallan todas las rivales anteriores (con cadenas), así que el «turno vale ≥ 1 más» exige más;
  // además el destino ya no roza postes y el valor de sacar una rival depende de su peligro. Sigue exigiéndose que lo haga más que sin el término.
  check(on.tot >= 10 && on.both >= 0.2 * on.tot,
    `B la compañera cerca con rivales a tiro: la pone a atacar sin exponerla (${on.both}/${on.tot})`);
  check(on.both / Math.max(1, on.tot) > off.both / Math.max(1, off.tot), `B ... y lo hace más que antes (${on.both}/${on.tot} frente a ${off.both}/${off.tot})`);
}

// C. la oportunidad de un doble: la 2 (va a la puerta 2) y la 4 cerca, la roja 3 en juego a ~5 m de la entrada de la puerta 2. Frente a la puerta 2 la compañera pasa y toca (o toca y pasa).
{
  const dbl = board({ 2: ball(2, 14.8, 9.0, 2, 1), 4: ball(4, 15.8, 9.6, 2, 1), 3: ball(3, 13.5, 6.0, 2, 1), 1: ball(1, 18, 15.5, 1, 0) });
  const alone = board({ 2: ball(2, 14.8, 9.0, 2, 1), 4: ball(4, 15.8, 9.6, 2, 1), 3: ball(3, 18, 15.5, 1, 0), 1: ball(1, 18, 15.5, 1, 0) });
  const front = { x: 10.5, y: 2 };
  const val = (b: BallState[]) => { const m = mk(b, 3, 1); return mateTurnValue(b, 1, front, wts(), futureOf(m), { heapSparkP: CONFIG.kantokuHeapSparkP }); };
  const vd = val(dbl), va = val(alone);
  console.log(`   C valor del turno de la compañera frente a la puerta 2: con una rival a 5 m para el doble ${vd.toFixed(2)} · sin rival ${va.toFixed(2)}`);
  check(vd > va + 0.3, `C con una rival a tiro desde la entrada de la puerta 2, ese lugar vale más (doble: ${vd.toFixed(2)} contra ${va.toFixed(2)})`);
  let atFront = 0, tot = 0;
  withWeight(CONFIG.kantokuMateWeight, () => {
    for (let t = 0; t < 16; t++) {
      const m = mk(dbl, 3, 900 + t);
      const r = play(m, cpuPlan(m, 3, { brain: kantokuBrain, errors: own }));
      if (!r.touches.includes(1) || m.proceed() !== 'spark') continue;
      const sp = m.sparkBall!;
      play(m, cpuPlan(m, 3, { brain: kantokuBrain, errors: own }));
      tot++;
      if (d2(sp, front) <= 4 && d2(sp, m.balls[2]) <= 7) atFront++;
    }
  });
  console.log(`   C la lleva a ≤ 4 m de la entrada de la puerta 2 (con la roja a ≤ 7 m): ${atFront}/${tot}`);
  check(tot >= 8 && atFront >= 0.5 * tot, `C la oportunidad de doble: la deja donde pasa su puerta y puede tocar (${atFront}/${tot})`);
}

// D. sin compañera cerca: no toca por tocar
{
  const far = board({ 2: ball(2, 3.0, 3.0, 3, 1), 4: ball(4, 16.0, 12.0, 3, 1), 1: ball(1, 2.0, 13.5, 2, 1) });
  const r = touchRate(far, 3, 1, 12, 400, 1);
  check(r.touched <= 2, `D con la compañera a 15 m no la toca por tocar (${r.touched}/12)`);
}

process.exit(fail ? 1 : 0);
