import { CONFIG } from '../config';
import type { Phase } from './phase';

/**
 * Pesos de la valoración del planificador de la CPU (`cpuPlanner.evaluate`): cuánto vale, en gateball, cada cosa que puede pasar
 * en un golpe. Más valor = mejor para el equipo de la CPU. `handWeights` son los pesos escritos a mano (los que usa el juego hoy);
 * `cpuWeights.json` guarda los del kantoku artificial, que se entrenan por autojuego (ver TRAINING.md).
 */
export interface Weights {
  // --- Puntos ---
  point: number; // valor de un punto (puerta o poste) ganado por mi equipo; el rival lo resta
  pointLate: number; // ... cuando al reloj le quedan menos de `lateClock` segundos: puntuar vale más
  lateClock: number; // segundos de reloj que quedan para considerar «tarde» (0 = nunca: las fases del kantoku lo reemplazan)
  // --- Bolas fuera ---
  outOwn: number; // una bola mía sale de la cancha (suma, negativo): pierde un turno
  outRivalBase: number; // una bola rival sale: la frena
  outRivalPerPoint: number; // ... y más si tenía puntos
  failReenter: number; // (resta) bola fuera que no logra entrar
  shooterOutStart: number; // (resta) la que golpea sale de la cancha en el tiro de salida
  shooterOutLater: number; // (resta) la que golpea sale de la cancha después
  foul: number; // (resta) falta: tocar otra bola desde fuera, tocar dos veces la misma, spark corto
  // --- Touch y golpe continuo ---
  touchRivalBase: number; // touch a un rival: da el spark para sacarlo y un golpe más
  touchPerPoint: number; // ... más cuanto más puntos tiene el rival
  touchPole: number; // ... y si está por llegar al poste
  touchGate3: number; // ... o por pasar la puerta 3
  touchOwn: number; // touch a una bola propia: poder acomodarla con el spark
  continuation: number; // la que golpea pasó una puerta y sigue en juego: golpe continuo
  // --- Posición para la siguiente meta (pesos a mano) ---
  posGood: number; // la bola puede puntuar de un tiro directo: más cerca = mejor
  posGoodDist: number; // distancia (m) a la que ese valor llega a su mínimo
  posGoodMin: number; // fracción mínima del valor por lejos que esté
  posBadBase: number; // (resta) la bola queda mal puesta para su puerta (hay que acomodarla otra vez)
  posBadPerM: number; // (resta por metro) ... y peor cuanto más lejos
  // --- Exposición: una bola propia a la vista de un rival puede recibir un touch y salir ---
  exposure: number; // castigo base
  exposurePerPoint: number; // ... mayor si la bola expuesta tiene puntos
  exposureReach: number; // alcance (m) del rival: más allá se considera a salvo
  exposureMin: number; // probabilidad mínima de touch dentro del alcance (pesos a mano)
  exposureMax: number; // ... y máxima (pesos a mano)
  exposureLate: number; // multiplicador de la exposición cuando es tarde (pesos a mano)
  exposureContinuation: number; // multiplicador si la que golpea tiene golpe continuo (puedo corregir enseguida)

  // --- Kantoku artificial: certeza de cada jugador y momento del partido (apagado en `handWeights`) ---
  certainty: boolean; // usa los términos de abajo en lugar de la posición y la exposición a mano
  poleBonus: number; // llegar al poste (+2 y la bola sale del juego): extra por no poder ser tocada ni gastar más turnos
  posProb: number; // acomodar: probabilidad de que el dueño de la bola pase su puerta desde donde queda, según su certeza
  nextMateBonus: number; // ... con más peso (1 + esto) para el compañero que juega justo después
  exposureLater: number; // exposición: peso de los rivales que juegan más tarde, frente a 1 para el que juega justo después
  efp: number; // peso de los puntos que se esperan sumar aún con los turnos que quedan (diferencia propia − rival)
  efpNextFactor: number; // los intentos siguientes (tras fallar o tras un golpe continuo) valen este factor de un tiro típico
  // --- Kantoku v2 (iteración C): riesgo, zona y apoyo (reemplazan a la exposición y los puntos esperados) ---
  model: 1 | 2; // qué términos de certeza usa el planificador: 1 = los del campeón actual, 2 = los de la iteración C
  risk: number; // castigo por la mejor opción de las próximas bolas rivales (pasar su puerta o tocar una bola mía); la 1.ª pesa 1, la 2.ª 0,5 y la 3.ª 0,25
  riskPerPoint: number; // ... y una bola mía con puntos vale más: 1 + esto × sus puntos
  zone: number; // premio por las bolas mías dentro de su zona de entrada y sin ángulo de tiro sencillo para el rival: P(pasar) × (1 − amenaza)
  riskWeights?: number[]; // peso de la 1.ª, 2.ª, 3.ª… bola rival que va a jugar en el riesgo (por defecto [1, 0,5, 0,25], con lo que se entrenó el v2)
  advanced?: boolean; // reglas avanzadas (iteración D): amenaza como valor esperado, recogida por compañeras, ventanas por bolas fuera
  legacyTouch?: boolean; // solo para comparar: el intento de touch de antes (mira 0,3 / 1 / 2,5 m más allá y las muestras normales)
  legacyExitChain?: boolean; // solo para comparar: el riesgo sin «pasar su puerta y quedar cerca» en las puertas 2 y 3
  legacyHeap?: boolean; // solo para comparar: sin mandar una compañera al montón de rivales
  legacyHeapRisk?: boolean; // solo para comparar: el riesgo bola por bola, sin el ataque a varias bolas de un montón mío
  legacyOpenings?: boolean; // solo para comparar: sin el libro de aperturas de la primera vuelta (`opening.ts`)
  legacyAgari?: boolean; // solo para comparar: sin la regla del agari (puede ir al poste cuando quiera)
  legacyChains?: boolean; // solo para comparar: sin los tsunagi (cadenas de touches) en el riesgo ni en el acercamiento propio
  legacyChainRisk?: boolean; // solo para comparar: sin las cadenas del rival en el riesgo (pero con los puentes propios)
  legacyBridges?: boolean; // solo para comparar: sin los puentes propios (acercarse a su puerta encadenando) pero con las cadenas del rival en el riesgo
  legacyDouble?: boolean; // solo para comparar: sin descartar las jugadas que dejan una bola mía con doble ángulo para la rival que juega después
  legacyComboFront?: boolean; // solo para comparar: el doble «bola y puerta» sin el aumento cuando mi bola está delante de la puerta del rival
  legacyFailPunish?: boolean; // solo para comparar: la amenaza de un touch lejano sin restarle el castigo si el rival falla (su bola queda expuesta a mis bolas que juegan después)
  legacyCover?: boolean; // solo para comparar: la cobertura y el castigo de una compañera cuentan aunque una rival que juega antes pueda sacarla
  legacySend?: boolean; // solo para comparar: sin la amenaza de que la rival mande a marcar (touch a una compañera suya y spark junto a mi bola)
  legacyRiskRest?: boolean; // solo para comparar: del riesgo de cada rival cuenta solo su mejor opción (una bola nueva expuesta no se nota si otra ya es peor)
  legacyOwnExposure?: boolean; // solo para comparar: la bola que se acaba de mover no paga su propia exposición aparte del riesgo de la mejor opción de cada rival
  legacyReentryFail?: boolean; // solo para comparar: tirar la bola fuera otra vez desde fuera cuesta solo «mi bola sale», no «no entra»
  legacyLineCands?: boolean; // solo para comparar: la reentrada sin los candidatos pegados a la línea en otros tramos
  legacyReentryMust?: boolean; // solo para comparar: no entrar cuesta solo `failReenter`, sin `kantokuReentryMust` ni la excepción de la última vuelta ganando
  legacyLastTurn?: boolean; // solo para comparar: el último turno (y el penúltimo sin rivales que ataquen) se juega con la valoración de un golpe, sin buscar la cadena que más puntos suma (`lastTurn.ts`)
  legacySelfOut?: boolean; // solo para comparar: sacar a propósito la propia bola desde el juego cuesta solo `shooterOutLater`, sin el costo de volver a entrar (`kantokuSelfOutCost`)
  legacyJoinWindow?: boolean; // solo para comparar: juntarse cuenta la amenaza de todas las rivales, no solo la de las que juegan antes que la compañera
  legacySparkClear?: boolean; // solo para comparar: el spark a una bola rival no descarta los candidatos que mueven una bola mía y sacar una bola mía no cuesta más que `outOwn`
  legacyLateAgain?: boolean; // solo para comparar: acercarse a la puerta con pocos turnos vale entero aunque la bola casi no vuelva a jugar
  legacyLongSpot?: boolean; // solo para comparar: los golpes de acomodo largos se miden con las muestras de siempre
  legacyOpeningRivals?: boolean; // solo para comparar: la apertura solo mira a la roja 1 (no a cualquier rival cerca del sitio o que pueda alcanzarlo)
  legacyFarEntry?: boolean; // solo para comparar: la reentrada sin los candidatos de golpe largo hacia zonas lejanas de la cancha
  legacyOpenField?: boolean; // solo para comparar: sin el mayor cuidado cuando tengo pocas bolas en juego
  legacyTurnModel?: boolean; // solo para comparar: los turnos que quedan salen de un promedio de reloj por turno, no del tablero (`pace.ts`)
  legacyCombo?: boolean; // solo para comparar: el riesgo toma la mejor opción del rival, sin sus combinaciones de dos oportunidades seguidas (bola y bola, puerta y bola, bola y puerta)
  legacyMateSurvival?: boolean; // solo para comparar: la compañera sobrevive hasta su turno si falla la rival más peligrosa (antes), no si fallan todas las que juegan antes (con cadenas)
  /** Equilibrio entre puntos y ataque (v4): sube el peso de los puntos (y baja el del touch) cuanto más pierde y cuanto más avanzado va el partido; 0 = sin efecto. Ver `balanceMul`. */
  leadSlope?: number;
  clockSlope?: number;
  legacyZoneSpark?: boolean; // solo para comparar: el spark que acomoda a una compañera sin la zona de entrada (sin probarlo siempre ni eximirlo del doble ángulo)
  legacyRivalDanger?: boolean; // solo para comparar: el valor de sacar una rival sin depender de su peligro real (cerca de mis bolas o de su puerta, línea, poste)
  legacySafePoint?: boolean; // solo para comparar: sin la regla del punto seguro primero (touch lejano o dudoso contra pasar la puerta)
  legacyLateProgress?: boolean; // solo para comparar: sin el premio a acercarse a su puerta cuando a la bola le quedan pocos turnos
  legacyJoin?: boolean; // solo para comparar: sin el costo de juntarse con una rival que puede llegar al montón
  legacyLongTouch?: boolean; // solo para comparar: sin descartar los intentos de touch a una bola lejana (> `kantokuTouchMaxM`)
  legacyAttackRule?: boolean; // solo para comparar: sin la regla de ataque (pasar la puerta y atacar con rivales a tiro de la salida)
  legacyLineSpot?: boolean; // solo para comparar: sin el premio al lugar de espera pegado a la línea con ángulo a su puerta
  legacyRiskByValue?: boolean; // solo para comparar: el riesgo compara la probabilidad de pasar su puerta con la de tocar mi bola sin ponerlas en la misma escala
  legacyMateSpark?: boolean; // solo para comparar: sin valorar a dónde se lleva a una compañera con el spark (destinos de puerta, ataque y doble)
  legacyTouchPass?: boolean; // solo para comparar: el riesgo sin el «doble» del rival (tocar mi bola y, desde donde queda, pasar su puerta con el golpe extra)
  legacyThreatUnion?: boolean; // solo para comparar: la amenaza sobre cada bola mía (la zona de entrada) como el mayor de los rivales, no como la probabilidad de que alguno la toque
  // --- Reglas del kantoku v3 (se entrenan; sin valor = la constante de `config.ts`) ---
  contAttack?: number; // probabilidad estimada de que un touch + spark salga (cadena de ataques tras una puerta o un touch)
  heapRisk?: number; // peso del riesgo de que el rival entre a mi montón y saque varias bolas
  heapValue?: number; // peso del valor de mandar una compañera al montón rival
  heapSparkP?: number; // probabilidad estimada de que el spark deje la bola en el montón
  rivalSupport?: number; // peso del apoyo entre bolas rivales (restado)
  lineSpot?: number; // premio a esperar pegado a la línea con ángulo a su puerta (iteración F)
  mateWeight?: number; // peso del turno de una compañera tras el spark propio (touch a compañeras)
  passScale?: number; // escala de «pasar su puerta» del rival frente a «tocar mi bola» en el riesgo (1 = como antes; ≈ 0,14 = por valor)
  touchPass?: number; // peso del doble del rival (tocar mi bola y pasar su puerta)
  support: number; // premio por tener cerca (1-6 m, línea limpia) otra bola mía que juega pronto para encadenar touch y spark con las que aún no pasan
  // --- Simulación con error ---
  topN: number; // candidatos que se vuelven a simular
  errorSamples: number; // simulaciones con el error del jugador por candidato (0 = tiro exacto, como los pesos a mano)
}

/** Pesos a mano: los valores de siempre del planificador (iteración 10b). */
export const handWeights: Weights = {
  point: 3,
  pointLate: 4.5,
  lateClock: 150,
  outOwn: -2.2,
  outRivalBase: 1.8,
  outRivalPerPoint: 0.3,
  failReenter: 2,
  shooterOutStart: 3,
  shooterOutLater: 2.2,
  foul: 5,
  touchRivalBase: 2.2,
  touchPerPoint: 0.4,
  touchPole: 1.5,
  touchGate3: 0.6,
  touchOwn: 0.5,
  continuation: 1,
  posGood: 1.2,
  posGoodDist: 14,
  posGoodMin: 0.2,
  posBadBase: 0.3,
  posBadPerM: 0.03,
  exposure: 3.2,
  exposurePerPoint: 0.4,
  exposureReach: 13,
  exposureMin: 0.1,
  exposureMax: 0.9,
  exposureLate: 0.6,
  exposureContinuation: 0.5,
  certainty: false,
  model: 1,
  risk: 0,
  riskPerPoint: 0,
  zone: 0,
  support: 0,
  poleBonus: 0,
  posProb: 0,
  nextMateBonus: 0,
  exposureLater: 0,
  efp: 0,
  efpNextFactor: 0,
  topN: 6,
  errorSamples: 0,
};

// ---------- Pesos del kantoku: base común + multiplicadores por fase ----------

/** Términos clave: en cada fase se multiplican por un factor propio (la fase `medio` es la referencia, factor 1). */
export const KEY_TERMS = {
  exposure: ['exposure'],
  point: ['point'],
  pole: ['poleBonus', 'touchPole'],
  touchRival: ['touchRivalBase', 'touchPerPoint', 'touchGate3'],
  efp: ['efp'],
  outRival: ['outRivalBase', 'outRivalPerPoint'],
  pos: ['posProb'],
} as const satisfies Record<string, readonly (keyof Weights)[]>;
export type KeyTerm = keyof typeof KEY_TERMS;
export const KEY_TERM_NAMES = Object.keys(KEY_TERMS) as KeyTerm[];
export const MULT_PHASES = ['inicio', 'final'] as const; // `medio` = 1

/** Pesos base evolucionables, con su valor inicial (los de mano donde existen; moderados para los términos nuevos). */
const BASE_GENES = [
  'point', 'outOwn', 'outRivalBase', 'outRivalPerPoint', 'failReenter', 'shooterOutStart', 'shooterOutLater', 'foul',
  'touchRivalBase', 'touchPerPoint', 'touchPole', 'touchGate3', 'touchOwn', 'continuation', 'exposure', 'exposurePerPoint',
  'exposureLater', 'poleBonus', 'posProb', 'nextMateBonus', 'efp', 'efpNextFactor',
] as const satisfies readonly (keyof Weights)[];
export type BaseGene = (typeof BASE_GENES)[number];

const NEW_INIT: Partial<Record<BaseGene, number>> = { exposureLater: 0.5, poleBonus: 0.5, posProb: 1.5, nextMateBonus: 0.5, efp: 0.5, efpNextFactor: 0.7 };

export interface Gene { name: string; init: number; scale: number; lo: number; hi: number }

/** Todos los números del genoma, en orden: primero los pesos base y luego los multiplicadores de `inicio` y `final` de cada término clave. */
export const GENES: Gene[] = [
  ...BASE_GENES.map((name): Gene => {
    const init = NEW_INIT[name] ?? (handWeights[name] as number);
    const neg = init < 0;
    const mag = Math.abs(init);
    return { name, init, scale: Math.max(0.25, 0.5 * mag), lo: neg ? -(4 * mag + 2) : 0, hi: neg ? 0 : name === 'efpNextFactor' ? 1.5 : 4 * mag + 2 };
  }),
  ...MULT_PHASES.flatMap((ph) => KEY_TERM_NAMES.map((k): Gene => ({ name: `${ph}.${k}`, init: 1, scale: 0.5, lo: 0, hi: 4 }))),
];

export const GENOME_SIZE = GENES.length;

export interface WeightFile {
  version: 1;
  base: Record<BaseGene, number>;
  mult: Record<(typeof MULT_PHASES)[number], Record<KeyTerm, number>>;
  /** Simulaciones con error por candidato (estructura, no se entrena). */
  sims: { topN: number; errorSamples: number };
}

export const clampGene = (g: Gene, v: number) => Math.min(g.hi, Math.max(g.lo, v));

/** `sims`: candidatos que se vuelven a simular × simulaciones con error por candidato (6 × 5 mantiene el planificador cerca de 40 ms por golpe). */
export function genomeToFile(x: number[], sims = { topN: 6, errorSamples: 5 }): WeightFile {
  const v = (i: number) => clampGene(GENES[i], x[i]);
  const base = {} as Record<BaseGene, number>;
  BASE_GENES.forEach((n, i) => { base[n] = v(i); });
  const mult = { inicio: {}, final: {} } as WeightFile['mult'];
  let i = BASE_GENES.length;
  for (const ph of MULT_PHASES) for (const k of KEY_TERM_NAMES) mult[ph][k] = v(i++);
  return { version: 1, base, mult, sims };
}

export function fileToGenome(f: WeightFile): number[] {
  const x = BASE_GENES.map((n) => f.base[n]) as number[];
  for (const ph of MULT_PHASES) for (const k of KEY_TERM_NAMES) x.push(f.mult[ph][k]);
  return x;
}

/** Genoma inicial: los pesos a mano (y valores moderados para los términos nuevos). */
export const initialGenome = () => GENES.map((g) => g.init);

/** Pesos planos para una fase: la base común por el multiplicador de la fase en cada término clave. */
export function resolveWeights(f: AnyWeightFile, phase: Phase): Weights {
  if (f.version === 2) return resolveWeights2(f, phase);
  const w: Weights = { ...handWeights, ...f.base, certainty: true, lateClock: 0, topN: f.sims.topN, errorSamples: f.sims.errorSamples };
  w.pointLate = w.point;
  if (phase !== 'medio') {
    for (const k of KEY_TERM_NAMES) {
      for (const field of KEY_TERMS[k]) (w[field] as number) *= f.mult[phase][k];
    }
    w.pointLate = w.point;
  }
  return w;
}

// ---------- Kantoku v2 (iteración C) ----------

export const KEY_TERMS2 = {
  risk: ['risk'],
  zone: ['zone'],
  point: ['point'],
  touchRival: ['touchRivalBase', 'touchPerPoint', 'touchGate3'],
} as const satisfies Record<string, readonly (keyof Weights)[]>;
export type KeyTerm2 = keyof typeof KEY_TERMS2;
export const KEY_TERM2_NAMES = Object.keys(KEY_TERMS2) as KeyTerm2[];

const BASE_GENES2 = [
  'point', 'outOwn', 'outRivalBase', 'outRivalPerPoint', 'failReenter', 'shooterOutStart', 'shooterOutLater', 'foul',
  'touchRivalBase', 'touchPerPoint', 'touchPole', 'touchGate3', 'touchOwn', 'continuation',
  'risk', 'riskPerPoint', 'zone', 'support', 'posProb', 'nextMateBonus', 'poleBonus',
] as const satisfies readonly (keyof Weights)[];
export type BaseGene2 = (typeof BASE_GENES2)[number];

export interface WeightFile2 {
  version: 2;
  /** Peso de cada bola rival según el orden en que juega (por defecto [1, 0,5, 0,25]): una bola mía se queda quieta toda la ronda, así que le toca el turno a todas. */
  riskWeights?: number[];
  /** Reglas avanzadas del kantoku (iteración D): amenaza como valor esperado del rival, recogida por compañeras y ventanas por bolas fuera. */
  advanced?: boolean;
  /** Solo para comparar: el intento de touch de antes de la corrección de la fuerza. */
  legacyTouch?: boolean;
  legacyExitChain?: boolean;
  legacyHeap?: boolean;
  legacyHeapRisk?: boolean;
  legacyOpenings?: boolean;
  legacyAgari?: boolean;
  legacyChains?: boolean;
  legacyBridges?: boolean;
  legacyChainRisk?: boolean;
  legacyTouchPass?: boolean;
  legacyThreatUnion?: boolean;
  legacyMateSpark?: boolean;
  legacyRiskByValue?: boolean;
  legacyLineSpot?: boolean;
  legacyAttackRule?: boolean;
  legacyLongTouch?: boolean;
  legacyJoin?: boolean;
  legacySafePoint?: boolean;
  legacyRivalDanger?: boolean;
  legacyZoneSpark?: boolean;
  legacyMateSurvival?: boolean;
  legacyLateProgress?: boolean;
  legacyCombo?: boolean;
  legacyComboFront?: boolean;
  legacyFailPunish?: boolean;
  legacyTurnModel?: boolean;
  legacyCover?: boolean;
  legacySend?: boolean;
  legacyRiskRest?: boolean;
  legacyReentryFail?: boolean;
  legacyLineCands?: boolean;
  legacyReentryMust?: boolean;
  legacyLastTurn?: boolean;
  legacySelfOut?: boolean;
  legacyFarEntry?: boolean;
  legacyJoinWindow?: boolean;
  legacySparkClear?: boolean;
  legacyLateAgain?: boolean;
  legacyLongSpot?: boolean;
  legacyOpeningRivals?: boolean;
  legacyOpenField?: boolean;
  legacyOwnExposure?: boolean;
  legacyDouble?: boolean;
  /** Solo para comparar: aplica el libro de aperturas solo a las rojas, a las blancas o a la blanca 2. */
  openingsOnly?: 'red' | 'white' | 'white2';
  /** Reglas del v3 entrenadas (ver `RULE_GENES`); las que falten usan la constante de `config.ts`. */
  rules?: Partial<Record<RuleName, number>>;
  base: Record<BaseGene2, number>;
  mult: Record<(typeof MULT_PHASES)[number], Record<KeyTerm2, number>>;
  sims: { topN: number; errorSamples: number };
}
export type AnyWeightFile = WeightFile | WeightFile2;

/** Valores de partida de los términos nuevos (los demás salen del campeón actual). */
// `risk` parte del piso (1): el barrido del riesgo (`config.ts`, `kantokuRiskFloor`) mostró que con 3 o más la CPU duda al pasar la puerta 1 y al volver a entrar.
const INIT2: Partial<Record<BaseGene2, number>> = { risk: 1, riskPerPoint: 0.4, zone: 1, support: 0.5 };

/** Genes del v2: cada peso base y los multiplicadores de `inicio` y `final` de los términos clave. El peso del riesgo no baja del piso de `config.ts`. */
export function genes2(champion?: WeightFile): Gene[] {
  const init = (name: BaseGene2) => INIT2[name] ?? (champion && name in champion.base ? (champion.base as Record<string, number>)[name] : (handWeights[name] as number));
  const base = BASE_GENES2.map((name): Gene => {
    const v = init(name);
    const neg = v < 0, mag = Math.abs(v);
    const lo = name === 'risk' ? Math.max(CONFIG.kantokuRiskFloor, 0) : neg ? -(4 * mag + 2) : 0;
    return { name, init: name === 'risk' ? Math.max(v, lo) : v, scale: Math.max(0.25, 0.5 * mag), lo, hi: neg ? 0 : 4 * mag + 2 };
  });
  const mult = MULT_PHASES.flatMap((ph) => KEY_TERM2_NAMES.map((k): Gene => {
    const fromChampion = champion && (k === 'point' || k === 'touchRival') ? champion.mult[ph][k] : 1;
    return { name: `${ph}.${k}`, init: fromChampion, scale: 0.5, lo: k === 'risk' || k === 'zone' ? 0.3 : 0, hi: k === 'risk' || k === 'zone' ? 3 : 4 };
  }));
  return [...base, ...mult];
}

// ---------- Kantoku v3: constantes de reglas como genes ----------

/** Constantes estimadas a mano que el v3 entrena. `key` = el campo de `Weights`; `init` sale de `config.ts`. Los límites y la escala del paso están en TRAINING.md (iteración E). */
export const RULE_GENES = [
  { name: 'contAttack', init: () => CONFIG.kantokuContinuationAttack, lo: 0.2, hi: 1, scale: 0.5 },
  { name: 'heapRisk', init: () => CONFIG.kantokuHeapRisk, lo: 0, hi: 1.5, scale: 0.6 },
  { name: 'heapValue', init: () => CONFIG.kantokuHeapValue, lo: 0, hi: 2.5, scale: 0.8 },
  { name: 'heapSparkP', init: () => CONFIG.kantokuHeapSparkP, lo: 0.2, hi: 0.95, scale: 0.4 },
  { name: 'rivalSupport', init: () => CONFIG.kantokuRivalSupport, lo: 0, hi: 2, scale: 0.8 },
  // Iteración F: los términos que se agregaron tras jugar contra el v3 (Chris, 2026-10-23/24); al medirlos a mano cada uno costaba fuerza, así que se entrenan juntos
  { name: 'lineSpot', init: () => CONFIG.kantokuLineSpotBonus, lo: 0, hi: 1.5, scale: 0.5 },
  { name: 'mateWeight', init: () => CONFIG.kantokuMateWeight, lo: 0, hi: 1.5, scale: 0.5 },
  { name: 'passScale', init: () => (CONFIG.kantokuRiskByValue ? 0.14 : 1), lo: 0.14, hi: 1, scale: 0.4 },
  { name: 'touchPass', init: () => CONFIG.kantokuTouchPassScale, lo: 0, hi: 3, scale: 1 },
] as const;
/** Iteración G (v4): el equilibrio entre puntos y ataque según marcador y tiempo (0 = neutro). Las demás constantes de reglas quedan fijas con los valores del campeón de partida. */
export const RULE_GENES4 = [
  { name: 'leadSlope', init: () => 0, lo: 0, hi: 1.5, scale: 0.5 },
  { name: 'clockSlope', init: () => 0, lo: 0, hi: 1.5, scale: 0.5 },
] as const;
export type RuleName = (typeof RULE_GENES)[number]['name'] | (typeof RULE_GENES4)[number]['name'];

/**
 * Genes del v3: los del v2 (límites y escala de `genes2(v1)`) con los valores de partida del campeón `start`, más las constantes de reglas (con el valor de `start.rules` o el de `config.ts`).
 * El piso del riesgo se mantiene (gen `risk`); el riesgo del montón puede bajar a 0 porque el riesgo normal conserva su piso.
 */
export function genes3(start: WeightFile2, v1?: WeightFile): Gene[] {
  const g2 = genes2(v1).map((g): Gene => {
    const [a, b] = g.name.split('.');
    const v = b ? (start.mult as Record<string, Record<string, number>>)[a]?.[b] : (start.base as Record<string, number>)[g.name];
    return { ...g, init: typeof v === 'number' ? clampGene(g, v) : g.init };
  });
  const rules = RULE_GENES.map((r): Gene => ({ name: `rules.${r.name}`, init: Math.min(r.hi, Math.max(r.lo, start.rules?.[r.name] ?? r.init())), scale: r.scale, lo: r.lo, hi: r.hi }));
  return [...g2, ...rules];
}

/** Genes del v4: los del v2 con los valores del campeón `start` y, además, `leadSlope` y `clockSlope`. Las reglas del v3 de `start.rules` no son genes: se conservan fijas (ver `scripts/train.ts`, `--v4`). */
export function genes4(start: WeightFile2, v1?: WeightFile): Gene[] {
  const g2 = genes3(start, v1).slice(0, genes2(v1).length);
  const rules = RULE_GENES4.map((r): Gene => ({ name: `rules.${r.name}`, init: Math.min(r.hi, Math.max(r.lo, start.rules?.[r.name] ?? r.init())), scale: r.scale, lo: r.lo, hi: r.hi }));
  return [...g2, ...rules];
}

export function genomeToFile2(x: number[], genes: Gene[], sims = { topN: 6, errorSamples: 5 }, riskWeights?: number[], advanced?: boolean): WeightFile2 {
  const v = (i: number) => clampGene(genes[i], x[i]);
  const base = {} as Record<BaseGene2, number>;
  BASE_GENES2.forEach((n, i) => { base[n] = v(i); });
  const mult = { inicio: {}, final: {} } as WeightFile2['mult'];
  let i = BASE_GENES2.length;
  for (const ph of MULT_PHASES) for (const k of KEY_TERM2_NAMES) mult[ph][k] = v(i++);
  const file: WeightFile2 = riskWeights ? { version: 2, riskWeights, base, mult, sims } : { version: 2, base, mult, sims };
  if (advanced) file.advanced = true;
  if (genes.length > i) {
    const rules: Partial<Record<RuleName, number>> = {};
    for (; i < genes.length; i++) rules[genes[i].name.replace('rules.', '') as RuleName] = Math.round(v(i) * 10000) / 10000;
    file.rules = rules;
  }
  return file;
}

function resolveWeights2(f: WeightFile2, phase: Phase): Weights {
  const w: Weights = { ...handWeights, ...f.base, model: 2, certainty: true, lateClock: 0, topN: f.sims.topN, errorSamples: f.sims.errorSamples, riskWeights: f.riskWeights, advanced: f.advanced, legacyTouch: f.legacyTouch, legacyExitChain: f.legacyExitChain, legacyHeap: f.legacyHeap, legacyHeapRisk: f.legacyHeapRisk, legacyOpenings: f.legacyOpenings, legacyAgari: f.legacyAgari, legacyChains: f.legacyChains, legacyBridges: f.legacyBridges, legacyChainRisk: f.legacyChainRisk, legacyTouchPass: f.legacyTouchPass, legacyThreatUnion: f.legacyThreatUnion, legacyMateSpark: f.legacyMateSpark, legacyRiskByValue: f.legacyRiskByValue, legacyLineSpot: f.legacyLineSpot, legacyAttackRule: f.legacyAttackRule, legacyLongTouch: f.legacyLongTouch, legacyJoin: f.legacyJoin, legacySafePoint: f.legacySafePoint, legacyRivalDanger: f.legacyRivalDanger, legacyZoneSpark: f.legacyZoneSpark, legacyMateSurvival: f.legacyMateSurvival, legacyLateProgress: f.legacyLateProgress, legacyCombo: f.legacyCombo, legacyComboFront: f.legacyComboFront, legacyFailPunish: f.legacyFailPunish, legacyTurnModel: f.legacyTurnModel, legacyCover: f.legacyCover, legacySend: f.legacySend, legacyRiskRest: f.legacyRiskRest, legacyOpenField: f.legacyOpenField, legacyLineCands: f.legacyLineCands, legacyReentryMust: f.legacyReentryMust, legacyLastTurn: f.legacyLastTurn, legacySelfOut: f.legacySelfOut, legacyFarEntry: f.legacyFarEntry, legacyJoinWindow: f.legacyJoinWindow, legacySparkClear: f.legacySparkClear, legacyLateAgain: f.legacyLateAgain, legacyLongSpot: f.legacyLongSpot, legacyOpeningRivals: f.legacyOpeningRivals, legacyReentryFail: f.legacyReentryFail, legacyOwnExposure: f.legacyOwnExposure, legacyDouble: f.legacyDouble, ...f.rules };
  if (phase !== 'medio') {
    for (const k of KEY_TERM2_NAMES) for (const field of KEY_TERMS2[k]) (w[field] as number) *= f.mult[phase][k];
  }
  w.pointLate = w.point;
  w.risk = Math.max(w.risk, CONFIG.kantokuRiskFloor); // exponerse siempre cuesta algo, en cualquier fase
  return w;
}

/** Quién decide: los pesos a mano o los del kantoku. */
export type Brain = { kind: 'hand' } | { kind: 'kantoku'; file: AnyWeightFile };
export const handBrain: Brain = { kind: 'hand' };

export function weightsFor(brain: Brain, phase: Phase): Weights {
  return brain.kind === 'hand' ? handWeights : resolveWeights(brain.file, phase);
}
