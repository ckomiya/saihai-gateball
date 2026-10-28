# Cambios

Las versiones son `X.Y.Z`: `X.Y` es el modelo (`saihai-vX.Y`) y `Z` son correcciones que no cambian las jugadas. Un cambio de API incompatible solo ocurre con un mayor nuevo.

## Relación con las etiquetas del juego (`gateball-retro`)

| Etiqueta en gateball-retro | Saihai | Qué cambió |
|---|---|---|
| `kantoku-v1.0` | `saihai-v1.0` (solo pesos históricos) | Campeón v4 con el modelo de ritmo |
| `kantoku-v1.1` | `saihai-v1.1` (idem) | «Enviar a marcar», cobertura que puede caer, cancha abierta, exposición de la reentrada |
| `kantoku-v1.2` | `saihai-v1.2` (idem) | Reentradas que casi siempre entran; candidatos pegados a la línea |
| `kantoku-v1.3` | `saihai-v1.3` (idem) | Último turno: búsqueda de la cadena que más puntos suma |
| `kantoku-v1.4` | **`saihai-v1.4`** | Spark sin chocar con bolas propias, apertura bloqueada por cualquier bola, `juntarse` y `avanza` según quién vuelve a jugar |

Los pesos de v1.0 a v1.3 no se republican como versiones; están en `src/game/cpuWeights.v10.json` a `v13.json` solo para comparar (`npm run h2h`).

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
