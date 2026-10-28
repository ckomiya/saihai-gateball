// Reentrada (v1.2, Chris, 2026-10-27): casi siempre hay que entrar, y se valora la línea y otros tramos alcanzables.
//  A  no entrar cuesta `failReenter` + `kantokuReentryMust`, salvo en la última vuelta de esa bola yendo ganando (queda menos de `kantokuReentryLastTurns` de turno después del actual y la ventaja ≥ `kantokuReentryLead`);
//  B  los candidatos de reentrada incluyen posiciones pegadas a la línea en otros tramos (a más de 4 m del lugar por donde salió la bola), no solo el abanico de 4 m;
//  C  las dos reglas se apagan con `legacyReentryMust` / `legacyLineCands`.
// Las pruebas de posición (rivales dominando) y de que entra están en la batería `npm run behavior`.
import { CONFIG, kantokuLevelBase } from '../src/config';
import { scaleError } from '../src/game/certainty';
import { Outcome, candidates, evaluate } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number, out = false, points = 1): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: out, points });

/** Valor del término `noEntra` de una reentrada que falla (la bola vuelve a salir) con `turns` turnos por delante de esa bola y `lead` puntos de ventaja; la bola 9 (roja) es la que reentra. */
function noEntra(turns: number, lead: number, extra: Record<string, unknown> = {}) {
  const balls: BallState[] = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED, false, 0));
  balls[8] = ball(9, 15, -0.35, 2, true);
  balls[1] = ball(2, 6, 8, 3);
  const m = Match.fromBalls(balls, { turn: 8, rng: mulberry32(1) });
  m.clock = 900; m.firstRoundDone = true;
  const turnsArr = new Array<number>(10).fill(0); turnsArr[8] = turns;
  const out: Outcome = { balls: balls.map((b) => ({ ...b })), touched: [], foul: false, shooterOut: true, gate: false, sparkOk: true };
  const terms: Record<string, number> = {};
  evaluate(balls, out, 8, 'stroke', {
    team: 0, clock: 900, noise: 0, rng: mulberry32(2), weights: { ...weightsFor(kantokuBrain, 'medio'), ...extra }, terms, lead,
    future: { seq: upcomingTurns(m), turns: turnsArr, profiles: m.profiles, base: scaleError(kantokuLevelBase(), CONFIG.kantokuLevelPlanScale), rivalBase: CONFIG.humanRivalError },
  });
  return -(terms.noEntra ?? 0);
}
const base = noEntra(3, 0, { legacyReentryMust: true });
const tied = noEntra(3, 0), ahead = noEntra(3, 2), lastTied = noEntra(0, 0), lastAhead = noEntra(0, 2), lastOne = noEntra(0, 1);
check(Math.abs(tied - (base + CONFIG.kantokuReentryMust)) < 1e-9, `A no entrar con turnos por delante cuesta ${tied.toFixed(1)} (= ${base.toFixed(1)} + ${CONFIG.kantokuReentryMust})`);
check(Math.abs(ahead - tied) < 1e-9, `A ... aunque vaya ganando, si a la bola le quedan turnos (${ahead.toFixed(1)})`);
check(Math.abs(lastTied - tied) < 1e-9, `A ... y en su última vuelta sin ir ganando (${lastTied.toFixed(1)})`);
check(Math.abs(lastAhead - base) < 1e-9 && Math.abs(lastOne - base) < 1e-9, `A en la última vuelta yendo ganando solo cuesta lo normal (${lastAhead.toFixed(1)} con +2, ${lastOne.toFixed(1)} con +1)`);

// B
const origin = { x: -0.35, y: 7.5 };
const bs = [ball(1, 18, 15.5, 1), ball(2, origin.x, origin.y, 2, true), ...Array.from({ length: 8 }, (_, i) => ball(i + 3, 18, 15.5, FINISHED, false, 0))];
const onLine = (c: { aim: { x: number; y: number } }) => c.aim.x >= 0.3 && c.aim.x <= 1.2 && Math.abs(c.aim.y - origin.y) > 4.5;
const withLines = candidates(origin, 1, bs, 'stroke', -1, true, true, false, false, true), without = candidates(origin, 1, bs, 'stroke', -1, true, true, false, false, false);
check(withLines.filter(onLine).length >= 8 && without.filter(onLine).length === 0, `B hay candidatos pegados a la línea en otros tramos: ${withLines.filter(onLine).length} (antes ${without.filter(onLine).length}) de ${withLines.length}`);
check(withLines.some((c) => c.aim.y < origin.y - 6) && withLines.some((c) => c.aim.y > origin.y + 6), 'B ... hacia los dos lados del lugar por donde salió');
// C
check(Math.abs(noEntra(0, 2, { legacyReentryMust: true }) - base) < 1e-9, 'C con `legacyReentryMust` el costo vuelve a `failReenter`');
process.exit(fail ? 1 : 0);
