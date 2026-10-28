// Prueba del optimizador (scripts/cma.ts): encuentra el máximo de una función con ruido y es repetible con la misma semilla.
import { mulberry32, gauss } from '../src/game/rng';
import { SepCma } from '../scripts/cma';

function run(seed: number) {
  const rng = mulberry32(seed);
  const D = 20;
  const target = Array.from({ length: D }, (_, i) => (i % 5) - 2); // máximo en este punto
  const cma = new SepCma(new Array(D).fill(0), 1, 24);
  // aptitud = −distancia al máximo, con ruido
  const dist = (x: number[]) => Math.sqrt(x.reduce((s, v, i) => s + (v - target[i]) ** 2, 0));
  for (let g = 0; g < 150; g++) {
    const xs = cma.ask(rng);
    cma.tell(xs.map((x) => -dist(x) + 0.3 * gauss(rng)));
  }
  return { start: dist(new Array(D).fill(0)), end: dist(cma.state.mean) };
}

const a = run(1), b = run(1);
let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
check(a.end < 0.25 * a.start, `sep-CMA-ES con ruido: distancia al máximo de ${a.start.toFixed(2)} a ${a.end.toFixed(2)}`);
check(a.end === b.end, 'sep-CMA-ES: misma semilla, mismo resultado');
process.exit(fail ? 1 : 0);
