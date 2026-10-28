import table from './attackTable.json';

/**
 * Qué pasa cuando un rival intenta el touch a una bola mía (iteración D): frecuencias de los resultados del intento completo, simuladas con la física real
 * (`npm run lineplay -- --write` genera `attackTable.json`). Dependen de la distancia de mi bola a la línea más cercana (`dl`), del ángulo del tiro respecto a esa línea
 * (`phi`: 0° = de frente a ella) y de la distancia del tiro (`D`). Por cada celda, seis números:
 *   [d, c, b, b2, exp, a]  con  d + c + b + b2 = 1  (condicionados a que el rival acierta: contacto con mi bola)
 *   d = touch válido y todo queda dentro (touch y spark) · c = sale mi bola por el impacto y la suya no (sin touch ni spark) · b = salen las dos · b2 = sale solo la suya
 *   exp = probabilidad de que el spark saque mi bola, dado d · a = (condicionado a que falla) su bola sale de la cancha.
 * Art. 15 cl. 1: el derecho a spark solo se gana si la bola que golpea y la tocada quedan en juego.
 * Hay una tabla para un rival humano (con su error y algo de fuerza de más: promedio de +10 % y +20 %) y otra para la CPU (su error, sin fuerza de más).
 */
export const ATTACK_GRID = {
  phi: [0, 30, 60, 90],
  D: [3, 5, 8, 12, 16],
  dl: [0.15, 0.3, 0.5, 0.8, 1.2, 2, 3.5, 6],
};

export interface AttackOutcome { d: number; c: number; b: number; b2: number; exp: number; a: number }

type Cells = number[][][][]; // [phi][D][dl] → [d, c, b, b2, exp, a]
const tables = table as unknown as { human?: Cells; cpu?: Cells };

const lerpIndex = (grid: number[], v: number): [number, number, number] => {
  if (v <= grid[0]) return [0, 0, 0];
  const last = grid.length - 1;
  if (v >= grid[last]) return [last, last, 0];
  let i = 0;
  while (v > grid[i + 1]) i++;
  return [i, i + 1, (v - grid[i]) / (grid[i + 1] - grid[i])];
};

/** Resultados de un intento de touch (interpolación trilineal de la tabla); null si no hay tabla. */
export function attackOutcome(who: 'human' | 'cpu', dl: number, phiDeg: number, D: number): AttackOutcome | null {
  const cells = tables[who];
  if (!cells) return null;
  const [p0, p1, tp] = lerpIndex(ATTACK_GRID.phi, Math.min(90, phiDeg));
  const [d0, d1, td] = lerpIndex(ATTACK_GRID.D, D);
  const [l0, l1, tl] = lerpIndex(ATTACK_GRID.dl, dl);
  const out = [0, 0, 0, 0, 0, 0];
  for (const [ip, wp] of [[p0, 1 - tp], [p1, tp]] as const) {
    for (const [id, wd] of [[d0, 1 - td], [d1, td]] as const) {
      for (const [il, wl] of [[l0, 1 - tl], [l1, tl]] as const) {
        const w = wp * wd * wl;
        if (w === 0) continue;
        const cell = cells[ip][id][il];
        for (let k = 0; k < 6; k++) out[k] += w * cell[k];
      }
    }
  }
  return { d: out[0], c: out[1], b: out[2], b2: out[3], exp: out[4], a: out[5] };
}
