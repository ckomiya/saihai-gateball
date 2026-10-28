// Casos reales de la partida 20261027-114432 (kantoku-v1.0 de blancas contra Chris): reentraba en zonas vulnerables. Los tableros son los literales del registro (`partidas/`, ver `EXPOSURE_CASES` en `scripts/behavior.ts`).
// Los tres criterios de Chris (2026-10-27), medidos sobre esos tableros:
//  A  «enviar a marcar»: la rival que toca a una compañera suya y la manda junto a mi bola cuenta como amenaza (`sendThreat`), si esa bola juega antes de que la mía pueda salir;
//  B  una compañera que cubre solo cuenta si ninguna rival que juega antes puede sacarla (`coverSurvival`: la 7 saca a la 8 en el turno 32);
//  C  con pocas compañeras que lleguen vivas a su turno (cobertura efectiva) el riesgo pesa más (turnos 32 y 34; en el 42 viven la 4, la 8 y la 10);
//  D  la reentrada no queda más expuesta que en la partida (la batería `npm run behavior` tiene un escenario por caso) y los tableros discriminan: el kantoku v1.0 (`cpuWeights.v10.json`) falla los casos 16 y 40.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { errorsAt } from '../src/game/certainty';
import { cpuPlan, futureOf, kantokuLevelErrors } from '../src/game/cpuDriver';
import { coverSurvival, sendThreat } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile } from '../src/game/weights';
import { EXPOSURE_CASES, behaviorScore } from '../scripts/behavior';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };
const rErr = (_i: number, d: number) => errorsAt(CONFIG.humanRivalError, { short: 1, medium: 1, long: 1 }, d);
const byName = (t: number) => EXPOSURE_CASES.find((c) => c.turn === t)!;
/** El tablero tal como quedó en la partida (la bola ya en su lugar) y le toca al siguiente. */
const loggedBoard = (t: number) => {
  const c = byName(t), B = mk(c.rows), bi = c.ball - 1;
  B[bi].x = c.logged[0]; B[bi].y = c.logged[1]; B[bi].outBall = false;
  const m = Match.fromBalls(B, { turn: c.ball % 10, rng: mulberry32(1) });
  m.clock = c.clock - 15; m.turnStarts = 41; m.firstRoundDone = true;
  const first = new Map<number, number>();
  futureOf(m, { errors } as never).seq.forEach((i, k) => { if (!first.has(i)) first.set(i, k); });
  return { m, first, bi };
};

// A
for (const c of EXPOSURE_CASES) {
  const { m, first, bi } = loggedBoard(c.turn);
  let best = 0, who = 0;
  for (let r = 0; r < 10; r++) if (m.balls[r].team === 0) { const v = sendThreat(m.balls, r, bi, first, 1, rErr, CONFIG.kantokuContinuationAttack); if (v > best) { best = v; who = r + 1; } }
  check(best >= 0.05, `A ${c.name}: una rival puede mandar a marcar a mi bola donde quedó (la roja ${who}: ${best.toFixed(2)}; sin la amenaza valía 0)`);
}
// B: la 7 saca a la 8 y a la 10 (turno 32); en el 22 la 10 y la 8 están a merced de la 3
{
  const { m, first } = loggedBoard(32);
  const s8 = coverSurvival(m.balls, 7, first, 1, rErr), s10 = coverSurvival(m.balls, 9, first, 1, rErr);
  check(s8 <= 0.1 && s10 <= 0.1, `B turno 32: la 8 y la 10 llegan vivas a su turno con ${s8.toFixed(2)} y ${s10.toFixed(2)}: no cubren`);
  const l = loggedBoard(22);
  check(coverSurvival(l.m.balls, 9, l.first, 1, rErr) <= 0.1, `B turno 22: la 10 no cubre (${coverSurvival(l.m.balls, 9, l.first, 1, rErr).toFixed(2)})`);
  check(coverSurvival(l.m.balls, 3, l.first, 1, rErr) >= 0.9, `B ... y la 4, que ninguna rival alcanza, sí (${coverSurvival(l.m.balls, 3, l.first, 1, rErr).toFixed(2)})`);
}
// C: el riesgo de la jugada elegida pesa más con la cancha abierta
{
  // v1.3: el v1.0 no tenía los candidatos de reentrada lejanos ni el costo de salir a propósito ni la cadena del último turno
  const v10: AnyWeightFile = { ...JSON.parse(readFileSync('src/game/cpuWeights.v10.json', 'utf8')), legacyFarEntry: true, legacySelfOut: true, legacyLastTurn: true };
  const legacyOpen = { ...(kantokuBrain as { file: AnyWeightFile }).file, legacyOpenField: true } as AnyWeightFile;
  const riskOf = (t: number, file: AnyWeightFile) => {
    const c = byName(t), m = Match.fromBalls(mk(c.rows), { turn: c.ball - 1, rng: mulberry32(500) });
    m.clock = c.clock; m.turnStarts = 40; m.firstRoundDone = true;
    const ex = cpuPlan(m, 3, { brain: { kind: 'kantoku', file }, errors, explain: true }).decision!.explanation as unknown as { alternatives: { terms: Record<string, number> }[] };
    return ex.alternatives[0].terms.riesgo;
  };
  for (const t of [32, 34]) {
    const a = riskOf(t, (kantokuBrain as { file: AnyWeightFile }).file), b = riskOf(t, legacyOpen);
    check(a < b - 0.2, `C turno ${t}: con la cancha abierta (compañeras sin cobertura) el riesgo pesa más (${b.toFixed(2)} → ${a.toFixed(2)})`);
  }
  // D: los escenarios discriminan
  const now = behaviorScore((kantokuBrain as { file: AnyWeightFile }).file, 6).detail, old = behaviorScore(v10, 6).detail;
  const key = (t: number) => Object.keys(now).find((k) => k.startsWith(`T${t} (`))!;
  for (const t of [16, 40]) check(old[key(t)] <= 0.2 && now[key(t)] >= 0.5, `D caso ${t}: el kantoku v1.0 lo falla (${(100 * old[key(t)]).toFixed(0)} %) y el actual lo cumple (${(100 * now[key(t)]).toFixed(0)} %)`);
  for (const c of EXPOSURE_CASES) check(now[key(c.turn)] >= 0.5, `D caso ${c.turn}: el kantoku actual cumple su escenario (${(100 * now[key(c.turn)]).toFixed(0)} %)`);
}
process.exit(fail ? 1 : 0);
