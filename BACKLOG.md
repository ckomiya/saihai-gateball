# BACKLOG — Saihai

El historial anterior al 2026-10-28 (iteraciones B a G, v1.0 a v1.4) está en el `BACKLOG.md` de gateball-retro y en el `TRAINING.md` de este repositorio.

## Hecho
- [x] Separación de gateball-retro (2026-10-28): motor, kantoku, pesos, herramientas y pruebas; API pública; build a `dist/`; licencia MIT.
- [x] v1.4.2 (rama `i18n-v1.4.2`): multiidioma `es`/`en` sin cambiar jugadas; README, RULES y CHANGELOG en inglés y español con glosario; `examples/duelo.mjs --lang`. Pendiente de merge y etiqueta (los hace Chris).

## Hecho — Saihai v1.5 (rama `v1.5`, 2026-10-29; pendiente de merge y etiqueta `v1.5.0`)
Observaciones de Chris de la partida 2026-10-28 (v1.4), medidas con los tableros literales (`tests/fixtures/partidas/`):
- [x] **Último turno (073420, golpe 121) — corregido.** Causa: `candidates` descarta las bolas a más de 12 m y la blanca 10 estaba a 12,9 m de la 8 (ya había tocado a 2, 7, 1 y 3); la cadena final ni la evaluaba. Además, el haz de 5 se llenaba por orden de candidatos con touches a rivales de igual valor. Ahora, con el reloj en cero y el equipo ganando (resultado asegurado), la cadena alcanza 18 m (`kantokuLastReachM`) y desempata a favor de tocar a una compañera. Prueba `tests/lastturn.test.ts`: apunta a la 10 en 18/24 (con `legacyLastReach`, 0/24). La toca en 4/24 (a 13 m el error humano pesa) pero sin riesgo no cuesta nada. **Primer intento descartado:** aplicarlo en todo último/penúltimo turno bajó el h2h a 44,0 % (más candidatos con valoración ruidosa → elige peor cuando el resultado está en juego); por eso solo con el resultado asegurado.
- [x] **Turno 24 (104041) — diagnosticado, NO corregido (v2.0).** (1) La amenaza de una rival sin puerta 1 SÍ se calcula desde donde queda tras pasarla (`touchThreat`, paradas 1-11 m de `EXIT_STOPS`, pasa ≥ 0,9). (2) Error real encontrado: en el combo «bola y puerta» de esa rival, el segundo evento medía la puerta 1 desde la bola tocada (≈ 0) y no la 2 (0,49 → 0,62 para la blanca 4). Pero no cambia la jugada (24/24 semillas siguen poniendo la 4 frente a la puerta 2) y el arreglo solo bajó el h2h a 46,0 %: **revertido**. (3) La causa de fondo es estructural: el riesgo de cada rival es el MÁXIMO de sus cadenas; el montón 10-8-2 junto a la puerta 3 ya vale 1,01 y la cadena 4-6-puerta 2 (0,83) queda debajo, así que mover la 4 no cambia el riesgo, mientras que la zona de entrada le da +0,58. Sumar cadenas distintas o volver a pesar `kantokuRiskRest` exige reentrenar (no se ajustan constantes al resultado). En la partida real la roja 5 pasó la puerta 1 y falló el golpe continuo.
- [x] **Turno 28 (073420) — diagnosticado, sin error claro.** Fue una REENTRADA forzada de la blanca 8: las 121 opciones salían entre −3,81 y −4,28. El modelo SÍ consideró a la roja 9: la 8 era su bola más amenazada (29-31 %) y la cadena 9 → 7 → 8 (0,25, igual que el touch directo) está en el modelo. Limitación conocida: la cadena supone que la 9 queda junto a la bola tocada (la 7) y no calcula hasta dónde puede seguir según la fuerza.
- [x] **Turno 16 (073420) — solo medido, sin cambios (estilo).** La blanca 6 quedó en (9,12; 1,85) frente a la puerta 2. Simulando el turno de la roja 7 (60 partidos por posición, rival tipo humano) y la probabilidad de pasar la puerta 2 después: jugada 30 % la tocan / 38 % sale / valor de pasar 0,57; pegada a la línea frente a la puerta ((9;0,8) o (10;0,5)) 0-5 % / 0,80. Pero esas posiciones **no eran alcanzables** desde (6,95; 3,10): la mira se recorta contra los postes de la puerta 2 y la bola termina en y≈1,9-2,3. La única opción cercana a la línea que el planificador evaluó, (12,15; 0,10), da 0 % de touch, 18 % sale, 0,60 de pasar (contra 0,57) y valía −1,57 contra −1,30. El criterio de Chris es razonable, pero requiere candidatos nuevos (acercarse a la línea rodeando los postes) y el mismo riesgo por máximo del caso 24 (el planificador ve casi igual riesgo, −2,19 contra −2,27, porque otra bola, la 4, domina el máximo).
- Validación: `npm test` completo (ver TRAINING.md), h2h contra la v1.4 (`cpuWeights.v14.json`): **47,8 %, −0,57 puntos; el control v1.4 contra sí mismo da exactamente 47,8 % (−0,60)**, o sea el h2h tiene ese sesgo y la v1.5 no se distingue de la v1.4 (el umbral de 48 % no se puede cumplir ni con dos copias idénticas); `humanduel` 200: 84,5 % (7,05 puntos; línea base 84,5 %, 7,00); `behavior` 98 %; `bench:plan --kantoku` 52,9 ms por golpe.

## Siguiente (v2.0)
- [ ] Riesgo que sume cadenas independientes de una rival (montón + bola alineada con la puerta) en vez de solo el máximo, y candidatos pegados a la línea rodeando los postes: casos del turno 24 y 16; requiere reentrenar con la fase 5 (atributos S/M/L).
- [ ] Combo «bola y puerta» de rivales sin puerta 1 usando la puerta 2 (arreglo correcto, revertido solo porque el h2h bajó a 46,0 %: volver a probarlo junto al reentrenamiento).
- [ ] Cadena de touch: dónde queda la bola que toca (según la fuerza) en vez de «junto a la bola tocada».

## Pendientes de la separación
- [ ] Mover los pesos a `weights/` (`saihai-v1.4.json` y `weights/history/`): hoy conservan `src/game/cpuWeights*.json` para no tocar 47 referencias durante la separación.
- [ ] Arreglar los 12 errores de `npm run typecheck:todo` (variables sin usar, tipos de `rounds.ts`, `waitdiag.ts`, `partida1027b`) y pasarlo a `typecheck`.
- [ ] Etiqueta `v1.4.0` y que el juego dependa de `github:ckomiya/saihai-gateball#v1.4.0` (lo decide Chris).
- [ ] GitHub Pages del juego con Saihai privado: necesita token; mejor esperar a que Saihai sea público.

- [ ] Corregir en `TRAINING.md` la cifra de genes: la sección «Qué entrena» dice **36 números** (22 base + 14 multiplicadores), que es el genoma del v1. El `saihai-v1.4.json` real tiene 45 valores: **31 genes del entrenamiento v4** (21 pesos base + 8 multiplicadores + `leadSlope` y `clockSlope`) y 14 fijos o de configuración (5 constantes de `rules`, 5 `riskWeights`, 2 de `sims`, `advanced` y `version`). La ficha del modelo en Hugging Face ya usa estas cifras. (2026-10-28)

## Preguntas abiertas
- ¿Cuándo se hace público el repositorio? (Después de la revisión de Chris.)
- v2.0: reentrenar tras la fase 5 (atributos S/M/L por jugador).
