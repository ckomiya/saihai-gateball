# BACKLOG — Saihai

**El BACKLOG es solo para lo que viene; lo hecho va a `HISTORIAL.md`, `TRAINING.md` o `CHANGELOG.md`.** El historial anterior (iteraciones B a G, v1.0 a v1.5, separación de gateball-retro) está en `HISTORIAL.md`; las mediciones y decisiones de entrenamiento, en `TRAINING.md`.

## Estado
`saihai-v1.5` (etiqueta `v1.5.0`, ya con merge) es la que usa el juego: último turno con el resultado asegurado, alcance 18 m (ver `CHANGELOG.md`). Los pesos son los de v1.4.

## Siguiente (v2.0)
- [ ] Riesgo que sume cadenas independientes de una rival (montón + bola alineada con la puerta) en vez de solo el máximo, y candidatos pegados a la línea rodeando los postes: casos del turno 24 y 16 de la partida 2026-10-28; requiere reentrenar con la fase 5 (atributos S/M/L).
- [ ] Combo «bola y puerta» de rivales sin puerta 1 usando la puerta 2 (arreglo correcto, revertido solo porque el h2h bajó a 46,0 %: volver a probarlo junto al reentrenamiento).
- [ ] Cadena de touch: dónde queda la bola que toca (según la fuerza) en vez de «junto a la bola tocada».
- [ ] Caso T12 «puente sin doble ángulo» (partida 20261027-205516; `tests/partida1027d.test.ts`, omitida): el peso de las amenazas largas (≈ 20 % por rival a 13 m, sumadas) frente a un kantoku humano; calibrar con partidas reales, no a mano. Detalle en `HISTORIAL.md` («Kantoku v2.0: caso T12»).
- [ ] Reentrenar tras la fase 5 (atributos S/M/L por jugador), con la certeza del nivel y las reglas de comportamiento fijas o sus pruebas dentro de la aptitud (lección de la iteración F).
- [ ] Jugada rara: sacar a propósito a una compañera para que reentre por la línea junto a otra (requiere spark de expulsión con plan de reentrada de dos turnos).

## Errores conocidos / limitaciones
- La cadena de touch supone que la bola queda junto a la bola tocada (no calcula hasta dónde sigue según la fuerza).
- El turno 21 de la partida 2026-10-27 (dos puentes + puerta) sigue sin modelo.
- El combo «bola y puerta» del turno 24 (partida 2026-10-28) mide la puerta 1 en lugar de la 2 para una rival que aún no la pasó. Corrección conocida pero revertida porque el h2h bajó a 46,0 %: arreglarla junto con el reentrenamiento (ver «Siguiente»).
- El h2h tiene un sesgo: el control v1.4 contra sí mismo da 47,8 % (el umbral de 48 % no se puede cumplir ni con dos copias idénticas). **A cambiar:** la meta debe basarse en el control (la versión contra sí misma, mismas semillas) en vez del 48 % fijo.

## Pendientes de la separación
- [ ] Mover los pesos a `weights/` (`saihai-v1.4.json` y `weights/history/`): hoy conservan `src/game/cpuWeights*.json` para no tocar 47 referencias.
- [ ] Arreglar los 12 errores de `npm run typecheck:todo` (variables sin usar, tipos de `rounds.ts`, `waitdiag.ts`, `partida1027b`) y pasarlo a `typecheck`.
- [ ] GitHub Pages del juego con Saihai privado: necesita token; mejor esperar a que Saihai sea público.
- [ ] Corregir en `TRAINING.md` la cifra de genes: la sección «Qué entrena» dice **36 números** (22 base + 14 multiplicadores), que es el genoma del v1. El `saihai-v1.4.json` real tiene 45 valores: **31 genes del entrenamiento v4** (21 pesos base + 8 multiplicadores + `leadSlope` y `clockSlope`) y 14 fijos o de configuración (5 constantes de `rules`, 5 `riskWeights`, 2 de `sims`, `advanced` y `version`). La ficha del modelo en Hugging Face ya usa estas cifras. (2026-10-28)

## Preguntas abiertas
- ¿Cuándo se hace público el repositorio? (Después de la revisión de Chris.)
