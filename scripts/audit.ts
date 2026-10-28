// Auditoría del kantoku con el registro de partidas (iteración «registro y deficiencias»): juega N partidos contra un rival tipo humano y mide, solo de las jugadas del kantoku:
//   1. agari: cuándo lo hace (reloj), qué turnos creía que le quedaban a la bola, cuántos le quedaban de verdad y qué excepción lo permitió; y qué tan bien estima los turnos que quedan.
//   2. spark de expulsión: cuántas veces decide sacar la bola rival, cuántas sale y por qué falla (y de las otras sparks, qué hace).
//   3. salidas de cancha de su bola al golpear: por partido y por causa (plan, error de fuerza, rumbo, mira, rebote).
// Uso: npm run audit -- [--games 40] [--seed 21000] [--save] [--brain ruta.json]     (--save guarda los registros en partidas/audit-*.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { MatchLogger, ShotLog } from '../src/game/matchLog';
import { futureOf, kantokuLevelErrors } from '../src/game/cpuDriver';
import { exposureOf } from '../src/game/cpuPlanner';
import { Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import type { AnyWeightFile, Brain } from '../src/game/weights';
import { playVsHuman } from './vsHuman';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
// --set clave=valor (varias veces): cambia un valor numérico o booleano de CONFIG solo para esta corrida (comparar una regla nueva con la anterior)
argv.forEach((a, i) => { if (a === '--set' && argv[i + 1]) { const [k, v] = argv[i + 1].split('='); (CONFIG as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v); console.log(`CONFIG.${k} = ${v}`); } });
const GAMES = Number(str('games', '40'));
const SEED = Number(str('seed', '21000'));
const bf = str('brain', '');
const brain: Brain | undefined = bf ? { kind: 'kantoku', file: JSON.parse(readFileSync(bf, 'utf8')) as AnyWeightFile } : undefined;
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

const agari: { atPole: boolean; clock: number; est: number; real: number; why: string; ball: number; game: number; turn: number }[] = [];
const kinds: Record<string, number> = {};
const knockout = { decided: 0, ok: 0, causes: {} as Record<string, number>, other: {} as Record<string, number> };
const outs = { total: 0, causes: {} as Record<string, number>, byKind: {} as Record<string, number> };
const situations: unknown[] = []; // sparks contra bolas rivales (para `tests/spark.test.ts`)
const pace: { clock: number; est: number; real: number }[] = [];
const paceB: { clock: number; old: number; model: number; pAgain: number; real: number; again: boolean }[] = []; // por bola: lo que estimaba cada modelo y los turnos que de verdad le tocaron
let shotsK = 0;
const tt = { attempts: 0, hits: 0, bands: { '<4 m': [0, 0], '4-9 m': [0, 0], '>9 m': [0, 0] } as Record<string, number[]>, line: [0, 0], mate: [0, 0], waits: 0, exits: 0 }; // intentos de touch (golpes normales): [intentos, aciertos]

const expo = { byDecision: 0, byExecution: 0, reentries: 0, stayOut: 0, sum: 0, n: 0, all: 0, allN: 0, high: 0 }; // exposición (`exposureOf`) de la bola del kantoku tras su turno: reentradas y todas las jugadas
const bal = { pts: 0, gates: 0, turns: 0, far: [0, 0], games: 0 }; // puntos del kantoku, puertas pasadas por turno, touches de más de 6 m [intentos, aciertos]
const mates = { touches: 0, sparks: 0, byDest: {} as Record<string, number>, games: 0 }; // touches a compañeras y qué hace el spark propio


for (let g = 0; g < GAMES; g++) {
  const side = (g % 2) as 0 | 1;
  const logger = new MatchLogger({ level: CONFIG.cpuLevels.length, cpuTeam: side });
  logger.data.id = `audit-semilla${SEED + g}-lado${side}`;
  playVsHuman(SEED + g, side, logger, brain);
  const shots = logger.data.shots;
  bal.pts += logger.data.final ? logger.data.final.score[side] : 0;
  const lastTurn = shots.at(-1)?.turn ?? 0;
  if (argv.includes('--save')) { mkdirSync('partidas', { recursive: true }); writeFileSync(`partidas/${logger.data.id}.json`, logger.json()); }
  const mine = (s: ShotLog) => s.team === side;
  // vueltas reales que quedaban: turnos que empezaron después de éste ÷ bolas vivas en ese momento
  const alive = (s: ShotLog) => s.before.filter((b) => b.gate !== 5).length;
  for (const s of shots) {
    if (!mine(s)) continue;
    shotsK++;
    if (s.stroke === 1 && s.mode === 'golpe' && s.after && s.team === side) {
      // exposición de la bola que acaba de jugar (si sigue en juego) con el tablero tal como quedó y le toca a la siguiente
      const nextShot = shots.find((x) => x.shot === s.shot + 1);
      const rows = s.after;
      if (rows.length === 10) {
        const balls = rows.map((b) => ({ n: b.n, team: (b.n % 2 === 1 ? 0 : 1) as 0 | 1, x: b.x, y: b.y, vx: 0, vy: 0, nextGate: b.gate, outBall: b.out, points: b.pts }));
        const m = Match.fromBalls(balls, { turn: s.ball % 10, rng: mulberry32(1) });
        m.clock = Math.max(1, (nextShot?.clock ?? s.clock - 15)); m.turnStarts = 41; m.firstRoundDone = true;
        const me = balls[s.ball - 1];
        const reentry = s.decision?.kind === 'reentrada';
        if (reentry) {
          expo.reentries++;
          if (me.outBall) {
            expo.stayOut++;
            // ¿por decisión o por ejecución? El mismo tiro sin error (barras en el triángulo) sobre el tablero de antes: si también sale, la jugada elegida no entraba (decisión); si entra, falló la ejecución
            const bb = s.before.map((b) => ({ n: b.n, team: (b.n % 2 === 1 ? 0 : 1) as 0 | 1, x: b.x, y: b.y, vx: 0, vy: 0, nextGate: b.gate, outBall: b.out, points: b.pts }));
            const m0 = Match.fromBalls(bb, { turn: s.ball - 1, rng: mulberry32(7 + s.shot) });
            const bars = m0.bars();
            let res = m0.shoot(s.input.aim, s.plan?.idealPower ?? bars.power.sweetSpot, s.plan?.idealAcc ?? bars.accuracy.sweetSpot);
            for (let i = 0; i < 900 && !res && m0.stage === 'rolling'; i++) if (m0.step(1 / 60)) res = m0.resolution;
            if (!res) { m0.forceStop(); }
            if (m0.balls[s.ball - 1].outBall) expo.byDecision++; else expo.byExecution++;
          }
        }
        if (!me.outBall && me.nextGate >= 2 && me.nextGate <= 4) {
          const e = exposureOf(balls, s.ball - 1, futureOf(m, { errors: { ...kantokuLevelErrors(), rivalIsHuman: true } } as never));
          expo.all += e; expo.allN++; if (e >= 0.8) expo.high++;
          if (reentry) { expo.sum += e; expo.n++; }
        }
      }
    }
    if (s.stroke === 1) bal.turns++;
    if (s.result) for (const e of s.result.events) if ((e.type === 'gate') && e.stroker) bal.gates++;
    const d = s.decision;
    if (s.mode === 'golpe' && s.stroke === 1) {
      const later = shots.filter((x) => x.stroke === 1 && x.ball === s.ball && x.turn > s.turn).length;
      if (s.pacing.model) paceB.push({ clock: s.clock, old: s.pacing.turnsLeft, model: s.pacing.model.turnsLeft, pAgain: s.pacing.model.pAgain, real: 1 + later, again: later > 0 });
    }
    if (s.mode === 'golpe' && s.stroke === 1) pace.push({ clock: s.clock, est: s.pacing.turnsLeft, real: (lastTurn - s.turn) / Math.max(1, alive(s)) + 1 });
    if (d?.explanation?.agari?.chosenIsAgari && s.mode === 'golpe') {
      const real = (lastTurn - s.turn) / Math.max(1, alive(s) - 1) + 1; // turnos que le habrían tocado a la bola (las demás siguen vivas)
      agari.push({ atPole: !!s.after?.find((b) => b.n === s.ball && b.gate === 5), clock: s.clock, est: d.explanation.agari.turnsLeft, real, why: d.explanation.agari.why ?? '?', ball: s.ball, game: g, turn: s.turn });
    } else if (d && s.mode === 'golpe' && d.kind === 'agari: poste') {
      agari.push({ atPole: true, clock: s.clock, est: -1, real: (lastTurn - s.turn) / Math.max(1, alive(s) - 1) + 1, why: 'sin la regla del agari en el trazo', ball: s.ball, game: g, turn: s.turn });
    }
    if (s.mode === 'spark' && d && s.sparkBall !== undefined && s.sparkBall % 2 !== s.team + 0 === false) { /* ver abajo */ }
    if (s.mode === 'spark' && d) {
      const rivalBall = s.sparkBall !== undefined && ((s.sparkBall % 2 === 1 ? 0 : 1) !== s.team);
      if (rivalBall) {
        bump(kinds, d.kind);
        if (situations.length < Number(str('max-situations', '80')) && g % 2 === 0) situations.push({ before: s.before, turn: s.ball - 1, sparkIdx: s.sparkBall! - 1, sparked: (s.sparked ?? []).map((n) => n - 1), clock: s.clock, turnNo: s.turn });
        if (d.kind === 'spark: expulsar bola rival') {
          knockout.decided++;
          const after = s.after?.find((b) => b.n === s.sparkBall);
          if (after?.out || after?.gate === 5) knockout.ok++; else bump(knockout.causes, s.sparkFail?.cause ?? '(sin diagnóstico)');
        } else bump(knockout.other, d.kind + (s.after?.find((b) => b.n === s.sparkBall)?.out ? ' (la bola salió)' : ''));
      }
    }
    if (s.mode === 'golpe' && s.result) {
      const t = s.result.touches.filter((n) => n % 2 === s.ball % 2 && n !== s.ball).length;
      mates.touches += t;
    }
    if (s.mode === 'spark' && s.sparkBall !== undefined && s.sparkBall % 2 === s.ball % 2) { mates.sparks++; if (d) bump(mates.byDest, d.kind); }
    if (s.mode === 'golpe' && d && s.result) {
      const me = s.before.find((b) => b.n === s.ball)!;
      if (me.gate === 1 && !me.out && d.kind.startsWith('salida')) { tt.exits++; if (!d.intended.gate) tt.waits++; }
      if (d.kind.startsWith('touch') && d.intended.touched.length) {
        const tn = d.intended.touched[0];
        const tg = s.before.find((b) => b.n === tn)!;
        const dist = Math.hypot(tg.x - me.x, tg.y - me.y);
        const hit = s.result.touches.includes(tn) ? 1 : 0;
        if (dist > 6) { bal.far[0]++; bal.far[1] += hit; }
        const band = dist < 4 ? '<4 m' : dist < 9 ? '4-9 m' : '>9 m';
        tt.attempts++; tt.hits += hit; tt.bands[band][0]++; tt.bands[band][1] += hit;
        if (Math.min(tg.x, 20 - tg.x, tg.y, 15 - tg.y) <= 1.0) { tt.line[0]++; tt.line[1] += hit; }
        if (tn % 2 === s.ball % 2) { tt.mate[0]++; tt.mate[1] += hit; }
      }
    }
    if (s.outCause) { outs.total++; bump(outs.causes, s.outCause.cause); bump(outs.byKind, d?.kind ?? s.mode); }
  }
}

console.log(`Auditoría del kantoku (${GAMES} partidos contra un rival tipo humano, ${shotsK} golpes del kantoku)\n`);

console.log('1. AGARI');
console.log(`  agaris del kantoku: ${agari.length} (${(agari.length / GAMES).toFixed(2)} por partido) · con más de 15:00 de reloj: ${agari.filter((a) => a.clock > 900).length} · con más de 10:00: ${agari.filter((a) => a.clock > 600).length}`);
const why: Record<string, number> = {};
for (const a of agari) bump(why, a.why);
for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`    · ${k}: ${v}`);
for (const a of agari.filter((x) => x.clock > 600).slice(0, 12)) console.log(`    partido ${a.game + 1}, turno ${a.turn}, bola ${a.ball}: reloj ${Math.floor(a.clock / 60)}:${String(Math.round(a.clock % 60)).padStart(2, '0')}, creía que le quedaban ${a.est} turnos, le habrían tocado ≈ ${a.real.toFixed(1)} · ${a.why}`);
console.log(`  agaris que de verdad llegaron al poste: ${agari.filter((a) => a.atPole).length} de ${agari.length} (la explicación usa otro azar del pasto) · antes de tiempo (más de 2 turnos reales): ${agari.filter((a) => a.atPole && a.real > 2.5).length}`);
console.log('  ritmo (turnos que cree que quedan por bola ↔ lo que realmente quedó, por tramo de reloj):');
for (const [lo, hi] of [[1500, 1800], [1200, 1500], [900, 1200], [600, 900], [300, 600], [0, 300]]) {
  const rows = pace.filter((p) => p.clock > lo && p.clock <= hi);
  if (rows.length) console.log(`    ${String(lo / 60).padStart(2)}-${String(hi / 60).padStart(2)} min: estima ${mean(rows.map((r) => r.est)).toFixed(2)} · real ${mean(rows.map((r) => r.real)).toFixed(2)} (${rows.length} turnos)`);
}

// turnos que le quedan a la bola: el promedio de reloj de antes y el modelo de la cancha contra lo que de verdad le tocó (la bola puede llegar al poste antes: eso baja lo real en los dos por igual)
console.log('  turnos por bola (por tramo de reloj): promedio de reloj (antes) · modelo de la cancha · real (turnos que de verdad le tocaron a esa bola)');
const mae = (a: number[], b: number[]) => mean(a.map((v, i) => Math.abs(v - b[i])));
for (const [lo, hi] of [[1500, 1800], [1200, 1500], [900, 1200], [600, 900], [300, 600], [0, 300]]) {
  const rows = paceB.filter((p) => p.clock > lo && p.clock <= hi);
  if (rows.length) console.log(`    ${String(lo / 60).padStart(2)}-${String(hi / 60).padStart(2)} min: antes ${mean(rows.map((r) => r.old)).toFixed(2)} · modelo ${mean(rows.map((r) => r.model)).toFixed(2)} · real ${mean(rows.map((r) => r.real)).toFixed(2)} · error medio absoluto ${mae(rows.map((r) => r.old), rows.map((r) => r.real)).toFixed(2)} → ${mae(rows.map((r) => r.model), rows.map((r) => r.real)).toFixed(2)} (${rows.length} turnos)`);
}
if (paceB.length) {
  console.log(`    todos: error medio absoluto ${mae(paceB.map((r) => r.old), paceB.map((r) => r.real)).toFixed(2)} → ${mae(paceB.map((r) => r.model), paceB.map((r) => r.real)).toFixed(2)} · sesgo ${mean(paceB.map((r) => r.old - r.real)).toFixed(2)} → ${mean(paceB.map((r) => r.model - r.real)).toFixed(2)} (${paceB.length} turnos)`);
  const pa = mean(paceB.map((x) => (x.again ? 1 : 0)));
  const brier = mean(paceB.map((r) => (r.pAgain - (r.again ? 1 : 0)) ** 2)), base = mean(paceB.map((r) => (pa - (r.again ? 1 : 0)) ** 2));
  console.log(`  probabilidad de volver a jugar (modelo): Brier ${brier.toFixed(3)} (constante: ${base.toFixed(3)}) · por rango de probabilidad:`);
  for (const [lo, hi] of [[0, 0.1], [0.1, 0.3], [0.3, 0.6], [0.6, 0.9], [0.9, 1.01]]) {
    const rows = paceB.filter((p) => p.pAgain >= lo && p.pAgain < hi);
    if (rows.length) console.log(`    ${lo.toFixed(1)}-${Math.min(1, hi).toFixed(1)}: estima ${mean(rows.map((r) => r.pAgain)).toFixed(2)} · real ${mean(rows.map((r) => (r.again ? 1 : 0))).toFixed(2)} (${rows.length})`);
  }
}

console.log('\n2. SPARK CONTRA BOLAS RIVALES');
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`  expulsiones decididas: ${knockout.decided} · salió de verdad: ${knockout.ok} (${pc(knockout.ok, knockout.decided)})`);
for (const [k, v] of Object.entries(knockout.causes).sort((a, b) => b[1] - a[1])) console.log(`    fallo · ${k}: ${v}`);
for (const [k, v] of Object.entries(knockout.other).sort((a, b) => b[1] - a[1])) console.log(`    otra jugada · ${k}: ${v}`);

console.log('\n3. SU BOLA SALE DE LA CANCHA AL GOLPEAR');
console.log(`  ${outs.total} salidas en ${GAMES} partidos = ${(outs.total / GAMES).toFixed(2)} por partido`);
for (const [k, v] of Object.entries(outs.causes).sort((a, b) => b[1] - a[1])) console.log(`    causa · ${k}: ${v} (${pc(v, outs.total)})`);
for (const [k, v] of Object.entries(outs.byKind).sort((a, b) => b[1] - a[1])) console.log(`    jugada · ${k}: ${v}`);

if (argv.includes('--dump-sparks')) {
  const f = str('dump-sparks', 'tests/spark-situations.json');
  writeFileSync(f, JSON.stringify(situations));
  console.log(`
${situations.length} situaciones de spark guardadas en ${f}`);
}

console.log(`
4. TOUCH A COMPAÑERAS: ${mates.touches} en ${GAMES} partidos = ${(mates.touches / GAMES).toFixed(2)} por partido · sparks propios ${mates.sparks} (${(mates.sparks / GAMES).toFixed(2)} por partido)`);
for (const [k, v] of Object.entries(mates.byDest).sort((a, b) => b[1] - a[1])) console.log(`    spark propio · ${k}: ${v}`);

console.log(`
5. TOUCHES (intentos de golpe normal): ${tt.attempts} en ${GAMES} partidos = ${(tt.attempts / GAMES).toFixed(1)} por partido · aciertan ${pc(tt.hits, tt.attempts)}`);
for (const [k, [n, h]] of Object.entries(tt.bands)) console.log(`    a ${k}: ${(n / GAMES).toFixed(2)} por partido · aciertan ${pc(h, n)}`);
console.log(`    a bolas en la línea (≤ 1 m): ${(tt.line[0] / GAMES).toFixed(2)} por partido · aciertan ${pc(tt.line[1], tt.line[0])}`);
console.log(`    a compañeras: ${(tt.mate[0] / GAMES).toFixed(2)} por partido · aciertan ${pc(tt.mate[1], tt.mate[0])}`);
console.log(`    esperas en la salida de la puerta 1: ${(tt.waits / GAMES).toFixed(2)} por partido de ${(tt.exits / GAMES).toFixed(2)} salidas`);

console.log(`
6. BALANCE: puntos del kantoku ${(bal.pts / GAMES).toFixed(2)} por partido · puertas pasadas por turno ${(bal.gates / Math.max(1, bal.turns)).toFixed(3)} (${(bal.gates / GAMES).toFixed(1)} por partido) · touches de más de 6 m ${(bal.far[0] / GAMES).toFixed(2)} por partido, aciertan ${pc(bal.far[1], bal.far[0])}`);

console.log(`
7. EXPOSICIÓN (probabilidad de que las próximas rivales toquen, saquen o manden a marcar la bola que acaba de jugar; sin contar mi cobertura)
  reentradas: ${(expo.reentries / GAMES).toFixed(2)} por partido · se quedan fuera ${pc(expo.stayOut, expo.reentries)} (por decisión: el mismo tiro sin error también sale ${expo.byDecision}; por ejecución: sin error entraba ${expo.byExecution}) · exposición media de las que entran ${(expo.sum / Math.max(1, expo.n)).toFixed(3)}
  todas las jugadas del kantoku: exposición media ${(expo.all / Math.max(1, expo.allN)).toFixed(3)} · con exposición ≥ 0,8: ${pc(expo.high, expo.allN)} (${(expo.high / GAMES).toFixed(1)} por partido)`);
