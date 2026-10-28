// Turno 36 de la partida de Chris (2026-10-26): tres blancas juntas frente a la puerta 2 cuando la roja 7, que juega justo después, aún estaba en la salida. La roja puede pasar la puerta 1 con un tiro fuerte, rodar hasta
// las blancas y, con el golpe continuo, tener dos blancos juntos (doble ángulo bola y bola, y montón). Causas: (1) la amenaza desde la salida solo contaba paradas hasta 6 m más allá de la puerta 1 (`EXIT_STOPS`),
// cuando el tiro sigue rodando hasta 11 m; (2) el doble ángulo (`kantokuDoubleMax`) no se disparaba: el umbral era 0,3 y la situación daba ≈ 0,23 (se perdía además en un máximo con «pasar y tocar» de una sola bola)
// y juntarse solo costaba si la bola no estaba ya junto a otra (pasar de un par a otro no contaba).
//  A  la amenaza desde la salida incluye las paradas lejanas: una bola frente a la puerta 2 (9,8; 1,6) está amenazada por la roja que sale por encima de lo que daban las paradas hasta 6 m;
//  B  dos bolas mías frente a la puerta 2 y una rival en la salida que juega después: el kantoku no las deja juntas (≤ 40 % de los turnos; sin las reglas, las deja juntas casi siempre).
import { CONFIG } from '../src/config';
import { touchProbability } from '../src/game/certainty';
import { cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { BallState, FINISHED, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { EXIT_STOPS, touchThreat } from '../src/game/threat';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const ball = (n: number, x: number, y: number, nextGate: number): BallState => ({ n, team: (n % 2 === 1 ? 0 : 1) as 0 | 1, x, y, vx: 0, vy: 0, nextGate, outBall: false, points: nextGate > 1 ? 1 : 0 });

// A
{
  const target = { x: 9.8, y: 1.6 };
  const rival = ball(7, 18, 15.5, 1);
  const err = CONFIG.humanRivalError;
  const near = Math.max(...[1, 3, 6].map((s) => touchProbability(err, Math.hypot(target.x - 18, target.y - (11 - s)), true)));
  const all = touchThreat(rival, target, err);
  check(EXIT_STOPS.includes(11) && EXIT_STOPS.includes(9) && all >= CONFIG.kantokuStartPassP * near && all > 0.25, `A amenaza de la roja que sale sobre una bola frente a la puerta 2: ${all.toFixed(2)} con paradas hasta 11 m (mejor parada a ≤ 6 m: ${(CONFIG.kantokuStartPassP * near).toFixed(2)})`);
}
// B
{
  const N = 24;
  const turn = (flags: object) => {
    let joined = 0;
    for (let t = 0; t < N; t++) {
      const b = Array.from({ length: 10 }, (_, i) => ball(i + 1, 18, 15.5, FINISHED));
      b[6] = ball(7, 18, 15.5, 1); b[9] = ball(10, 9.8, 2.4, 2); b[7] = ball(8, 4.6, 1.0, 2); b[5] = ball(6, 3.9, 0.3, 2);
      const m = Match.fromBalls(b, { turn: 5, rng: mulberry32(100 + t) });
      m.clock = 900; m.turnStarts = 30; m.firstRoundDone = true;
      m.profiles = m.profiles.map(() => ({ short: 1, medium: 1, long: 1 }));
      for (let g = 0; g < 10; g++) {
        const plan = cpuPlan(m, 3, { brain: { kind: 'kantoku', file: { ...(kantokuBrain as { file: object }).file, ...flags } as never }, errors: { ...kantokuLevelErrors(), rivalIsHuman: true } });
        let res = m.shoot(plan.aim, plan.power, plan.acc);
        for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
        if (!res) { m.forceStop(); res = m.resolution!; }
        const tr = m.proceed(); if (tr === 'turn' || tr === 'end') break;
      }
      const mine = m.balls.filter((x) => x.team === 1 && x.nextGate >= 2 && x.nextGate <= 4 && !x.outBall);
      if (mine.some((a, i) => mine.some((c, j) => j > i && Math.hypot(a.x - c.x, a.y - c.y) <= 2.5 && Math.hypot(a.x - 9.8, a.y - 1.5) <= 3.5))) joined++;
    }
    return joined;
  };
  const on = turn({}), off = turn({ legacyDouble: true, legacyCombo: true, legacyJoin: true });
  check(on <= 0.4 * N && off >= 0.7 * N, `B dos bolas mías frente a la puerta 2 con una rival en la salida que juega después: las deja juntas ${on}/${N} (sin las reglas del doble ángulo y de juntarse: ${off}/${N})`);
}
process.exit(fail ? 1 : 0);
