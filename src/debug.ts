// Ayudas de depuración y dibujo (`saihai-gateball/debug`): lo que la escena del juego usa para mostrar zonas, sitios de apertura, cadenas y el registro de partidas.
export { MatchLogger, stringifyLog } from './game/matchLog';
export type { MatchLogData, ShotLog } from './game/matchLog';
export { ZONE_CELL, entryZone, exitDanger, exitDangerGate } from './game/zones';
export { OPENING_SITES } from './game/openings';
export type { OpeningSite } from './game/openings';
export { upcomingTurns } from './game/phase';
export { ChainModel } from './game/threat';
