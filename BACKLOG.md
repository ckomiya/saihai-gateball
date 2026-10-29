# BACKLOG — Saihai

El historial anterior al 2026-10-28 (iteraciones B a G, v1.0 a v1.4) está en el `BACKLOG.md` de gateball-retro y en el `TRAINING.md` de este repositorio.

## Hecho
- [x] Separación de gateball-retro (2026-10-28): motor, kantoku, pesos, herramientas y pruebas; API pública; build a `dist/`; licencia MIT.
- [x] v1.4.2 (rama `i18n-v1.4.2`): multiidioma `es`/`en` sin cambiar jugadas; README, RULES y CHANGELOG en inglés y español con glosario; `examples/duelo.mjs --lang`. Pendiente de merge y etiqueta (los hace Chris).

## Siguiente: Saihai v1.5
Observaciones de Chris de la partida 2026-10-28 (v1.4), para **medir antes de cambiar** (detalle en el BACKLOG de gateball-retro, sección «Observaciones de Chris — partida 2026-10-28»). Partidas guardadas en `tests/fixtures/registros/`.
- [ ] **Turno 16 — blanca 6 con doble ángulo.** Colocarla más cerca de la línea para que la roja 7 no tenga ese tiro. Es de estilo: medir el valor esperado de ambas opciones.
- [ ] **Turno 24 (partida 104041) — triple ángulo para la roja 5.** La blanca 4 se colocó frente a la puerta 2 y dejó un triple ángulo (blanca 4, blanca 6 y puerta 2) para la roja 5, que aún no había pasado la puerta 1. La roja 5 pasa la puerta 1 casi siempre (~9 de 10) y luego tiene golpe continuo cerca de la puerta 2. Revisar si el kantoku calcula la amenaza de las rivales sin puerta 1 desde su posición tras pasarla, y si suma el riesgo de varios blancos alineados.
- [ ] **Turno 28 — blanca 8 a merced de la roja 9.** Revisar si considera dónde queda la rival tras su touch.
- [ ] **Último turno — touch a la blanca 10.** Con el partido ganado debe intentar sumar puntos (`src/game/lastTurn.ts`).

## Pendientes de la separación
- [ ] Mover los pesos a `weights/` (`saihai-v1.4.json` y `weights/history/`): hoy conservan `src/game/cpuWeights*.json` para no tocar 47 referencias durante la separación.
- [ ] Arreglar los 12 errores de `npm run typecheck:todo` (variables sin usar, tipos de `rounds.ts`, `waitdiag.ts`, `partida1027b`) y pasarlo a `typecheck`.
- [ ] Etiqueta `v1.4.0` y que el juego dependa de `github:ckomiya/saihai-gateball#v1.4.0` (lo decide Chris).
- [ ] GitHub Pages del juego con Saihai privado: necesita token; mejor esperar a que Saihai sea público.
- [ ] Corregir en `TRAINING.md` la cifra de genes: la sección «Qué entrena» dice **36 números** (22 base + 14 multiplicadores), que es el genoma del v1. El `saihai-v1.4.json` real tiene 45 valores: **31 genes del entrenamiento v4** (21 pesos base + 8 multiplicadores + `leadSlope` y `clockSlope`) y 14 fijos o de configuración (5 constantes de `rules`, 5 `riskWeights`, 2 de `sims`, `advanced` y `version`). La ficha del modelo en Hugging Face ya usa estas cifras. (2026-10-28)

## Preguntas abiertas
- ¿Cuándo se hace público el repositorio? (Después de la revisión de Chris.)
- v2.0: reentrenar tras la fase 5 (atributos S/M/L por jugador).
