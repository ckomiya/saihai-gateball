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

## 1.4.0 (primera versión de Saihai como paquete)
- Separado de gateball-retro: el motor de reglas, la física, el planificador, los pesos, las herramientas de entrenamiento y las pruebas viven aquí. El juego lo consume como dependencia.
- API pública: `createMatch`, `Saihai.chooseShot`, `playShot` (`saihai-gateball`), más `/engine`, `/debug` y `/testing`.
- El comportamiento es idéntico al de gateball-retro en `pre-separacion` (poste de meta de 0,025 m): mismos goldens, mismo `h2h`, `behavior`, `humanduel` y `selfplay` con las mismas semillas.
