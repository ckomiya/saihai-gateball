// API pública de Saihai (`saihai-gateball`): crear un partido, pedirle una jugada a Saihai y aplicarla. Sin Phaser ni DOM.
//
//   import { createMatch, Saihai, playShot } from 'saihai-gateball';
//   const match = createMatch({ seed: 42 });
//   const saihai = new Saihai({ opponent: 'human' });
//   const shot = saihai.chooseShot(match);
//   const res = playShot(match, shot);
//
// El resto del motor está en `saihai-gateball/engine`; las ayudas de dibujo, en `saihai-gateball/debug`.
import { kantokuLevelBase } from './config';
import type { ErrorBase } from './game/certainty';
import type { CpuPlan } from './game/cpu';
import { KANTOKU_LEVEL, cpuPlan, kantokuLevelErrors } from './game/cpuDriver';
import { kantokuBrain } from './game/kantoku';
import { Match, Resolution } from './game/match';
import type { BallState, FoulReason, MatchEvent, SoundCue, Transition } from './game/match';
import { checkLang, decisionIn } from './game/i18n';
import type { Lang } from './game/i18n';
import type { Rng } from './game/rng';
import { mulberry32 } from './game/rng';

export const SAIHAI_MODEL = 'saihai-v1.5';

export type { ErrorBase, CpuPlan, Resolution, Rng, MatchEvent, Transition, FoulReason, BallState, SoundCue, Lang };
export { messageFor, messagesFor } from './game/messages';
export { Match };

/** Partido nuevo: 10 bolas en la salida, reloj completo y turno de la bola 1. El azar se inyecta: con `seed` el partido se repite; sin ella usa `rng` o la semilla 1. */
export function createMatch(opts: { seed?: number; rng?: Rng } = {}): Match {
  const m = new Match(opts.rng ?? mulberry32(opts.seed ?? 1));
  m.reset();
  return m;
}

export interface SaihaiOptions {
  /** Cómo juzga Saihai a sus rivales: `'human'` (por defecto) con el error de un buen jugador humano; `'saihai'`, con su mismo error. */
  opponent?: 'human' | 'saihai';
  /** Error base de la ejecución de sus propios tiros (mira, fuerza y rumbo; se multiplica por la certeza del jugador a esa distancia). Por defecto, el del nivel «Kantoku IA» del juego. */
  execution?: ErrorBase;
  /** Anota en `Shot.plan.decision` por qué eligió el golpe. No cambia la jugada. */
  explain?: boolean;
  /** Idioma de los textos de `Shot.plan.decision` (solo con `explain`): `'es'` (por defecto) o `'en'`. No cambia la jugada. Cualquier otro valor lanza `RangeError`. */
  lang?: Lang;
}

/** Una jugada de Saihai: dónde colocar la bola (solo en el tiro de salida), hacia dónde apuntar y dónde detener las barras de fuerza y de rumbo (0 a 1). */
export interface Shot {
  startX: number;
  aim: { x: number; y: number };
  power: number;
  accuracy: number;
  /** El plan completo (con el golpe ideal sin error y, si se pidió `explain`, la decisión). */
  plan: CpuPlan;
}

/** El agente: dado un partido, elige el golpe de la bola que juega. */
export class Saihai {
  constructor(private readonly opts: SaihaiOptions = {}) {
    checkLang(opts.lang);
  }

  /** Elige el golpe de la bola que juega (o del spark en curso). No modifica el partido, pero consume su azar (`match.rng`) como cualquier decisión. */
  chooseShot(match: Match): Shot {
    const errors = kantokuLevelErrors();
    const plan = cpuPlan(match, KANTOKU_LEVEL, {
      brain: kantokuBrain,
      errors: { ...errors, base: this.opts.execution ?? errors.base ?? kantokuLevelBase(), rivalIsHuman: (this.opts.opponent ?? 'human') === 'human' },
      explain: this.opts.explain,
    });
    if (plan.decision) plan.decision = decisionIn(plan.decision, this.opts.lang ?? 'es');
    return { startX: plan.startX, aim: plan.aim, power: plan.power, accuracy: plan.acc, plan };
  }
}

/**
 * Aplica un golpe y deja rodar la bola hasta que todo se detiene; devuelve la resolución (eventos, puntos, qué sigue) y deja el partido listo para `match.proceed()`.
 * No cobra al reloj el tiempo de pensar ni de leer mensajes (eso lo decide quien integra el motor, como la escena del juego).
 */
export function playShot(match: Match, shot: Pick<Shot, 'startX' | 'aim' | 'power' | 'accuracy'>, dt = 1 / 60): Resolution {
  if (match.strokesInTurn === 0 && !match.sparkBall && match.b.nextGate === 1) match.b.x = shot.startX; // coloca la bola en la salida
  let res = match.shoot(shot.aim, shot.power, shot.accuracy);
  for (let f = 0; f < 60 * 60 && !res && match.stage === 'rolling'; f++) {
    match.update(dt, true);
    if (match.step(dt)) res = match.resolution;
  }
  if (!res) { match.forceStop(); res = match.resolution!; }
  return res;
}
