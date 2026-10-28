import cpuWeights from './cpuWeights.json';
import type { AnyWeightFile, Brain } from './weights';

/**
 * Kantoku artificial: la CPU con los pesos entrenados por autojuego (`npm run train`, ver TRAINING.md). Es el cerebro del nivel temporal «Kantoku IA» del menú.
 * `cpuWeights.json` es hoy el **v2 afinado** (generación 50 del afinado de la iteración C2); el v2 anterior está de respaldo en `cpuWeights.v2.json` y el v1 en `cpuWeights.v1.json`. Los niveles 1 a 4 usan los pesos a mano.
 */
export const kantokuBrain: Brain = { kind: 'kantoku', file: cpuWeights as AnyWeightFile };
