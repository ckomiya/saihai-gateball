// Graba una partida simulada del kantoku contra un rival «tipo humano» en `partidas/` (mismo formato que el registro del juego), para revisarla con `npm run replay`.
// Uso: npm run record -- [--seed 1] [--side 0|1] [--out partidas/sim.json]   (el kantoku juega con el equipo --side; por defecto las blancas, como en el juego)
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config';
import { MatchLogger } from '../src/game/matchLog';
import { playVsHuman } from './vsHuman';

const argv = process.argv.slice(2);
const str = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const seed = Number(str('seed', '1'));
const side = Number(str('side', '1')) as 0 | 1;
const logger = new MatchLogger({ level: CONFIG.cpuLevels.length, cpuTeam: side });
logger.data.id = `sim-semilla${seed}-lado${side}`;
const res = playVsHuman(seed, side, logger);
const out = str('out', `partidas/${logger.data.id}.json`);
mkdirSync('partidas', { recursive: true });
writeFileSync(out, logger.json());
console.log(`${out}: rojas ${res.red} - ${res.white} blancas · ${res.strokes} golpes`);
