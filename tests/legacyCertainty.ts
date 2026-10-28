// Pruebas calibradas con la certeza ANTERIOR del nivel «Kantoku IA» (error base de entrenamiento × 0,4: touch a 6 m 97 %, pasar la puerta 1 casi siempre). Desde 2026-10-26 el nivel usa la de un buen
// jugador humano (`kantokuLevelHuman`, `humanRivalError` × `kantokuLevelErrorScale`): con ella la bola pasa la puerta y toca bastante menos, y los umbrales de estas pruebas (pasa ≥ 90 %, toca ≥ 60 %, sale ≤ 3 %…)
// miden la calidad de la jugada con puntería casi perfecta, no la regla. Se importa lo primero en cada prueba para fijar esa certeza; lo que depende de la certeza nueva se prueba en `certeza.test.ts`,
// `linetouch.test.ts` y `threat.test.ts`. Ver BACKLOG.md («Certeza del nivel Kantoku IA»).
import { CONFIG } from '../src/config';

CONFIG.kantokuLevelHuman = false;
CONFIG.kantokuLevelErrorScale = 0.4;
CONFIG.kantokuLevelPlanScale = 0.4;
