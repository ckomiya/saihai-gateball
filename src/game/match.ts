import { BarPattern, CONFIG, LAYOUT } from '../config';
import { Ball, PhysicsFx, speed, speedForDistance, stepAll } from './physics';
import { COURT_H, COURT_W, GATES, POSTS, clampAimToPosts, crossedGate, leftInnerField, nearestOutSpot, obstructsGateOne, outBallSpot, touchingPole } from './court';
import type { Rng } from './rng';
import type { Profile } from './certainty';

/**
 * Motor de reglas del partido, sin Phaser ni dibujo. La escena (`MatchScene`) y la CPU (`cpuPlanner`, `scripts/selfplay.ts`)
 * lo usan: la escena solo pone la entrada, el dibujo y las esperas, y decide los mensajes a partir de los eventos.
 *
 * Reglas (reglamento 2025, ver RULES.md): 10 bolas, rojas impares (equipo 0) y blancas pares (equipo 1), turnos en orden numérico (Art. 6).
 * Cada bola recorre puerta 1 → 2 → 3 → poste (Art. 13-14). Bola fuera (Art. 17): conserva sus puntos y se juega desde 10 cm fuera de la
 * línea, sin puntuar. Golpe continuo (Art. 12 cl. 3): al pasar una puerta y quedar en juego, un golpe más, encadenable. Touch (Art. 15): la
 * bola que ya pasó la puerta 1 y toca otra bola gana un spark (Art. 16), que va antes que el golpe continuo: éxito = la bola golpeada queda a
 * ≥10 cm, llega al poste o sale; si no, falta (todo vuelve y la que golpea queda fuera). Un golpe de bola fuera que toca otra bola, o tocar dos
 * veces la misma bola sparkeada, es falta. Sin pasar la puerta 1, las bolas tocadas vuelven a su sitio (Art. 11 cl. 2), salvo las que
 * estorban el tiro de salida: esas son fantasma (Art. 12 cl. 2 (2)). Reloj de cuenta regresiva (más rápido que el real, `clockFactor`); el
 * partido siempre termina con una bola blanca (decisión de Chris): al acabar el tiempo o llegar un equipo a 25 puntos, si la que golpea es
 * roja juega la blanca siguiente; si es blanca, termina al acabar sus golpes; si el blanco llega a 25 jugando una blanca, termina ahí.
 *
 * Flujo: `shoot()` → `step(dt)` repetido hasta que `stage === 'resolved'` (o `shoot()` ya devuelve la resolución, en una falta de spark) →
 * se muestra `resolution.events` → `proceed()` pasa al turno siguiente, al golpe continuo o al spark.
 */

/** Siguiente objetivo: 1-3 = puerta, 4 = poste, 5 = recorrido terminado. */
export const POLE_STEP = 4;
export const FINISHED = 5;
export const BALLS = 10;

export type P = { x: number; y: number };

/** Estado de una bola del partido. Rojas = impares (equipo 0), blancas = pares (equipo 1). */
export interface BallState extends Ball {
  n: number;
  team: 0 | 1;
  nextGate: number;
  outBall: boolean; // está en la franja exterior esperando volver a entrar
  points: number;
}

/** En juego: ya pasó la puerta 1, no llegó al poste y no está fuera. */
export const inPlay = (b: BallState) => b.nextGate >= 2 && b.nextGate <= POLE_STEP && !b.outBall;

export type FoulReason = 'touchedOther' | 'touchedTwice';

/** Cosas que pasan en un golpe. La escena decide qué mensaje (si alguno) y cuánto esperar; ver `messages.ts`. */
export type MatchEvent =
  | { type: 'gate'; ball: number; gate: number; stroker: boolean } // pasó una puerta (suma `gatePoints`)
  | { type: 'pole'; ball: number; stroker: boolean } // llegó al poste (suma `polePoints`)
  | { type: 'out'; ball: number } // otra bola (no la que golpea) salió de la cancha
  | { type: 'noTouch' } // tiro de salida: pasó la puerta 1 y luego tocó una bola, sin touch ni spark
  | { type: 'strokerOut'; start: boolean; gate: number; foul: FoulReason | null } // la que golpea salió (start: aún sin puerta 1)
  | { type: 'backInPlay' } // bola fuera que volvió a entrar
  | { type: 'ballOut' } // bola fuera (no entró, o salió tras un spark)
  | { type: 'failGate1' } // no pasó la puerta 1
  | { type: 'touch'; balls: number[] } // touch válido a estas bolas (números)
  | { type: 'spark' } // spark exitoso
  | { type: 'sparkFoul'; reason: 'short' | 'outside' }; // spark corto, o bola tocada en el campo exterior

/** Señales de sonido del golpe en curso (solo si la escena activa `cues`; las simulaciones de la CPU no las generan). `v` = intensidad 0-1. */
export type SoundCue = { type: 'strike' | 'ball' | 'gatePost' | 'pole' | 'gate' | 'agari' | 'out'; v: number };

export type Transition = 'turn' | 'continue' | 'spark' | 'end';

/** Resultado de un golpe ya resuelto (todas las bolas quietas), antes de pasar a lo que sigue. */
export interface Resolution {
  kind: 'stroke' | 'spark' | 'sparkFoul';
  /** En el orden en que se muestran. */
  events: MatchEvent[];
  next: 'turn' | 'continue' | 'spark';
  /** Índices de las bolas con touch válido (solo en un golpe normal que lo dé). */
  touches: number[];
  strokerOut: boolean;
  foul: FoulReason | null;
  /** Última puerta pasada por la que golpea en este golpe (0 = ninguna). */
  shotGate: number;
}

type Stage = 'ready' | 'rolling' | 'resolved' | 'done';

/** Estado de un partido en un inicio de turno (se puede guardar como JSON). */
export interface SavedState {
  balls: BallState[];
  turn: number;
  clock: number;
  ending: boolean;
  endNow: boolean;
  turnStarts: number;
  firstRoundDone: boolean;
  started: number[];
  profiles: Profile[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Velocidad de una barra (unidades/s) en la posición p: base del jugador × multiplicador de la zona. */
export function barSpeed(bar: BarPattern, p: number) {
  const zone = bar.zones.find((z) => p >= z.from && p <= z.to);
  return (2 / bar.cycleSeconds) * (zone ? zone.speed : 1);
}

/**
 * Cuanto más lejos va el tiro, más rápido se mueve el selector de precisión: de `accuracySpeedMin` (tiro de `accuracyNearM` o menos) a `accuracySpeedMax` (`accuracyFarM` o más), lineal entre los dos.
 * `travelM` = lo que va a recorrer la bola (`Match.travelDistance`). Antes dependía de la posición de la barra de fuerza, pero en el triángulo la barra queda casi siempre en el mismo punto sea cual sea la
 * distancia a la mira, así que un tiro muy lejano no se sentía más difícil (Chris, 2026-10-26).
 */
export const accuracySpeedFactor = (travelM: number) => {
  const t = Math.min(1, Math.max(0, (travelM - CONFIG.accuracyNearM) / (CONFIG.accuracyFarM - CONFIG.accuracyNearM)));
  return CONFIG.accuracySpeedMin + (CONFIG.accuracySpeedMax - CONFIG.accuracySpeedMin) * t;
};

export function startBall(): Ball {
  const sa = LAYOUT.startArea;
  return { x: (sa.x1 + sa.x2) / 2, y: sa.ballY, vx: 0, vy: 0 };
}

export class Match {
  balls: BallState[] = [];
  turn = 0; // índice de la bola que golpea (0 = bola 1)
  clock = 0; // segundos de partido que quedan (cuenta regresiva)
  ending = false; // se acabó el tiempo o hubo juego perfecto: el partido termina con la siguiente bola blanca
  endNow = false; // el blanco llegó a 25 jugando una bola blanca: termina al acabar ese golpe
  owed = 0; // golpes continuos que quedan por un spark exitoso
  strokesInTurn = 0; // golpes dados en el turno en curso (el planificador distingue el golpe continuo del primero)
  sparkBall: BallState | null = null; // bola tocada que se está sparkeando (null = golpe normal)
  /** Señales de sonido pendientes (la escena las vacía en cada cuadro); `null` = no se generan (simulaciones). */
  cues: SoundCue[] | null = null;
  sparkQueue: BallState[] = []; // otras bolas tocadas en el mismo golpe, que se sparkean después
  sparkedThisTurn = new Set<BallState>(); // bolas ya sparkeadas en este turno (tocarlas otra vez es falta)
  sparkBonus = 1; // golpes que gana el spark exitoso: 2 si el touch y una puerta fueron del mismo golpe
  stage: Stage = 'ready';
  resolution: Resolution | null = null;
  shots = 0;
  /** Cuántos turnos se han empezado y si ya terminó el inicio (cada bola jugó su primer turno): lo usa `phase.ts`. */
  turnStarts = 0;
  firstRoundDone = false;
  private startedBalls = new Set<number>();
  /** Certeza de quien tira cada bola (índice 0 = bola 1). Por defecto la de `config.ts`; el entrenamiento los sortea por partido. */
  profiles: Profile[] = [];

  // Estado del golpe en curso
  shotGate = 0; // última puerta pasada por la que golpea en este golpe
  private shotScore: MatchEvent | null = null; // último evento de puntos de la que golpea en este golpe
  private shotFromOut = false; // este golpe sale de una bola fuera: no puntúa
  private lastRest: P = { x: 0, y: 0 };
  private touched = new Set<BallState>(); // bolas tocadas por la que golpea en este golpe
  private ghostSet = new Set<BallState>(); // bolas que estorban el tiro de salida a la puerta 1: se fijan al golpear
  private strokeFromStart = false; // este golpe es un tiro de salida (la bola aún no había pasado la puerta 1)
  private invalid = new Set<BallState>(); // bolas movidas por un movimiento inválido: vuelven a su sitio al final
  private snapshot = new Map<BallState, P>(); // posiciones al empezar el golpe
  private strokerOut = false; // la bola que golpea salió de la cancha en este golpe
  private foul: FoulReason | null = null;
  private side: MatchEvent[] = []; // eventos de otras bolas (puntos, salidas) en este golpe
  private noTouchShown = false;
  private sparkSet: P = { x: 0, y: 0 }; // dónde se colocó la bola tocada al golpear el spark
  private sparkBase = new Map<BallState, { x: number; y: number; nextGate: number; points: number; outBall: boolean }>(); // estado tras el touch

  constructor(readonly rng: Rng) {}

  /** Partido nuevo: 10 bolas en la salida, reloj completo, turno de la bola 1. */
  reset() {
    this.balls = [];
    for (let n = 1; n <= BALLS; n++) {
      this.balls.push({ ...startBall(), n, team: n % 2 === 1 ? 0 : 1, nextGate: 1, outBall: false, points: 0 });
    }
    this.clock = CONFIG.matchMinutes * 60;
    this.ending = false;
    this.endNow = false;
    this.shots = 0;
    this.resolution = null;
    this.turnStarts = 0;
    this.firstRoundDone = false;
    this.startedBalls.clear();
    this.profiles = this.balls.map((_, i) => ({ ...CONFIG.playerCertainty[Math.floor(i / 2) % CONFIG.playerCertainty.length] }));
    this.beginTurn(0);
    this.noteTurnStart(0);
  }

  /** Cuenta el turno que empieza (no el R de la salida, que repite el mismo). */
  private noteTurnStart(idx: number) {
    if (this.startedBalls.has(idx)) this.firstRoundDone = true; // una bola empieza su segundo turno: terminó el inicio
    this.startedBalls.add(idx);
    this.turnStarts++;
  }

  /** Estado del partido en un inicio de turno, para guardarlo (banco de finales del entrenamiento). */
  saveState(): SavedState {
    return {
      balls: this.balls.map((b) => ({ ...b, vx: 0, vy: 0 })),
      turn: this.turn,
      clock: this.clock,
      ending: this.ending,
      endNow: this.endNow,
      turnStarts: this.turnStarts,
      firstRoundDone: this.firstRoundDone,
      started: [...this.startedBalls],
      profiles: this.profiles.map((p) => ({ ...p })),
    };
  }

  static restore(s: SavedState, rng: Rng): Match {
    const m = new Match(rng);
    m.balls = s.balls.map((b) => ({ ...b }));
    m.turn = s.turn;
    m.clock = s.clock;
    m.ending = s.ending;
    m.endNow = s.endNow;
    m.turnStarts = s.turnStarts;
    m.firstRoundDone = s.firstRoundDone;
    m.startedBalls = new Set(s.started);
    m.profiles = s.profiles.map((p) => ({ ...p }));
    return m;
  }

  /** Tablero a partir de bolas dadas, para simular golpes (planificador de la CPU). `sparkBall` = índice de la bola tocada en un spark. */
  static fromBalls(balls: BallState[], o: { turn: number; rng: Rng; sparkBall?: number; sparked?: number[] }): Match {
    const m = new Match(o.rng);
    m.balls = balls.map((b) => ({ ...b }));
    m.clock = CONFIG.matchMinutes * 60;
    m.turn = o.turn;
    m.profiles = m.balls.map((_, i) => ({ ...CONFIG.playerCertainty[Math.floor(i / 2) % CONFIG.playerCertainty.length] }));
    m.sparkedThisTurn = new Set((o.sparked ?? []).map((i) => m.balls[i]));
    if (o.sparkBall !== undefined && o.sparkBall >= 0) {
      m.sparkBall = m.balls[o.sparkBall];
      m.snapshotForSpark();
    }
    return m;
  }

  /**
   * Copia del partido entre dos golpes (etapa 'ready': a mitad de turno, con spark o golpes continuos pendientes) para que el planificador pruebe cadenas de golpes sin tocar el partido real.
   * Las bolas, la cola de sparks y el estado del turno se copian; el azar es el que se pase.
   */
  clone(rng: Rng): Match {
    const c = new Match(rng);
    c.balls = this.balls.map((b) => ({ ...b }));
    const at = (o: BallState) => c.balls[this.balls.indexOf(o)];
    c.turn = this.turn; c.clock = this.clock; c.ending = this.ending; c.endNow = this.endNow;
    c.owed = this.owed; c.strokesInTurn = this.strokesInTurn; c.sparkBonus = this.sparkBonus; c.stage = this.stage;
    c.shots = this.shots; c.turnStarts = this.turnStarts; c.firstRoundDone = this.firstRoundDone;
    c.startedBalls = new Set(this.startedBalls);
    c.profiles = this.profiles.map((p) => ({ ...p }));
    c.sparkBall = this.sparkBall ? at(this.sparkBall) : null;
    c.sparkQueue = this.sparkQueue.map(at);
    c.sparkedThisTurn = new Set([...this.sparkedThisTurn].map(at));
    c.sparkBase = new Map([...this.sparkBase].map(([o, st]) => [at(o), { ...st }]));
    c.sparkSet = { ...this.sparkSet };
    return c;
  }

  /** Bola que golpea ahora. */
  get b(): BallState {
    return this.balls[this.turn];
  }

  /** Perfil de barras por posición en el equipo (provisional, fase 5). */
  get player() {
    return Math.floor((this.b.n - 1) / 2);
  }

  bars() {
    return CONFIG.playerBars[this.player % CONFIG.playerBars.length];
  }

  sweetSpot() {
    return this.bars().power.sweetSpot;
  }

  teamScore(team: 0 | 1) {
    return this.balls.filter((x) => x.team === team).reduce((sum, x) => sum + x.points, 0);
  }

  /** Por qué terminó el partido (válido con `stage === 'done'`). */
  endReason(): 'perfect' | 'time' | 'allIn' {
    const perfect = Math.max(this.teamScore(0), this.teamScore(1)) >= CONFIG.perfectPoints;
    return perfect ? 'perfect' : this.clock <= 0 ? 'time' : 'allIn';
  }

  // ---------- Mira ----------

  /** Mira que se usa al golpear: la que puso el jugador, sin traspasar postes (las bolas no la detienen). */
  /** Metros que va a recorrer la bola con esta mira y esta fuerza (como en `shoot`: distancia a la mira × fuerza ÷ triángulo). */
  travelDistance(aim: P, power: number) {
    const a = this.shownAim(aim);
    return Math.hypot(a.x - this.b.x, a.y - this.b.y) * (power / this.sweetSpot());
  }

  shownAim(aim: P) {
    return clampAimToPosts(this.b, aim);
  }

  /** Un metro después de la puerta 1 (salida) o la puerta/poste que sigue. */
  exactAim(): P {
    const b = this.b;
    if (b.nextGate === 1) return { x: GATES[0].x, y: GATES[0].y - 1 };
    if (b.nextGate === POLE_STEP) return { x: LAYOUT.pole.x, y: LAYOUT.pole.y };
    return { x: GATES[b.nextGate - 1].x, y: GATES[b.nextGate - 1].y };
  }

  /**
   * Mira al empezar: cerca (no exacta, para que el jugador la afine) de lo más próximo entre la puerta/poste que sigue y la
   * bola más cercana en juego. Se desvía entre 0,5 y 1,2 m en una dirección al azar.
   */
  defaultAim(): P {
    const b = this.b;
    let t = this.exactAim();
    const near = this.balls
      .filter((o) => o !== b && o !== this.sparkBall && o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall && b.nextGate !== 1)
      .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
    if (near && Math.hypot(near.x - b.x, near.y - b.y) < Math.hypot(t.x - b.x, t.y - b.y)) t = { x: near.x, y: near.y };
    const a = this.rng() * Math.PI * 2, r = 0.5 + this.rng() * 0.7;
    return {
      x: clamp(t.x + Math.cos(a) * r, -1, COURT_W + 1),
      y: clamp(t.y + Math.sin(a) * r, -1, COURT_H + 1),
    };
  }

  /** Dónde queda la bola tocada para el spark: pegada a la que golpea, del lado de la mira. */
  sparkSpot(aim: P): P {
    const b = this.b;
    const a = this.shownAim(aim);
    const dx = a.x - b.x, dy = a.y - b.y;
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : 0, uy = d > 1e-6 ? dy / d : -1;
    return { x: b.x + ux * 2 * CONFIG.ballRadiusM, y: b.y + uy * 2 * CONFIG.ballRadiusM };
  }

  /** Mientras se apunta un spark, la bola tocada sigue a la mira. */
  placeSparkBall(aim: P) {
    if (!this.sparkBall) return;
    const spot = this.sparkSpot(aim);
    this.sparkBall.x = spot.x;
    this.sparkBall.y = spot.y;
  }

  // ---------- Turnos ----------

  /** Empieza el turno de la bola `idx`: si aún no pasó la puerta 1, sale desde el área de salida. */
  beginTurn(idx: number) {
    this.turn = idx;
    this.owed = 0;
    this.strokesInTurn = 0;
    this.sparkBall = null;
    this.sparkQueue = [];
    this.sparkedThisTurn.clear();
    this.stage = 'ready';
    const b = this.b;
    if (b.nextGate === 1) Object.assign(b, startBall()); // sale desde el área de salida
  }

  /** Juego perfecto: un equipo llegó a 25 puntos. */
  checkPerfect() {
    const red = this.teamScore(0), white = this.teamScore(1);
    if (red >= CONFIG.perfectPoints || white >= CONFIG.perfectPoints) this.ending = true;
    if (white >= CONFIG.perfectPoints && this.b.team === 1) this.endNow = true;
  }

  /**
   * Cada cuadro: corre el reloj (solo si `clockRunning`: el reloj se detiene mientras el jugador mide y calcula, y corre cuando la
   * bola se mueve o juega la CPU) y revisa el juego perfecto.
   */
  update(dt: number, clockRunning: boolean) {
    if (this.stage === 'done') return;
    if (!this.ending && clockRunning) {
      this.clock = Math.max(0, this.clock - dt * CONFIG.clockFactor);
      if (this.clock === 0) this.ending = true;
    }
    this.checkPerfect();
  }

  private endTurn(): Transition {
    this.checkPerfect();
    if (this.endNow) return this.finish();
    if (this.ending) {
      // Fin del partido: siempre con una bola blanca. Si terminan los golpes de una blanca, se acaba; si terminan los de una
      // roja, juega la blanca que sigue (si no está fuera ni en meta; si no, se acaba, Art. 7 cl. 4).
      if (this.b.team === 1) return this.finish();
      const next = (this.turn + 1) % BALLS;
      const nb = this.balls[next];
      if (nb.team === 1 && nb.nextGate !== FINISHED && !nb.outBall) { this.beginTurn(next); this.noteTurnStart(next); return 'turn'; }
      return this.finish();
    }
    for (let i = 1; i <= BALLS; i++) {
      const idx = (this.turn + i) % BALLS;
      if (this.balls[idx].nextGate !== FINISHED) {
        this.beginTurn(idx);
        this.noteTurnStart(idx);
        return 'turn';
      }
    }
    return this.finish(); // todas llegaron al poste
  }

  private finish(): Transition {
    this.stage = 'done';
    return 'end';
  }

  /** Golpe continuo (Art. 12 cl. 3): un golpe más con la misma bola. */
  private continueTurn(): Transition {
    if (this.endNow) return this.endTurn();
    this.stage = 'ready';
    return 'continue';
  }

  /** Empieza el spark de la primera bola tocada; las demás van después. */
  private startSpark(queue: BallState[]): Transition {
    if (this.endNow) return this.endTurn();
    this.sparkBall = queue[0];
    this.sparkQueue = queue.slice(1);
    this.snapshotForSpark();
    this.stage = 'ready';
    return 'spark';
  }

  private snapshotForSpark() {
    this.sparkBase = new Map(this.balls.map((o) => [o, { x: o.x, y: o.y, nextGate: o.nextGate, points: o.points, outBall: o.outBall }]));
  }

  /** Tras mostrar la resolución: pasa al turno siguiente, al golpe continuo, al spark o al final del partido. */
  proceed(): Transition {
    const r = this.resolution;
    if (!r) return this.stage === 'done' ? 'end' : 'continue';
    this.resolution = null;
    if (r.next === 'continue') return this.continueTurn();
    if (r.next === 'spark') return this.startSpark(r.touches.map((i) => this.balls[i]));
    return this.endTurn();
  }

  // ---------- Golpe ----------

  /**
   * Golpea con la mira `aim` (la real; se limita contra los postes), la fuerza y el rumbo fijados en las barras (0-1).
   * En el triángulo de fuerza la bola llega a la mira; en el de rumbo va directa. En un spark la que golpea no se mueve
   * (el pie la sujeta): la fuerza y el rumbo van a la bola tocada. Devuelve la resolución si el golpe es falta de inmediato
   * (bola tocada en el campo exterior); si no, null y hay que llamar a `step`.
   */
  shoot(aim: P, power: number, acc: number): Resolution | null {
    const b = this.b;
    const o = this.sparkBall;
    if (o) {
      const spot = this.sparkSpot(aim);
      o.x = spot.x;
      o.y = spot.y;
      o.vx = 0;
      o.vy = 0;
      this.sparkSet = spot;
      if (leftInnerField(spot)) return this.sparkFoul('outside', true); // golpear con la bola tocada en el campo exterior es falta (Art. 16 cl. 4)
    } else if (this.owed > 0) {
      this.owed--;
    }
    this.cues?.push({ type: 'strike', v: Math.min(1, power / Math.max(0.01, this.sweetSpot()) / 1.5) });
    const shown = this.shownAim(aim);
    const dx = shown.x - b.x;
    const dy = shown.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    // La barra se mide contra el triángulo del jugador: en el triángulo la bola llega a la mira.
    const target = d * (power / this.sweetSpot());
    const v = speedForDistance(target);
    // Puntería: en el triángulo la bola va directa; hacia un lado o el otro se desvía a la izquierda/derecha.
    const angle = (((acc - this.bars().accuracy.sweetSpot) * 2) * CONFIG.accuracyMaxAngleDeg * Math.PI) / 180;
    const ux = dx / d, uy = dy / d;
    const mover = o ?? b;
    mover.vx = (ux * Math.cos(angle) - uy * Math.sin(angle)) * v; // giro horario en pantalla = a la derecha
    mover.vy = (ux * Math.sin(angle) + uy * Math.cos(angle)) * v;
    this.lastRest = { x: b.x, y: b.y };
    this.shotFromOut = b.outBall;
    this.shotGate = 0;
    this.shotScore = null;
    this.touched.clear();
    this.invalid.clear();
    this.strokeFromStart = !o && b.nextGate === 1;
    this.ghostSet = new Set(
      this.strokeFromStart
        ? this.balls.filter((x) => x !== b && x.nextGate >= 2 && x.nextGate <= POLE_STEP && !x.outBall && obstructsGateOne(b, x))
        : [],
    );
    this.snapshot = new Map(this.balls.map((x) => [x, { x: x.x, y: x.y }]));
    this.strokerOut = false;
    this.foul = null;
    this.side = [];
    this.noTouchShown = false;
    this.shots++;
    this.strokesInTurn++;
    this.stage = 'rolling';
    return null;
  }

  /**
   * Bola fantasma (transparente, sin choque): estorba a la bola que golpea para pasar la puerta 1 (está en su ángulo de tiro o
   * pegada a la puerta) y esa bola aún no la pasó. Al apuntar se calcula en vivo; al golpear queda fijo hasta que termine el golpe.
   */
  isGhost(o: BallState) {
    const s = this.b;
    if (o === s || this.stage === 'done' || s.nextGate !== 1) return false;
    if (this.stage === 'rolling') return this.ghostSet.has(o);
    return o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall && obstructsGateOne(s, o);
  }

  /** Bolas que se mueven y chocan: la que golpea y las demás que están en juego dentro de la cancha (salvo las fantasma). */
  private collisionSet(): BallState[] {
    const s = this.b;
    return this.balls.filter((o) => {
      if (o === s) return !this.strokerOut && o.nextGate !== FINISHED;
      return o.nextGate >= 2 && o.nextGate <= POLE_STEP && !o.outBall && !this.isGhost(o);
    });
  }

  /** Avanza la física `dt` segundos. Devuelve true si el golpe terminó (todas quietas): entonces `resolution` está lista. */
  step(dt: number): boolean {
    if (this.stage !== 'rolling') return false;
    const movers = this.collisionSet();
    const prev = movers.map((o) => ({ x: o.x, y: o.y }));
    const pinned = this.sparkBall ? { x: this.b.x, y: this.b.y } : null;
    const cues = this.cues;
    const fx: PhysicsFx | undefined = cues
      ? {
          onBall: (_i, _j, v) => cues.push({ type: 'ball', v: v / 6 }),
          onPost: (_i, k, v) => cues.push({ type: k === POSTS.length - 1 ? 'pole' : 'gatePost', v: v / 5 }),
        }
      : undefined;
    const hits = stepAll(movers, dt, POSTS, this.rng, fx);
    if (pinned) Object.assign(this.b, pinned, { vx: 0, vy: 0 }); // en el spark la bola que golpea queda fija
    for (const [i, j] of hits) this.onHit(movers[i], movers[j]);
    movers.forEach((o, k) => this.ballEvents(o, prev[k], { x: o.x, y: o.y }));
    if (this.collisionSet().every((o) => speed(o) === 0)) {
      this.finishStroke();
      return true;
    }
    return false;
  }

  /** Detiene todas las bolas y resuelve el golpe (para simulaciones con tope de tiempo). */
  forceStop() {
    if (this.stage !== 'rolling') return;
    for (const o of this.balls) { o.vx = 0; o.vy = 0; }
    this.finishStroke();
  }

  /** Contacto entre dos bolas: touch, movimiento inválido o falta, según la bola que golpea. */
  private onHit(a: BallState, c: BallState) {
    const s = this.b;
    if (this.sparkBall) return; // en el spark todos los movimientos son válidos (Art. 16 cl. 1)
    if (a !== s && c !== s) {
      // Choque entre bolas ajenas: si una se movió por un movimiento inválido, la otra también.
      if (this.invalid.has(a) || this.invalid.has(c)) {
        this.invalid.add(a);
        this.invalid.add(c);
      }
      return;
    }
    const o = a === s ? c : a;
    if (this.invalid.has(o)) return;
    if (this.shotFromOut || this.sparkedThisTurn.has(o)) {
      // Golpe de bola fuera que toca otra bola (Art. 17 cl. 4) o tocar dos veces la misma bola (Art. 15 cl. 4): falta.
      // La bola movida vuelve y la que golpea queda fuera.
      this.invalid.add(o);
      this.foul = this.shotFromOut ? 'touchedOther' : 'touchedTwice';
      if (!this.strokerOut) {
        const spot = nearestOutSpot(s);
        s.vx = 0;
        s.vy = 0;
        s.x = spot.x;
        s.y = spot.y;
        this.strokerOut = true;
      }
    } else if (s.nextGate === 1) {
      this.invalid.add(o); // sin pasar la puerta 1 no se mueve a otras bolas (Art. 11 cl. 2); las que estorban son fantasma (`isGhost`)
    } else if (this.strokeFromStart) {
      // Pasó la puerta 1 en este mismo tiro de salida y toca una bola: las bolas siguen su movimiento, sin touch ni spark;
      // el jugador gana el golpe continuo por la puerta y juega desde donde quedó.
      if (!this.noTouchShown) { this.noTouchShown = true; this.side.push({ type: 'noTouch' }); }
    } else if (s.nextGate !== FINISHED) {
      this.touched.add(o);
    }
  }

  /** Puertas, poste y salida de la cancha de una bola que se movió de prev a cur. */
  private ballEvents(o: BallState, prev: P, cur: P) {
    if (this.invalid.has(o)) return; // movimiento inválido: no puntúa ni sale, vuelve a su sitio al final
    const isStroker = o === this.b;

    // Solo cuenta la puerta que toca, en su dirección; la siguiente se habilita después.
    // Un golpe de bola fuera no puntúa (Art. 13 cl. 1 y Art. 14).
    if (!o.outBall && !(isStroker && this.shotFromOut)) {
      if (o.nextGate <= GATES.length && crossedGate(GATES[o.nextGate - 1], prev, cur)) {
        o.points += CONFIG.gatePoints;
        this.cues?.push({ type: 'gate', v: 1 });
        const ev: MatchEvent = { type: 'gate', ball: o.n, gate: o.nextGate, stroker: isStroker };
        if (isStroker) {
          this.shotGate = o.nextGate;
          this.shotScore = ev;
        } else {
          this.side.push(ev);
        }
        o.nextGate++;
      } else if (o.nextGate === POLE_STEP && touchingPole(cur)) {
        o.points += CONFIG.polePoints;
        this.cues?.push({ type: 'agari', v: 1 });
        o.nextGate = FINISHED; // llegó al poste: la bola sale del campo
        o.vx = 0;
        o.vy = 0;
        const ev: MatchEvent = { type: 'pole', ball: o.n, stroker: isStroker };
        if (isStroker) this.shotScore = ev;
        else this.side.push(ev);
      }
    }

    // Salió por completo de la cancha interior (la bola que sale del área de salida empieza fuera).
    if (o.nextGate !== FINISHED && !leftInnerField(prev) && leftInnerField(cur)) {
      const spot = outBallSpot(prev, cur);
      this.cues?.push({ type: 'out', v: 1 });
      o.vx = 0;
      o.vy = 0;
      o.x = spot.x;
      o.y = spot.y;
      if (isStroker) this.strokerOut = true;
      else {
        o.outBall = true;
        this.side.push({ type: 'out', ball: o.n });
      }
    }
  }

  /** Todas las bolas se detuvieron: las de movimientos inválidos vuelven a su sitio y se resuelve el golpe. */
  private finishStroke() {
    for (const o of this.invalid) {
      const p = this.snapshot.get(o);
      if (p) {
        o.x = p.x;
        o.y = p.y;
      }
      o.vx = 0;
      o.vy = 0;
    }
    if (this.sparkBall) this.resolveSpark();
    else this.resolveStroke(this.strokerOut);
  }

  private resolved(r: Resolution): Resolution {
    this.resolution = r;
    this.stage = 'resolved';
    return r;
  }

  /** Bolas tocadas por este golpe que cuentan: touch válido si la bola ya estaba en juego y todas quedan en la cancha. */
  private validTouches(): BallState[] {
    return [...this.touched].filter((o) => !this.invalid.has(o) && !o.outBall && o.nextGate >= 2 && o.nextGate <= POLE_STEP);
  }

  /** El golpe normal terminó: decide los eventos y si el turno sigue (golpe continuo, spark) o pasa a la siguiente bola. */
  private resolveStroke(out: boolean) {
    const b = this.b;
    const events: MatchEvent[] = [...this.side];
    let next: Resolution['next'] = 'turn';
    let touches: number[] = [];

    if (b.nextGate === FINISHED) {
      if (this.shotScore) events.push(this.shotScore); // llegó al poste: la bola sale del campo
    } else if (out) {
      if (b.nextGate === 1) {
        events.push({ type: 'strokerOut', start: true, gate: 0, foul: null }); // no pasó la puerta 1: la bola se retira
      } else {
        // Bola fuera: conserva lo que ganó en este golpe y se juega desde el punto de salida.
        b.outBall = true;
        events.push({ type: 'strokerOut', start: false, gate: this.shotGate, foul: this.foul });
      }
    } else if (this.shotFromOut) {
      if (!leftInnerField(b)) {
        b.outBall = false;
        events.push({ type: 'backInPlay' });
      } else {
        // No entró a la cancha: vuelve a donde estaba antes del golpe y pierde el turno.
        b.x = this.lastRest.x;
        b.y = this.lastRest.y;
        events.push({ type: 'ballOut' });
      }
    } else if (b.nextGate === 1) {
      events.push({ type: 'failGate1' }); // la puerta 1 se pasa de un solo golpe; si falla, vuelve a salir
    } else {
      if (this.shotScore) events.push(this.shotScore);
      const valid = this.validTouches();
      if (valid.length) {
        // Touch (Art. 15): gana el derecho a spark, que va antes que el golpe continuo (Art. 15 cl. 3).
        touches = valid.map((o) => this.balls.indexOf(o));
        events.push({ type: 'touch', balls: valid.map((o) => o.n) });
        this.sparkBonus = this.shotGate ? 2 : 1; // touch + puerta en el mismo golpe: dos golpes tras el spark
        next = 'spark';
      } else if (this.shotGate || this.owed > 0) {
        // Pasó una puerta y quedó en juego: gana un golpe continuo (Art. 12 cl. 3). Se gana con cada golpe que pase
        // una puerta, así que se puede encadenar; un mismo golpe que pase varias puertas da un solo golpe extra.
        next = 'continue';
      }
    }

    if (b.nextGate === 1) Object.assign(b, startBall()); // sin puerta 1, la bola vuelve al área de salida
    this.resolved({ kind: 'stroke', events, next, touches, strokerOut: this.strokerOut, foul: this.foul, shotGate: this.shotGate });
  }

  /** Falta de spark (Art. 16 cl. 4): todo vuelve a como estaba; la bola tocada, a donde se colocó (o donde quedó tras el touch si estaba
   *  fuera); la bola que golpea queda fuera desde donde quedó tras el touch. */
  private sparkFoul(reason: 'short' | 'outside', outside: boolean): Resolution {
    const b = this.b;
    const o = this.sparkBall!;
    for (const [ball, st] of this.sparkBase) {
      Object.assign(ball, st);
      ball.vx = 0;
      ball.vy = 0;
    }
    if (!outside) {
      o.x = this.sparkSet.x;
      o.y = this.sparkSet.y;
    }
    const spot = nearestOutSpot(b);
    b.x = spot.x;
    b.y = spot.y;
    b.outBall = true;
    this.sparkBall = null;
    this.sparkQueue = [];
    return this.resolved({ kind: 'sparkFoul', events: [{ type: 'sparkFoul', reason }], next: 'turn', touches: [], strokerOut: true, foul: null, shotGate: 0 });
  }

  /** El spark terminó: éxito si la bola golpeada queda a ≥10 cm, llega al poste o sale (Art. 16 cl. 3). */
  private resolveSpark() {
    const b = this.b;
    const o = this.sparkBall!;
    const gap = Math.hypot(o.x - b.x, o.y - b.y) - 2 * CONFIG.ballRadiusM;
    if (!(o.nextGate === FINISHED || o.outBall || gap >= CONFIG.sparkMinGapM)) {
      this.sparkFoul('short', false);
      return;
    }
    const events: MatchEvent[] = [{ type: 'spark' }, ...this.side];
    this.sparkedThisTurn.add(o);
    this.sparkBall = null;
    let next: Resolution['next'] = 'turn';
    let touches: number[] = [];
    if (b.nextGate === FINISHED) {
      if (this.shotScore) events.push(this.shotScore);
    } else if (this.strokerOut) {
      b.outBall = true;
      events.push({ type: 'ballOut' });
    } else if (this.sparkQueue.length) {
      const rest = this.sparkQueue;
      touches = rest.map((x) => this.balls.indexOf(x));
      next = 'spark';
    } else {
      this.owed += this.sparkBonus; // un spark exitoso (o varios) da un golpe más; con puerta en el mismo golpe del touch, dos
      next = 'continue';
    }
    this.resolved({ kind: 'spark', events, next, touches, strokerOut: this.strokerOut, foul: null, shotGate: this.shotGate });
  }
}
