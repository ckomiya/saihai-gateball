// Escenarios de reglas del partido (iteraciones 2 a 12) usados por las pruebas de caracterización.
// Datos puros: cada escenario coloca las bolas, da uno o más golpes y se compara lo que pasa (mensajes y estado final)
// con `tests/golden.json`, que se grabó con la escena anterior antes de extraer `src/game/match.ts`.
// Posiciones en metros. Puerta 1 (18, 11) hacia arriba · puerta 2 (8, 2) hacia la izquierda · puerta 3 (10, 13) hacia la derecha · poste (10, 7,5).
import { CONFIG } from '../src/config';

export interface BallSetup { n: number; x?: number; y?: number; nextGate?: number; outBall?: boolean; points?: number }
export interface Step { n: number; aim: { x: number; y: number }; power: number; acc: number }
export interface Scenario {
  name: string;
  turn: number; // índice de la bola que golpea (0 = bola 1)
  balls?: BallSetup[];
  clock?: number;
  ending?: boolean;
  endNow?: boolean;
  sparked?: number[]; // números de las bolas ya sparkeadas en el turno
  steps: Step[];
}

const bars = (n: number) => CONFIG.playerBars[Math.floor((n - 1) / 2) % CONFIG.playerBars.length];

/** Golpe de la bola n hacia (x, y). k = fuerza relativa al triángulo (1 = llega a la mira); dAcc = desplazamiento de la barra de rumbo. */
export const shot = (n: number, x: number, y: number, k = 1, dAcc = 0): Step => ({
  n,
  aim: { x, y },
  power: Math.min(1, bars(n).power.sweetSpot * k),
  acc: bars(n).accuracy.sweetSpot + dAcc,
});

const FIN = 5;
const enMeta = (...ns: number[]): BallSetup[] => ns.map((n) => ({ n, nextGate: FIN, points: 5 }));

export const SCENARIOS: Scenario[] = [
  // --- Salida y puerta 1 ---
  { name: 'salida: pasa la puerta 1 y gana golpe continuo', turn: 0, steps: [shot(1, 18, 10), shot(1, 18, 6)] },
  { name: 'salida: se queda corta y vuelve a la salida', turn: 0, steps: [shot(1, 18, 13)] },
  { name: 'salida: sale de la cancha sin pasar la puerta', turn: 0, steps: [shot(1, 10, -3, 1.3)] },
  { name: 'salida: desviada por la barra de rumbo', turn: 0, steps: [shot(1, 18, 10, 1, 0.3)] },
  { name: 'salida: bola de otra puerta fuera del ángulo la mueve (inválido)', turn: 0, balls: [{ n: 3, x: 15, y: 13, nextGate: 2 }], steps: [shot(1, 15, 13)] },
  { name: 'salida: bola en el ángulo de tiro es fantasma', turn: 0, balls: [{ n: 3, x: 18, y: 13, nextGate: 2 }], steps: [shot(1, 18, 10)] },
  { name: 'salida: pasa la puerta y choca con una bola (sin touch)', turn: 0, balls: [{ n: 3, x: 18, y: 8, nextGate: 2 }], steps: [shot(1, 18, 7), shot(1, 18, 5)] },
  // --- Puertas y poste ---
  { name: 'puerta 2: la pasa en su sentido', turn: 2, balls: [{ n: 3, x: 11, y: 2, nextGate: 2 }], steps: [shot(3, 6, 2), shot(3, 6, 6)] },
  { name: 'puerta 2: sentido contrario no cuenta', turn: 2, balls: [{ n: 3, x: 5, y: 2, nextGate: 2 }], steps: [shot(3, 11, 2)] },
  { name: 'puerta 3: fuera de orden no cuenta', turn: 2, balls: [{ n: 3, x: 7, y: 13, nextGate: 2 }], steps: [shot(3, 13, 13)] },
  { name: 'puerta 3: la pasa', turn: 2, balls: [{ n: 3, x: 7, y: 13, nextGate: 3 }], steps: [shot(3, 13, 13)] },
  { name: 'puerta 3: roza el poste y rebota', turn: 2, balls: [{ n: 3, x: 7, y: 13.3, nextGate: 3 }], steps: [shot(3, 13, 13.3)] },
  { name: 'poste de meta: +2 y la bola sale', turn: 4, balls: [{ n: 5, x: 10, y: 10, nextGate: 4, points: 3 }], steps: [shot(5, 10, 7.5)] },
  { name: 'poste de meta antes de la puerta 3 no cuenta', turn: 4, balls: [{ n: 5, x: 10, y: 10, nextGate: 3, points: 2 }], steps: [shot(5, 10, 7.5)] },
  { name: 'recorrido: puerta 1, puerta 2 y puerta 3 encadenadas', turn: 0, steps: [shot(1, 18, 10), shot(1, 6, 0.4, 1.0), shot(1, 6, 8)] },
  // --- Bola fuera ---
  { name: 'fuera: sale tras pasar una puerta y conserva el punto', turn: 2, balls: [{ n: 3, x: 9, y: 2, nextGate: 2 }], steps: [shot(3, -3, 2)] },
  { name: 'bola fuera: vuelve a entrar', turn: 2, balls: [{ n: 3, x: -0.2, y: 6, nextGate: 3, outBall: true, points: 1 }], steps: [shot(3, 3, 6)] },
  { name: 'bola fuera: no entra y vuelve a donde estaba', turn: 2, balls: [{ n: 3, x: -0.2, y: 6, nextGate: 3, outBall: true, points: 1 }], steps: [shot(3, -0.2, 9)] },
  { name: 'bola fuera: toca otra bola (falta)', turn: 2, balls: [{ n: 3, x: -0.2, y: 6, nextGate: 3, outBall: true, points: 1 }, { n: 5, x: 2, y: 6, nextGate: 2 }], steps: [shot(3, 2, 6)] },
  // --- Touch y spark ---
  { name: 'touch, spark exitoso y golpe continuo', turn: 2, balls: [{ n: 3, x: 12, y: 6, nextGate: 2 }, { n: 4, x: 9, y: 6, nextGate: 2 }], steps: [shot(3, 9, 6), shot(3, 3, 6), shot(3, 14, 6)] },
  { name: 'spark corto es falta', turn: 2, balls: [{ n: 3, x: 12, y: 6, nextGate: 2 }, { n: 4, x: 9, y: 6, nextGate: 2 }], steps: [shot(3, 9, 6), shot(3, 6, 6, 0.02)] },
  { name: 'spark saca la bola de la cancha', turn: 2, balls: [{ n: 3, x: 3, y: 6, nextGate: 2 }, { n: 4, x: 1, y: 6, nextGate: 2 }], steps: [shot(3, 1, 6), shot(3, -3, 6, 1.2)] },
  { name: 'spark con la bola tocada en el campo exterior (falta)', turn: 2, balls: [{ n: 3, x: 0.05, y: 5, nextGate: 2 }, { n: 4, x: 0.27, y: 5, nextGate: 2 }], steps: [shot(3, 0.27, 5, 0.3), shot(3, -3, 5)] },
  { name: 'tocar dos veces la misma bola sparkeada es falta', turn: 2, balls: [{ n: 3, x: 12, y: 6, nextGate: 2 }, { n: 4, x: 9, y: 6, nextGate: 2 }], steps: [shot(3, 9, 6), shot(3, 6, 6, 1.0), shot(3, 6, 6, 1.3)] },
  { name: 'spark empuja una bola por su puerta', turn: 2, balls: [{ n: 3, x: 7.5, y: 13, nextGate: 2 }, { n: 4, x: 9, y: 13, nextGate: 3 }], steps: [shot(3, 9, 13), shot(3, 12, 13)] },
  { name: 'touch y puerta en el mismo golpe (dos golpes tras el spark)', turn: 2, balls: [{ n: 3, x: 10, y: 2, nextGate: 2 }, { n: 4, x: 5.5, y: 2, nextGate: 3 }], steps: [shot(3, 5.5, 2), shot(3, 1.5, 2), shot(3, 3, 6), shot(3, 3, 9)] },
  { name: 'touch a dos bolas a la vez', turn: 2, balls: [{ n: 3, x: 12, y: 6, nextGate: 2 }, { n: 4, x: 9, y: 5.9, nextGate: 2 }, { n: 6, x: 9, y: 6.1, nextGate: 2 }], steps: [shot(3, 9, 6), shot(3, 3, 5), shot(3, 3, 7)] },
  { name: 'touch fuerte: la bola tocada sale de la cancha', turn: 2, balls: [{ n: 3, x: 3, y: 6, nextGate: 2 }, { n: 4, x: 0.6, y: 6, nextGate: 2 }], steps: [shot(3, 0.6, 6, 1.4)] },
  { name: 'touch fuerte: empuja una bola por su puerta', turn: 2, balls: [{ n: 3, x: 7, y: 13, nextGate: 2 }, { n: 4, x: 9.5, y: 13, nextGate: 3 }], steps: [shot(3, 9.5, 13, 1.5)] },
  // --- Reloj y fin del partido ---
  { name: 'tiempo: termina la roja, juega la blanca y acaba', turn: 0, clock: 0.05, balls: [{ n: 1, x: 10, y: 10, nextGate: 2 }, { n: 2, x: 5, y: 5, nextGate: 2 }], steps: [shot(1, 10, 9), shot(2, 5, 6)] },
  { name: 'tiempo: la blanca que golpea termina el partido', turn: 1, ending: true, balls: [{ n: 2, x: 5, y: 5, nextGate: 2 }], steps: [shot(2, 5, 6)] },
  { name: 'juego perfecto del rojo: juega la blanca y acaba', turn: 0, balls: [{ n: 1, x: 10, y: 9, nextGate: 4, points: 3 }, ...enMeta(3, 5, 7, 9), { n: 2, x: 5, y: 5, nextGate: 2 }], steps: [shot(1, 10, 7.5), shot(2, 5, 6)] },
  { name: 'juego perfecto del blanco: termina al acabar el golpe', turn: 1, balls: [{ n: 2, x: 10, y: 9, nextGate: 4, points: 3 }, ...enMeta(4, 6, 8, 10)], steps: [shot(2, 10, 7.5)] },
  { name: 'todas las bolas en meta', turn: 9, balls: [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, nextGate: FIN, points: 1 })), { n: 10, x: 10, y: 9, nextGate: 4, points: 1 }], steps: [shot(10, 10, 7.5)] },
];
