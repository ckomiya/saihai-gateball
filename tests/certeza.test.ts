// Certeza del nivel «Kantoku IA» (Chris, 2026-10-26): la de un buen jugador humano (`humanRivalError` × `kantokuLevelErrorScale`), la misma para lo que ejecuta y lo que el kantoku cree de sí mismo.
//  A  coherencia: ejecución y planificación usan el mismo error, y es un poco más certero que el humano medio (touch 6 m ≈ 50 %, 13 m ≈ 20 %), no sobrehumano;
//  B  sin ser torpe en lo corto: un buen jugador (modelo del rival humano) pasa la puerta 1 desde la salida en 85-95 % y el kantoku en ≥ 90 %; los touches de 6 m o más no cambian con el ajuste del rumbo corto (con ×0,53, 2026-10-27: 79 / 56,7 / 37,9 % a 6 / 9 / 13 m; con ×0,6 eran 74 / 52 / 34);
//  C  elige jugadas acordes a su certeza: ante una rival a ~8 m en campo abierto intenta menos touches que con la certeza anterior (×0,4) (con la certeza sola no bastaba: el touch vale 3,3 + el spark; por eso `kantokuTouchMinP`, 45 %); con la rival cerca la ataca igual.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { touchProbability, scaleError } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points });
const board = (over: Record<number, BallState>): BallState[] => {
  const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, 0));
  for (const [n, v] of Object.entries(over)) b[Number(n) - 1] = v;
  return b;
};
const NEW = { ...kantokuLevelErrors(), rivalIsHuman: true };
const OLD = { base: CONFIG.kantokuBaseError, executionScale: 0.4, planningScale: 0.4, rivalIsHuman: true };
const normal = { short: 1, medium: 1, long: 1 };
const irregular = { short: 1.4, medium: 1.4, long: 1.4 }; // jugador irregular de `playerCertainty`

// A
{
  check(NEW.executionScale === NEW.planningScale, `A ejecución y planificación usan la misma escala (${NEW.executionScale} y ${NEW.planningScale})`);
  const e = scaleError(kantokuLevelBase(), NEW.executionScale ?? 1);
  const h = CONFIG.humanRivalError;
  const p6 = touchProbability(e, 6, true), p13 = touchProbability(e, 13, true), h6 = touchProbability(h, 6, true), h13 = touchProbability(h, 13, true);
  check(CONFIG.kantokuLevelHuman && p6 >= h6 && p6 <= h6 + 0.3 && p13 >= h13 && p13 <= h13 + 0.2, `A touch a 6 m ${(100 * p6).toFixed(0)} % y a 13 m ${(100 * p13).toFixed(0)} % (humano medio ${(100 * h6).toFixed(0)} % y ${(100 * h13).toFixed(0)} %; antes 97 % y 63 %)`);
}
// B. la puerta 1 desde la salida con tiros reales (la física del juego): un buen jugador la pasa 9 de cada 10 veces (Chris, 2026-10-26)
{
  const T = 100;
  const gate1 = (errors: { base: typeof CONFIG.humanRivalError; executionScale?: number; planningScale?: number; rivalIsHuman?: boolean }) => {
    let ok = 0;
    for (let t = 0; t < T; t++) {
      const m = Match.fromBalls(board({ 2: ball(2, 18, 15.5, 1, 0) }), { turn: 1, rng: mulberry32(700 + t) });
      m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
      m.profiles = m.profiles.map(() => ({ ...normal }));
      const plan = cpuPlan(m, 3, { brain: kantokuBrain, errors });
      m.b.x = plan.startX;
      let res = m.shoot(plan.aim, plan.power, plan.acc);
      for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
      if (!res) { m.forceStop(); res = m.resolution!; }
      if (res.shotGate === 1) ok++;
    }
    return ok;
  };
  const kant = gate1(NEW), human = gate1({ base: CONFIG.humanRivalError, rivalIsHuman: false }); // el modelo del rival humano: humanRivalError × 1
  check(human >= 0.85 * T && human <= 0.95 * T, `B un buen jugador (modelo del rival humano) pasa la puerta 1 desde la salida en ${human}/${T} (85-95 %; antes del ajuste del rumbo en tiros cortos, 48 %)`);
  check(kant >= 0.9 * T, `B el kantoku (humano ×${CONFIG.kantokuLevelErrorScale}) la pasa en ${kant}/${T} (≥ 90 %; antes 63 %)`);
  // los touches medios y largos no cambian con el ajuste (el factor del rumbo vale 1 desde `accLongM`)
  const e = scaleError(kantokuLevelBase(), NEW.executionScale ?? 1);
  const t6 = touchProbability(e, 6, true), t9 = touchProbability(e, 9, true), t13 = touchProbability(e, 13, true);
  check(Math.abs(t6 - 0.79) <= 0.03 && Math.abs(t9 - 0.567) <= 0.03 && Math.abs(t13 - 0.379) <= 0.03, `B touches medios y largos sin cambio por el rumbo corto: 6 m ${(100 * t6).toFixed(0)} %, 9 m ${(100 * t9).toFixed(0)} %, 13 m ${(100 * t13).toFixed(0)} % (79 / 56,7 / 37,9 % con ×0,53; antes de subir la certeza, 74 / 52 / 34 con ×0,6)`);
}
// C
{
  const attempts = (b: BallState[], errors: typeof NEW, N: number, prof = normal) => {
    let n = 0;
    for (let t = 0; t < N; t++) {
      const m = Match.fromBalls(b, { turn: 1, rng: mulberry32(900 + t) });
      m.clock = 1200; m.turnStarts = 30; m.firstRoundDone = true;
      m.profiles = m.profiles.map(() => ({ ...prof }));
      const plan = cpuPlan(m, 3, { brain: kantokuBrain, errors, explain: true });
      if (plan.decision?.intended.touched.includes(1)) n++;
    }
    return n;
  };
  const N = 24;
  // v1.3 (certeza ×0,53): a 8 m el jugador irregular ya supera `kantokuTouchMinP` (45 %) y la regla fija lo deja intentar (0/24 con ×0,6, 23/24 desde ×0,56); la prueba sigue midiendo lo mismo, un touch por debajo de ese mínimo, con la rival a 9 m
  const mid = board({ 2: ball(2, 12, 3, 3), 1: ball(1, 12, 12.0, 2) }); // rival a 9 m, en campo abierto
  const near = board({ 2: ball(2, 12, 3, 3), 1: ball(1, 12, 6, 2) }); // rival a 3 m
  const nm = attempts(mid, NEW, N, irregular), om = attempts(mid, OLD, N, irregular), nn = attempts(near, NEW, N, irregular), nr = attempts(mid, NEW, N);
  console.log(`   jugador irregular, rival a 8 m en campo abierto: certeza nueva ${nm}/${N}, anterior ${om}/${N} · rival a 3 m: nueva ${nn}/${N} · (jugador normal a 8 m: nueva ${nr}/${N}, touch ≈ 52 %)`);
  check(nm < om && nn >= 0.6 * N, `C jugador irregular (touch a 8 m bajo kantokuTouchMinP): intenta menos que antes (${nm} contra ${om}); rival cerca: la ataca (${nn}/${N})`);
}
process.exit(fail ? 1 : 0);
