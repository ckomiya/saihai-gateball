# Cambios

🇬🇧 [Read in English](CHANGELOG.md)

Las versiones son `X.Y.Z`: `X.Y` es el modelo (`saihai-vX.Y`) y `Z` son correcciones que no cambian las jugadas. Un cambio de API incompatible solo ocurre con un mayor nuevo.

## Relación con las etiquetas del juego (`gateball-retro`)

| Etiqueta en gateball-retro | Saihai | Qué cambió |
|---|---|---|
| `kantoku-v1.0` | `saihai-v1.0` (solo pesos históricos) | Campeón v4 con el modelo de ritmo |
| `kantoku-v1.1` | `saihai-v1.1` (idem) | «Enviar a marcar», cobertura que puede caer, cancha abierta, exposición de la reentrada |
| `kantoku-v1.2` | `saihai-v1.2` (idem) | Reentradas que casi siempre entran; candidatos pegados a la línea |
| `kantoku-v1.3` | `saihai-v1.3` (idem) | Último turno: búsqueda de la cadena que más puntos suma |
| `kantoku-v1.4` | **`saihai-v1.4`** | Spark sin chocar con bolas propias, apertura bloqueada por cualquier bola, `juntarse` y `avanza` según quién vuelve a jugar |
| (aún no en el juego) | **`saihai-v1.5`** | Último turno con el resultado asegurado: también intenta touches largos a una compañera (hasta 18 m) |

Los pesos de v1.0 a v1.3 no se republican como versiones; están en `src/game/cpuWeights.v10.json` a `v13.json` solo para comparar (`npm run h2h`).

## 1.5.0 (modelo `saihai-v1.5`; cambia una jugada)
- Último turno con el partido ya decidido (reloj en cero y el equipo gana): la cadena final también considera bolas hasta 18 m (`kantokuLastReachM`, antes 12 m) y, a igualdad, prefiere tocar a una compañera. Caso: partida 20261028-073420, la última bola (blanca 8) no intentó el touch a la blanca 10 frente a la puerta 3. Fuera de esa situación las jugadas son las de la 1.4. `legacyLastReach: true` en el archivo de pesos devuelve la 1.4; `src/game/cpuWeights.v14.json` es el archivo de la 1.4 para `npm run h2h`.
- Medido y no cambiado (detalle en `BACKLOG.md` y `TRAINING.md`): turno 24 (triple ángulo para una roja que no pasó la puerta 1), turno 28 (reentrada junto a una cadena roja) y turno 16 (blanca cerca de la línea).
- `tests/lastturn.test.ts` es nueva; `tests/i18n.test.ts` compara ahora la huella de la 1.4.1 con `legacyLastReach` activado.

## 1.4.2 (multiidioma; mismas jugadas)
- Sin cambios de juego: los goldens, el planner-golden y las pruebas dan lo mismo que en 1.4.1.
- Textos en español o inglés: `messageFor(evento, lang?)`, `messagesFor(eventos, lang?)` y la nueva `noTouchMessage(lang?)` (`/engine`; `messageFor` y `messagesFor` también desde la raíz), `new Saihai({ lang })` para `Shot.plan.decision` y `OPENING_SITES[…].noteEn`. El idioma por defecto es `'es'`: sin indicarlo, la salida es idéntica a 1.4.1 (`tests/i18n.test.ts`, contra una huella de 360 golpes grabada con 1.4.1). Un `lang` desconocido en `Saihai` lanza `RangeError`.
- Documentación en dos idiomas: `README.md` (inglés) y `README.es.md`; `RULES.md` y `RULES.es.md`; `CHANGELOG.md` y `CHANGELOG.es.md`. Glosario de términos del gateball en los dos README. `CLAUDE.md` y los comentarios del código siguen en español.
- `examples/duelo.mjs`: opción `--lang en|es` (inglés por defecto en el ejemplo); el partido es el mismo en los dos idiomas. La carpeta `examples/` ahora viaja en el paquete (`files` de `package.json`).
- Los identificadores internos (claves de `Decision`, tipos de `MatchEvent`, registro de partidas) siguen sin traducir: son datos, no textos para el jugador.

## 1.4.1 (documentación y tipos; mismas jugadas)
- Sin cambios de juego: los goldens, el planner-golden y las pruebas dan lo mismo que en 1.4.0.
- API raíz: se exportan los tipos `MatchEvent`, `Transition`, `FoulReason`, `BallState` y `SoundCue` (antes solo estaban en `/engine`). No se quitó nada.
- README: conceptos de gateball (equipos y colores, turno y golpe, reloj, fin del partido, determinismo), tabla de eventos con salida real y el significado de `Resolution.touches` (índices, no números de bola), `opponent` y `execution` con ejemplos, instalación (build en `prepare`, aviso `allow-scripts`, por qué se queda `private: true`), estado público y para qué sirven los mensajes de `/engine`.
- `examples/duelo.mjs`: Saihai contra Saihai con semilla fija; ejemplo de humano contra Saihai en pseudocódigo.
- Origen: informe de la prueba de desarrollador externo (instalación limpia desde GitHub).

## 1.4.0 (primera versión de Saihai como paquete)
- Separado de gateball-retro: el motor de reglas, la física, el planificador, los pesos, las herramientas de entrenamiento y las pruebas viven aquí. El juego lo consume como dependencia.
- API pública: `createMatch`, `Saihai.chooseShot`, `playShot` (`saihai-gateball`), más `/engine`, `/debug` y `/testing`.
- **Nota sobre el poste de meta:** `saihai-v1.4` se midió primero con el poste de 0,05 m (h2h 49,8 %, 91/17/92; humanduel 87,3 %, 7,31 puntos). Desde el 2026-10-28 el poste mide 0,025 m (`poleRadiusM` en `src/config.ts`, a pedido de Chris) y las mismas medidas dan h2h 46,5 % (85/16/99, -0,38) y humanduel 84,5 % (7,00 puntos). Los pesos no cambiaron: con el poste en 0,05 m se recuperan exactamente las cifras anteriores. La referencia de esta versión es el poste de 0,025 m.
- El comportamiento es idéntico al de gateball-retro en `pre-separacion` (poste de meta de 0,025 m): mismos goldens, mismo `h2h`, `behavior`, `humanduel` y `selfplay` con las mismas semillas.
