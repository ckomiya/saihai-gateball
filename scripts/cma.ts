// sep-CMA-ES (Ros y Hansen, 2008): estrategia evolutiva con adaptación de covarianza DIAGONAL, sin dependencias.
// Maximiza una aptitud ruidosa en un espacio de D números. Con ≈40 parámetros y solo unos miles de evaluaciones (cada una son partidos),
// la covarianza completa (D² números) no llega a aprenderse; la diagonal aprende una escala por parámetro con tasas lineales en D.
import { Rng, gauss } from '../src/game/rng';

export interface CmaState {
  mean: number[];
  sigma: number;
  C: number[]; // varianzas (diagonal)
  ps: number[];
  pc: number[];
  gen: number;
}

export class SepCma {
  readonly D: number;
  readonly lambda: number;
  readonly mu: number;
  private w: number[];
  private mueff: number;
  private cs: number; private ds: number; private cc: number; private c1: number; private cmu: number; private chiN: number;
  state: CmaState;
  private lastZ: number[][] = [];
  private lastY: number[][] = [];

  constructor(x0: number[], sigma0: number, lambda: number) {
    this.D = x0.length;
    this.lambda = lambda;
    this.mu = Math.floor(lambda / 2);
    const raw = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const sum = raw.reduce((a, b) => a + b, 0);
    this.w = raw.map((v) => v / sum);
    this.mueff = 1 / this.w.reduce((a, v) => a + v * v, 0);
    const D = this.D, me = this.mueff;
    this.cs = (me + 2) / (D + me + 5);
    this.ds = 1 + 2 * Math.max(0, Math.sqrt((me - 1) / (D + 1)) - 1) + this.cs;
    this.cc = (4 + me / D) / (D + 4 + (2 * me) / D);
    const c1 = 2 / ((D + 1.3) ** 2 + me);
    const cmu = Math.min(1 - c1, (2 * (me - 2 + 1 / me)) / ((D + 2) ** 2 + me));
    const boost = (D + 2) / 3; // versión separable: tasas de aprendizaje mayores
    this.c1 = Math.min(0.5, c1 * boost);
    this.cmu = Math.min(1 - this.c1, cmu * boost);
    this.chiN = Math.sqrt(D) * (1 - 1 / (4 * D) + 1 / (21 * D * D));
    this.state = { mean: [...x0], sigma: sigma0, C: new Array(D).fill(1), ps: new Array(D).fill(0), pc: new Array(D).fill(0), gen: 0 };
  }

  /** Candidatos de esta generación (en el espacio de parámetros). */
  ask(rng: Rng): number[][] {
    const { mean, sigma, C } = this.state;
    this.lastZ = [];
    this.lastY = [];
    return Array.from({ length: this.lambda }, () => {
      const z = Array.from({ length: this.D }, () => gauss(rng));
      const y = z.map((v, i) => v * Math.sqrt(C[i]));
      this.lastZ.push(z);
      this.lastY.push(y);
      return mean.map((m, i) => m + sigma * y[i]);
    });
  }

  /** Actualiza con la aptitud de los candidatos de `ask` (mayor = mejor). */
  tell(fitness: number[]) {
    const s = this.state, D = this.D;
    const order = fitness.map((f, i) => [f, i] as const).sort((a, b) => b[0] - a[0]).slice(0, this.mu).map(([, i]) => i);
    const yw = new Array(D).fill(0), zw = new Array(D).fill(0);
    order.forEach((k, r) => {
      for (let i = 0; i < D; i++) { yw[i] += this.w[r] * this.lastY[k][i]; zw[i] += this.w[r] * this.lastZ[k][i]; }
    });
    for (let i = 0; i < D; i++) s.mean[i] += s.sigma * yw[i];
    const k = Math.sqrt(this.cs * (2 - this.cs) * this.mueff);
    for (let i = 0; i < D; i++) s.ps[i] = (1 - this.cs) * s.ps[i] + k * zw[i];
    const psNorm = Math.sqrt(s.ps.reduce((a, v) => a + v * v, 0));
    const hsig = psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * (s.gen + 1))) / this.chiN < 1.4 + 2 / (D + 1) ? 1 : 0;
    const kc = hsig * Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    for (let i = 0; i < D; i++) s.pc[i] = (1 - this.cc) * s.pc[i] + kc * yw[i];
    for (let i = 0; i < D; i++) {
      let rankMu = 0;
      order.forEach((idx, r) => { rankMu += this.w[r] * this.lastY[idx][i] ** 2; });
      s.C[i] = (1 - this.c1 - this.cmu) * s.C[i] + this.c1 * (s.pc[i] ** 2 + (1 - hsig) * this.cc * (2 - this.cc) * s.C[i]) + this.cmu * rankMu;
      s.C[i] = Math.max(1e-6, s.C[i]);
    }
    s.sigma = Math.min(2, Math.max(1e-3, s.sigma * Math.exp((this.cs / this.ds) * (psNorm / this.chiN - 1))));
    s.gen++;
  }
}
