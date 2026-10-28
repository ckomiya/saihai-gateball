// Pruebas del motor de reglas (src/game/match.ts) sin navegador: `npm test`.
// 1) Los escenarios de tests/scenarios.ts dan lo mismo que la escena anterior (tests/golden.json, grabado con ella).
// 2) El azar con semilla es repetible; 3) un partido completo CPU contra CPU termina y es repetible con la misma semilla.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { Match } from '../src/game/match';
import { messagesFor } from '../src/game/messages';
import { mulberry32 } from '../src/game/rng';
import { SCENARIOS, Scenario } from './scenarios';
import { compareRuns } from './compare';

/** Ejecuta un escenario con el motor, igual que `tests/browser-golden.ts` lo hace con la escena: mismo `dt` y mismo orden por cuadro. */
export function runScenarioNode(sc: Scenario) {
  const m = new Match(() => 0.5); // sin desvío del pasto: determinista
  m.reset();
  for (const bs of sc.balls ?? []) {
    const b = m.balls[bs.n - 1];
    if (bs.nextGate !== undefined) b.nextGate = bs.nextGate;
    if (bs.outBall !== undefined) b.outBall = bs.outBall;
    if (bs.points !== undefined) b.points = bs.points;
  }
  m.beginTurn(sc.turn);
  for (const bs of sc.balls ?? []) {
    const b = m.balls[bs.n - 1];
    if (bs.x !== undefined) b.x = bs.x;
    if (bs.y !== undefined) b.y = bs.y;
  }
  if (sc.clock !== undefined) m.clock = sc.clock;
  if (sc.ending) m.ending = true;
  if (sc.endNow) m.endNow = true;
  if (sc.sparked) m.sparkedThisTurn = new Set(sc.sparked.map((n) => m.balls[n - 1]));
  let phase = m.b.nextGate === 1 ? 'set' : 'aim';
  const dt = Math.min(1000 / 60 / 1000, 1 / 20);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  const steps = [];
  for (const st of sc.steps) {
    const who = m.b.n;
    let res = m.shoot(st.aim, st.power, st.acc);
    for (let i = 0; i < 40000 && !res && m.stage === 'rolling'; i++) {
      m.update(dt, true); // el reloj corre mientras la bola rueda
      if (m.step(dt)) res = m.resolution;
    }
    const msgs = res ? messagesFor(res.events) : [];
    if (res) {
      const t = m.proceed();
      phase = t === 'end' ? 'done' : t === 'turn' ? (m.b.nextGate === 1 ? 'set' : 'aim') : 'aim';
    } else phase = 'rolling';
    steps.push({
      who,
      msgs,
      turn: m.turn,
      phase,
      owed: m.owed,
      spark: m.sparkBall ? m.sparkBall.n : 0,
      ending: m.ending,
      endNow: m.endNow,
      clock: r6(m.clock),
      sparked: [...m.sparkedThisTurn].map((o) => o.n).sort((a, b) => a - b),
      balls: m.balls.map((b) => ({ n: b.n, x: r6(b.x), y: r6(b.y), g: b.nextGate, out: b.outBall, p: b.points })),
    });
    if (phase === 'rolling') break;
  }
  return { name: sc.name, steps };
}

// El golden se grabó con clockFactor 6; se fija aquí para que las pruebas de reglas no dependan de ese valor de ajuste.
const GAME_CLOCK_FACTOR = CONFIG.clockFactor;
CONFIG.clockFactor = 6;
const GAME_OUT_OFFSET = CONFIG.outBallOffsetM; // el golden también se grabó con la bola fuera a 10 cm de la línea
CONFIG.outBallOffsetM = 0.1;
const GAME_BOUNCE = CONFIG.bounce; // ... y con el rebote contra postes en 0,45 (el juego usa 0,35 desde 2026-10-26)
CONFIG.bounce = 0.45;

let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failures++; console.log('✗ ' + msg); } else console.log('✓ ' + msg); };

// 1) Reglas = escena anterior
const golden = JSON.parse(readFileSync('tests/golden.json', 'utf8'));
const diffs = compareRuns(golden, SCENARIOS.map(runScenarioNode));
if (diffs.length) console.log(diffs.join('\n'));
check(diffs.length === 0, `${SCENARIOS.length} escenarios de reglas iguales a la escena anterior`);

// 2) Semilla
const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
const sa = [a(), a(), a()], sb = [b(), b(), b()], sc2 = [c(), c(), c()];
check(JSON.stringify(sa) === JSON.stringify(sb) && JSON.stringify(sa) !== JSON.stringify(sc2) && sa.every((v) => v >= 0 && v < 1), 'mulberry32: misma semilla, misma secuencia');

CONFIG.clockFactor = GAME_CLOCK_FACTOR; // el partido completo usa los valores del juego
CONFIG.outBallOffsetM = GAME_OUT_OFFSET;
CONFIG.bounce = GAME_BOUNCE;
// 3) Partido completo con la CPU (se carga aparte para que las pruebas de reglas no dependan de la CPU)
const { playMatch } = await import('../scripts/selfplay');
const g1 = playMatch({ seed: 7, levels: [3, 3] });
const g2 = playMatch({ seed: 7, levels: [3, 3] });
check(g1.strokes > 20 && ['perfect', 'time', 'allIn'].includes(g1.reason), `partido CPU contra CPU termina (${g1.strokes} golpes, ${g1.red}-${g1.white}, ${g1.reason})`);
check(g1.red === g2.red && g1.white === g2.white && g1.strokes === g2.strokes && g1.clockLeft === g2.clockLeft, 'el mismo partido con la misma semilla da lo mismo');

if (failures) { console.log(`\n${failures} prueba(s) fallaron`); process.exit(1); }
console.log('\nTodo bien');
