// Cuántas vueltas da el partido simulado según `clockFactor`, cuánto dura en pantalla y cuántos golpes tiene cada fase.
// Uso: npm run rounds -- --factors 4,5,6 --games 12 --levels 4,4 [--seed 1] [--human 0] [--msg 1] [--think 0.5]
// «Vuelta» = turno de cada bola (un partido real de 30 min da entre 5 y 6 por bola). Con --human 0 el equipo rojo juega «como un humano»:
// su reloj solo corre mientras rueda la bola (su nivel es el primero de --levels). Sin --human, CPU contra CPU con el reloj siempre en marcha.
// Las fases son las de `src/game/phase.ts` (inicio, medio y final con k ≤ `kantokuFinalTurns`).
import { CONFIG } from '../src/config';
import { phaseOf } from '../src/game/phase';
import { playMatch } from './selfplay';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const factors = arg('factors', CONFIG.clockFactor.toString()).split(',').map(Number);
const games = Number(arg('games', '12'));
const [la, lb] = arg('levels', '4,4').split(',').map((v) => Number(v) - 1) as [number, number];
const seed0 = Number(arg('seed', '1'));
const human = arg('human', 'none') === 'none' ? undefined : (Number(arg('human', '0')) as 0 | 1);
const messageSeconds = arg('msg', '') ? Number(arg('msg', '')) : undefined; // espera por mensaje (s)
const thinkScale = arg('think', '') ? Number(arg('think', '')) : undefined; // escala del tiempo de la CPU

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const TOTAL = CONFIG.matchMinutes * 60;

for (const factor of factors) {
  const rows = [];
  for (let g = 0; g < games; g++) {
    const phases = { inicio: 0, medio: 0, final: 0 };
    const r = playMatch({
      seed: seed0 + g, levels: [la, lb], clockFactor: factor, humanTeam: human, messageSeconds, thinkScale,
      onStroke: (m) => { phases[phaseOf(m)]++; },
    });
    rows.push({ r, phases });
  }
  const perBall = rows.map(({ r }) => mean(r.turnsPerBall));
  const reasons: Record<string, number> = {};
  for (const { r } of rows) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const screen = rows.map(({ r }) => (r.screenSplit.think + r.screenSplit.roll + r.screenSplit.messages) / 60);
  const split = (k: 'think' | 'roll' | 'messages') => mean(rows.map(({ r }) => r.screenSplit[k])) / 60;
  const strokes = mean(rows.map(({ r }) => r.strokes));
  const roundSecs = mean(rows.map(({ r }) => (TOTAL - r.clockLeft) / (r.turnsPerBall.reduce((a, b) => a + b, 0) / 10)));
  const ph = (k: 'inicio' | 'medio' | 'final') => mean(rows.map((x) => x.phases[k]));
  console.log(
    `clockFactor ${factor}: ${mean(perBall).toFixed(2)} turnos por bola (±${sd(perBall).toFixed(2)}, de ${Math.min(...perBall).toFixed(1)} a ${Math.max(...perBall).toFixed(1)}) · ` +
    `${strokes.toFixed(0)} golpes · fin: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ')}\n` +
    `    pantalla: ${mean(screen).toFixed(1)} min (CPU colocando/apuntando ${split('think').toFixed(1)}, bola rodando ${split('roll').toFixed(1)}, mensajes ${split('messages').toFixed(1)}) · ` +
    `${roundSecs.toFixed(0)} s de reloj por vuelta\n` +
    `    golpes por fase: inicio ${ph('inicio').toFixed(0)} · medio ${ph('medio').toFixed(0)} · final ${ph('final').toFixed(0)} (${(100 * ph('final') / strokes).toFixed(0)} % del partido en el final)`,
  );
}
