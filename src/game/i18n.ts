import type { Decision } from './cpu';
import type { Explanation, ShotExplanation } from './cpuPlanner';

/** Idioma de los textos que Saihai entrega al exterior (mensajes de los eventos, explicación de las decisiones). `'es'` es el predeterminado y da exactamente lo mismo que las versiones anteriores a 1.4.2. */
export type Lang = 'es' | 'en';
export const DEFAULT_LANG: Lang = 'es';

/** Valida el idioma recibido de quien llama (JS sin tipos incluido): rechaza lo que no sea 'es' o 'en' en vez de caer en silencio al español. */
export function checkLang(lang: unknown = DEFAULT_LANG): Lang {
  if (lang === 'es' || lang === 'en') return lang;
  throw new RangeError(`Saihai: unsupported lang ${JSON.stringify(lang)} (use 'es' or 'en') / idioma no soportado`);
}

// ---------- Decisiones (`Shot.plan.decision`) ----------
// Internamente los identificadores de la decisión siguen en español (los scripts de auditoría y los registros de partidas los usan como claves).
// Al salir por la API pública con `lang: 'en'` se traducen aquí; con `'es'` no se toca nada.

const SOURCE: Record<Decision['source'], string> = { apertura: 'opening', planificador: 'planner', simple: 'simple', 'cadena final': 'last-turn chain' };

const KIND: Record<string, string> = {
  'spark propio: poste': 'spark on teammate: pole',
  'spark propio: puerta': 'spark on teammate: gate',
  'spark propio: acomodo': 'spark on teammate: positioning',
  'spark: expulsar bola rival': 'spark: knock out rival ball',
  'spark: mover bola rival': 'spark: move rival ball',
  'salida: puerta 1': 'start: gate 1',
  'salida (no pasa la puerta 1)': 'start: wait (no gate 1 attempt)',
  reentrada: 're-entry',
  'agari: poste': 'agari: pole',
  'touch a rival': 'touch on a rival',
  'touch a compañera': 'touch on a teammate',
  acomodo: 'positioning',
};

const TERM: Record<string, string> = {
  puntos: 'points', bolasFuera: 'ballsOut', propiaFuera: 'mateKnockedOut', falta: 'foul', miBolaSale: 'shooterOut', salidaPropia: 'shooterOutAfterGate',
  noEntra: 'failsToReenter', touch: 'touch', continuo: 'continuation', posicion: 'position', exposicion: 'exposure', acomodo: 'positioning',
  oportunidadTouch: 'touchOpportunity', riesgo: 'risk', agariListo: 'agariWait', juntarse: 'clustering', avanza: 'lateProgress', zona: 'entryZone',
  lineaDiagonal: 'lineSpot', preparaTurno: 'mateTurnSetup', sparkPropio: 'mateSparkValue', combinado: 'multiBenefit', apoyo: 'support', apoyoRival: 'rivalSupport',
  montonRiesgo: 'heapRisk', montonValor: 'heapValue', poste: 'pole',
};

const WHY: Record<string, string> = {
  'quedan pocos turnos a la bola': 'the ball has few turns left',
  'juego perfecto o partido decidido': 'perfect game or decided match',
  'su bola iba a ser sacada casi seguro': 'its ball was almost sure to be knocked out',
  'no había otra jugada': 'there was no other play',
  'sin excepción (revisar)': 'no exception (check)',
};

const RELEASED: Record<string, string> = { sinAlternativas: 'noAlternatives', amenaza: 'threat' };

const kindEn = (k: string) => KIND[k] ?? k.replace(/^puerta (\d)$/, 'gate $1');
const comboEn = (k: string) => k.replace('bola y bola', 'ball and ball').replace('bola y puerta', 'ball and gate').replace('puerta y bola', 'gate and ball').replace(/\((\d+) y (\d+)\)/, '($1 and $2)');

function alternativeEn(a: ShotExplanation): ShotExplanation {
  return { ...a, kind: kindEn(a.kind), terms: Object.fromEntries(Object.entries(a.terms).map(([k, v]) => [TERM[k] ?? k, v])) };
}

function explanationEn(e: Explanation): Explanation {
  const out: Explanation = {
    ...e,
    alternatives: e.alternatives.map(alternativeEn),
    risk: e.risk.map((r) => (r.combo ? { ...r, combo: { ...r.combo, kind: comboEn(r.combo.kind) } } : r)),
  };
  if (e.agari) out.agari = { ...e.agari, why: e.agari.why === null ? null : (WHY[e.agari.why] ?? e.agari.why), released: e.agari.released === null ? null : (RELEASED[e.agari.released] ?? e.agari.released) as never };
  return out;
}

/** La decisión en el idioma pedido. Devuelve una copia (no toca la original); en español devuelve la misma. */
export function decisionIn(d: Decision, lang: Lang): Decision {
  if (lang === 'es') return d;
  const out: Decision = { ...d, source: SOURCE[d.source] as Decision['source'], kind: kindEn(d.kind) };
  if (d.explanation) out.explanation = explanationEn(d.explanation);
  if (d.chain) out.chain = { ...d.chain, turn: (d.chain.turn === 'ultimo' ? 'last' : 'secondToLast') as never };
  return out;
}
