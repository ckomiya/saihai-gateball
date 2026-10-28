import { LAYOUT } from '../config';

/**
 * Libro de aperturas de la primera vuelta (propuesta de Chris, 2026-10-22; los sitios están EN VALIDACIÓN, se dibujan con F2 en el partido). Las aperturas son reglas del kantoku, no algo que se entrene.
 * Los sitios se calculan a partir de las puertas de `LAYOUT` (puerta 2 en (8, 2), de derecha a izquierda; puerta 3 en (10, 13), de izquierda a derecha):
 *  - `red1`: la roja 1 pasa la puerta 1 y se coloca cerca de la puerta 2, pegada a la línea de arriba (0,55 m), con ángulo en diagonal para pasarla. Chris la marcó sobre un esquema de la cancha: sobre la línea, de la vertical de la puerta 2 (x ≈ 7,7) hasta x ≈ 10,6.
 *  - `whiteLine`: la blanca (no necesariamente la 2) se coloca también pegada a la línea de arriba, más a la derecha (marca de Chris: x ≈ 15 a 17,3): ahí cerca de la línea no es sencillo que la roja 1 ni otra roja que pase la puerta 1 le haga touch.
 *  - `gate3`: frente a la puerta 3, para que la roja 1, al pasar la puerta 2, no vaya hacia allá.
 * `r` es el radio de tolerancia del sitio (la bola «está» en el sitio si termina a menos de `r` m).
 */
export interface OpeningSite { x: number; y: number; r: number; label: string; note: string }

const g2 = LAYOUT.gates[1], g3 = LAYOUT.gates[2];

export const OPENING_SITES: Record<'red1' | 'whiteLine' | 'gate3', OpeningSite> = {
  red1: { x: g2.x + 1.2, y: 0.55, r: 0.9, label: 'R', note: 'roja 1: pegada a la línea, en diagonal a la puerta 2' },
  whiteLine: { x: g2.x + 8.2, y: 0.55, r: 0.9, label: 'B', note: 'blanca: pegada a la línea, a la derecha de la roja 1' },
  gate3: { x: g3.x - 2.5, y: g3.y - 0.2, r: 0.7, label: '3', note: 'frente a la puerta 3, en diagonal' },
};
