// Datos para el modelo de ritmo (`src/game/pace.ts`): juega partidos y, por turno, guarda lo que se sabía al empezar y lo que costó de verdad. Uso: npm run pacedata -- [--games 20]
import { CONFIG } from '../src/config';
import { MatchLogger } from '../src/game/matchLog';
import { playVsHuman } from './vsHuman';
const argv = process.argv.slice(2);
const GAMES = Number(argv[argv.indexOf('--games') + 1] || 20);
const rows: { seconds: number; strokes: number; ball: number; clock: number; gate: number; side: number; before: unknown; ending: boolean }[] = [];
for (let g = 0; g < GAMES; g++) {
  const side = (g % 2) as 0 | 1;
  const logger = new MatchLogger({ level: CONFIG.cpuLevels.length, cpuTeam: side });
  playVsHuman(31000 + g, side, logger);
  const shots = logger.data.shots;
  const firsts = shots.filter((s) => s.stroke === 1);
  for (let k = 0; k < firsts.length - 1; k++) {
    const s = firsts[k], nx = firsts[k + 1];
    const strokes = shots.filter((x) => x.turn === s.turn).length;
    rows.push({ seconds: s.clock - nx.clock, strokes, ball: s.ball, clock: s.clock, gate: s.before.find((b) => b.n === s.ball)!.gate, side, before: s.before, ending: false });
  }
}
import { writeFileSync } from 'node:fs';
writeFileSync('.build/pacedata.json', JSON.stringify(rows));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`turnos ${rows.length} · segundos/turno ${mean(rows.map((r) => r.seconds)).toFixed(1)} · golpes/turno ${mean(rows.map((r) => r.strokes)).toFixed(2)} · segundos/golpe ${(mean(rows.map((r) => r.seconds)) / mean(rows.map((r) => r.strokes))).toFixed(1)}`);
for (let n = 1; n <= 6; n++) { const r = rows.filter((x) => x.strokes === n); if (r.length) console.log(`  ${n} golpes: ${r.length} turnos, ${mean(r.map((x) => x.seconds)).toFixed(1)} s (${(mean(r.map((x) => x.seconds)) / n).toFixed(1)} por golpe)`); }
const r6 = rows.filter((x) => x.strokes >= 7); if (r6.length) console.log(`  7+ golpes: ${r6.length} turnos, ${mean(r6.map((x) => x.seconds)).toFixed(1)} s`);
for (const gt of [1, 2, 3, 4]) { const r = rows.filter((x) => x.gate === gt); console.log(`  bola en meta ${gt}: ${r.length} turnos, ${mean(r.map((x) => x.strokes)).toFixed(2)} golpes, ${mean(r.map((x) => x.seconds)).toFixed(1)} s`); }
