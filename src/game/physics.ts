import { CONFIG } from '../config';
import type { Rng } from './rng';

export interface Ball {
  x: number; // metros
  y: number;
  vx: number; // m/s
  vy: number;
}

export interface Post {
  x: number;
  y: number;
  r: number;
}

export function speed(b: Ball) {
  return Math.hypot(b.vx, b.vy);
}

/**
 * Avanza todas las bolas dt segundos: fricción del pasto, rebote en postes y choques entre bolas.
 * Se integra en sub-pasos para que ninguna bola atraviese postes u otras bolas a alta velocidad.
 * Devuelve los pares de índices que chocaron en este avance (bola que se acerca a otra).
 * `rng` da el desvío aleatorio del pasto (con semilla en las pruebas).
 */
/** Avisos opcionales de los choques (para el sonido): entre bolas (i, j, velocidad de acercamiento) y con un poste (bola, poste, velocidad de impacto). No cambian la física. */
export interface PhysicsFx {
  onBall?: (i: number, j: number, v: number) => void;
  onPost?: (ball: number, post: number, v: number) => void;
}

export function stepAll(balls: Ball[], dt: number, posts: Post[], rng: Rng, fx?: PhysicsFx): [number, number][] {
  let vmax = 0;
  for (const b of balls) vmax = Math.max(vmax, speed(b));
  const steps = Math.max(1, Math.ceil((vmax * dt) / 0.03));
  const h = dt / steps;
  const hits: [number, number][] = [];
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (speed(b) === 0) continue;
      moveBall(b, h, rng);
      for (let k = 0; k < posts.length; k++) {
        const v = collidePost(b, posts[k]);
        if (v > 0) fx?.onPost?.(i, k, v);
      }
    }
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const v = collideBalls(balls[i], balls[j]);
        if (v > 0) { hits.push([i, j]); fx?.onBall?.(i, j, v); }
      }
    }
  }
  return hits;
}

/** Avanza una sola bola (sin choques entre bolas). */
export function step(b: Ball, dt: number, posts: Post[], rng: Rng) {
  stepAll([b], dt, posts, rng);
}

function moveBall(b: Ball, h: number, rng: Rng) {
  const v = speed(b);
  // Freno del pasto: roce fijo + arrastre según velocidad; al final la bola se clava.
  let decel = CONFIG.grassFriction + CONFIG.grassDrag * v;
  if (v < CONFIG.slowZoneSpeed) decel *= CONFIG.slowZoneFriction;
  const nv = Math.max(0, v - decel * h);
  if (nv < CONFIG.stopSpeed) {
    b.vx = 0;
    b.vy = 0;
    return;
  }
  // Irregularidades del pasto: pequeño giro aleatorio de la dirección.
  const turn = (rng() - 0.5) * 2 * CONFIG.grassBumpiness * Math.sqrt(h);
  const cos = Math.cos(turn), sin = Math.sin(turn);
  const rx = b.vx * cos - b.vy * sin;
  const ry = b.vx * sin + b.vy * cos;
  b.vx = rx * (nv / v);
  b.vy = ry * (nv / v);
  b.x += b.vx * h;
  b.y += b.vy * h;
}

/** Choque entre dos bolas iguales: las separa y reparte la velocidad según la normal. Devuelve la velocidad de acercamiento (> 0) si venían acercándose, y 0 si no. */
function collideBalls(a: Ball, b: Ball): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = 2 * CONFIG.ballRadiusM;
  const d = Math.hypot(dx, dy);
  if (d >= minD || d === 0) return 0;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = minD - d;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // > 0: se acercan
  if (vn <= 0) return 0;
  const j = ((1 + CONFIG.ballBounce) * vn) / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  return vn;
}

/** Rebote con un poste. Devuelve la velocidad de impacto (> 0) si venía acercándose, y 0 si no. */
function collidePost(b: Ball, p: Post): number {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const minD = CONFIG.ballRadiusM + p.r;
  const d = Math.hypot(dx, dy);
  if (d >= minD || d === 0) return 0;
  const nx = dx / d;
  const ny = dy / d;
  // Sacar la bola del poste.
  b.x = p.x + nx * minD;
  b.y = p.y + ny * minD;
  // Reflejar la componente normal de la velocidad.
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + CONFIG.bounce) * vn * nx;
    b.vy -= (1 + CONFIG.bounce) * vn * ny;
    return -vn;
  }
  return 0;
}

/** Distancia aproximada que recorrería una bola lanzada a v m/s (útil para la IA y ayudas). */
export function travelDistance(v: number) {
  const c = CONFIG.grassFriction, k = CONFIG.grassDrag;
  return v / k - (c / (k * k)) * Math.log(1 + (k * v) / c);
}

/** Distancia exacta que recorre una bola lanzada a v0 m/s con la misma fricción de `step` (sin desvíos aleatorios). */
export function rollDistance(v0: number) {
  const h = 0.005;
  let v = v0, d = 0;
  while (v > 0) {
    let decel = CONFIG.grassFriction + CONFIG.grassDrag * v;
    if (v < CONFIG.slowZoneSpeed) decel *= CONFIG.slowZoneFriction;
    const nv = v - decel * h;
    if (nv < CONFIG.stopSpeed) break;
    d += ((v + nv) / 2) * h;
    v = nv;
  }
  return d;
}

/** Velocidad de golpe para que la bola recorra `dist` metros (limitada entre el tiro mínimo y el máximo). */
export function speedForDistance(dist: number) {
  let lo = CONFIG.minShotSpeed, hi = CONFIG.maxShotSpeed;
  if (dist <= rollDistance(lo)) return lo;
  if (dist >= rollDistance(hi)) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
