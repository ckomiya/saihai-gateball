import { CONFIG, LAYOUT } from '../config';
import { ErrorBase, retarget, scoreProbability, touchProbability } from './certainty';
import { distTo, reach } from './cpu';
import { BallState, FINISHED, inPlay } from './match';

/**
 * Qué puede hacer un rival en su turno (iteración C). Reemplaza a la exposición a mano: en vez de «una bola a la vista de un rival en juego a menos de 13 m», mide la
 * probabilidad de la MEJOR opción de cada bola rival que va a jugar (pasar su puerta o tocar una bola mía), con su certeza y el desvío del pasto. Cubre dos casos que
 * la exposición ignoraba: la bola mía que acaba de volver a entrar desde fuera (es una bola mía en juego como cualquier otra) y las bolas rivales que aún están en la
 * salida (pasan la puerta 1 y tocan con su golpe continuo). Sin Phaser.
 */

type P = { x: number; y: number };

/**
 * Metros más allá de la puerta 1 en que puede quedarse un rival que la pasa y sigue con su golpe continuo. Antes llegaban hasta 6 m; pero un tiro fuerte pasa la puerta y sigue rodando hasta 11 m (casi toda la cancha: la
 * puerta 1 está a 11 m de la línea de fondo) y desde allí ataca la zona de la puerta 2 (Chris, 2026-10-26, turno 36: tres blancas juntas frente a la puerta 2 y la roja 7 aún en la salida).
 */
export const EXIT_STOPS = CONFIG.kantokuExitFar ? [1, 3, 6, 9, 11] : [1, 3, 6];

/**
 * Probabilidad de que `rival` toque una bola en `target` en su turno. Un rival en juego: línea limpia (sin postes de por medio) y su certeza a esa distancia.
 * Un rival que aún no pasó la puerta 1: la pasa y desde donde se quede (el punto más favorable de `EXIT_STOPS`) toca con su golpe continuo.
 */
export function touchThreat(rival: BallState, target: P, err: ErrorBase, exitChain = true): number {
  if (rival.nextGate === 1) {
    const g1 = LAYOUT.gates[0];
    const dT = Math.max(0.3, Math.hypot(target.x - rival.x, target.y - rival.y)); // `err` viene calculado para este tiro; cada tramo tiene su distancia
    let best = 0;
    for (const s of EXIT_STOPS) {
      const d = Math.hypot(target.x - g1.x, target.y - (g1.y - s));
      best = Math.max(best, touchProbability(retarget(err, dT, d), d, true));
    }
    // «Nunca se deja una bola en la salida de la puerta 1 contando con que el rival falle»: cualquiera puede pasarla si se concentra. Probabilidad de pasar pesimista (al menos `kantokuStartPassP`).
    const pass = scoreProbability(rival, 1, retarget(err, dT, Math.hypot(rival.x - g1.x, rival.y - g1.y)), true);
    return Math.max(pass, CONFIG.kantokuStartPassP) * best;
  }
  if (!inPlay(rival)) return 0;
  const direct = reach(rival, target) ? touchProbability(err, distTo(rival, target), true) : 0;
  return exitChain ? Math.max(direct, exitChainThreat(rival, target, err)) : direct;
}

/**
 * Pasar su puerta y quedar cerca (puertas 1 a 3, con la bola ya en juego): P(el rival pasa su siguiente puerta) × P(touch con el golpe continuo desde donde se queda). La bola sigue la
 * línea de su tiro por la puerta y se queda a 1, 3 o 6 m más allá (`EXIT_STOPS`); vale el punto de parada más favorable. Es la jugada de una persona: pasa su puerta, rueda hasta quedar cerca de
 * la mía y la saca.
 */
export function exitChainThreat(rival: BallState, target: P, err: ErrorBase): number {
  if (!inPlay(rival) || rival.nextGate > 3) return 0;
  const g = LAYOUT.gates[rival.nextGate - 1];
  const dx = g.x - rival.x, dy = g.y - rival.y, L = Math.hypot(dx, dy);
  if (L < 0.3) return 0;
  const ux = dx / L, uy = dy / L;
  let pPass = scoreProbability(rival, rival.nextGate, err, true);
  // Puertas 2 y 3: una rival bien colocada (el modelo ≥ `kantokuPlacedPassMin`) se supone que la pasa con al menos `kantokuPlacedPassP` (0 = el modelo). Ver BACKLOG.
  if (CONFIG.kantokuPlacedPassP > 0 && pPass >= CONFIG.kantokuPlacedPassMin) pPass = Math.max(pPass, CONFIG.kantokuPlacedPassP);
  if (pPass < 0.02) return 0;
  let best = 0;
  for (const s of EXIT_STOPS) {
    const stop = { x: g.x + ux * s, y: g.y + uy * s };
    const d = distTo(stop, target);
    if (d > 12 || !reach(stop, target)) continue;
    best = Math.max(best, touchProbability(err, d, true));
  }
  return pPass * best;
}

/** Probabilidad de que `rival` pase su siguiente puerta (o llegue al poste) de un tiro. 0 si está fuera (primero tiene que volver a entrar) o ya llegó. */
export function passThreat(rival: BallState, err: ErrorBase): number {
  if (rival.outBall || rival.nextGate >= FINISHED) return 0;
  return scoreProbability(rival, rival.nextGate, err, true);
}

/** La mejor opción de `rival`: pasar su puerta o tocar la bola mía que más valga (`1 + riskPerPoint × sus puntos`). */
export function bestOption(rival: BallState, mine: BallState[], err: ErrorBase, riskPerPoint: number): number {
  let best = passThreat(rival, err);
  for (const b of mine) best = Math.max(best, (1 + riskPerPoint * b.points) * touchThreat(rival, b, err));
  return best;
}

// ---------- Tsunagi (puentes): cadenas de touches ----------

/** Resultado de la mejor cadena: probabilidad y camino (índices de bola: tirador, puentes y blanco, o con `gate` = «pasa su puerta» al final). */
export interface BestChain { p: number; path: number[]; gate: boolean }

/**
 * Tsunagi (つなぎ, «puente»): una bola que está lejos de su blanco se acerca encadenando touches a otras bolas cercanas (suyas o de cualquier equipo): toca una bola, gana el spark y un golpe extra
 * desde donde quedó (junto a la bola tocada), y desde ahí toca la siguiente, pasa su puerta o toca el blanco. Modela cadenas de 2 y 3 pasos (un puente o dos), con la probabilidad de cada toque según la certeza
 * del tirador a esa distancia (`errOf`) y `K` = probabilidad de que el touch y el spark den el golpe extra (`kantokuContinuationAttack`). Una cadena puede terminar pasando la puerta del tirador y tocando
 * el blanco con el golpe continuo (`exitChainThreat` desde donde queda). Las bolas se toman en la posición que tienen (el spark mueve la bola tocada, no la del tirador). Sin Phaser.
 */
// Memorias compartidas entre evaluaciones (el planificador evalúa decenas de tableros casi iguales: solo se mueven la bola que golpea y las tocadas). La geometría (¿hay un poste de por medio?) no cambia
// nunca; la probabilidad de touch depende de la certeza, así que se vacía al empezar cada planificación (`resetChainCache`) y se separa por modelo (`tag`).
const REACH_CACHE = new Map<number, boolean>();
let TOUCH_CACHE = new Map<number, number>();
export const resetChainCache = () => { TOUCH_CACHE = new Map(); if (REACH_CACHE.size > 400000) REACH_CACHE.clear(); };
const q = (v: number) => Math.round(v * 50); // posiciones a 2 cm
const pairKey = (a: BallState, b: BallState) => (((q(a.x) * 1024 + q(a.y)) * 1024 + q(b.x)) * 1024 + q(b.y));

export class ChainModel {
  /** `tag` distingue modelos con distinto error (rival, propio) en la memoria compartida. */
  constructor(private S: BallState[], private errOf: (shooter: number, d: number) => ErrorBase, private K: number, private exitChain = true, private tag = 0) {}

  private reachable(a: number, b: number) {
    const key = pairKey(this.S[a], this.S[b]);
    let v = REACH_CACHE.get(key);
    if (v === undefined) { v = reach(this.S[a], this.S[b]); REACH_CACHE.set(key, v); }
    return v;
  }

  /** Probabilidad de que `shooter`, parado donde está la bola `a`, toque la bola `b`. */
  touch(shooter: number, a: number, b: number): number {
    if (a === b) return 0;
    const d = distTo(this.S[a], this.S[b]);
    if (d < 0.25) return 0;
    const key = ((this.tag * 16 + shooter) * 4096 + Math.round(d * 40)) * 2 + 1; // por tirador y distancia (2,5 cm); la geometría se comprueba aparte
    let p = TOUCH_CACHE.get(key);
    if (p === undefined) { p = touchProbability(this.errOf(shooter, d), d, true); TOUCH_CACHE.set(key, p); }
    return p > 0 && this.reachable(a, b) ? p : 0;
  }

  private inGame(i: number) { return inPlay(this.S[i]); }
  private nbrMemo = new Map<number, number[]>();
  /** Las demás bolas en juego, de la más cercana a la más lejana (se calcula una vez por tablero). */
  private nbrs(i: number): number[] {
    let v = this.nbrMemo.get(i);
    if (!v) {
      v = this.S.map((_, j) => j).filter((j) => j !== i && this.inGame(j)).sort((a, b) => distTo(this.S[i], this.S[a]) - distTo(this.S[i], this.S[b]));
      this.nbrMemo.set(i, v);
    }
    return v;
  }

  /** La mejor cadena de `depth` pasos (2 o 3) del tirador `r` (en juego) para tocar `target`. */
  best(r: number, target: number, depth = 3): BestChain {
    const S = this.S, K = this.K;
    let best: BestChain = { p: 0, path: [], gate: false };
    if (!this.inGame(r)) return best;
    // Solo los puentes más cercanos (un puente lejano no encadena): 5 al tirador y, tras el primero, 4 a él (acota el costo de cada evaluación)
    const mids = this.nbrs(r).filter((i) => i !== target).slice(0, 5);
    const consider = (p: number, path: number[], gate = false) => { if (p > best.p) best = { p, path, gate }; };
    for (const q of mids) {
      const p1 = this.touch(r, r, q) * K; // toca el puente q y gana el golpe extra desde su posición
      if (p1 < 0.02) continue;
      consider(p1 * this.touch(r, q, target), [r, q, target]);
      if (this.exitChain && S[r].nextGate <= 3 && p1 >= 0.15) {
        // ... o pasa su puerta desde ahí y toca el blanco con el golpe continuo
        const at = { ...S[r], x: S[q].x, y: S[q].y };
        const d = distTo(at, GATE_POINT(S[r].nextGate));
        consider(p1 * exitChainThreat(at, S[target], this.errOf(r, d)), [r, q, target], true);
      }
      if (depth >= 3) {
        for (const q2 of this.nbrs(q).filter((i) => i !== r && i !== target).slice(0, 4)) {
          const p2 = p1 * this.touch(r, q, q2) * K;
          if (p2 < 0.02) continue;
          consider(p2 * this.touch(r, q2, target), [r, q, q2, target]);
        }
      }
    }
    return best;
  }

  /** Probabilidad de la mejor cadena (sin el camino). */
  chain(r: number, target: number, depth = 3): number { return this.best(r, target, depth).p; }

  /** Una bola mía `i` que se acerca a su puerta con un puente: toca una bola cercana y desde ahí pasa su puerta (2 pasos). */
  bridgePass(i: number): number {
    const b = this.S[i];
    if (!this.inGame(i) || b.nextGate > 3) return 0;
    let best = 0;
    const gate = GATE_POINT(b.nextGate);
    for (let q = 0; q < this.S.length; q++) {
      if (q === i || !this.inGame(q)) continue;
      const p1 = this.touch(i, i, q) * this.K;
      if (p1 < 0.05) continue;
      const at = { ...b, x: this.S[q].x, y: this.S[q].y };
      const d = distTo(at, gate);
      best = Math.max(best, p1 * scoreProbability(at, b.nextGate, this.errOf(i, d), true));
    }
    return best;
  }
}

const GATE_POINT = (step: number) => ({ x: LAYOUT.gates[step - 1].x, y: LAYOUT.gates[step - 1].y });
