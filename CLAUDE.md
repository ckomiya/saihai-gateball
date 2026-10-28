# CLAUDE.md — Saihai

Saihai (采配) es un agente de IA kantoku para gateball: motor de reglas, física, planificador, pesos entrenados y herramientas de medición. Sin interfaz. Lo consume el juego **Nana-Ban** (repo `gateball-retro`) y, más adelante, otros desarrolladores. Modelo actual: `saihai-v1.4` (= `kantoku-v1.4` del juego).

## Al empezar cada sesión
1. Lee `BACKLOG.md`: qué sigue y las preguntas abiertas. El historial de decisiones del kantoku está en `TRAINING.md`.
2. Confirma con Chris el objetivo de la iteración antes de escribir código.

## Reglas legales (no negociables)
- Nunca uses el nombre del juego que inspiró el proyecto ni el de sus empresas, ni en el código, ni en los textos, ni en los comentarios. `tests/legal.test.ts` lo revisa (las palabras prohibidas están armadas en fragmentos ahí).
- No copies sprites, personajes, música, sonidos ni textos de ningún juego ni del reglamento oficial. `RULES.md` está escrito con palabras propias y solo cita números de artículo.
- Nada de la carpeta de referencias del juego (clips, PDF, texto del reglamento) entra a este repositorio.
- Todo el código se escribe desde cero. No uses código obtenido de ninguna ROM.

## Stack y comandos
- TypeScript (strict), sin dependencias de ejecución. `esbuild` empaqueta tanto el paquete (`dist/`) como los scripts y las pruebas, que ejecuta Node (`scripts/run-node.mjs`).
- `npm run build`: `dist/` (ESM con los pesos adentro) y los tipos en `dist/types/`. El juego lo usa: **compílalo después de cambiar algo** si el juego lo enlaza con `file:`.
- `npm run typecheck`: `tsc --noEmit` solo sobre `src/`. `npm run typecheck:todo` incluye `scripts/` y `tests/` (tiene 12 errores que ya existían).
- `npm test`: todas las pruebas, una tras otra (≈ 30 min). `npm run tests:todas -- <etiqueta> [--jobs 4]` corre cada una por separado y resume cuáles pasan. Tiene que pasar antes de cada commit.
- Medición: `npm run h2h`, `humanduel`, `behavior`, `bench:plan -- --kantoku`, `selfplay`, `validate`, `audit`, `analyze`, `probe`, `lineplay`, `spark`, `exposure`, `turnorder`, `gate1exit`, `waitdiag`, `touchshort`, `pacedata`, `pacefit`, `certeza`, `diagcont`, `rounds`. Los argumentos y qué mide cada una están en la primera línea de cada script y en `TRAINING.md`.
- Entrenamiento: `npm run train -- …` y `npm run select -- --verdict` (ver `TRAINING.md`). Publica en `src/game/cpuWeights.next.json` sin reemplazar al campeón.
- Registro y repetición de partidas: `npm run record`, `replay`. Las partidas de Chris llegan en JSON desde el juego; las usadas por las pruebas están en `tests/fixtures/registros/`.
- Referencias de equivalencia: el comportamiento de `saihai-v1.4` es el de gateball-retro en la etiqueta `pre-separacion`. Línea base (semillas por defecto): h2h 200 contra `cpuWeights.v13.json` con `--seed 8300000` = 46,5 % (85/16/99, -0,38 puntos); `behavior` 98 %; `humanduel` 200 = 84,5 % (7,00 puntos); `selfplay --games 8 --levels 4,1 --seed 1` = 5/2/1 y 20,1-16,4. `bench:plan --kantoku` ≈ 55-60 ms por golpe (avisar si pasa de ≈ 65).

## Estructura
- `src/index.ts`: API pública (`createMatch`, `Saihai`, `playShot`). `src/engine.ts`, `src/debug.ts`, `src/testing.ts`: subpaths del paquete. Son fachadas finas: no hay lógica nueva ahí.
- `src/config.ts`: **todos** los valores ajustables del motor y del kantoku (física, cancha, `LAYOUT`, certeza, constantes de las reglas del kantoku). `CONFIG` es global y mutable: los scripts y pruebas lo cambian a propósito. Los valores de la interfaz del juego (pantalla, mira, sonido) están en el repo del juego, no aquí.
- `src/game/match.ts`: **motor de reglas**, sin Phaser ni dibujo. Cualquier cambio de reglas se hace aquí y se refleja solo en el planificador. `physics.ts`, `court.ts` (geometría), `rng.ts` (`Rng`: **no uses `Math.random`**, pasa un `Rng`), `messages.ts`, `matchLog.ts`, `zones.ts`.
- `src/game/cpu.ts`, `cpuDriver.ts`, `cpuPlanner.ts`, `weights.ts`, `kantoku.ts`, `certainty.ts`, `threat.ts`, `pace.ts`, `phase.ts`, `lastTurn.ts`, `opening.ts`, `openings.ts`, `attackTable.*`: el planificador y el kantoku, con los pesos `cpuWeights.json` (el `saihai-v1.4`) y sus respaldos `cpuWeights.v*.json`, solo para comparar. El detalle de cada pieza (agari, tsunagi, riesgo, ritmo, último turno, aperturas) está en `TRAINING.md` y en los comentarios de cada archivo; los interruptores `legacy…` del archivo de pesos apagan reglas nuevas para comparar.
- `scripts/`: herramientas de medición y entrenamiento. `tests/`: pruebas (`*.test.ts`), escenarios (`scenarios.ts`) y goldens (`golden.json`, `planner-golden.json`).
- `candidatos-descartados/`, `training/` (no versionado; puntos de control y `endbank.json`), `partidas/` (no versionado; las partidas que usan las pruebas van en `tests/fixtures/partidas/`).

## Convenciones
- La lógica trabaja en **metros y segundos**. Sin Phaser, DOM ni `window`.
- Los textos que salen de Saihai están en español (`lang: 'es'`, el predeterminado: no cambiarlo, el juego depende de él) y en inglés (`lang: 'en'`), en `src/game/i18n.ts` y `messages.ts`. Los identificadores internos (claves de `Decision`, registro de partidas) siguen en español: los scripts los usan como claves; se traducen solo al salir por la API pública. `tests/i18n.test.ts` compara con `tests/fixtures/i18n-v1.4.1.json`: no lo regraves. La documentación pública es bilingüe (`README.md`/`README.es.md`, `RULES`, `CHANGELOG`: mismo contenido en los dos); `CLAUDE.md`, `TRAINING.md`, `BACKLOG.md` y los comentarios del código, en español.
- Si cambias una regla **a propósito**, `npm test` va a fallar: revisa que la diferencia sea la esperada, ajusta el escenario en `tests/scenarios.ts` y regraba el golden **desde la escena del juego** (`npm run build` en este repo y, en gateball-retro, `npm run build` y `node scripts/run-node.mjs tests/browser-golden.ts grabar`, que escribe `tests/golden.json` aquí). Cuéntaselo a Chris. El golden es la prueba de que el motor y la escena coinciden: no lo cambies para que una prueba pase.
- `tests/planner.test.ts` exige que con `handWeights` el planificador elija exactamente lo mismo que el planificador anterior (`planner-golden.json`).
- Si cambias un valor de `config.ts` por feedback, deja un comentario con el motivo.
- Medir antes de afirmar: cada cambio del kantoku se mide (h2h, humanduel, behavior, auditoría) y se anota con honestidad en `TRAINING.md` o `BACKLOG.md`, incluidos los que no mejoran.

## Forma de trabajo
- Iteraciones cortas, cada una con **una sola cosa**. Al cerrar: `npm run build` y `npm test` pasan, actualiza `BACKLOG.md`, y commit en español.
- Cambios de versión: sube `X.Y.Z` en `package.json`, anota en `CHANGELOG.md`, etiqueta `vX.Y.Z`. El juego fija la versión con `github:ckomiya/saihai-gateball#vX.Y.Z`; para trabajar en los dos a la vez, `npm install ../saihai-gateball` en el juego (no commitear la ruta `file:`).

## Estado actual
`saihai-v1.4` estable, separado de gateball-retro (ver `DECISIONES-NOCHE.md` en la rama `separacion-saihai` del juego). Lo que sigue está en `BACKLOG.md` (Saihai v1.5: observaciones de las partidas de Chris).
