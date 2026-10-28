// ¿Cambia el kantoku su jugada según la certeza? Mismas posiciones y mismos sorteos, solo cambia el perfil de un jugador.
// Uso: npm run probe -- [--file src/game/cpuWeights.json] [--games 16]
// Prueba 1: certeza de quien tira (certero de corto contra certero de largo). Prueba 2: certeza del rival que juega después (certero contra errático).
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { Profile, bandOf, scaleError } from '../src/game/certainty';
import { distTo, goalOf } from '../src/game/cpu';
import { planShot } from '../src/game/cpuPlanner';
import { Match, SavedState } from '../src/game/match';
import { phaseOf, upcomingTurns } from '../src/game/phase';
import { mulberry32 } from '../src/game/rng';
import { WeightFile, handWeights, resolveWeights } from '../src/game/weights';
import { playMatch } from './selfplay';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const file = JSON.parse(readFileSync(str('file', 'src/game/cpuWeights.json'), 'utf8')) as WeightFile;
const games = Number(str('games', '16'));

// Posiciones de todas las fases: partidos de pesos a mano contra pesos a mano, guardando un turno de cada cuatro.
const states: SavedState[] = [];
for (let g = 0; g < games; g++) {
  let k = 0;
  playMatch({
    seed: 4242 + g, levels: [3, 3], errors: { base: CONFIG.kantokuBaseError },
    onStroke: (m, fresh) => { if (fresh && m.stage === 'ready' && ++k % 4 === 0 && m.b.nextGate >= 2) states.push(m.saveState()); },
  });
}
console.log(`${states.length} posiciones de ${games} partidos (turnos con la bola ya en juego)\n`);

const corto: Profile = { short: 0.6, medium: 1, long: 1.8 };
const largo: Profile = { short: 1.8, medium: 1, long: 0.6 };
const certero: Profile = { short: 0.5, medium: 0.5, long: 0.5 };
const erratico: Profile = { short: 2.5, medium: 2.5, long: 2.5 };

/** Mira que elige un cerebro en una posición, con los perfiles dados. */
function choose(s: SavedState, idx: number, brain: 'hand' | 'kantoku', profiles: Profile[], believe = 1) {
  const m = Match.restore(s, mulberry32(1000 + idx));
  const sp = m.sparkBall;
  const w = brain === 'hand' ? handWeights : resolveWeights(file, phaseOf(m));
  const plan = planShot(m.balls, sp ? m.balls.indexOf(sp) : m.turn, 'stroke', -1, {
    team: m.b.team, clock: m.clock, noise: 0, rng: mulberry32(7000 + idx), weights: w,
    future: w.certainty ? { seq: upcomingTurns(m), profiles, base: scaleError(CONFIG.kantokuBaseError, believe) } : undefined,
  });
  if (!plan) return null;
  // Dónde queda la bola que golpea (tiro exacto) respecto a su siguiente meta: lo que importa al acomodar.
  const sim = Match.restore(s, mulberry32(5));
  const bars = sim.bars();
  let res = sim.shoot(plan.aim, bars.power.sweetSpot, bars.accuracy.sweetSpot);
  for (let i = 0; i < 420 && !res && sim.stage === 'rolling'; i++) if (sim.step(1 / 30)) res = sim.resolution;
  const b = sim.b;
  const goalDist = b.nextGate >= 2 && b.nextGate <= 4 && !b.outBall ? distTo(b, goalOf(b.nextGate)) : NaN;
  return { aim: plan.aim, dist: distTo(m.b, plan.aim), goalDist, m };
}

for (const brain of ['hand', 'kantoku'] as const) {
  const goalD = { corto: [] as number[], largo: [] as number[] };
  let n = 0, differ = 0, dCorto = 0, dLargo = 0, shortUnderCorto = 0, shortUnderLargo = 0, longUnderCorto = 0, longUnderLargo = 0, differR = 0;
  const byPhase: Record<string, { n: number; differ: number }> = { inicio: { n: 0, differ: 0 }, medio: { n: 0, differ: 0 }, final: { n: 0, differ: 0 } };
  states.forEach((s, i) => {
    const mk = (p: Profile) => { const m0 = Match.restore(s, mulberry32(1)); const ps = m0.profiles.map((q) => ({ ...q })); ps[m0.turn] = p; return ps; };
    const a = choose(s, i, brain, mk(corto)), b = choose(s, i, brain, mk(largo));
    if (!a || !b) return;
    n++;
    const phase = phaseOf(a.m);
    byPhase[phase].n++;
    if (distTo(a.aim, b.aim) > 0.5) { differ++; byPhase[phase].differ++; }
    dCorto += a.dist; dLargo += b.dist;
    if (!Number.isNaN(a.goalDist) && !Number.isNaN(b.goalDist)) { goalD.corto.push(a.goalDist); goalD.largo.push(b.goalDist); }
    if (bandOf(a.dist) === 'short') shortUnderCorto++;
    if (bandOf(b.dist) === 'short') shortUnderLargo++;
    if (bandOf(a.dist) === 'long') longUnderCorto++;
    if (bandOf(b.dist) === 'long') longUnderLargo++;
    // Prueba 2: el rival que juega después
    const m1 = Match.restore(s, mulberry32(1));
    const seq = upcomingTurns(m1);
    const rival = seq.find((j) => m1.balls[j].team !== m1.b.team);
    if (rival !== undefined) {
      const mk2 = (p: Profile) => { const ps = m1.profiles.map((q) => ({ ...q })); ps[rival] = p; return ps; };
      const c = choose(s, i, brain, mk2(certero)), d = choose(s, i, brain, mk2(erratico));
      if (c && d && distTo(c.aim, d.aim) > 0.5) differR++;
    }
  });
  const pc = (x: number) => `${((100 * x) / n).toFixed(0)} %`;
  console.log(`== ${brain === 'hand' ? 'pesos a mano' : 'campeón'} (${n} posiciones)`);
  console.log(`  Prueba 1, certeza de quien tira: elige otra jugada en ${pc(differ)} de las posiciones (inicio ${byPhase.inicio.differ}/${byPhase.inicio.n}, medio ${byPhase.medio.differ}/${byPhase.medio.n}, final ${byPhase.final.differ}/${byPhase.final.n})`);
  console.log(`    distancia media del golpe: certero de corto ${(dCorto / n).toFixed(1)} m · certero de largo ${(dLargo / n).toFixed(1)} m`);
  console.log(`    golpes cortos (≤4 m): certero de corto ${pc(shortUnderCorto)} · certero de largo ${pc(shortUnderLargo)} · golpes largos (>9 m): certero de corto ${pc(longUnderCorto)} · certero de largo ${pc(longUnderLargo)}`);
  const avg = (x: number[]) => (x.reduce((a, c) => a + c, 0) / Math.max(1, x.length)).toFixed(1);
  console.log(`    dónde deja la bola respecto a su siguiente meta (${goalD.corto.length} posiciones en que sigue en juego): certero de corto a ${avg(goalD.corto)} m · certero de largo a ${avg(goalD.largo)} m`);
  console.log(`  Prueba 2, certeza del rival que juega después: elige otra jugada en ${pc(differR)} de las posiciones`);
  // Prueba 3: lo que el planificador CREE que se equivoca (×1 contra ×0,4), con la misma posición y el mismo tirador
  let differB = 0, dB1 = 0, dB2 = 0, goalB1: number[] = [], goalB2: number[] = [];
  states.forEach((s, i) => {
    const m0 = Match.restore(s, mulberry32(1));
    const a = choose(s, i, brain, m0.profiles, 1), b = choose(s, i, brain, m0.profiles, 0.4);
    if (!a || !b) return;
    if (distTo(a.aim, b.aim) > 0.5) differB++;
    dB1 += a.dist; dB2 += b.dist;
    if (!Number.isNaN(a.goalDist) && !Number.isNaN(b.goalDist)) { goalB1.push(a.goalDist); goalB2.push(b.goalDist); }
  });
  console.log(`  Prueba 3, lo que el planificador cree que se equivoca (×1 contra ×0,4): elige otra jugada en ${pc(differB)} de las posiciones · distancia del golpe ${(dB1 / n).toFixed(1)} m contra ${(dB2 / n).toFixed(1)} m · deja la bola a ${avg(goalB1)} m contra ${avg(goalB2)} m de su meta`);
}
