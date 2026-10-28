/**
 * Azar con semilla inyectable. Todo el azar de la física, el partido y la CPU recibe un `Rng`
 * (función que devuelve un número en [0, 1)): en el navegador es `Math.random`; en las pruebas y en
 * `scripts/selfplay.ts`, un generador con semilla para repetir partidos idénticos.
 */
export type Rng = () => number;

/** Generador mulberry32: rápido, de 32 bits y repetible con la misma semilla. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `Math.random` enlazado al momento de usarlo (así se puede reemplazar en pruebas del navegador). */
export const browserRng: Rng = () => Math.random();

/** Número aleatorio con distribución normal (media 0, desviación 1). */
export function gauss(rng: Rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}
