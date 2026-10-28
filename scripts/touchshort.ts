// Intentos de touch del kantoku: ¿cuántos aciertan, cuántos se quedan cortos y cuántos pasan de largo o se van al lado?
// Uso: npm run touchshort -- [--games 40] [--seed 12000] [--rival human|kantoku] [--brain champion|ruta] [--exec 0.4] [--margins]
// «Intento de touch» = el golpe elegido, sin error (la mira y la fuerza del plan, barras en el triángulo), toca una bola. Se compara con lo que pasó de verdad (con el error
// del jugador): acierta (touch válido), se queda corta (la bola que golpea para antes de llegar a la bola, medido sobre la línea del golpe), pasa de largo o se va al lado
// (llega a la altura de la bola sin tocarla), o la bola que golpea sale de la cancha. Si se queda corta, ¿queda a menos de 1,5 m de una bola rival (se la entrega)?
// `--rival human`: el rival juega con el kantoku v1 pero ejecuta con `humanRivalError` y se pasa de fuerza (como `humanduel`); `--rival kantoku`: kantoku contra kantoku.
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { CpuPlan } from '../src/game/cpu';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, inPlay } from '../src/game/match';
import { AnyWeightFile, Brain } from '../src/game/weights';
import { championV1 as v1File } from './trainLib';
const championV1: Brain = { kind: 'kantoku', file: v1File };
import { playMatch } from './selfplay';
import { Attempt, Kind, classify, replay } from './touchLib';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GAMES = Number(str('games', '40'));
const SEED = Number(str('seed', '12000'));
const bs = str('brain', 'champion');
const legacy = argv.includes('--legacy');
const champ: Brain = kantokuBrain.kind === 'kantoku' && legacy ? { kind: 'kantoku', file: { ...kantokuBrain.file, legacyTouch: true } as AnyWeightFile } : kantokuBrain;
const brain: Brain = bs === 'champion' ? champ : { kind: 'kantoku', file: JSON.parse(readFileSync(bs, 'utf8')) as AnyWeightFile };
const lvl = kantokuLevelErrors();
const execScale = Number(str('exec', String(lvl.executionScale ?? 1)));
const own = { ...lvl, executionScale: execScale, rivalIsHuman: str('rival', 'human') === 'human' };
const humanRival = str('rival', 'human') === 'human';


const attempts: Attempt[] = [];
const near = { all: 0, idealTouch: 0, idealNear: 0, other: 0, otherShort: 0, samples: [] as string[] }; // bola que golpea (en juego) que termina a < 1,5 m de una rival sin tocarla
for (let g = 0; g < GAMES; g++) {
  const side = (g % 2) as 0 | 1; // equipo del kantoku
  const extra = (g >> 1) % 2 ? 0.2 : 0.1;
  const kProfiles = Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + side) % 4] }));
  const neutral = Array.from({ length: 5 }, () => ({ short: 1, medium: 1, long: 1 }));
  const humanErr = { base: CONFIG.humanRivalError };
  const sc = { exec: own.executionScale ?? 1, plan: own.planningScale ?? 1 };
  let rec: { balls: BallState[]; turn: number; plan: CpuPlan } | null = null;
  playMatch({
    seed: SEED + g, levels: [3, 3],
    brains: humanRival ? (side === 0 ? [brain, championV1] : [championV1, brain]) : [brain, brain],
    errorsByTeam: humanRival ? (side === 0 ? [own, humanErr] : [humanErr, own]) : [own, own],
    errorScales: humanRival ? (side === 0 ? [sc, { exec: 1, plan: 1 }] : [{ exec: 1, plan: 1 }, sc]) : [sc, sc],
    profiles: humanRival ? (side === 0 ? [kProfiles, neutral] : [neutral, kProfiles]) : [kProfiles, kProfiles.map((p) => ({ ...p }))],
    touchExtra: humanRival ? (side === 0 ? [0, extra] : [extra, 0]) : undefined,
    onShot: (m, team, plan) => {
      rec = null;
      if (m.sparkBall || m.b.nextGate < 2 || m.b.outBall || !plan.ideal) return;
      if (humanRival && team !== side) return;
      rec = { balls: m.balls.map((b) => ({ ...b })), turn: m.turn, plan };
    },
    onResult: (m, res) => {
      const r = rec; rec = null;
      if (!r) return;
      const a = classify(r.balls, r.turn, r.plan, res, m.balls);
      if (!res.touches.length && !res.strokerOut) {
        const f = m.balls[r.turn], o = r.balls[r.turn];
        const rivals = m.balls.filter((b, i) => i !== r.turn && b.team !== f.team && inPlay(b) && Math.hypot(b.x - f.x, b.y - f.y) < 1.5);
        if (rivals.length) {
          near.all++;
          if (a) near.idealTouch++;
          else {
            const id = replay(r.balls, r.turn, r.plan.ideal!).balls[r.turn];
            const dIdeal = Math.min(...r.balls.filter((b, i) => i !== r.turn && b.team !== f.team && inPlay(b)).map((b) => Math.hypot(b.x - id.x, b.y - id.y)));
            if (dIdeal < 1.5) near.idealNear++; else near.other++;
            if (near.samples.length < 6) near.samples.push('de (' + o.x.toFixed(1) + ',' + o.y.toFixed(1) + ') ideal acaba a ' + dIdeal.toFixed(1) + ' m de una rival, real a ' + Math.min(...rivals.map((b) => Math.hypot(b.x - f.x, b.y - f.y))).toFixed(1) + ' m');
          }
        }
      }
      if (a) attempts.push(a);
    },
  });
}

const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
const count = (k: Kind, set = attempts) => set.filter((a) => a.kind === k).length;
export function report(set: Attempt[], title: string) {
  const n = set.length;
  const short = count('short', set);
  console.log(`${title}: ${n} intentos de touch · aciertan ${count('hit', set)} (${pc(count('hit', set), n)}) · se quedan CORTOS ${short} (${pc(short, n)}) · pasan de largo o al lado ${count('past', set)} (${pc(count('past', set), n)}) · su bola sale ${count('out', set)} (${pc(count('out', set), n)})`);
  const miss = set.filter((a) => a.kind !== 'hit');
  console.log('   fallos que dejan la bola a < 1,5 m de una rival (se la entregan): ' + miss.filter((a) => a.handed).length + ' de ' + miss.length + ' fallos (' + pc(miss.filter((a) => a.handed).length, miss.length) + '), ' + pc(miss.filter((a) => a.handed).length, n) + ' de los intentos');
  const sh = set.filter((a) => a.kind === 'short');
  if (sh.length) console.log(`   de los cortos, quedan a < 1,5 m de una bola rival (se la entregan): ${sh.filter((a) => a.handed).length} (${pc(sh.filter((a) => a.handed).length, sh.length)})`);
  console.log(`   salidas de la cancha de la bola que golpea (en cualquier resultado): ${set.filter((a) => a.shooterOut).length} (${pc(set.filter((a) => a.shooterOut).length, n)})`);
}
{
  console.log('Terminan a < 1,5 m de una rival sin tocarla: ' + near.all + ' (intento de touch que falló: ' + near.idealTouch + ' · el plan sin error ya acababa junto a una rival, o sea que quería acercarse: ' + near.idealNear + ' · el plan acababa lejos y el error la dejó cerca: ' + near.other + ')');
  for (const x of near.samples) console.log('   ' + x);
  report(attempts, `Kantoku${legacy ? " (touch de antes)" : ""} (${GAMES} partidos, rival ${str('rival', 'human')}, error de ejecución ×${execScale})`);
  if (argv.includes('--margins')) {
    const bins: [string, (a: Attempt) => boolean][] = [['< 0,2 m', (a) => a.over < 0.2], ['0,2–0,6 m', (a) => a.over >= 0.2 && a.over < 0.6], ['0,6–1,5 m', (a) => a.over >= 0.6 && a.over < 1.5], ['≥ 1,5 m', (a) => a.over >= 1.5]];
    for (const [name, f] of bins) report(attempts.filter(f), `  apuntaba ${name} más allá`);
    const dbins: [string, (a: Attempt) => boolean][] = [['≤ 4 m', (a) => a.dist <= 4], ['4–8 m', (a) => a.dist > 4 && a.dist <= 8], ['> 8 m', (a) => a.dist > 8]];
    for (const [name, f] of dbins) report(attempts.filter(f), `  distancia ${name}`);
  }
}
if (argv.includes('--handed')) {
  for (const a of attempts.filter((x) => x.handed)) console.log(`  entregada: ${a.kind} · distancia al blanco ${a.dist.toFixed(1)} m · mira ${a.over.toFixed(1)} m más allá`);
}
