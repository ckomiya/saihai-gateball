import { CONFIG, LAYOUT } from '../config';
import { ErrorBase, errorsAt, scaleError, touchProbability } from './certainty';
import { distTo, reach } from './cpu';
import { BallState, Match, inPlay } from './match';
import { OPENING_SITES, OpeningSite } from './openings';
import { EXIT_STOPS, touchThreat } from './threat';

/**
 * Libro de aperturas de la primera vuelta (Chris, 2026-10-22): reglas del kantoku, no algo que se entrene (la ventaja de la línea solo aparece contra personas).
 *  - Roja 1: pasa la puerta 1 y, con el golpe continuo, se coloca pegada a la línea cerca de la puerta 2 (sitio `red1` de `openings.ts`).
 *  - Blanca 2, con variedad para que no sea predecible: esperar (no pasar la puerta 1) ~50 %, ocupar el sitio de la línea (`whiteLine`) ~35 %, ir frente a la puerta 3 (`gate3`) ~15 %.
 *    Se adapta a dónde quedó la roja 1: si desde donde quedó puede hacer touch al sitio de la línea con probabilidad alta, o ya está junto a un sitio, ese sitio se descarta.
 *  - Otra blanca (4, 6, 8, 10): si el sitio de la línea (o el de la puerta 3) sigue libre, puede ocuparlo (más probable el de la línea); así, si la 2 esperó, otra blanca toma el sitio.
 *  - Una oportunidad clara de ataque (una rival a tiro de la salida de la puerta 1: pasar la puerta y tocar con el golpe continuo, `continuation.test.ts`) tiene prioridad: no se sigue la apertura.
 * Las de las blancas solo contra un rival humano (`rivalIsHuman`, como en el juego); la de la roja 1 siempre (CPU contra CPU, 200 partidos: de 12 a 53 victorias como rojas).
 * Solo en la primera vuelta (`!firstRoundDone`) y con el cerebro del kantoku (`legacyOpenings: true` en el archivo de pesos la apaga, para comparar). Se aplica al equipo que juegue la CPU, rojas o blancas.
 */

export const OPENING_WEIGHTS = { wait: 0.5, whiteLine: 0.35, gate3: 0.15 }; // blanca 2
export const OPENING_LATER = { whiteLine: 0.5, gate3: 0.25 }; // blancas siguientes si el sitio sigue libre (el resto: juega el planificador)
const WAIT_AIM = { x: 20.5, y: 15.5 }; // golpe que no pasa la puerta 1: la bola vuelve a la salida (lo que elige el v3 cuando espera)
const SPOT_REACH = 1.6; // un sitio está «ocupado» si una bola en juego está a menos de esto de su centro
const THREAT_LIMIT = 0.7; // si la roja 1 puede tocar el sitio con más probabilidad que esta, se descarta
/**
 * Mayor probabilidad con que una rival (en juego, o que aún no pasa la puerta 1 y la pasa para tocar con el golpe continuo, `touchThreat`) toca una bola puesta en `site`, con el error de un buen jugador humano.
 * Chris (2026-10-23): la blanca 4 en el sitio de la línea de la derecha (26 % por cada roja que falta por salir) fue sacada por la roja 5 que pasó la puerta 1. El sitio de la roja 1, junto a la puerta 2, expone 12 %.
 */
export function siteExposure(m: Match, site: { x: number; y: number }, err: ErrorBase, team: number): number {
  let worst = 0;
  for (const r of m.balls) {
    if (r.team === team || r.outBall || r.nextGate > 4) continue;
    worst = Math.max(worst, touchThreat(r, site, err));
  }
  return worst;
}
export const SITE_EXPOSURE_LIMIT = 0.2; // el sitio de la línea de la derecha (≈ 26 %) no se ocupa
export type OpeningKind = 'red1' | 'whiteLine' | 'gate3' | 'wait';

/** Dónde se queda la bola tras el golpe de la puerta 1, para llegar al sitio con el golpe continuo. */
const STOP_AFTER_GATE: Record<'red1' | 'whiteLine' | 'gate3', { x: number; y: number }> = {
  red1: { x: LAYOUT.gates[0].x, y: 3 },
  whiteLine: { x: LAYOUT.gates[0].x, y: 4 },
  gate3: { x: LAYOUT.gates[0].x, y: 9 },
};

interface OpeningState { turnStarts: number; ball: number; kind: OpeningKind; stage: 'pass' | 'site'; target: { x: number; y: number } }
const states = new WeakMap<Match, OpeningState>();

export interface OpeningOptions { only?: 'red' | 'white' | 'white2'; anyRival?: boolean; errors?: { base: ErrorBase; planningScale?: number; rivalIsHuman?: boolean } }

/** Un punto dentro del sitio (sobre la línea): variedad en dónde queda la bola. */
function pointIn(site: OpeningSite, rnd: () => number, onLine: boolean) {
  if (onLine) return { x: site.x + (rnd() * 2 - 1) * site.r * 0.8, y: Math.min(0.75, Math.max(0.4, site.y + (rnd() * 2 - 1) * 0.2)) }; // pegada a la línea
  const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * site.r * 0.8;
  return { x: site.x + Math.cos(a) * d, y: site.y + Math.sin(a) * d };
}

const occupied = (balls: BallState[], site: OpeningSite, except: BallState) => balls.some((b) => b !== except && inPlay(b) && distTo(b, site) <= SPOT_REACH);
/**
 * Sitio bloqueado por CUALQUIER bola (v1.4, Chris, turno 4 de la partida 20261027-205516: la blanca 4 fue a la apertura frente al 3.er arco y la roja 3 ya estaba a 1,9 m, justo fuera del radio de 1,6 m): hay una bola en juego a menos de
 * `SPOT_REACH` + `SPOT_MARGIN` del sitio, o una rival (en juego o que aún pasa la puerta 1 y ataca con el golpe continuo) lo toca con más de `THREAT_LIMIT`. `anyRival` en falso (`legacyOpeningRivals`) deja solo lo de antes.
 */
const SPOT_MARGIN = 0.8;
const siteBlocked = (m: Match, site: OpeningSite, err: ErrorBase, except: BallState) =>
  m.balls.some((o) => o !== except && inPlay(o) && distTo(o, site) <= SPOT_REACH + SPOT_MARGIN) || m.balls.some((o) => o.team !== except.team && !o.outBall && o.nextGate <= 4 && touchThreat(o, site, err) > THREAT_LIMIT);

/** ¿Hay una rival a tiro de la salida de la puerta 1 (pasar y tocarla con el golpe continuo)? Si sí, el ataque tiene prioridad sobre la apertura. */
export function clearAttack(m: Match, o: OpeningOptions): boolean {
  if (!o.errors) return false;
  const b = m.b;
  const g1 = LAYOUT.gates[0];
  for (const r of m.balls) {
    if (r.team === b.team || !inPlay(r)) continue;
    for (const s of EXIT_STOPS) {
      const stop = { x: g1.x, y: g1.y - s };
      const d = distTo(stop, r);
      if (d < 0.5 || d > 8 || !reach(stop, r)) continue;
      const p = touchProbability(errorsAt(scaleError(o.errors.base, o.errors.planningScale ?? 1), m.profiles[m.turn], d), d, true);
      if (p >= CONFIG.kantokuOpeningAttackP) return true;
    }
  }
  return false;
}

/** Sorteo entre opciones con pesos (los pesos 0 no salen). Sin pesos positivos: null. */
function draw(weights: [OpeningKind, number][], rnd: () => number): OpeningKind | null {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let x = rnd() * total;
  for (const [k, w] of weights) { if (x < w) return k; x -= w; }
  return weights[weights.length - 1][0];
}

/**
 * Golpe de la apertura para la bola que juega, o null si no corresponde (el planificador decide). Se llama en cada golpe de la CPU: en el primer golpe de la bola (en la salida) elige la apertura;
 * en el golpe continuo tras pasar la puerta 1 lleva la bola al sitio.
 */
export function openingAim(m: Match, o: OpeningOptions = {}): { aim: { x: number; y: number }; kind: OpeningKind } | null {
  if (m.firstRoundDone || m.sparkBall) return null;
  const b = m.b;
  const st = states.get(m);
  if (st && st.turnStarts === m.turnStarts && st.ball === b.n) {
    // segundo golpe: ya pasó la puerta 1 en este turno, la lleva al sitio
    if (b.nextGate >= 2) { states.delete(m); return b.outBall || st.kind === 'wait' ? null : { aim: st.target, kind: st.kind }; }
    // el mismo golpe pedido otra vez: la misma decisión
    if (b.nextGate === 1 && !b.outBall) return st.kind === 'wait' ? { aim: WAIT_AIM, kind: 'wait' } : { aim: { ...STOP_AFTER_GATE[st.kind] }, kind: st.kind };
    return null;
  }
  states.delete(m);
  if (b.nextGate !== 1 || b.outBall) return null;
  if (clearAttack(m, o)) return null;
  const rnd = m.rng;
  const red1 = m.balls[0];
  const humanRival = !!o.errors?.rivalIsHuman;
  const anyRival = o.anyRival !== false;
  const rivalErr: ErrorBase = humanRival ? CONFIG.humanRivalError : scaleError(o.errors?.base ?? CONFIG.kantokuBaseError, o.errors?.planningScale ?? 1);
  let kind: OpeningKind | null = null;
  if (o.only === 'red' && b.team === 1) return null;
  if (o.only === 'white' && b.team === 0) return null;
  if (o.only === 'white2' && (b.team === 0 || b.n !== 2)) return null;
  // La primera bola en juego de la partida (ninguna otra bola, de ningún equipo, ha pasado la puerta 1) toma la apertura de la roja 1: pegada a la línea cerca de la puerta 2, con pase en diagonal (Chris, 2026-10-26: la
  // roja 1, la blanca 2 y la roja 3 fallaron la puerta 1 y la blanca 4, la primera en juego, se fue a la puerta 3). Es lo que haría un kantoku real, sea cual sea el número de la bola. Las blancas, solo contra un humano.
  const firstInPlay = !m.balls.some((o) => o !== b && inPlay(o)) && (b.team === 0 || humanRival);
  if (firstInPlay) {
    const site = OPENING_SITES.red1;
    if (!occupied(m.balls, site, b)) kind = 'red1';
  } else if (b.team === 0) {
    // rojas: solo la roja 1 tiene apertura
    if (b.n !== 1) return null;
    kind = 'red1';
  } else {
    // Las opciones de las blancas (sitio de la línea, puerta 3) son para jugar contra personas: la línea solo protege contra ellas. Contra una CPU certera (`rivalIsHuman` falso) pierden mucho
    // (CPU contra CPU, 200 partidos: de 74 a 24 victorias como blancas), así que ahí juega el planificador.
    if (!humanRival) return null;
    const line = OPENING_SITES.whiteLine, g3 = OPENING_SITES.gate3;
    const r1Passed = inPlay(red1);
    // adaptación a la roja 1: descarta el sitio que puede tocar con probabilidad alta o junto al que está
    const lineOk = !(anyRival && siteBlocked(m, line, rivalErr, b)) && !occupied(m.balls, line, b) && !(r1Passed && touchThreat(red1, line, rivalErr) > THREAT_LIMIT) && siteExposure(m, line, rivalErr, b.team) <= SITE_EXPOSURE_LIMIT;
    const g3Ok = !(anyRival && siteBlocked(m, g3, rivalErr, b)) && !occupied(m.balls, g3, b) && !(r1Passed && distTo(red1, g3) < SPOT_REACH + 0.4);
    if (b.n === 2) {
      // Esperar solo tiene sentido si hay una rival en juego que obligue a pensar la posición; con la roja 1 fuera de juego (falló la puerta 1) esperar regala la oportunidad de pasar (Chris, 2026-10-23)
      const rivalInPlay = m.balls.some((o) => o.team !== b.team && inPlay(o));
      // Sin ninguna rival en juego (la roja 1 falló) la blanca 2 juega como la apertura de la roja 1: junto a la línea cerca de la puerta 2, con pase en diagonal (Chris, 2026-10-23: no debe irse a la puerta 3)
      kind = rivalInPlay
        ? draw([['wait', OPENING_WEIGHTS.wait], ['whiteLine', lineOk ? OPENING_WEIGHTS.whiteLine : 0], ['gate3', g3Ok ? OPENING_WEIGHTS.gate3 : 0], ['plan' as OpeningKind, lineOk ? 0 : OPENING_WEIGHTS.whiteLine]], rnd) // sitio de la línea descartado: juega el planificador
        : 'whiteLine';
    } else {
      // otra blanca: si el sitio sigue libre puede ocuparlo; si no, juega el planificador
      const pick = draw([['wait', 1 - OPENING_LATER.whiteLine - OPENING_LATER.gate3], ['whiteLine', lineOk ? OPENING_LATER.whiteLine : 0], ['gate3', g3Ok ? OPENING_LATER.gate3 : 0]], rnd);
      kind = pick === 'wait' ? null : pick;
    }
  }
  // Si la roja 1 no ocupó su sitio (no pasó la puerta 1, o quedó en otro lado) y nada lo amenaza, la blanca que iba a la línea toma ESE sitio: pegada a la línea cerca de la puerta 2, con pase en diagonal
  // (Chris, 2026-10-23: la roja 1 falló la puerta 1 y la blanca 2 se fue a x ≈ 17 en vez de a la línea junto a la puerta 2).
  const noLine = (kind as string) === 'plan'; // el sitio de la línea está expuesto: solo se usa el de la roja 1 si está libre
  if (kind === 'whiteLine' || noLine) {
    const r = OPENING_SITES.red1;
    const free = !(anyRival && siteBlocked(m, r, rivalErr, b)) && !occupied(m.balls, r, b) && !(inPlay(red1) && touchThreat(red1, r, rivalErr) > THREAT_LIMIT);
    if (free) kind = 'red1';
    else if (noLine) return null;
  }
  if (!kind) return null;
  const target = kind === 'wait' ? WAIT_AIM : pointIn(OPENING_SITES[kind], rnd, kind !== 'gate3');
  states.set(m, { turnStarts: m.turnStarts, ball: b.n, kind, stage: kind === 'wait' ? 'pass' : 'site', target });
  if (kind === 'wait') return { aim: WAIT_AIM, kind };
  return { aim: { x: STOP_AFTER_GATE[kind].x, y: STOP_AFTER_GATE[kind].y }, kind };
}
