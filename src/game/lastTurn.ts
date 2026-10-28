import { CONFIG } from '../config';
import { clampAimToPosts } from './court';
import { drawShotError, errorsAt, scoreProbability, shotDistance } from './certainty';
import { applyShotError, distTo, goalOf } from './cpu';
import { candidates, FutureCtx } from './cpuPlanner';
import { FINISHED, Match, inPlay } from './match';
import { mulberry32 } from './rng';

/**
 * Último turno del partido (Chris, 2026-10-27, partida 20261027-181359, turno 62): cuando ya no queda ningún turno rival que pueda atacar, el riesgo no importa y lo único que cuenta
 * es sumar puntos. En vez del mejor golpe aislado, el planificador busca la CADENA que más puntos suma: touch a una compañera → spark por su puerta → golpe continuo → siguiente
 * compañera → … → la puerta propia. Sin Phaser.
 *
 * «Último» y «penúltimo» salen del modelo de ritmo (`pace.ts`, que ya aplica la regla de que el partido termina con una bola blanca): en el último no queda ningún turno después del
 * actual (`FutureCtx.seq` vacío); en el penúltimo quedan turnos, pero ninguno de una rival que pueda pasar su puerta o tocar (están fuera o ya llegaron al poste). En los dos el riesgo
 * del planificador ya vale 0; lo que cambia es el objetivo (la cadena de más puntos) en vez de la valoración de un solo golpe.
 */

export type EndTurn = 'ultimo' | 'penultimo';

/** ¿Este turno es el último (o el penúltimo sin rivales que puedan atacar)? null = juego normal. */
export function endTurnOf(m: Match, F: FutureCtx): EndTurn | null {
  const b = m.b;
  if (b.outBall || b.nextGate < 2 || b.nextGate >= FINISHED) return null; // salir (puerta 1) o reentrar no suma puntos: juego normal
  if (F.seq.length === 0) return 'ultimo';
  // Una rival que está fuera solo reentra en su primer turno; si le queda otro después, ya puede atacar (con todas las rojas fuera pero tiempo por delante no es el penúltimo turno)
  const turnsOf = (i: number) => F.seq.filter((x) => x === i).length;
  const canAttack = F.seq.some((i) => m.balls[i].team !== b.team && m.balls[i].nextGate !== FINISHED && (!m.balls[i].outBall || turnsOf(i) >= 2));
  return canAttack ? null : 'penultimo';
}

export interface ChainAlt { aim: { x: number; y: number }; ideal: string; h: number; value: number }
export interface ChainPlan { aim: { x: number; y: number }; value: number; nodes: number; alts: ChainAlt[] }

const ownDiff = (m: Match, team: 0 | 1) => m.teamScore(team) - m.teamScore(team === 0 ? 1 : 0);

/**
 * Busca la mejor cadena de golpes del turno actual (`m` en etapa 'ready': golpe normal, spark o golpe continuo) y devuelve la mira del primer golpe.
 * Búsqueda en haz: en cada nodo se simulan todos los candidatos del planificador sin error y se conservan los mejores (con distinto resultado); cada uno se mide con el error del
 * jugador (`samples` golpes sorteados) y, si el turno sigue, se busca la mejor continuación desde ese tablero (`Match.clone`). Valor = puntos que suma el equipo (menos los del rival)
 * en el resto del turno. Un turno que sigue al llegar al horizonte vale `kantokuLastLeafSpark` / `kantokuLastLeafCont`; en el penúltimo, además, la probabilidad de pasar la siguiente puerta.
 */
export function planChain(m: Match, F: FutureCtx, kind: EndTurn): ChainPlan | null {
  const rng = mulberry32(Math.floor(m.rng() * 2 ** 31));
  const team = m.b.team;
  let nodes = 0;
  const alts: ChainAlt[] = [];

  const terminal = (mc: Match): number => {
    if (kind !== 'penultimo') return 0;
    let v = 0;
    mc.balls.forEach((b, i) => {
      if (b.team !== team || !inPlay(b) || b.nextGate > 3) return;
      v += CONFIG.kantokuLastNextGate * scoreProbability(b, b.nextGate, errorsAt(F.base, F.profiles[i], distTo(b, goalOf(b.nextGate))), true);
    });
    return v;
  };

  /** Un golpe sobre una copia: puntos que suma y cómo sigue el turno. */
  const strike = (mc: Match, aim: { x: number; y: number }, power: number, acc: number) => {
    const before = ownDiff(mc, team);
    let res = mc.shoot(aim, power, acc);
    for (let i = 0; i < 420 && !res && mc.stage === 'rolling'; i++) if (mc.step(1 / 30)) res = mc.resolution;
    if (!res) { mc.forceStop(); res = mc.resolution!; }
    const gain = ownDiff(mc, team) - before;
    const touches = res.touches.join(',');
    const next = res.next;
    const tr = mc.proceed();
    return { gain, next, tr, touches, gate: res.shotGate };
  };

  const leaf = (tr: string) => (tr === 'spark' ? CONFIG.kantokuLastLeafSpark : tr === 'continue' ? CONFIG.kantokuLastLeafCont : 0);

  const search = (mc: Match, depth: number): { value: number; aim?: { x: number; y: number } } => {
    nodes++;
    const sp = mc.sparkBall;
    const mode = sp ? 'spark' : 'stroke';
    const pinned = sp ? mc.turn : -1;
    const si = sp ? mc.balls.indexOf(sp) : mc.turn;
    const shooter = mc.turn;
    const origin = sp ? mc.balls[pinned] : mc.balls[si];
    const bars = mc.bars();
    const ideal = { power: bars.power.sweetSpot, acc: bars.accuracy.sweetSpot };
    const list = candidates(origin, si, mc.balls, mode, pinned, false, true, true, false, true);
    // 1. todos los candidatos sin error; por clase de resultado (qué bolas toca y si pasa una puerta) se queda el de mayor valor inmediato: así la búsqueda no se llena de variantes del mismo golpe
    const ranked = new Map<string, { aim: { x: number; y: number }; h: number; what: string; gain: number; tr: string; next: Match; cls: string; alt: { x: number; y: number }[] }>();
    for (const c of list) {
      const t = mc.clone(rng);
      const r = strike(t, c.aim, ideal.power, ideal.acc);
      const h = r.gain + leaf(r.tr);
      const cls = `${r.touches}|${r.gate > 0 ? 1 : 0}`;
      const cur = ranked.get(cls);
      if (!cur || h > cur.h + 1e-9) ranked.set(cls, { aim: c.aim, h, what: `${r.tr} toca[${r.touches}] puerta${r.gate} +${r.gain}`, gain: r.gain, tr: r.tr, next: t, cls, alt: [] });
      else if (Math.abs(h - cur.h) <= 1e-9) cur.alt.push(c.aim); // misma jugada ideal con otra mira: el error decide cuál es más segura
    }
    if (!ranked.size) return { value: 0 };
    const root = depth === CONFIG.kantokuLastDepth;
    const beam = root ? CONFIG.kantokuLastBeam : CONFIG.kantokuLastBeamDeep;
    const samples = root ? CONFIG.kantokuLastSamples : CONFIG.kantokuLastSamplesDeep;
    const top = [...ranked.values()].sort((a, b) => b.h - a.h).slice(0, beam);
    // 2. los mejores se miden con el error del jugador: con probabilidad p el golpe sale como el ideal y el turno sigue desde ese tablero (se busca la continuación UNA vez); si no, vale lo que dé cada golpe fallido
    let best: { value: number; aim: { x: number; y: number } } | null = null;
    for (const c0 of top) {
      // hasta 3 variantes de mira de la misma jugada (la primera, la del medio y la última de la lista), medidas con error
      const variants = [c0.aim, ...(c0.alt.length ? [c0.alt[Math.floor(c0.alt.length / 2)], c0.alt[c0.alt.length - 1]] : [])].filter((a, i, v) => v.indexOf(a) === i);
      let follow: number | null = null;
      for (const aim of variants) {
      const c = { ...c0, aim };
      const shown = clampAimToPosts(origin, c.aim);
      const err = errorsAt(F.base, F.profiles[shooter], mode === 'spark' ? distTo(origin, shown) : shotDistance(origin, shown, mc.balls[si].nextGate));
      let same = 0, other = 0;
      for (let k = 0; k < samples; k++) {
        const e = applyShotError(c.aim, ideal, drawShotError(err, rng));
        const t = mc.clone(rng);
        const r = strike(t, e.aim, e.power, e.acc);
        if (`${r.touches}|${r.gate > 0 ? 1 : 0}` === c.cls && r.gain === c.gain) same++;
        else other += r.gain + (r.tr === 'turn' || r.tr === 'end' ? terminal(t) : leaf(r.tr));
      }
      follow ??= c.tr === 'continue' || c.tr === 'spark' ? (depth > 1 ? search(c.next, depth - 1).value : leaf(c.tr)) : terminal(c.next);
      const value = (same * (c.gain + follow) + other) / samples;
      if (root) alts.push({ aim: c.aim, ideal: c.what, h: c.h, value });
      if (!best || value > best.value) best = { value, aim: c.aim };
      }
    }
    return best!;
  };

  const r = search(m.clone(rng), CONFIG.kantokuLastDepth);
  return r.aim ? { aim: r.aim, value: r.value, nodes, alts } : null;
}
