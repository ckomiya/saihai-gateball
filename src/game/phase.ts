import { CONFIG } from '../config';
import { BALLS, FINISHED, Match } from './match';
import type { Pace } from './pace';

/**
 * Fases del partido para el kantoku artificial, por turnos que quedan y no por minutos (así sirven con cualquier `clockFactor`).
 *  - inicio: hasta que cada bola haya jugado su primer turno;
 *  - final: quedan `kantokuFinalTurns` turnos o menos para esta bola, o el partido ya está en su última bola (`ending`);
 *  - medio: el resto.
 * Sin Phaser.
 */
export type Phase = 'inicio' | 'medio' | 'final';

const TOTAL_SECONDS = CONFIG.matchMinutes * 60;

const aliveBalls = (m: Match) => Math.max(1, m.balls.filter((b) => b.nextGate !== FINISHED).length);

/** Segundos de reloj que gasta cada turno (de cualquier bola): la media observada en este partido o, antes de una vuelta, el valor de `config.ts` entre 10. */
export function secondsPerTurn(m: Match): number {
  return m.turnStarts >= BALLS ? Math.max(0.5, (TOTAL_SECONDS - m.clock) / m.turnStarts) : CONFIG.kantokuRoundSeconds / BALLS;
}

/**
 * Segundos de reloj que gasta una vuelta. Con `kantokuPaceByTurn`, lo que cuesta un turno × las bolas que siguen vivas (una vuelta se acorta a medida que las bolas llegan al poste);
 * sin él (como antes), la media de las vueltas ya jugadas, que sobrestima la vuelta y subestima los turnos que quedan en la segunda mitad (medido con `npm run audit`).
 */
export function secondsPerRound(m: Match): number {
  if (CONFIG.kantokuPaceByTurn) return secondsPerTurn(m) * aliveBalls(m);
  return m.turnStarts >= BALLS ? Math.max(1, (TOTAL_SECONDS - m.clock) / (m.turnStarts / BALLS)) : CONFIG.kantokuRoundSeconds;
}

/**
 * Turnos que le quedan a la bola que juega (contando el actual). Con `pace` (el modelo de la cancha, `pace.ts`) son los esperados según el tablero; sin él, los estimados con el reloj y un promedio por turno.
 */
export function turnsLeft(m: Match, pace?: Pace): number {
  if (pace) return Math.max(1, Math.round(1 + pace.turns[m.turn]));
  return Math.ceil(m.clock / secondsPerRound(m));
}

export function phaseOf(m: Match, pace?: Pace): Phase {
  if (m.ending) return 'final';
  if (!m.firstRoundDone) return 'inicio';
  return turnsLeft(m, pace) <= CONFIG.kantokuFinalTurns ? 'final' : 'medio';
}

/**
 * Orden de los turnos que aún se van a jugar después del actual (índices de bola), estimado con el reloj: cada turno cuesta un décimo de
 * vuelta. Como en el juego, el partido termina siempre tras una bola blanca: si el último turno sería de una roja, juega también la blanca
 * siguiente (si está en juego); con el partido ya en su última bola solo queda esa blanca.
 */
export function upcomingTurns(m: Match, pace?: Pace): number[] {
  if (pace) return pace.seq;
  const alive = (i: number) => m.balls[i].nextGate !== FINISHED;
  const whiteNext = (from: number) => {
    const nb = (from + 1) % BALLS;
    return m.balls[nb].team === 1 && alive(nb) && !m.balls[nb].outBall ? [nb] : [];
  };
  if (m.ending) return m.b.team === 1 ? [] : whiteNext(m.turn);
  const slots = CONFIG.kantokuPaceByTurn ? Math.floor(m.clock / secondsPerTurn(m)) : Math.floor((m.clock / secondsPerRound(m)) * BALLS);
  const seq: number[] = [];
  for (let p = 1; seq.length < slots && p <= 3 * BALLS; p++) {
    const i = (m.turn + p) % BALLS;
    if (alive(i)) seq.push(i);
  }
  const last = seq.length ? seq[seq.length - 1] : m.turn;
  if (m.balls[last].team === 0) seq.push(...whiteNext(last));
  return seq;
}
