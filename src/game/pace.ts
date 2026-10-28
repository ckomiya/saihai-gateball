import { CONFIG } from '../config';
import { ErrorBase, Profile, errorsAt, scoreProbability, touchProbability } from './certainty';
import { distTo, goalOf, reach } from './cpu';
import { BALLS, BallState, FINISHED, Match, inPlay } from './match';

/**
 * Ritmo del partido según la cancha (Chris, 2026-10-27). Una vuelta puede durar de minuto y medio a seis, según cuántos golpes extra encadenen las bolas que juegan antes (puertas, touches y sparks) y
 * si fallan o no: un promedio fijo de reloj por vuelta no sirve. Aquí cada turno cuesta lo que se espera de la bola que lo juega en el tablero actual:
 *   golpes del turno = 1 + c / (1 − κ·c) + sparkW·pTouch      con  c = 1 − (1 − pPuerta)(1 − touchW·pTouch)
 *   (pPuerta = probabilidad de pasar su meta de un tiro; pTouch = la del mejor touch a una bola en juego; cada golpe extra repite la misma probabilidad, amortiguada por κ).
 * Cada golpe gasta `s1` segundos de reloj (los observados en el partido, con un valor previo). Con la media y la varianza de cada turno se acumula el reloj que consumen las bolas que juegan antes y
 * se obtiene la probabilidad de que a cada bola le vuelva a tocar antes de que termine el tiempo (aproximación normal). Sin Phaser.
 */

export interface PaceCtx {
  team: 0 | 1; // equipo de la CPU: sus bolas usan `base` y `profiles`; las demás, `rivalBase` y `rivalProfiles`
  base: ErrorBase;
  rivalBase: ErrorBase;
  profiles: Profile[];
  rivalProfiles?: Profile[];
}

export interface Pace {
  seq: number[]; // bolas que aún juegan, en orden (como `phase.upcomingTurns`)
  turns: number[]; // por bola: turnos esperados DESPUÉS del actual (suma de probabilidades)
  pAgain: number[]; // por bola: probabilidad de que vuelva a jugar tras su turno actual
  seconds: number; // segundos de reloj por golpe que se usaron
}

const TOTAL_SECONDS = CONFIG.matchMinutes * 60;
const NEUTRAL: Profile = { short: 1, medium: 1, long: 1 };

/** Φ(z): función de distribución normal (aproximación de Abramowitz-Stegun). */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Segundos de reloj por golpe: los observados en el partido (con un valor previo de peso `kantokuPaceN0` golpes). */
export function secondsPerStroke(m: Match): number {
  const used = TOTAL_SECONDS - m.clock;
  const prior = CONFIG.kantokuPaceStrokeSeconds;
  // acotado a 0,6-1,6 veces el valor previo: un tablero armado a mano (reloj y golpes que no cuadran) no debe dar un ritmo absurdo
  return Math.min(1.6 * prior, Math.max(0.6 * prior, (prior * CONFIG.kantokuPaceN0 + used) / (CONFIG.kantokuPaceN0 + m.shots)));
}

/** Golpes que se esperan (media y varianza) en el turno de la bola `i` con el tablero `S`. */
export function turnStrokes(S: BallState[], i: number, c: PaceCtx): { mean: number; variance: number } {
  const b = S[i];
  const mine = b.team === c.team;
  const base = mine ? c.base : c.rivalBase;
  const prof = (mine ? c.profiles[i] : c.rivalProfiles?.[i]) ?? NEUTRAL;
  // pasar su meta de un tiro (una bola fuera primero tiene que volver a entrar)
  let pg = 0;
  if (!b.outBall) {
    const g = Math.min(b.nextGate, 4);
    pg = scoreProbability(b, g, errorsAt(base, prof, distTo(b, goalOf(g))), true);
  }
  // el mejor touch a una bola en juego (propia o rival: cualquier touch da el spark y el golpe extra)
  let pt = 0;
  for (let j = 0; j < S.length; j++) {
    if (j === i || !inPlay(S[j])) continue;
    const d = distTo(b, S[j]);
    if (d < 0.3 || d > CONFIG.kantokuPaceTouchMaxM || !reach(b, S[j])) continue;
    pt = Math.max(pt, touchProbability(errorsAt(base, prof, d), d, true));
  }
  const cont = Math.min(0.97, 1 - (1 - pg) * (1 - CONFIG.kantokuPaceTouchW * pt));
  const r = Math.min(0.95, CONFIG.kantokuPaceKappa * cont);
  const meanG = 1 / (1 - r), varG = r / ((1 - r) * (1 - r));
  const mean = 1 + cont * meanG + CONFIG.kantokuPaceSparkW * pt;
  // varianza de los golpes extra: Bernoulli(cont) × geométrica
  const varN = cont * (varG + meanG * meanG) - cont * cont * meanG * meanG;
  return { mean, variance: Math.max(0.05, varN) };
}

/**
 * Ritmo del partido: orden de los turnos que aún se juegan, turnos esperados por bola (después del actual) y probabilidad de que cada una vuelva a jugar.
 * Igual que `phase.upcomingTurns`, el partido termina siempre tras una bola blanca.
 */
export function paceOf(m: Match, c: PaceCtx): Pace {
  const alive = (i: number) => m.balls[i].nextGate !== FINISHED;
  const s1 = secondsPerStroke(m);
  const cv2 = CONFIG.kantokuPaceStrokeCv * CONFIG.kantokuPaceStrokeCv;
  const stats = m.balls.map((_, i) => (alive(i) ? turnStrokes(m.balls, i, c) : { mean: 1, variance: 0 }));
  const secs = (i: number) => stats[i].mean * s1;
  const vars = (i: number) => s1 * s1 * (stats[i].variance + stats[i].mean * cv2);
  const turns = new Array<number>(BALLS).fill(0), pAgain = new Array<number>(BALLS).fill(0);
  const seq: number[] = [];
  const ending = m.ending;
  // lo que queda del turno en curso (el golpe de ahora y sus golpes extra)
  const cur = m.turn;
  let mean = Math.max(1, stats[cur].mean - m.strokesInTurn) * s1, variance = vars(cur) * (m.strokesInTurn ? 0.5 : 1);
  if (!ending) {
    for (let p = 1; p <= 8 * BALLS; p++) {
      const i = (cur + p) % BALLS;
      if (!alive(i)) continue;
      const pr = phi((m.clock - mean) / Math.sqrt(variance + 1)); // probabilidad de que el turno empiece antes de que termine el tiempo
      if (pr < 0.02) break;
      turns[i] += pr;
      if (!pAgain[i]) pAgain[i] = pr;
      if (mean < m.clock) seq.push(i);
      mean += secs(i);
      variance += vars(i);
    }
    // como en el juego, el partido termina tras una bola blanca: si el último turno sería de una roja, juega también la blanca siguiente
    const last = seq.length ? seq[seq.length - 1] : cur;
    const nb = (last + 1) % BALLS;
    if (m.balls[last].team === 0 && m.balls[nb].team === 1 && alive(nb) && !m.balls[nb].outBall) { seq.push(nb); turns[nb] += 1 - 0; if (!pAgain[nb]) pAgain[nb] = 0.5; }
  } else if (m.b.team === 0) {
    const nb = (cur + 1) % BALLS;
    if (m.balls[nb].team === 1 && alive(nb) && !m.balls[nb].outBall) { seq.push(nb); turns[nb] = 1; pAgain[nb] = 1; }
  }
  return { seq, turns, pAgain, seconds: s1 };
}
