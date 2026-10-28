import { CONFIG, LAYOUT, kantokuLevelBase } from '../config';
import { ErrorBase, scaleError, scoreProbability } from './certainty';
import { COURT_H, COURT_W } from './court';
import { exitChainThreat, touchThreat } from './threat';

/**
 * Zonas de la cancha (propuesta de la iteración C, sin uso en la CPU todavía; se dibujan en el modo debug de la escena con F2).
 *  - Zona de entrada de una puerta (o del poste): los puntos desde los que se pasa de un tiro con probabilidad alta, con el error de referencia
 *    (el del nivel «Kantoku IA» y un jugador promedio) y el desvío del pasto.
 *  - Peligro de la salida de la puerta 1: dónde queda a merced de un rival (humano) que pase la puerta 1 y siga con su golpe continuo.
 * Sin Phaser.
 */

export interface ZoneCell { x: number; y: number; p: number }

export const ZONE_CELL = 0.5; // metros

/** Error de referencia para dibujar las zonas: error base × el multiplicador del nivel «Kantoku IA», jugador promedio. */
export const referenceError = (): ErrorBase => scaleError(kantokuLevelBase(), CONFIG.kantokuLevelErrorScale);

function grid(fn: (x: number, y: number) => number, min: number): ZoneCell[] {
  const cells: ZoneCell[] = [];
  for (let x = ZONE_CELL / 2; x < COURT_W; x += ZONE_CELL) {
    for (let y = ZONE_CELL / 2; y < COURT_H; y += ZONE_CELL) {
      const p = fn(x, y);
      if (p >= min) cells.push({ x, y, p });
    }
  }
  return cells;
}

/** Zona de entrada de la meta `step` (1-3 = puerta, 4 = poste): probabilidad de pasarla (o llegar) de un tiro desde cada punto de la cancha. */
export function entryZone(step: number, e = referenceError(), min = 0.3): ZoneCell[] {
  return grid((x, y) => scoreProbability({ x, y }, step, e, true), min);
}

/**
 * Peligro de la salida de las puertas 2 y 3: un rival (humano) con su bola 3 m delante de la puerta `step`, de frente, la pasa y con el golpe continuo toca ahí una bola mía
 * (`exitChainThreat`: P(pasar) × P(touch desde el punto de parada más favorable)). Sin postes en el camino hacia la bola mía.
 */
export function exitDangerGate(step: 2 | 3, e: ErrorBase = CONFIG.humanRivalError, min = 0.1): ZoneCell[] {
  const g = LAYOUT.gates[step - 1];
  const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[g.dir];
  const rival = { n: 0, team: 0 as const, x: g.x + back[0] * 3, y: g.y + back[1] * 3, vx: 0, vy: 0, nextGate: step, outBall: false, points: 0 };
  return grid((x, y) => exitChainThreat(rival, { x, y }, e), min);
}

/**
 * Peligro de la salida de la puerta 1: probabilidad de que un rival que sale del área de salida pase la puerta 1 y, con su golpe continuo, toque una bola mía en esa
 * celda (`touchThreat`, que mira el punto de parada más favorable de `EXIT_STOPS`). Por defecto con el error de un buen jugador humano (`humanRivalError`).
 * Ignora los postes en el camino.
 */
export function exitDanger(e: ErrorBase = CONFIG.humanRivalError, min = 0.1): ZoneCell[] {
  const start = { n: 0, team: 0 as const, x: (LAYOUT.startArea.x1 + LAYOUT.startArea.x2) / 2, y: LAYOUT.startArea.ballY, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0 };
  return grid((x, y) => touchThreat(start, { x, y }, e), min);
}
