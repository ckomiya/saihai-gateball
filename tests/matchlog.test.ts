// Registro de partidas (`src/game/matchLog.ts`): una partida simulada del kantoku contra un rival tipo humano se registra golpe a golpe y el registro tiene todo lo que hace falta para
// reportar un turno («turno 23»): número de turno, reloj, las 10 bolas antes y después, quién tiró, qué pasó y, en la CPU, su decisión con alternativas, términos y riesgo.
// Además, registrar NO cambia la partida (mismo azar, mismo resultado) y el comando de revisión (`npm run replay`) lee el archivo y dibuja el turno.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { MatchLogData, MatchLogger } from '../src/game/matchLog';
import { playVsHuman } from '../scripts/vsHuman';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };

const logger = new MatchLogger({ level: CONFIG.cpuLevels.length, cpuTeam: 1 });
logger.data.id = 'prueba-registro';
const withLog = playVsHuman(77, 1, logger);
const without = playVsHuman(77, 1);
check(withLog.red === without.red && withLog.white === without.white && withLog.strokes === without.strokes, `registrar no cambia la partida (${withLog.red}-${withLog.white} en ${withLog.strokes} golpes, igual que sin registro)`);

const d = JSON.parse(logger.json()) as MatchLogData;
check(d.shots.length === withLog.strokes, `un registro por golpe (${d.shots.length} de ${withLog.strokes})`);
check(d.shots.every((s, i) => s.shot === i + 1 && s.before.length === 10 && !!s.after && s.after.length === 10 && !!s.result && !!s.score), 'cada golpe tiene las 10 bolas antes y después, el resultado y el marcador');
const turns = d.shots.map((s) => s.turn);
check(turns.every((t, i) => i === 0 || t === turns[i - 1] || t === turns[i - 1] + 1) && turns[0] === 1, `los turnos avanzan de uno en uno desde 1 (último: ${turns.at(-1)})`);
check(d.shots.every((s, i) => i === 0 || s.clock <= d.shots[i - 1].clock + 1e-9), 'el reloj nunca sube');
check(d.shots.every((s) => /^\d\d:\d\d$/.test(s.clockText)), 'el reloj se registra como en el HUD (mm:ss)');
check(d.shots.every((s) => s.pacing.turnsLeft >= 0 && s.pacing.secondsPerRound > 0 && ['inicio', 'medio', 'final'].includes(s.pacing.phase)), 'cada golpe anota el ritmo (turnos que cree que quedan) y la fase');

const cpu = d.shots.filter((s) => s.team === 1);
check(cpu.length > 20 && cpu.every((s) => !!s.decision && !!s.plan), 'las jugadas de la CPU llevan su decisión y lo que intentó con las barras');
const planned = cpu.filter((s) => s.decision?.source === 'planificador' && s.decision.explanation);
check(planned.length > 10, `${planned.length} decisiones del planificador con explicación`);
check(planned.every((s) => {
  const ex = s.decision!.explanation!;
  return ex.alternatives.length >= 1 && ex.alternatives.length <= 5 && ex.alternatives[0].chosen && ex.alternatives.every((a) => Object.keys(a.terms).length > 0 && !!a.kind);
}), 'hasta 5 alternativas, la elegida primero, cada una con su tipo de jugada y los términos que pesaron');
check(planned.some((s) => (s.decision!.explanation!.risk.length ?? 0) > 0 && s.decision!.explanation!.alternatives[0].terms.riesgo !== undefined), 'el riesgo de las bolas rivales queda desglosado (cada rival con «pasa» y «toca»)');
const agariRows = cpu.filter((s) => s.decision?.explanation?.agari);
check(agariRows.every((s) => typeof s.decision!.explanation!.agari!.turnsLeft === 'number' && s.decision!.explanation!.agari!.limit === CONFIG.kantokuAgariTurns), `las jugadas con la bola lista para el poste anotan qué decidió el agari (${agariRows.length} casos)`);
const chosenAgari = agariRows.filter((s) => s.decision!.explanation!.agari!.chosenIsAgari);
check(chosenAgari.every((s) => !!s.decision!.explanation!.agari!.why), `cada agari anota por qué se permitió (${chosenAgari.length} agaris)`);
check(d.shots.filter((s) => s.mode === 'spark').every((s) => s.sparkBall !== undefined), 'los spark anotan qué bola se sparkea');
check(!!d.final, 'el registro guarda el final (marcador y motivo)');

// El comando de revisión: lee el archivo, explica el turno y dibuja la cancha en un SVG
mkdirSync('.build/partidas-prueba', { recursive: true });
const file = '.build/partidas-prueba/prueba-registro.json';
writeFileSync(file, logger.json());
const turn = planned[Math.floor(planned.length / 2)].turn;
const run = spawnSync(process.execPath, ['scripts/run-node.mjs', 'scripts/replay.ts', file, '--turn', String(turn)], { encoding: 'utf8' });
check(run.status === 0 && run.stdout.includes(`Turno ${turn}.`) && run.stdout.includes('Alternativas'), `npm run replay -- archivo --turn ${turn} explica la decisión`);
const svg = `.build/partidas-prueba/replays/prueba-registro-t${turn}-1.svg`;
check(existsSync(svg) && readFileSync(svg, 'utf8').includes('<svg') && readFileSync(svg, 'utf8').includes('<circle'), 'y dibuja la cancha en un SVG');
const list = spawnSync(process.execPath, ['scripts/run-node.mjs', 'scripts/replay.ts', file, '--list'], { encoding: 'utf8' });
check(list.status === 0 && list.stdout.split('\n').length > d.shots.length, 'y --list resume todos los golpes');
rmSync('.build/partidas-prueba', { recursive: true, force: true });

process.exit(fail ? 1 : 0);
