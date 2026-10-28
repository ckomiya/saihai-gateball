// Experimento de la línea (defensa) con el intento de touch completo, con la física real: una bola mía cerca de la línea y un rival que intenta el touch.
// Resultados de un intento (Art. 15 cl. 1: el spark solo se gana si la bola que golpea y la tocada quedan en juego):
//   a  falla y su bola sale (pierde el turno)            e  falla y todo queda dentro (nada)
//   b  acierta y salen las dos bolas                     b2 acierta y solo sale la suya
//   c  acierta, sale mi bola por el impacto y la suya no (sin touch ni spark: solo pierde el turno)
//   d  acierta y todo queda dentro: touch y spark (y el spark saca mi bola con probabilidad `exp`)
// Geometría: φ = ángulo entre la dirección del tiro (rival → mi bola) y la línea más cercana a mi bola (0° = de frente a ella); dl = distancia de mi bola a esa línea; D = distancia del tiro.
// Uso: npm run lineplay -- [--trials 400] [--extra 0.1,0.2] [--write]   (--write guarda src/game/attackTable.json: las tablas que usa el planificador)
import { writeFileSync } from 'node:fs';
import { CONFIG, kantokuLevelBase } from '../src/config';
import { ErrorBase, drawShotError } from '../src/game/certainty';
import { applyShotError, knockOutTarget } from '../src/game/cpu';
import { BallState, Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';
import { ATTACK_GRID } from '../src/game/attackTable';
import { touchOvershoot } from '../src/game/cpuPlanner';
import cpuWeights from '../src/game/cpuWeights.json';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TRIALS = Number(str('trials', '400'));
const EXTRAS = str('extra', '0.1,0.2').split(',').map(Number);
const WRITE = argv.includes('--write');
const bars = CONFIG.playerBars[0]; // el rival es la bola 1

const board = (rx: number, ry: number, bx: number, by: number): BallState[] =>
  Array.from({ length: 10 }, (_, i) => ({ n: i + 1, team: (i % 2) as 0 | 1, x: 18, y: 15.5, vx: 0, vy: 0, nextGate: 1, outBall: false, points: 0, ...(i === 0 ? { x: rx, y: ry, nextGate: 3 } : i === 1 ? { x: bx, y: by, nextGate: 2 } : {}) }));

function roll(m: Match, aim: { x: number; y: number }, power: number, acc: number) {
  let res = m.shoot(aim, power, acc);
  for (let i = 0; i < 900 && !res && m.stage === 'rolling'; i++) if (m.step(1 / 60)) res = m.resolution;
  if (!res) { m.forceStop(); res = m.resolution!; }
  return res;
}

interface Counts { a: number; e: number; b: number; b2: number; c: number; d: number; x: number; exp: number }
const zero = (): Counts => ({ a: 0, e: 0, b: 0, b2: 0, c: 0, d: 0, x: 0, exp: 0 });

/** `trials` intentos con el error `err` y `extra` de fuerza de más. Mi bola a `dl` m de la línea izquierda; el rival a `D` m (menos si el campo no da). */
function cell(dl: number, D: number, phiDeg: number, err: ErrorBase, extra: number, trials: number, seed: number, rule = false): Counts {
  const phi = (phiDeg * Math.PI) / 180;
  const sin = Math.sin(phi);
  const Dc = sin > 1e-6 ? Math.min(D, 7.5 / sin) : D; // el rival tiene que quedar dentro de la cancha
  const bx = dl, by = 4.5; // lejos del poste (10; 7,5) y de las puertas
  const rx = bx + Dc * Math.cos(phi), ry = by + Dc * sin;
  const c = zero();
  const rng = mulberry32(seed);
  for (let t = 0; t < trials; t++) {
    const m = Match.fromBalls(board(rx, ry, bx, by), { turn: 0, rng });
    m.clock = 900; m.firstRoundDone = true;
    // `rule`: el kantoku (CPU) apunta pasado el blanco (regla de la mira, `touchOvershoot`: 0,2 m por metro, reducida cerca de la línea)
    const off = rule ? touchOvershoot({ x: rx, y: ry }, { x: bx, y: by }) : 0;
    const aimT = { x: bx - Math.cos(phi) * off, y: by - sin * off };
    const shot = applyShotError(aimT, { power: bars.power.sweetSpot, acc: bars.accuracy.sweetSpot }, drawShotError(err, rng));
    const res = roll(m, shot.aim, Math.min(1, shot.power * (1 + extra)), shot.acc);
    const B = m.balls[1];
    const contact = B.outBall || Math.hypot(B.x - bx, B.y - by) > 1e-4;
    const rOut = m.balls[0].outBall;
    if (!contact) { if (rOut) c.a++; else c.e++; continue; }
    if (rOut && B.outBall) c.b++;
    else if (rOut) c.b2++;
    else if (B.outBall) c.c++;
    else if (res.touches.includes(1)) {
      c.d++;
      if (m.proceed() === 'spark' && m.sparkBall) {
        const sp = applyShotError(knockOutTarget(m.b), { power: bars.power.sweetSpot, acc: bars.accuracy.sweetSpot }, drawShotError(err, rng));
        const r2 = roll(m, sp.aim, sp.power, sp.acc);
        if (r2.kind === 'spark' && m.balls[1].outBall) c.exp++;
      }
    } else c.x++;
  }
  return c;
}

const pc = (a: number, n: number) => `${n ? Math.round((100 * a) / n) : 0}`.padStart(3);
const base = (cpuWeights as unknown as { base: Record<string, number> }).base;
// Ilustración del valor esperado para el rival con los pesos del campeón (gana: d = touch + spark que saca mi bola; c = mi bola fuera; pierde `shooterOutLater` si su bola sale)
const val = { d: base.touchRivalBase + base.outRivalBase, c: base.outRivalBase, b: base.outRivalBase - base.shooterOutLater, b2: -base.shooterOutLater, a: -base.shooterOutLater };
const ev = (c: Counts) => { const n = c.a + c.e + c.b + c.b2 + c.c + c.d + c.x; return n ? (c.d * val.d + c.c * val.c + c.b * val.b + c.b2 * val.b2 + c.a * val.a) / n : 0; };

if (argv.includes('--compare')) {
  // ¿Pesa la línea en CPU contra CPU? El intento de touch de la CPU con la regla de la mira contra el de antes (fuerza exacta), con el error del nivel
  const s0 = CONFIG.kantokuLevelErrorScale;
  const kerr0: ErrorBase = { aimErr: kantokuLevelBase().aimErr * s0, powerErr: kantokuLevelBase().powerErr * s0, accErr: kantokuLevelBase().accErr * s0 };
  console.log('CPU (error del nivel): % de intentos por resultado · a = falla y su bola sale · b/b2 = salen las dos / solo la suya · c = sale mi bola sin spark · d = touch y spark · acierta = b+b2+c+d');
  for (const D of [6, 10, 14]) {
    for (const phi of [0, 45]) {
      for (const dl of [0.2, 0.5, 1]) {
        const o = cell(dl, D, phi, kerr0, 0, TRIALS, 5 + D + phi, false), r = cell(dl, D, phi, kerr0, 0, TRIALS, 5 + D + phi, true);
        const f = (c: Counts) => `a ${pc(c.a, TRIALS)} b ${pc(c.b, TRIALS)} b2 ${pc(c.b2, TRIALS)} c ${pc(c.c, TRIALS)} d ${pc(c.d, TRIALS)} | acierta ${pc(c.b + c.b2 + c.c + c.d + c.x, TRIALS)} | valor del rival ${ev(c).toFixed(2)}`;
        console.log(`D ${D} φ ${phi} dl ${dl}:  exacta: ${f(o)}   ||   regla: ${f(r)}`);
      }
    }
  }
  process.exit(0);
}
if (!WRITE) {
  for (const extra of EXTRAS) {
    for (const D of [6, 10]) {
      for (const phi of [0, 45, 90]) {
        console.log(`\nHumano, fuerza +${Math.round(extra * 100)} %, tiro a ${D} m, φ = ${phi}° (0° = de frente a la línea, 90° = paralelo)`);
        console.log('  dl     |   a   e   b  b2   c   d | mi bola sale tras d | valor esperado del rival');
        for (const dl of [0.2, 0.5, 1, 1.5, 2, 3, 5]) {
          const c = cell(dl, D, phi, CONFIG.humanRivalError, extra, TRIALS, 1 + Math.round(dl * 100) + D * 7 + phi);
          const n = TRIALS;
          console.log(`  ${dl.toFixed(1).padStart(4)} m | ${pc(c.a, n)} ${pc(c.e, n)} ${pc(c.b, n)} ${pc(c.b2, n)} ${pc(c.c, n)} ${pc(c.d, n)} |  ${pc(c.exp, c.d)} %              | ${ev(c).toFixed(2)}`);
        }
      }
    }
  }
} else {
  const s = CONFIG.kantokuLevelErrorScale;
  const kerr: ErrorBase = { aimErr: kantokuLevelBase().aimErr * s, powerErr: kantokuLevelBase().powerErr * s, accErr: kantokuLevelBase().accErr * s };
  const tables: Record<string, number[][][][]> = {};
  const jobs: [string, ErrorBase, number[]][] = [['human', CONFIG.humanRivalError, EXTRAS], ['cpu', kerr, [0]]];
  for (const [name, err, extras] of jobs) {
    const t: number[][][][] = [];
    ATTACK_GRID.phi.forEach((phi, ip) => {
      t[ip] = [];
      ATTACK_GRID.D.forEach((D, iD) => {
        t[ip][iD] = [];
        ATTACK_GRID.dl.forEach((dl, il) => {
          const tot = zero();
          extras.forEach((ex, k) => {
            const c = cell(dl, D, phi, err, ex, TRIALS, 77 + ip * 1000 + iD * 100 + il * 10 + k, name === 'cpu');
            for (const key of Object.keys(tot) as (keyof Counts)[]) tot[key] += c[key];
          });
          const hit = tot.b + tot.b2 + tot.c + tot.d + tot.x;
          const miss = tot.a + tot.e;
          const f = (v: number) => Math.round(v * 1000) / 1000;
          const a = f(miss ? tot.a / miss : 0);
          // [d, c, b, b2 | acierta], expulsa el spark | d, [a | falla]; el contacto sin touch válido ni salida (x) cuenta como d
          t[ip][iD][il] = hit ? [f((tot.d + tot.x) / hit), f(tot.c / hit), f(tot.b / hit), f(tot.b2 / hit), f(tot.d ? tot.exp / tot.d : 1), a] : [1, 0, 0, 0, 1, a];
        });
      });
    });
    tables[name] = t;
    console.log(`tabla ${name} lista`);
  }
  writeFileSync('src/game/attackTable.json', JSON.stringify({ ...tables }) + '\n');
  console.log('escrita src/game/attackTable.json');
}
