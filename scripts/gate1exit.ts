// Salida de la puerta 1 del kantoku, con el rival «tipo humano» jugando de verdad su turno siguiente (golpe continuo incluido).
// Uso: npm run gate1exit -- [--trials 200] [--brain champion|ruta] [--seed 500] [--exec 0.4]
// Mide: a dónde quería llevar la bola (el plan sin error), dónde queda de verdad (con el error del jugador), cuánto se queda corta sobre la línea del golpe y, según dónde queda,
// con qué frecuencia el rival la toca o la saca en su turno. El tablero: bolas rivales al azar (en la salida, en juego o cerca de la salida) y sus bolas siguientes esperando en la salida.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { AnyWeightFile, Brain } from '../src/game/weights';
import { championV1 } from './trainLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TRIALS = Number(str('trials', '200'));
const SEED = Number(str('seed', '500'));
const bs = str('brain', 'champion');
const brain: Brain = bs === 'champion' ? kantokuBrain : { kind: 'kantoku', file: JSON.parse(readFileSync(bs, 'utf8')) as AnyWeightFile };
const rivalBrain: Brain = { kind: 'kantoku', file: championV1 };
const lvl = kantokuLevelErrors();
const own = { ...lvl, executionScale: Number(str('exec', String(lvl.executionScale ?? 1))), rivalIsHuman: true };
const humanOpts = { base: CONFIG.humanRivalError };
const neutral = (m: Match) => { m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })); };
const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));

function play(m: Match, b: Brain, opts: object) {
  const touched = new Set<number>(), knocked = new Set<number>(), log: string[] = [];
  let firstPos = { x: 0, y: 0 }, first: ReturnType<Match['shoot']> | null = null, plan0: ReturnType<typeof cpuPlan> | null = null;
  for (let guard = 0, fresh = true; guard < 8; guard++, fresh = false) {
    const plan = cpuPlan(m, 3, { brain: b, errors: opts as never });
    if (!plan0) plan0 = plan;
    if (fresh && m.b.nextGate === 1) m.b.x = plan.startX;
    let idealTxt = "";
    if (plan.ideal && !m.sparkBall) { const mi2 = Match.fromBalls(m.balls, { turn: m.turn, rng: mulberry32(1) }); if (fresh && mi2.b.nextGate === 1) mi2.b.x = plan.startX; let r2 = mi2.shoot(plan.ideal.aim, plan.ideal.power, plan.ideal.acc); for (let i = 0; i < 900 && !r2 && mi2.stage === "rolling"; i++) if (mi2.step(1 / 60)) r2 = mi2.resolution; if (!r2) { mi2.forceStop(); r2 = mi2.resolution!; } idealTxt = " [ideal " + (r2.touches.length ? "TOUCH " : "") + "(" + mi2.balls[m.turn].x.toFixed(1) + "," + mi2.balls[m.turn].y.toFixed(1) + ") aim d=" + Math.hypot(plan.ideal.aim.x - m.b.x, plan.ideal.aim.y - m.b.y).toFixed(1) + "]"; }
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (!first) firstPos = { x: m.b.x, y: m.b.y };
    first ??= res;
    log.push(res.kind + (res.shotGate ? " puerta" + res.shotGate : "") + (res.touches.length ? " touch" : "") + (res.strokerOut ? " FUERA" : "") + " -> (" + m.b.x.toFixed(1) + "," + m.b.y.toFixed(1) + ")" + idealTxt);
    for (const e of res.events) { if (e.type === 'touch') e.balls.forEach((n) => touched.add(n)); if (e.type === 'out') knocked.add(e.ball); }
    const t = m.proceed();
    if (t === 'turn' || t === 'end') break;
  }
  return { strokes: log, touched, knocked, first: first!, plan0: plan0!, firstPos };
}

const rows: { dFinal: number; dExit: number; hit: boolean; ideal: number; along: number; short: boolean; nearRival: number }[] = [];
for (let t = 0; t < TRIALS; t++) {
  const rnd = mulberry32(SEED + t * 7);
  const over: Record<number, Partial<BallState>> = {};
  const k = Math.floor(rnd() * 4); // cuántas bolas rojas (rivales) ya están en juego
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < k; i++) {
    for (;;) {
      const c = { x: 2 + rnd() * 17, y: 2 + rnd() * 11 };
      if (spots.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 1.2)) { spots.push(c); over[[1, 3, 5, 7, 9][i]] = { ...c, nextGate: 2 }; break; }
    }
  }
  const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(900 + t) });
  neutral(m);
  const startBalls = m.balls.map((b) => ({ ...b }));
  const r = play(m, brain, own);
  const b2 = m.balls[1];
  if (r.first.shotGate !== 1 && b2.nextGate < 2) { if (argv.includes('--fails')) console.log('  NO PASA: ' + r.strokes.join(' | ') + ` · inicio x ${r.plan0.startX.toFixed(2)} · rojas en juego ${k}`); continue; }
  const exit = { x: 18, y: 11 };
  const dExit = Math.hypot(r.firstPos.x - exit.x, r.firstPos.y - exit.y); // tras el primer golpe (la puerta); después puede seguir con el golpe continuo
  const dFinal = Math.hypot(b2.x - exit.x, b2.y - exit.y);
  // plan sin error, para saber dónde quería dejarla
  const mi = Match.fromBalls(startBalls, { turn: 1, rng: mulberry32(1) });
  mi.b.x = r.plan0.startX;
  let ri = mi.shoot(r.plan0.ideal!.aim, r.plan0.ideal!.power, r.plan0.ideal!.acc);
  for (let i = 0; i < 900 && !ri && mi.stage === 'rolling'; i++) if (mi.step(1 / 60)) ri = mi.resolution;
  if (!ri) { mi.forceStop(); }
  const bi = mi.balls[1];
  const ideal = Math.hypot(bi.x - exit.x, bi.y - exit.y);
  const start = { x: r.plan0.startX, y: startBalls[1].y };
  const ux = bi.x - start.x, uy = bi.y - start.y, L = Math.hypot(ux, uy) || 1;
  const along = ((r.firstPos.x - bi.x) * ux + (r.firstPos.y - bi.y) * uy) / L; // negativo = se quedó corta sobre la línea del golpe
  const nearRival = Math.min(...m.balls.filter((b) => b.team === 0 && b.nextGate >= 2 && !b.outBall).map((b) => Math.hypot(b.x - b2.x, b.y - b2.y)), 99);
  let hit = false;
  if (m.turn === 2 && m.stage !== 'done') {
    const rv = play(m, rivalBrain, humanOpts);
    hit = rv.touched.has(2) || rv.knocked.has(2) || m.balls[1].outBall;
  }
  if (argv.includes("--detail") && (dFinal <= 8 || nearRival < 3)) console.log("  caso: termina a " + dFinal.toFixed(1) + " m de la salida, roja más cercana " + nearRival.toFixed(1) + " m, " + (hit ? "LA TOCAN" : "no la tocan") + " · golpes: " + r.strokes.join(" | "));
  rows.push({ dFinal, dExit, hit, ideal, along, short: along < -0.3, nearRival });
}
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const n = rows.length;
console.log(`Salida de la puerta 1 (${n} intentos, error de ejecución ×${own.executionScale}): la tocan o la sacan en su turno ${pc(rows.filter((r) => r.hit).length, n)}`);
console.log(`  a dónde quería llevarla (sin error), distancia a la salida: mediana ${q(rows.map((r) => r.ideal), 0.5).toFixed(1)} m · p10 ${q(rows.map((r) => r.ideal), 0.1).toFixed(1)} · p90 ${q(rows.map((r) => r.ideal), 0.9).toFixed(1)}`);
console.log(`  dónde queda tras el golpe de la puerta (con error): mediana ${q(rows.map((r) => r.dExit), 0.5).toFixed(1)} m · p10 ${q(rows.map((r) => r.dExit), 0.1).toFixed(1)} · p90 ${q(rows.map((r) => r.dExit), 0.9).toFixed(1)}`);
console.log(`  dónde termina el turno (tras el golpe continuo): mediana ${q(rows.map((r) => r.dFinal), 0.5).toFixed(1)} m · p10 ${q(rows.map((r) => r.dFinal), 0.1).toFixed(1)} · p90 ${q(rows.map((r) => r.dFinal), 0.9).toFixed(1)}`);
console.log(`  diferencia sobre la línea del golpe (negativo = corta): mediana ${q(rows.map((r) => r.along), 0.5).toFixed(2)} m · p10 ${q(rows.map((r) => r.along), 0.1).toFixed(2)} · p90 ${q(rows.map((r) => r.along), 0.9).toFixed(2)} · se queda corta por más de 30 cm: ${pc(rows.filter((r) => r.short).length, n)}`);
const buckets: [string, (r: typeof rows[number]) => boolean][] = [['≤ 5 m de la salida', (r) => r.dFinal <= 5], ['5–8 m', (r) => r.dFinal > 5 && r.dFinal <= 8], ['8–11 m', (r) => r.dFinal > 8 && r.dFinal <= 11], ['> 11 m', (r) => r.dFinal > 11]];
for (const [name, f] of buckets) { const s = rows.filter(f); console.log(`  termina el turno a ${name}: ${s.length} (${pc(s.length, n)}) · la tocan o la sacan ${pc(s.filter((r) => r.hit).length, s.length)}`); }
const cut: [string, (r: typeof rows[number]) => boolean][] = [['con una bola roja a < 3 m', (r) => r.nearRival < 3], ['con una bola roja a 3–6 m', (r) => r.nearRival >= 3 && r.nearRival < 6], ['sin bola roja a < 6 m', (r) => r.nearRival >= 6]];
for (const [name, f] of cut) { const s = rows.filter(f); console.log(`  ${name}: ${s.length} · la tocan o la sacan ${pc(s.filter((r) => r.hit).length, s.length)}`); }
