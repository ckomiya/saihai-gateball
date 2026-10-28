import { CONFIG, LAYOUT } from '../config';
import { GATES } from './court';
import type { Rng } from './rng';
import { gauss } from './rng';

/**
 * Certeza de cada jugador (provisional hasta la fase 5): cuánto se desvía su tiro según la distancia. Sin Phaser.
 * Error de un golpe = error base (mira en metros, fuerza relativa y rumbo en unidades de barra) × factor del perfil a esa distancia.
 */

/** Error base del tiro: desviación típica de la mira (m), de la fuerza (relativa) y de la barra de rumbo (0-1). */
export interface ErrorBase { aimErr: number; powerErr: number; accErr: number }

/** Factor de error por distancia: 0,6 = mucho más certero que el promedio a esa distancia; 1,8 = mucho menos. */
export interface Profile { short: number; medium: number; long: number }

export type Band = 'short' | 'medium' | 'long';

export function bandOf(d: number): Band {
  return d <= CONFIG.certaintyBands.shortMax ? 'short' : d <= CONFIG.certaintyBands.mediumMax ? 'medium' : 'long';
}

/** El error `e` multiplicado por `k` (por ejemplo, el multiplicador de error de un nivel). */
export const scaleError = (e: ErrorBase, k: number): ErrorBase => ({ aimErr: e.aimErr * k, powerErr: e.powerErr * k, accErr: e.accErr * k });

/**
 * Factor del error de rumbo según la distancia del tiro (2026-10-26, Chris: un buen jugador pasa la puerta 1 desde la salida 9 de cada 10 veces; el error de rumbo de `humanRivalError` se calibró con touches a 6 m o más
 * y es demasiado grande para un tiro corto y recto). 1 desde `accLongM` (6 m: los touches medios y largos no cambian); baja suavemente hasta `accShortFactor` a `accShortM` (4,5 m: la puerta 1 desde la salida) o menos.
 */
export function accFactor(d: number): number {
  const lo = CONFIG.accShortM, hi = CONFIG.accLongM, min = CONFIG.accShortFactor;
  if (d >= hi) return 1;
  if (d <= lo) return min;
  const t = (d - lo) / (hi - lo);
  return min + (1 - min) * t * t * (3 - 2 * t);
}

/** El error `e`, calculado para un tiro de `from` metros, vuelto a calcular para uno de `to` metros (solo cambia el rumbo, por `accFactor`). */
export const retarget = (e: ErrorBase, from: number, to: number): ErrorBase => ({ ...e, accErr: (e.accErr * accFactor(to)) / accFactor(from) });

/**
 * Distancia que cuenta para el error de un tiro de `origin` a `aim`: el brazo de palanca del desvío. Si el tiro pasa por su siguiente puerta (la bola va a pasarla y seguir), el desvío que importa es el de la puerta:
 * la distancia a ella; si no, el recorrido hasta la mira.
 */
export function shotDistance(origin: { x: number; y: number }, aim: { x: number; y: number }, nextGate: number): number {
  const L = Math.hypot(aim.x - origin.x, aim.y - origin.y);
  if (nextGate < 1 || nextGate > 3 || L < 1e-6) return L;
  const g = GATES[nextGate - 1];
  const ux = (aim.x - origin.x) / L, uy = (aim.y - origin.y) / L;
  const t = (g.x - origin.x) * ux + (g.y - origin.y) * uy;
  if (t <= 0 || t >= L + 0.5) return L;
  const off = Math.abs((g.x - origin.x) * uy - (g.y - origin.y) * ux);
  return off < 0.35 ? Math.hypot(g.x - origin.x, g.y - origin.y) : L;
}

/** Error del tiro de un jugador con `profile` a `d` metros. */
export function errorsAt(base: ErrorBase, profile: Profile, d: number): ErrorBase {
  const f = profile[bandOf(d)];
  return { aimErr: base.aimErr * f, powerErr: base.powerErr * f, accErr: base.accErr * f * accFactor(d) };
}

/** Perfil sorteado: factores alrededor de 1 (logarítmicos), independientes por tramo; salen especialistas y irregulares. */
export function randomProfile(rng: Rng): Profile {
  const f = () => Math.min(2.5, Math.max(0.4, Math.exp(0.4 * gauss(rng))));
  return { short: f(), medium: f(), long: f() };
}

/** Desviación aleatoria de un golpe: mira (x, y en m), fuerza (relativa) y rumbo (barra). El orden de los sorteos es fijo. */
export function drawShotError(e: ErrorBase, rng: Rng) {
  return { dx: gauss(rng) * e.aimErr, dy: gauss(rng) * e.aimErr, dp: gauss(rng) * e.powerErr, da: gauss(rng) * e.accErr };
}

// ---------- Probabilidades analíticas ----------

const ANGLE_PER_BAR = (2 * CONFIG.accuracyMaxAngleDeg * Math.PI) / 180; // radianes de desvío por unidad de barra de rumbo

/** erf (Abramowitz y Stegun 7.1.26). */
export function erf(x: number) {
  const s = Math.sign(x), a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/**
 * Probabilidad de que el desvío lateral a `d` metros quede dentro de ±`margin` y la fuerza no deje la bola corta por más de `shortfall` metros.
 * `extraSigma` suma un desvío lateral más (el del pasto: `grassSigma`, que a 6 m ya es mayor que el error de mira); sin él (por defecto) es el modelo con el que
 * se entrenó el campeón actual, que subestima la dispersión de los tiros largos.
 */
export function hitProbability(e: ErrorBase, d: number, margin: number, shortfall: number, extraSigma = 0) {
  const sigmaLat = Math.hypot(e.aimErr, d * Math.tan(ANGLE_PER_BAR * e.accErr), extraSigma) || 1e-6;
  const pLat = erf(margin / (sigmaLat * Math.SQRT2));
  const sigmaLen = Math.max(1e-6, d * e.powerErr);
  const pLen = normCdf(shortfall / sigmaLen);
  return pLat * pLen;
}

const GATE_HALF_OPENING = (CONFIG.gateWidthM - 2 * CONFIG.gatePostRadiusM - 2 * CONFIG.ballRadiusM) / 2; // ±7 cm: lo que se puede desviar el centro sin tocar un poste
/**
 * Margen efectivo del centro con el modelo del pasto: ±11 cm, calibrado con la física (600 tiros por caso: 93 / 83 / 61 % a 4,5 / 6 / 9 m). Es mayor que
 * los ±7 cm geométricos porque la puerta puntúa si el centro cruza entre los postes (±20 cm) y un roce con el poste desvía la bola sin impedir que pase.
 */
const GATE_EFFECTIVE_HALF_OPENING = 0.11;
const POLE_MARGIN = CONFIG.ballRadiusM + CONFIG.poleRadiusM + CONFIG.poleTouchMarginM; // ±18 cm
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;

/**
 * Probabilidad de que una bola en `pos` pase su siguiente puerta (o llegue al poste) de un golpe, con el error `e`.
 * Una puerta se pasa mejor de frente (el margen se proyecta con el ángulo de llegada) y desde el lado correcto.
 */
export function scoreProbability(pos: { x: number; y: number }, nextGate: number, e: ErrorBase, grass = false) {
  if (nextGate >= 5) return 0;
  if (nextGate === 4) {
    const d = Math.max(0.3, Math.hypot(pos.x - LAYOUT.pole.x, pos.y - LAYOUT.pole.y));
    return clampP(hitProbability(e, d, POLE_MARGIN, POLE_MARGIN, grass ? grassSigma(d) : 0));
  }
  const g = GATES[nextGate - 1];
  const [dx, dy] = DIRS[g.dir];
  const rx = g.x - pos.x, ry = g.y - pos.y; // de la bola a la puerta
  const d = Math.max(0.3, Math.hypot(rx, ry));
  const cos = (rx * dx + ry * dy) / d; // 1 = de frente, ≤ 0 = del lado equivocado o de costado
  const margin = (grass ? GATE_EFFECTIVE_HALF_OPENING : GATE_HALF_OPENING) * Math.max(0.03, cos);
  return clampP(hitProbability(e, d, margin, 0.9 * d / (d + 1), grass ? grassCrossSigma(d) : 0));
}

/**
 * Desvío lateral (desviación típica, m) de un tiro recto y exacto tras `t` metros por las irregularidades del pasto (`grassBumpiness`).
 * Medido con la física real (600 tiros por distancia, `grassBumpiness` 0,04): 1 m → 0,9 cm, 4 m → 5 cm, 8 m → 12 cm, 14 m → 23 cm.
 * Si cambian la fricción o `grassBumpiness`, hay que volver a medirlo.
 */
const GRASS_SIGMA: [number, number][] = [[0, 0], [1, 0.009], [2, 0.022], [3, 0.036], [4, 0.052], [6, 0.087], [8, 0.123], [10, 0.157], [14, 0.227]];
const GRASS_CROSS: [number, number][] = [[0, 0], [1, 0.007], [2, 0.02], [3, 0.033], [4, 0.047], [6, 0.081], [8, 0.112], [10, 0.143], [14, 0.227]];
/** Lo mismo medido al cruzar una puerta (tiro de t + 1 m, que apunta 1 m más allá): la bola aún va rápida y se ha desviado un poco menos. */
export function grassCrossSigma(t: number) {
  if (t >= 14) return 0.227 * (t / 14);
  for (let i = 1; i < GRASS_CROSS.length; i++) {
    const [x1, y1] = GRASS_CROSS[i];
    if (t <= x1) { const [x0, y0] = GRASS_CROSS[i - 1]; return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0); }
  }
  return 0;
}

export function grassSigma(t: number) {
  if (t >= 14) return 0.227 * (t / 14);
  for (let i = 1; i < GRASS_SIGMA.length; i++) {
    const [x1, y1] = GRASS_SIGMA[i];
    if (t <= x1) { const [x0, y0] = GRASS_SIGMA[i - 1]; return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0); }
  }
  return 0;
}

/**
 * Cuánto sobra (m) entre el recorrido de un tiro y una bola, descontando el margen de error: negativo = el error del tiro puede tocarla
 * (con probabilidad ≈ 97 % de que el desvío quede dentro de `k` desviaciones típicas). El recorrido va de `from` a `to` con la fuerza justa, pero
 * un error de fuerza lo alarga; el desvío lateral crece con la distancia recorrida. Una bola detrás del tirador solo molesta si ya lo toca.
 */
export function pathClearance(from: { x: number; y: number }, to: { x: number; y: number }, e: ErrorBase, ball: { x: number; y: number }, k = 2.2) {
  const L = Math.hypot(to.x - from.x, to.y - from.y) || 1e-6;
  const ux = (to.x - from.x) / L, uy = (to.y - from.y) / L;
  const vx = ball.x - from.x, vy = ball.y - from.y;
  const t = vx * ux + vy * uy;
  const base = 2 * CONFIG.ballRadiusM + 0.02;
  if (t <= 0) return Math.hypot(vx, vy) - base;
  const tt = Math.min(t, L * (1 + k * e.powerErr)); // hasta donde puede llegar la bola si se pasa de fuerza
  const perp = Math.hypot(vx - ux * tt, vy - uy * tt);
  const sigma = Math.hypot(tt * Math.hypot(e.aimErr / L, Math.tan(ANGLE_PER_BAR * e.accErr)), grassSigma(tt)); // mira + rumbo (proporcionales a lo recorrido) y pasto
  return perp - (base + k * sigma);
}

/** Probabilidad de pasar una puerta de frente a 6 m con el error `e`: un tiro típico (para estimar los intentos siguientes). */
export function typicalScoreProbability(e: ErrorBase, grass = false) {
  return clampP(hitProbability(e, 6, grass ? GATE_EFFECTIVE_HALF_OPENING : GATE_HALF_OPENING, (0.9 * 6) / 7, grass ? grassCrossSigma(6) : 0));
}

/** Probabilidad de que un tiro desde `from` toque una bola a `d` metros (centro a centro). */
export function touchProbability(e: ErrorBase, d: number, grass = false) {
  return clampP(hitProbability(e, Math.max(0.3, d), 2 * CONFIG.ballRadiusM, 2 * CONFIG.ballRadiusM, grass ? grassSigma(Math.max(0.3, d)) : 0));
}

const clampP = (p: number) => Math.min(0.98, Math.max(0.01, p));
