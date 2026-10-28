// Táctica de dejar bolas sin pasar la puerta 1 a propósito («esperar»): ¿cuándo la usa un cerebro? Uso: npm run waitdiag -- [--games 60] [--seed 31000] [--a src/game/cpuWeights.v3.json] [--b current]
// «Espera» = al empezar el turno de una bola que aún no pasó la puerta 1, el golpe elegido (sin error) no la pasa. Se mide por cerebro: qué bolas (1.ª a 5.ª de su equipo), en qué fase y con cuánto
// tiempo (turnos que quedan), con qué marcador y con qué hay en la cancha (rivales en juego y a tiro de la salida de la puerta 1), y cuántas bolas quedan sin pasarla al terminar el partido.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { BallState, Match, inPlay } from '../src/game/match';
import { phaseOf, turnsLeft } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { AnyWeightFile, Brain } from '../src/game/weights';
import { championV1 } from './trainLib';
import { playMatch } from './selfplay';


const argv = process.argv.slice(2);
const HUMAN = argv.includes('--human'); // el rival es una persona (el v1 con `humanRivalError` y fuerza extra) y el kantoku lo sabe: como en el juego; sin esto, CPU contra CPU (el kantoku cree que el rival es una CPU certera)
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GAMES = Number(str('games', '60'));
const SEED = Number(str('seed', '31000'));
const load = (s: string): Brain => ({ kind: 'kantoku', file: JSON.parse(readFileSync(s === 'current' ? 'src/game/cpuWeights.json' : s, 'utf8')) as AnyWeightFile });
const A = load(str('a', 'src/game/cpuWeights.v3.json')), B = load(str('b', 'current'));
const err = kantokuLevelErrors();
const EXIT = { x: 18, y: 11 };

interface Row { who: string; pos: number; phase: string; left: number; lead: number; rivalsIn: number; rivalsNear: number; waited: boolean }
const rows: Row[] = [];
const ends: { who: string; unpassed: number; ownPassedAtEnd: number }[] = [];
const firstWait: { who: string; pos: number; passedLater: boolean }[] = [];

function run(brains: [Brain, Brain], names: [string, string], seed: number, humanSide?: 0 | 1) {
  const waitedBalls = new Map<number, boolean>(); // bola → pasó después
  let last: Match | null = null;
  playMatch({
    seed, levels: [3, 3], brains, errors: { ...err, rivalIsHuman: false },
    ...(humanSide !== undefined ? { errorsByTeam: (humanSide === 0 ? [{ base: CONFIG.humanRivalError }, { ...err, rivalIsHuman: true }] : [{ ...err, rivalIsHuman: true }, { base: CONFIG.humanRivalError }]) as never, touchExtra: (humanSide === 0 ? [seed % 2 ? 0.2 : 0.1, 0] : [0, seed % 2 ? 0.2 : 0.1]) as [number, number] } : {}),
    errorScales: [{ exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }, { exec: err.executionScale ?? 1, plan: err.planningScale ?? 1 }],
    profiles: [Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + seed) % 4] })), Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + seed + 1) % 4] }))].map((p, t) => (t === humanSide ? p.map(() => ({ short: 1, medium: 1, long: 1 })) : p)) as never,
    onShot: (m, team, plan, fresh) => {
      last = m;
      if (!fresh || m.sparkBall || m.b.nextGate !== 1 || !plan.ideal || team === humanSide) return;
      const balls: BallState[] = m.balls.map((b) => ({ ...b }));
      balls[m.turn].x = plan.startX;
      const mm = Match.fromBalls(balls, { turn: m.turn, rng: mulberry32(1) });
      mm.clock = m.clock; mm.firstRoundDone = m.firstRoundDone;
      let res = mm.shoot(plan.ideal.aim, plan.ideal.power, plan.ideal.acc);
      for (let i = 0; i < 900 && !res && mm.stage === 'rolling'; i++) if (mm.step(1 / 60)) res = mm.resolution;
      if (!res) { mm.forceStop(); res = mm.resolution!; }
      const waited = res.shotGate !== 1 && mm.balls[m.turn].nextGate < 2;
      const rivals = m.balls.filter((b) => b.team !== team && inPlay(b));
      rows.push({
        who: names[team], pos: Math.ceil(m.b.n / 2), phase: phaseOf(m), left: turnsLeft(m), lead: m.teamScore(team) - m.teamScore(1 - team),
        rivalsIn: rivals.length, rivalsNear: rivals.filter((b) => Math.hypot(b.x - EXIT.x, b.y - EXIT.y) <= 8).length, waited,
      });
      if (waited && !waitedBalls.has(m.b.n)) waitedBalls.set(m.b.n, false);
    },
    onResult: (m) => {
      last = m;
      for (const n of waitedBalls.keys()) if (m.balls[n - 1].nextGate >= 2) waitedBalls.set(n, true);
    },
  });
  if (last) {
    const m = last as Match;
    for (const team of [0, 1] as const) if (team !== humanSide) ends.push({ who: names[team], unpassed: m.balls.filter((b) => b.team === team && b.nextGate === 1).length, ownPassedAtEnd: m.balls.filter((b) => b.team === team && b.nextGate >= 2).length });
  }
  for (const [n, later] of waitedBalls) if ((n - 1) % 2 !== humanSide) firstWait.push({ who: names[(n - 1) % 2], pos: Math.ceil(n / 2), passedLater: later });
}

const V1: Brain = { kind: 'kantoku', file: championV1 };
if (HUMAN) {
  // cada cerebro juega los mismos partidos (mismas semillas y colores) contra el rival tipo humano
  for (let g = 0; g < GAMES; g++) { const side = (g % 2) as 0 | 1; for (const [br, nm] of [[A, 'A'], [B, 'B']] as const) run(side === 0 ? [br, V1] : [V1, br], [nm, nm], SEED + g, (1 - side) as 0 | 1); }
} else {
  for (let g = 0; g < GAMES; g++) run(g % 2 ? [B, A] : [A, B], g % 2 ? ['B', 'A'] : ['A', 'B'], SEED + g);
  for (let g = 0; g < Math.floor(GAMES / 2); g++) run([B, B], ['B', 'B'], SEED + 5000 + g); // referencia: el campeón actual contra sí mismo (sus filas cuentan como «B»)
}

const pc = (a: number, n: number) => (n ? `${((100 * a) / n).toFixed(0)} %` : '–');
for (const who of ['A', 'B']) {
  const r = rows.filter((x) => x.who === who);
  const w = r.filter((x) => x.waited);
  console.log(`\n=== ${who} (${who === 'A' ? 'v3' : 'campeón actual'}) · turnos con una bola sin pasar la puerta 1: ${r.length} · espera ${w.length} (${pc(w.length, r.length)})`);
  const by = (title: string, key: (x: Row) => string, keys: string[]) => console.log(`  ${title}: ` + keys.map((k) => { const s = r.filter((x) => key(x) === k); return `${k} ${pc(s.filter((x) => x.waited).length, s.length)} (${s.length})`; }).join(' · '));
  by('según la bola de su equipo', (x) => String(x.pos), ['1', '2', '3', '4', '5']);
  by('según la fase', (x) => x.phase, ['inicio', 'medio', 'final']);
  by('según los turnos que quedan', (x) => (x.left <= 2 ? '≤2' : x.left <= 4 ? '3-4' : x.left <= 7 ? '5-7' : '≥8'), ['≥8', '5-7', '3-4', '≤2']);
  by('según el marcador', (x) => (x.lead <= -4 ? 'pierde por ≥4' : x.lead >= 4 ? 'gana por ≥4' : 'parejo'), ['pierde por ≥4', 'parejo', 'gana por ≥4']);
  by('rivales a ≤ 8 m de la salida de la puerta 1', (x) => (x.rivalsNear > 0 ? 'hay' : 'no hay'), ['hay', 'no hay']);
  by('rivales en juego', (x) => (x.rivalsIn === 0 ? '0' : x.rivalsIn <= 2 ? '1-2' : '3+'), ['0', '1-2', '3+']);
  const e = ends.filter((x) => x.who === who);
  const hist = [0, 1, 2, 3, 4, 5].map((k) => `${k}: ${e.filter((x) => x.unpassed === k).length}`).join(' · ');
  console.log(`  bolas sin pasar la puerta 1 al terminar el partido (por equipo, ${e.length} equipos): ${hist} · media ${(e.reduce((s, x) => s + x.unpassed, 0) / Math.max(1, e.length)).toFixed(2)}`);
  const f = firstWait.filter((x) => x.who === who);
  console.log(`  bolas que esperaron alguna vez: ${f.length} · de ellas pasaron después ${f.filter((x) => x.passedLater).length} (${pc(f.filter((x) => x.passedLater).length, f.length)}) · por bola: ` + [1, 2, 3, 4, 5].map((p) => `${p}ª ${f.filter((x) => x.pos === p).length}`).join(' '));
}
