// Pruebas compartidas (`saihai-gateball/testing`): los escenarios de reglas y su resultado grabado (`tests/golden.json`).
// El juego los ejecuta con la escena real (`tests/browser-golden.ts` del juego) y compara con este mismo golden.
import goldenJson from '../tests/golden.json';

export { SCENARIOS } from '../tests/scenarios';
export { compareRuns } from '../tests/compare';
export const golden: unknown = goldenJson;
