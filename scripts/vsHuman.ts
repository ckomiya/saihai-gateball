// Una partida del kantoku (el nivel «Kantoku IA» del juego) contra un rival «tipo humano»: error de un buen jugador (`humanRivalError`), pesos del v1 y su reloj solo corre mientras
// rueda la bola (como el reloj del juego con una persona). El kantoku sabe que su rival es una persona (`rivalIsHuman`), como en el juego. Lo usan `record.ts` y `audit.ts`.
import { CONFIG } from '../src/config';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import type { MatchLogger } from '../src/game/matchLog';
import type { AnyWeightFile, Brain } from '../src/game/weights';
import { championV1 } from './trainLib';
import { GameResult, playMatch } from './selfplay';

const rival: Brain = { kind: 'kantoku', file: championV1 as AnyWeightFile };
const neutral = () => Array.from({ length: 5 }, () => ({ short: 1, medium: 1, long: 1 }));

/** `side` = equipo del kantoku (1 = blancas, como en el juego). */
export function playVsHuman(seed: number, side: 0 | 1, logger?: MatchLogger, brain: Brain = kantokuBrain): GameResult {
  const own = { ...kantokuLevelErrors(), rivalIsHuman: true };
  const human = { base: CONFIG.humanRivalError };
  const mine = Array.from({ length: 5 }, (_, i) => ({ ...CONFIG.playerCertainty[(i + side) % 4] }));
  const scale = { exec: own.executionScale ?? 1, plan: own.planningScale ?? 1 };
  return playMatch({
    seed, levels: [3, 3],
    brains: side === 0 ? [brain, rival] : [rival, brain],
    errorsByTeam: side === 0 ? [own, human] : [human, own],
    errorScales: side === 0 ? [scale, { exec: 1, plan: 1 }] : [{ exec: 1, plan: 1 }, scale],
    profiles: side === 0 ? [mine, neutral()] : [neutral(), mine],
    humanTeam: side === 0 ? 1 : 0,
    logger,
  });
}
