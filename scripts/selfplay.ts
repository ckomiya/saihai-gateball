// Partido completo CPU contra CPU, sin pantalla ni Phaser: `npm run selfplay -- --games 8 --levels 4,1 --seed 1`
// Usa el mismo motor de reglas (`src/game/match.ts`) y la misma CPU que la escena. Devuelve puntos, ganador, golpes y tiempo de cómputo.
//
// El reloj del partido se cobra como en pantalla: mientras la bola rueda (a 60 cuadros por segundo), mientras la CPU coloca, apunta y
// detiene las barras (`cpuThinkSeconds`, mismas fórmulas que la animación) y mientras espera cada mensaje (`CONFIG.messageSeconds`, como `MatchScene`).
import { CONFIG } from '../src/config';
import type { ErrorBase, Profile } from '../src/game/certainty';
import { CpuOptions, cpuPlan, cpuThinkSeconds } from '../src/game/cpuDriver';
import type { CpuPlan } from '../src/game/cpu';
import { MatchLogger } from '../src/game/matchLog';
import { BALLS, Match, POLE_STEP, Resolution, SavedState } from '../src/game/match';
import { messagesFor } from '../src/game/messages';
import { mulberry32 } from '../src/game/rng';
import { Brain, handBrain } from '../src/game/weights';

const FRAME = 1 / 60;
const MAX_STROKES = 600; // por seguridad: un partido normal tiene 60-150 golpes
const MAX_ROLL_FRAMES = 60 * 60;

export interface GameOptions {
  seed: number;
  /** Nivel de la CPU (0-3) de las rojas y de las blancas. */
  levels: [number, number];
  maxStrokes?: number;
  /** Cambia `CONFIG.clockFactor` solo durante este partido (para medir cuántas vueltas da según el reloj). */
  clockFactor?: number;
  /** Equipo que se comporta como un humano: su reloj solo corre mientras rueda la bola (como en la escena, que lo detiene mientras mide y lee mensajes). Su nivel es el que juega por él. */
  humanTeam?: 0 | 1;
  /** Espera por mensaje (por defecto `CONFIG.messageSeconds`, como la escena) y escala de lo que tarda la CPU en colocar y apuntar (1 = como la escena): para probar esperas más cortas. */
  messageSeconds?: number;
  thinkScale?: number;
  /** Quién valora los golpes de cada equipo (por defecto, los pesos a mano). */
  brains?: [Brain, Brain];
  /** Error base realista de todos los tiros (× la certeza del jugador a esa distancia); sin esto, el error del nivel. */
  errors?: { base: ErrorBase; rivalIsHuman?: boolean };
  /** Por equipo, el error base de ese equipo en vez de `errors` (para que un bando se parezca a una persona). */
  errorsByTeam?: [{ base: ErrorBase; rivalIsHuman?: boolean } | undefined, { base: ErrorBase; rivalIsHuman?: boolean } | undefined];
  /** Por equipo: fuerza de más (0,1 = +10 %) en los golpes de touch (una persona suele pasarse para asegurar el touch). */
  touchExtra?: [number, number];
  /** Certeza de los 5 jugadores de cada equipo (rojo, blanco), en el orden de sus bolas; sin esto, los perfiles de `config.ts`. */
  profiles?: [Profile[], Profile[]];
  /** Por equipo: cuánto se equivoca de verdad al golpear (`exec`) y cuánto cree el planificador que se equivoca (`plan`), como múltiplo del error base. Por defecto 1 y 1. */
  errorScales?: [{ exec: number; plan: number }, { exec: number; plan: number }];
  /** Empieza desde un estado guardado (banco de finales) en vez de un partido nuevo. */
  start?: SavedState;
  /** Se llama con el plan de la CPU ya decidido, antes de golpear. */
  onShot?: (m: Match, team: 0 | 1, plan: CpuPlan, freshTurn: boolean) => void;
  /** Se llama con el golpe ya resuelto (todo quieto), antes de pasar al turno siguiente. */
  onResult?: (m: Match, res: Resolution, team: 0 | 1) => void;
  /** Se llama antes de cada golpe; `freshTurn` = el turno acaba de empezar. */
  onStroke?: (m: Match, freshTurn: boolean) => void;
  /** Registro de la partida (`src/game/matchLog.ts`): anota cada golpe con la decisión de la CPU; no cambia ninguna jugada. */
  logger?: MatchLogger;
}

export interface GameResult {
  red: number;
  white: number;
  winner: 'rojo' | 'blanco' | 'empate';
  reason: 'perfect' | 'time' | 'allIn' | 'maxStrokes';
  strokes: number;
  strokesByTeam: [number, number];
  /** Segundos de partido que quedaban al terminar. */
  clockLeft: number;
  /** Segundos reales que duraría en pantalla (reloj gastado ÷ clockFactor). */
  screenSeconds: number;
  /** Tiempo de cómputo del partido entero (ms), y lo que tardó el planificador de la CPU. */
  computeMs: number;
  planMs: { total: number; calls: number; max: number };
  touches: number;
  faults: number;
  /** Turnos que jugó cada bola (índice 0 = bola 1). Un turno puede tener varios golpes (continuo, spark). */
  turnsPerBall: number[];
  /** Segundos reales en pantalla por tipo de espera: la CPU colocando y apuntando, la bola rodando y los mensajes. */
  screenSplit: { think: number; roll: number; messages: number };
}

export function playMatch(opts: GameOptions): GameResult {
  const savedFactor = CONFIG.clockFactor;
  if (opts.clockFactor !== undefined) CONFIG.clockFactor = opts.clockFactor;
  try {
    return playMatchInner(opts);
  } finally {
    CONFIG.clockFactor = savedFactor;
  }
}

function playMatchInner(opts: GameOptions): GameResult {
  const t0 = performance.now();
  const rng = mulberry32(opts.seed);
  const m = opts.start ? Match.restore(opts.start, rng) : new Match(rng);
  if (!opts.start) m.reset();
  if (opts.profiles) for (let i = 0; i < BALLS; i++) m.profiles[i] = opts.profiles[i % 2][Math.floor(i / 2)];
  const brains = opts.brains ?? [handBrain, handBrain];
  const strokesByTeam: [number, number] = [0, 0];
  const plan = { total: 0, calls: 0, max: 0 };
  let strokes = 0, touches = 0, faults = 0;
  const turnsPerBall = new Array<number>(BALLS).fill(0);
  const screenSplit = { think: 0, roll: 0, messages: 0 };
  let fresh = true; // el turno acaba de empezar (no es un golpe continuo ni un spark)
  const maxStrokes = opts.maxStrokes ?? MAX_STROKES;

  while (m.stage !== 'done' && strokes < maxStrokes) {
    const team = m.b.team;
    if (fresh) turnsPerBall[m.turn]++;
    opts.onStroke?.(m, fresh);
    const aim0 = m.defaultAim(); // mira con la que empieza el golpe, como la escena
    const p0 = performance.now();
    const sc = opts.errorScales?.[team];
    const eb = opts.errorsByTeam?.[team] ?? opts.errors;
    const cpuOpts: CpuOptions = { brain: brains[team], errors: eb && { ...eb, executionScale: sc?.exec, planningScale: sc?.plan }, explain: !!opts.logger };
    const cpu = cpuPlan(m, opts.levels[team], cpuOpts);
    const extra = opts.touchExtra?.[team] ?? 0;
    if (extra > 0 && !m.sparkBall && cpu.ideal && m.balls.some((o, i) => i !== m.turn && o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall && Math.hypot(o.x - cpu.ideal!.aim.x, o.y - cpu.ideal!.aim.y) < 0.35)) cpu.power = Math.min(1, cpu.power * (1 + extra)); // intento de touch con fuerza de más
    const dp = performance.now() - p0;
    plan.total += dp; plan.calls++; plan.max = Math.max(plan.max, dp);

    opts.onShot?.(m, team, cpu, fresh);
    const human = opts.humanTeam === team;
    const think = cpuThinkSeconds(m, cpu, aim0, fresh) * (opts.thinkScale ?? 1);
    if (!human) screenSplit.think += think; // lo que tarda una persona en medir no se cuenta
    m.update(human ? 0 : think, !human); // el reloj corre mientras la CPU coloca, apunta y detiene las barras
    if (fresh && m.b.nextGate === 1) m.b.x = cpu.startX; // coloca la bola en la salida
    opts.logger?.beginShot(m, { cpu: true, aim: cpu.aim, power: cpu.power, acc: cpu.acc, plan: cpu });
    let res = m.shoot(cpu.aim, cpu.power, cpu.acc);
    strokes++;
    strokesByTeam[team]++;
    for (let f = 0; f < MAX_ROLL_FRAMES && !res && m.stage === 'rolling'; f++) {
      m.update(FRAME, true); // el reloj corre mientras rueda la bola
      screenSplit.roll += FRAME;
      if (m.step(FRAME)) res = m.resolution;
    }
    if (!res) { m.forceStop(); res = m.resolution!; }
    opts.logger?.endShot(m, res);
    opts.onResult?.(m, res, team);
    for (const e of res.events) {
      if (e.type === 'touch') touches++;
      if ((e.type === 'strokerOut' && e.foul) || e.type === 'sparkFoul') faults++;
    }
    const waits = messagesFor(res.events).length * (opts.messageSeconds ?? CONFIG.messageSeconds);
    screenSplit.messages += waits;
    m.update(human ? 0 : waits, !human); // espera de los mensajes (el reloj sigue corriendo si juega la CPU)
    fresh = m.proceed() === 'turn';
  }

  opts.logger?.finish(m);
  const red = m.teamScore(0), white = m.teamScore(1);
  return {
    red,
    white,
    winner: red === white ? 'empate' : red > white ? 'rojo' : 'blanco',
    reason: m.stage === 'done' ? m.endReason() : 'maxStrokes',
    strokes,
    strokesByTeam,
    clockLeft: m.clock,
    screenSeconds: (CONFIG.matchMinutes * 60 - m.clock) / CONFIG.clockFactor,
    computeMs: performance.now() - t0,
    planMs: plan,
    touches,
    faults,
    turnsPerBall,
    screenSplit,
  };
}

// ---------- Línea de comandos ----------

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main() {
  const games = Number(arg('games', '1'));
  const seed0 = Number(arg('seed', '1'));
  const [lr, lw] = arg('levels', '4,4').split(',').map((v) => Number(v) - 1) as [number, number]; // niveles del menú 1-4
  const rows: GameResult[] = [];
  for (let g = 0; g < games; g++) {
    const r = playMatch({ seed: seed0 + g, levels: [lr, lw] });
    rows.push(r);
    console.log(
      `partido ${g + 1} (semilla ${seed0 + g}): rojas ${r.red} - ${r.white} blancas · gana ${r.winner} · ${r.reason} · ${r.strokes} golpes · ` +
      `${(r.screenSeconds / 60).toFixed(1)} min en pantalla · ${r.touches} touches, ${r.faults} faltas · cómputo ${(r.computeMs / 1000).toFixed(2)} s ` +
      `(planificador ${(r.planMs.total / Math.max(1, r.planMs.calls)).toFixed(1)} ms/golpe, máx ${r.planMs.max.toFixed(0)} ms)`,
    );
  }
  if (games > 1) {
    const sum = (f: (r: GameResult) => number) => rows.reduce((s, r) => s + f(r), 0);
    const wins = (w: string) => rows.filter((r) => r.winner === w).length;
    console.log(
      `\nnivel ${lr + 1} (rojas) contra nivel ${lw + 1} (blancas), ${games} partidos: rojas ${wins('rojo')} · blancas ${wins('blanco')} · empates ${wins('empate')} · ` +
      `puntos medios ${(sum((r) => r.red) / games).toFixed(1)} - ${(sum((r) => r.white) / games).toFixed(1)} · ` +
      `${(sum((r) => r.strokes) / games).toFixed(0)} golpes · ${(sum((r) => r.faults) / games).toFixed(1)} faltas · ` +
      `cómputo ${(sum((r) => r.computeMs) / games / 1000).toFixed(2)} s por partido`,
    );
  }
}

if (process.argv[1]?.endsWith('selfplay.mjs')) main();
