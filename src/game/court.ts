import { CONFIG, LAYOUT } from '../config';
import type { Post } from './physics';

const { widthM, heightM } = CONFIG.court;

export interface Gate {
  n: number;
  x: number;
  y: number;
  orient: 'h' | 'v';
  /** Dirección en que se cruza. */
  dir: 'up' | 'down' | 'left' | 'right';
  /** Extremos (postes) de la puerta. */
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export const GATES: Gate[] = LAYOUT.gates.map((g) => {
  const half = CONFIG.gateWidthM / 2;
  return g.orient === 'h'
    ? { ...g, a: { x: g.x - half, y: g.y }, b: { x: g.x + half, y: g.y } }
    : { ...g, a: { x: g.x, y: g.y - half }, b: { x: g.x, y: g.y + half } };
});

/** Todos los obstáculos redondos: postes de puertas y poste de meta. */
export const POSTS: Post[] = [
  ...GATES.flatMap((g) => [
    { ...g.a, r: CONFIG.gatePostRadiusM },
    { ...g.b, r: CONFIG.gatePostRadiusM },
  ]),
  { ...LAYOUT.pole, r: CONFIG.poleRadiusM },
];

/**
 * ¿La bola cruzó la puerta entre prev y cur, entre sus postes y en la dirección correcta (g.dir)?
 * Reglamento (Art. 13): debe cruzar COMPLETAMENTE la línea de la puerta, así que se mide
 * con el borde de la bola, no con su centro.
 */
export function crossedGate(g: Gate, prev: { x: number; y: number }, cur: { x: number; y: number }) {
  const r = CONFIG.ballRadiusM;
  if (g.orient === 'h') {
    const L = g.dir === 'up' ? g.y - r : g.y + r;
    const ok = g.dir === 'up' ? prev.y > L && cur.y <= L : prev.y < L && cur.y >= L;
    if (!ok) return false;
    const t = (prev.y - L) / (prev.y - cur.y);
    const xAt = prev.x + (cur.x - prev.x) * t;
    return xAt > g.a.x && xAt < g.b.x;
  }
  const L = g.dir === 'left' ? g.x - r : g.x + r;
  const ok = g.dir === 'left' ? prev.x > L && cur.x <= L : prev.x < L && cur.x >= L;
  if (!ok) return false;
  const t = (prev.x - L) / (prev.x - cur.x);
  const yAt = prev.y + (cur.y - prev.y) * t;
  return yAt > g.a.y && yAt < g.b.y;
}

/** ¿La bola salió por completo de la cancha interior (la línea interior pertenece a la cancha)? */
export function leftInnerField(b: { x: number; y: number }) {
  const r = CONFIG.ballRadiusM;
  return b.x < -r || b.x > widthM + r || b.y < -r || b.y > heightM + r;
}

/**
 * Dónde queda una bola fuera: sobre la perpendicular al punto donde cruzó la línea interior,
 * con su borde a `outBallOffsetM` de la línea (reglamento Art. 17 cl. 2).
 */
export function outBallSpot(prev: { x: number; y: number }, cur: { x: number; y: number }) {
  const off = CONFIG.outBallOffsetM + CONFIG.ballRadiusM;
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  // Lado cruzado: el de mayor exceso respecto a la línea.
  const over = [
    { side: 'L', v: -cur.x }, { side: 'R', v: cur.x - widthM },
    { side: 'T', v: -cur.y }, { side: 'B', v: cur.y - heightM },
  ].sort((a, b) => b.v - a.v)[0].side;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  if (over === 'L' || over === 'R') {
    const line = over === 'L' ? 0 : widthM;
    const t = dx === 0 ? 0 : (line - prev.x) / dx;
    return { x: over === 'L' ? -off : widthM + off, y: clamp(prev.y + dy * t, heightM) };
  }
  const line = over === 'T' ? 0 : heightM;
  const t = dy === 0 ? 0 : (line - prev.y) / dy;
  return { x: clamp(prev.x + dx * t, widthM), y: over === 'T' ? -off : heightM + off };
}

/** Punto de bola fuera más cercano a una posición dentro de la cancha (para faltas, Art. 17 cl. 2.2). */
export function nearestOutSpot(p: { x: number; y: number }) {
  const off = CONFIG.outBallOffsetM + CONFIG.ballRadiusM;
  const x = Math.min(widthM, Math.max(0, p.x));
  const y = Math.min(heightM, Math.max(0, p.y));
  const d = [x, widthM - x, y, heightM - y];
  const k = d.indexOf(Math.min(...d));
  if (k === 0) return { x: -off, y };
  if (k === 1) return { x: widthM + off, y };
  if (k === 2) return { x, y: -off };
  return { x, y: heightM + off };
}

/** ¿La bola está tocando el poste de meta? */
export function touchingPole(b: { x: number; y: number }) {
  return Math.hypot(b.x - LAYOUT.pole.x, b.y - LAYOUT.pole.y) <= CONFIG.ballRadiusM + CONFIG.poleRadiusM + CONFIG.poleTouchMarginM;
}

export { widthM as COURT_W, heightM as COURT_H };

/**
 * Limita la mira: si la línea desde la bola hasta la mira choca con un poste (de una puerta o el de meta),
 * la mira se queda en el borde del primer poste y no lo traspasa. Las bolas no la detienen (decisión de Chris).
 */
export function clampAimToPosts(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return to;
  let tMin = 1;
  for (const p of POSTS) {
    const fx = from.x - p.x, fy = from.y - p.y;
    const c = fx * fx + fy * fy - p.r * p.r;
    if (c <= 0) continue; // la bola ya toca este poste: no lo cuenta
    const b = fx * dx + fy * dy;
    const disc = b * b - a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / a; // primer cruce con el borde del poste
    if (t >= 0 && t < tMin) tMin = t;
  }
  return { x: from.x + dx * tMin, y: from.y + dy * tMin };
}

/** Distancia de un punto a un segmento. */
function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * ¿La bola `o` le estorba a la bola `s` para pasar la puerta 1? Sí si está en el ángulo de tiro (el triángulo entre `s` y los dos
 * postes de la puerta) o a menos de tres radios de bola de él: así entran las bolas pegadas a la puerta, antes o justo después
 * de la línea. Esas bolas no chocan con `s` (Art. 12 cl. 2 (2): el árbitro aparta la bola que obstruye).
 */
export function obstructsGateOne(s: { x: number; y: number }, o: { x: number; y: number }) {
  const { a, b } = GATES[0];
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }) => (q.x - p.x) * (o.y - p.y) - (q.y - p.y) * (o.x - p.x);
  const c1 = cross(s, a), c2 = cross(a, b), c3 = cross(b, s);
  const inside = (c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0);
  if (inside) return true;
  const margin = 3 * CONFIG.ballRadiusM;
  return Math.min(distToSegment(o, s, a), distToSegment(o, a, b), distToSegment(o, b, s)) <= margin;
}
