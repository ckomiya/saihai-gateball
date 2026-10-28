// Exposición, valor de sacar una rival y postes (partida 20261026-162635, turnos 12, 28 y 42; Chris los llamó 13, 28 y 42):
//  - T12/T13: la blanca 2 reentra y se queda pegada a la roja 5 (98 % de que la toque): el riesgo «pasa su puerta» de las otras rivales tapaba esa diferencia. Con `kantokuRiskByValue` no se queda pegada.
//  - T42: la 2 reentra con una sola opción que no sale de la cancha, y queda a 8 m de la 5 (que pasa el 3er arco y toca): se fija que no se pega a la 5 ni sale.
//  - T28: (a) el valor de sacar una rival depende de su peligro real (`rivalWorth`): la roja 7, lista para el poste, pegada a la línea y aislada, vale menos que una rival cerca de mis bolas o de su puerta; el poste solo suma si el agari es posible pronto o amenaza.
//         (b) el poste de meta (10; 7,5) tapaba el camino de la 10 al frente del 2º arco: `mateDestinations` ya no ofrece destinos cuyo camino roza un poste (`clearOfPosts`).
import { CONFIG } from '../src/config';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { clearOfPosts, mateDestinations, rivalWorth } from '../src/game/cpuPlanner';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { scaleError } from '../src/game/certainty';
import { upcomingTurns } from '../src/game/phase';
import { Brain, weightsFor } from '../src/game/weights';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const mk = (rows: number[][]): BallState[] => rows.map(([n, x, y, g, o, p]) => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate: g, outBall: !!o, points: p }));
const T12 = [[1, 2.063, 6.326, 2, 0, 1], [2, 6.507, -0.35, 2, 1, 1], [3, 18, 15.5, 1, 0, 0], [4, 10.088, 14.057, 2, 0, 1], [5, 9.622, 0.22, 2, 0, 1], [6, 18, 15.5, 1, 0, 0], [7, 18, 15.5, 1, 0, 0], [8, 18, 15.5, 1, 0, 0], [9, 18, 15.5, 1, 0, 0], [10, 6.736, 15.35, 2, 1, 1]];
const T42 = [[1, 5.218, 2.473, 3, 0, 2], [2, 19.118, 15.35, 2, 1, 1], [3, 20.35, 11.273, 3, 1, 2], [4, 20.35, 6.501, 2, 1, 1], [5, 9.014, 13.682, 3, 0, 2], [6, 7.942, 14.051, 2, 0, 1], [7, 18.823, 15.35, 4, 1, 3], [8, 13.202, 13.902, 2, 0, 1], [9, 9.121, 2.195, 2, 0, 1], [10, 18.875, 13.806, 2, 0, 1]];
const T28 = [[1, 2.429, 1.529, 3, 0, 2], [2, 13.244, 13.878, 2, 0, 1], [3, 6.228, -0.35, 3, 1, 2], [4, 9.963, 1.882, 2, 0, 1], [5, 14.195, 0.043, 3, 0, 2], [6, 2.882, 11.158, 2, 0, 1], [7, 19.029, 15.079, 4, 0, 3], [8, 10.388, 14.585, 2, 0, 1], [9, 15.628, -0.35, 3, 1, 1], [10, 10.573, 14.509, 2, 0, 1]];
const errors = { ...kantokuLevelErrors(), rivalIsHuman: true };

function endOfBall2(rows: number[][], clock: number, brain: Brain = kantokuBrain) {
  const ds: { x: number; y: number; out: boolean }[] = [];
  for (let s = 0; s < 8; s++) {
    const m = Match.fromBalls(mk(rows), { turn: 1, rng: mulberry32(40 + s) });
    m.clock = clock; m.turnStarts = 40; m.firstRoundDone = true;
    const plan = cpuPlan(m, 3, { brain, errors });
    let res = m.shoot(plan.aim, plan.power, plan.acc);
    for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
    if (!res) { m.forceStop(); res = m.resolution!; }
    ds.push({ x: m.balls[1].x, y: m.balls[1].y, out: m.balls[1].outBall });
  }
  return ds;
}
const withRbv = <T>(on: boolean, f: () => T): T => { const s = CONFIG.kantokuRiskByValue; CONFIG.kantokuRiskByValue = on; try { return f(); } finally { CONFIG.kantokuRiskByValue = s; } };

// T12: la 2 reentra junto a la roja 5 (9,62; 0,22)
{
  const dist = (e: { x: number; y: number }[]) => e.reduce((a, p) => a + Math.hypot(p.x - 9.622, p.y - 0.22), 0) / e.length;
  // 2026-10-27 (kantoku v1.1): la prueba mide el riesgo plano de la iteración anterior; la exposición propia de la reentrada y el resto del riesgo (v1.1) también lo corrigen (a 5,6 m), así que el caso «plano» se mide con esas piezas apagadas.
  const flatBrain: Brain = { kind: 'kantoku', file: { ...(kantokuBrain as { file: object }).file, legacyCover: true, legacySend: true, legacyRiskRest: true, legacyOpenField: true, legacyOwnExposure: true, legacyFarEntry: true } as never }; // v1.3: sin los candidatos de reentrada lejanos tampoco (con ellos la 2 se aleja de la 5 por sí misma)
  const aflat = dist(withRbv(false, () => endOfBall2(T12, 1510, flatBrain)));
  const aval = dist(withRbv(true, () => endOfBall2(T12, 1510)));
  check(aflat < 2, `T12 (riesgo plano): la 2 queda pegada a la 5 (a ${aflat.toFixed(1)} m de media)`);
  check(aval >= 3, `T12 (riesgo por valor): la 2 no queda pegada a la 5 (a ${aval.toFixed(1)} m de media, ≥ 3 m)`);
}
// T42: la única jugada que no saca a la 2 la deja a 8 m de la 5; no se pega ni sale
{
  const e = withRbv(true, () => endOfBall2(T42, 744));
  const near = e.filter((p) => Math.hypot(p.x - 9.014, p.y - 13.682) < 4).length, out = e.filter((p) => p.out).length;
  check(near === 0 && out <= 1, `T42: la 2 reentra sin pegarse a la 5 (${near} de 8 a menos de 4 m) ni salir (${out} de 8)`);
}
// T28 (a): valor de sacar una rival según su peligro real
{
  const m = Match.fromBalls(mk(T28), { turn: 7, rng: mulberry32(1), sparkBall: 9 });
  m.clock = 1090; m.turnStarts = 40; m.firstRoundDone = true;
  const F = { seq: upcomingTurns(m), profiles: m.profiles, base: scaleError(CONFIG.humanRivalError, 1), rivalBase: CONFIG.humanRivalError };
  const w = weightsFor(kantokuBrain, 'final');
  const S = mk(T28) as any[];
  const corner = rivalWorth(S, 6, w, F as any); // la roja 7: poste, 3 puntos, pegada a la línea, lejos de todo
  const near = mk(T28) as any[];
  Object.assign(near[6], { x: 15.5, y: 12.5 }); // la misma bola cerca de mis bolas (la 2 a 2,5 m), fuera de la línea
  const close = rivalWorth(near, 6, w, F as any);
  check(corner < close, `T28: la roja 7 pegada a la línea y aislada vale menos (${corner.toFixed(2)}) que la misma cerca de mis bolas (${close.toFixed(2)})`);
  const legacy = rivalWorth(S, 6, { ...w, legacyRivalDanger: true }, F as any);
  check(corner < legacy, `T28: con el peligro real vale menos que antes (${corner.toFixed(2)} < ${legacy.toFixed(2)})`);
  // el poste solo suma si el agari es posible pronto (≤ kantokuAgariTurns turnos) o amenaza
  const lonely = mk(T28) as any[];
  for (const i of [1, 3, 7, 9]) Object.assign(lonely[i], { outBall: true, x: 18, y: 15.5 }); // ninguna bola mía cerca de la 7
  const Fshort = { ...F, seq: [6, ...F.seq.filter((x) => x !== 6)] };
  const Flong = { ...F, seq: [6, 0, 6, 0, 6, 0, 6, 0, 6] };
  const soon = rivalWorth(lonely, 6, w, Fshort as any), later = rivalWorth(lonely, 6, w, Flong as any);
  check(later < soon || w.touchPole === 0, `T28: el bono de poste solo cuenta si el agari es posible pronto (pronto ${soon.toFixed(2)}, con muchos turnos ${later.toFixed(2)})`);
}
// T28 (b): el poste de meta tapaba el camino de la 10 al frente del 2º arco
{
  const from = { x: 10.573, y: 14.509 };
  check(!clearOfPosts(from, { x: 9.5, y: 1.6 }), 'T28: el camino de la 10 a (9,5; 1,6) pasa pegado al poste de meta: no está libre');
  check(clearOfPosts(from, { x: 11.5, y: 2.4 }), 'T28: el camino a (11,5; 2,4) rodea el poste con margen: libre');
  const ds = mateDestinations(mk(T28) as any, 9, from);
  check(ds.every((d) => clearOfPosts(from, d)), `T28: ninguno de los ${ds.length} destinos ofrecidos a la 10 roza un poste`);
  check(ds.some((d) => Math.hypot(d.x - 10.5, d.y - 2) <= 2.2), 'T28: entre ellos hay destinos frente al 2º arco');
}
process.exit(fail ? 1 : 0);
