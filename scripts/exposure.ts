// Dos casos de exposición, medidos de verdad (el rival juega su turno siguiente): npm run exposure -- [--brain hand|champion|ruta] [--rival hand|champion|ruta] [--trials 60]
//  A) Salida de la puerta 1: el kantoku pasa la puerta 1 y se queda con su bola. ¿Dónde queda y con qué frecuencia el rival la toca o la saca en su turno?
//  B) Reentrada: una bola del kantoku está fuera con bolas rivales en juego. Tira para volver a entrar. ¿Con qué frecuencia el rival la toca o la saca?
// --human-rival: como en el juego. El kantoku cree que el rival es una persona (mide sus opciones con `humanRivalError`) y el rival ejecuta con ese error y sin perfiles de certeza.
// Cerebros: hand, champion (el de `cpuWeights.json`, hoy el v2 afinado), v2 (el v2 anterior, respaldo), v1 (el respaldo) o una ruta.
// Ambos juegan con el error del nivel «Kantoku IA» (error base × certeza). Sirve para comparar el campeón actual con uno nuevo (la validación de la iteración C).
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { playMatch } from './selfplay';
import { AnyWeightFile, Brain, WeightFile, handBrain } from '../src/game/weights';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const loadBrain = (s: string): Brain => (s === 'hand' ? handBrain : s === 'champion' ? kantokuBrain : s === 'v2' ? { kind: 'kantoku', file: JSON.parse(readFileSync('src/game/cpuWeights.v2.json', 'utf8')) as AnyWeightFile } : s === 'v1' ? { kind: 'kantoku', file: JSON.parse(readFileSync('src/game/cpuWeights.v1.json', 'utf8')) as WeightFile } : { kind: 'kantoku', file: JSON.parse(readFileSync(s, 'utf8')) as AnyWeightFile });
if (argv.includes('--attack')) CONFIG.kantokuContinuationAttack = Number(str('attack', '0.6')); // 0 = sin la corrección del golpe continuo (el v2 original)
const brain = loadBrain(str('brain', 'champion'));
const rival = loadBrain(str('rival', 'champion'));
const TRIALS = Number(str('trials', '60'));
const HUMAN_RIVAL = argv.includes('--human-rival');
const err = kantokuLevelErrors();
/** Opciones del que juega: el kantoku cree que su rival es humano con `--human-rival`; el rival ejecuta con el error de un buen jugador humano. */
const optsFor = (own: boolean) => (HUMAN_RIVAL ? (own ? { ...err, rivalIsHuman: true } : { base: CONFIG.humanRivalError }) : err);
const neutral = (m: Match) => { if (HUMAN_RIVAL) m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 })); };

const board = (over: Record<number, Partial<BallState>>): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...over[i + 1] }));

interface TurnLog { touched: Set<number>; knocked: Set<number>; first: { shotGate: number } | null }

/** Juega el turno de la bola que toca (todos sus golpes: continuo, spark…) con `b`; devuelve qué bolas tocó y cuáles sacó. */
function playTurn(m: Match, b: Brain, own = true): TurnLog {
  const log: TurnLog = { touched: new Set(), knocked: new Set(), first: null };
  let fresh = true;
  for (let guard = 0; guard < 8; guard++) {
    const plan = cpuPlan(m, 3, { brain: b, errors: optsFor(own) });
    if (fresh && m.b.nextGate === 1) m.b.x = plan.startX;
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    if (!log.first) log.first = { shotGate: res.shotGate };
    for (const e of res.events) {
      if (e.type === 'touch') e.balls.forEach((n) => log.touched.add(n));
      if (e.type === 'out') log.knocked.add(e.ball);
    }
    const t = m.proceed();
    fresh = false;
    if (t === 'turn' || t === 'end') break;
  }
  return log;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)} %` : '–');

// ---------- A) Salida de la puerta 1 ----------
const LAYOUTS_A: Record<string, Record<number, Partial<BallState>>> = {
  'todos en la salida': {},
  'rivales ya en juego': { 1: { x: 12, y: 6, nextGate: 2 }, 3: { x: 5, y: 10, nextGate: 3 } },
  'una bola rival cerca de la salida': { 1: { x: 16.5, y: 8, nextGate: 2 } },
  'dos bolas rivales cerca de la salida': { 1: { x: 16.5, y: 8, nextGate: 2 }, 3: { x: 19, y: 9, nextGate: 2 } },
};
let passes = 0, total = 0, near = 0, nearHit = 0, farHit = 0, hit = 0;
const stopDist: number[] = [];
for (const [name, over] of Object.entries(LAYOUTS_A)) {
  let p = 0, h = 0, n = 0, nh = 0;
  for (let t = 0; t < TRIALS; t++) {
    const m = Match.fromBalls(board(over), { turn: 1, rng: mulberry32(500 + t) });
    neutral(m);
    const own = playTurn(m, brain);
    total++;
    const b2 = m.balls[1];
    if (own.first!.shotGate !== 1 && b2.nextGate < 2) continue;
    passes++; p++;
    const d = Math.hypot(b2.x - 18, b2.y - 11);
    stopDist.push(d);
    const isNear = d <= 5;
    if (isNear) { near++; n++; }
    if (m.turn === 2 && m.stage !== 'done') {
      const r = playTurn(m, rival, false);
      const bad = r.touched.has(2) || r.knocked.has(2) || m.balls[1].outBall;
      if (bad) { hit++; h++; if (isNear) { nearHit++; nh++; } else farHit++; }
    }
  }
  console.log(`  A · ${name}: pasa la puerta 1 en ${pc(p, TRIALS)} · se queda a ≤5 m de la salida en ${pc(n, p)} · el rival la toca o la saca en su turno: ${pc(h, p)} (cuando queda cerca: ${pc(nh, n)})`);
}
console.log(`A · salida de la puerta 1 (${total} intentos): pasa ${pc(passes, total)} · distancia media a la salida ${mean(stopDist).toFixed(1)} m · cerca (≤5 m) ${pc(near, passes)} · el rival la toca o la saca ${pc(hit, passes)} (cerca: ${pc(nearHit, near)}, lejos: ${pc(farHit, passes - near)})`);

// ---------- B) Reentrada desde fuera ----------
const rng = mulberry32(77);
let entered = 0, trialsB = 0, hitB = 0, fouls = 0;
for (let t = 0; t < TRIALS * 2; t++) {
  const side = Math.floor(rng() * 4);
  const out = side === 0 ? { x: -0.2, y: 2 + rng() * 11 } : side === 1 ? { x: 20.2, y: 2 + rng() * 11 } : side === 2 ? { x: 3 + rng() * 14, y: -0.2 } : { x: 3 + rng() * 14, y: 15.2 };
  const spots: { x: number; y: number }[] = [];
  while (spots.length < 3) {
    const c = { x: 1.5 + rng() * 17, y: 1.5 + rng() * 12 };
    if (spots.every((s) => Math.hypot(s.x - c.x, s.y - c.y) > 1.5)) spots.push(c);
  }
  const m = Match.fromBalls(board({ 2: { ...out, nextGate: 2, outBall: true, points: 1 }, 1: { ...spots[0], nextGate: 2 }, 3: { ...spots[1], nextGate: 3 }, 5: { ...spots[2], nextGate: 2 } }), { turn: 1, rng: mulberry32(900 + t) });
  m.firstRoundDone = true;
  m.clock = 900;
  neutral(m);
  const own = playTurn(m, brain);
  trialsB++;
  if (m.stage === 'done') continue;
  const b2 = m.balls[1];
  if (b2.outBall) continue; // no entró
  entered++;
  const r = playTurn(m, rival, false);
  if (r.touched.has(2) || r.knocked.has(2) || m.balls[1].outBall) hitB++;
  void own; void fouls;
}
console.log(`B · reentrada desde fuera (${trialsB} intentos con 3 bolas rivales en juego): entra ${pc(entered, trialsB)} · el rival la toca o la saca en su turno: ${pc(hitB, entered)}`);
void CONFIG;

// ---------- C) En partidos completos: kantoku contra pesos a mano, los dos colores ----------
const GAMES = Number(str('games', '0'));
if (GAMES > 0) {
  const tot = { passes: 0, near: 0, nearHit: 0, farHit: 0, reentries: 0, reHit: 0 };
  for (let g = 0; g < GAMES; g++) {
    const kantokuSide = g % 2;
    const teamOf = (n: number) => (n % 2 === 1 ? 0 : 1);
    let lastBall = -1, passedGate1 = false, reentered = false, watch: { n: number; near: boolean | null; re: boolean }[] = [];
    playMatch({
      seed: 3000 + g, levels: [3, 3], errors: err, brains: kantokuSide === 0 ? [brain, rival] : [rival, brain],
      profiles: [Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[i % 4] })), Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + 1) % 4] }))],
      errorScales: [{ exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }, { exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }],
      onStroke: (m, fresh) => {
        if (!fresh) return;
        if (lastBall >= 0 && teamOf(lastBall) === kantokuSide) {
          const b = m.balls[lastBall - 1];
          if (passedGate1 && b.nextGate >= 2 && !b.outBall) {
            const near = Math.hypot(b.x - 18, b.y - 11) <= 5;
            tot.passes++; if (near) tot.near++;
            watch.push({ n: lastBall, near, re: false });
          }
          if (reentered && !b.outBall) { tot.reentries++; watch.push({ n: lastBall, near: null, re: true }); }
        }
        lastBall = m.b.n; passedGate1 = false; reentered = false;
      },
      onResult: (m, res, team) => {
        const n = m.b.n;
        if (team === kantokuSide) {
          for (const e of res.events) {
            if (e.type === 'gate' && e.stroker && e.gate === 1) passedGate1 = true;
            if (e.type === 'backInPlay') reentered = true;
          }
        }
        // ¿el rival toca o saca una bola vigilada antes de que vuelva a jugar?
        for (const e of res.events) {
          const ball = e.type === 'touch' ? e.balls : e.type === 'out' ? [e.ball] : [];
          if (teamOf(n) === kantokuSide) continue;
          for (const w of [...watch]) {
            if (ball.includes(w.n)) {
              if (w.re) tot.reHit++; else if (w.near) tot.nearHit++; else tot.farHit++;
              watch = watch.filter((x) => x !== w);
            }
          }
        }
        // cuando la bola vuelve a jugar, deja de vigilarse
        watch = watch.filter((w) => w.n !== n || teamOf(n) !== kantokuSide);
      },
    });
  }
  console.log(`C · ${GAMES} partidos completos: salidas de la puerta 1 del kantoku: ${tot.passes} · se quedan a ≤5 m de la salida: ${pc(tot.near, tot.passes)} · la tocan o la sacan antes de volver a jugar: cerca ${pc(tot.nearHit, tot.near)}, lejos ${pc(tot.farHit, tot.passes - tot.near)} · reentradas desde fuera: ${tot.reentries}, tocadas o sacadas antes de volver a jugar: ${pc(tot.reHit, tot.reentries)}`);
}
