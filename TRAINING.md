# TRAINING.md — Kantoku artificial de Nana-Ban

El **kantoku artificial** es la CPU que decide con pesos calibrados por autojuego en vez de pesos escritos a mano. «Kantoku» (監督) es el director técnico: el que decide la jugada. Aquí aprende a valorar cada golpe según el momento del partido y la certeza de cada jugador.

> El juego usa el campeón **solo en el nivel temporal «Kantoku IA»** del menú (con el error base del entrenamiento × la certeza del jugador). Desde la iteración C es el **v2** (`src/game/cpuWeights.json`); el campeón anterior (v1) está de respaldo en `src/game/cpuWeights.v1.json`. Los niveles 1 a 4 siguen con los pesos a mano (`handWeights`, `src/game/weights.ts`) y sus errores de siempre.

## Cómo correrlo

> Desde la iteración C, `npm run train` entrena el **v2** (ver la sección «Iteración C» más abajo); los comandos de esta sección y las secciones sobre el campeón «v1» describen la primera versión, que ahora es el respaldo.

```
npm run train                         # entrena y retoma solo si se corta (usa training/state.json)
npm run train -- --generations 2 --dir training/pilot --no-publish     # piloto
npm run train -- --fresh              # vuelve a empezar de cero
npm run validate -- --games 200 --finals 60      # campeón contra pesos a mano, colores cambiados, semillas nuevas
npm run validate -- --file initial               # el kantoku sin entrenar (pesos de partida) · también gen:N o un archivo
npm run validate -- --vs initial                 # contra otro kantoku (initial, gen:N, archivo) en vez de los pesos a mano
npm run validate -- --ablate fases               # el campeón sin una pieza: fases | muestras | acomodo
npm run analyze                                  # qué hace distinto el campeón: pesos por fase y estadísticas de juego
npm run probe                                    # misma posición, distinto perfil de certeza: ¿cambia la jugada?
```

- Cada generación se guarda en `training/gen_NNN.json` y el estado completo del optimizador en `training/state.json`: si se corta (Ctrl+C, apagón), `npm run train` continúa en la generación siguiente. La carpeta `training/` está en `.gitignore`.
- Al terminar escribe el campeón en `training/champion.json` y en `src/game/cpuWeights.json` (que sí va en el repositorio; `--no-publish` lo evita). El juego lo carga con `src/game/kantoku.ts`.
- Opciones: `--generations 60` · `--lambda 24` (población) · `--sigma 0.4` · `--workers N` (por defecto, hilos − 1) · `--seed 1` · `--hand-pairs 2` · `--group-rounds 3` · `--end-fraction 0.4` · `--bank 400` · `--monitor 5` · `--dir training`.
- Otros comandos: `npm run selfplay` (partidos CPU contra CPU), `npm run rounds` (vueltas, duración y golpes por fase según `clockFactor`), `npm run bench:plan -- --kantoku` (tiempo de planificación por golpe).

## Qué entrena

**Cifras actuales (campeón v4, `saihai-v1.4.json`, el que usa `saihai-v1.5`):** 45 valores en el archivo de pesos, **31 aprendidos por el entrenamiento y 14 fijos**. Los 31 son 21 pesos base + 8 multiplicadores por fase (4 términos clave × *inicio* y *final*) + `leadSlope` y `clockSlope`. Los 14 fijos son 5 constantes de reglas (`rules`), 5 `riskWeights`, 2 de `sims`, `advanced` y `version`. El genoma creció por iteraciones: 36 en el v1, 29 en el v2, 34 en el v3 (29 + 5 constantes de reglas), 38 en la iteración F (descartada) y 31 en el v4.

La descripción que sigue es la del **genoma del v1 (36 números)**, la primera versión, que ahora es el respaldo: los 36 números del genoma son los pesos de la valoración del planificador (`cpuPlanner.evaluate`): 22 pesos base comunes a todas las fases y 14 multiplicadores (7 términos clave × las fases *inicio* y *final*; el *medio* es la referencia con factor 1). Los términos clave son: exposición, puntos, poste, touch al rival, puntos esperados, sacar bola rival y acomodo. Ver `GENES` en `src/game/weights.ts`.

**Algoritmo: sep-CMA-ES** (CMA-ES con covarianza diagonal, `scripts/cma.ts`, sin dependencias). Se eligió sobre el genético clásico porque la aptitud es ruidosa (cada partido depende de la suerte del pasto y de los errores) y hay unos 40 parámetros: CMA-ES adapta solo el tamaño del paso y la escala de cada parámetro, promedia las mejores muestras en vez de quedarse con la «mejor» (que con ruido suele ser la más afortunada) y no necesita ajustar tasas de cruce ni de mutación. La versión diagonal aprende una escala por parámetro con tasas lineales en el número de parámetros; la de covarianza completa necesitaría del orden de 40² evaluaciones para aprender sus correlaciones, y aquí hay solo unos miles. El **campeón** es la media de la última generación, no el mejor candidato.

**Población:** 24 candidatos por generación, que parten de los pesos a mano (y de valores moderados para los términos nuevos).

**Partidos de cada generación** (siempre en pares con los colores cambiados y los mismos sorteos —semilla, certeza de los jugadores y, si toca, la posición— para los dos colores):
- 2 pares contra los **pesos a mano**, los mismos para todos los candidatos (comparación justa).
- 3 rondas contra el **grupo**: emparejamientos al azar entre candidatos; el resultado cuenta para los dos.
- ≈40 % de los pares empiezan desde una **posición de final de partido** del banco (`training/endbank.json`, ≈400 posiciones con distintos marcadores, generadas jugando partidos hasta la fase final) y se juegan hasta el fin.
- Cada 5 generaciones, 8 pares de la media contra los pesos a mano, solo para vigilar el progreso.

**Aptitud:** victorias (el empate vale ½) + 0,02 × diferencia de puntos por partido (acotada a ±10).

**Error en el entrenamiento:** error base realista, `CONFIG.kantokuBaseError` (aimErr 0,056 m, powerErr 0,022, accErr 0,022: la media geométrica de los niveles 2 y 3), multiplicado por la **certeza del jugador a esa distancia**. En cada partido se sortean los perfiles de los 10 jugadores (factores logarítmicos alrededor de 1, entre 0,4 y 2,5 por tramo), para que aprenda la regla general y no un equipo fijo. El nivel 4 del juego (error de 1 cm) no se usa porque es sobrehumano y vuelve irrelevantes la estrategia y el riesgo.

## Qué valora distinto el campeón v1 (en gateball)

Todo esto sale de `npm run analyze` y `npm run probe` sobre 200 partidos del campeón contra los pesos a mano (certeza sorteada, error base realista). Las cifras son por partido.

> **Lo que se diseñó y el optimizador no usó.** El diseño tenía tres ideas: pesos distintos por fase, «puntos esperados al terminar» en el final, y exposición según la certeza del rival que juega después. El entrenamiento dejó en **0** el peso de la exposición y el de los puntos esperados en todas las fases, y los multiplicadores por fase no aportan (ver las pruebas de piezas más abajo). Lo que sí funciona es otra cosa: atacar con touch y spark, y acomodar según la certeza de quien tira.

### 1. Atacar: el touch y el spark valen mucho más que sumar un punto propio
- **Pesos:** un punto propio pasa de valer 3 a **1,0 / 1,9 / 1,1** (inicio / medio / final). Un touch a un rival pasa de valer 2,2 a **4,7 / 4,6 / 10,2**: en el final vale casi cinco veces más. Sacar una bola rival de la cancha sube a 2,7 en el medio. Las faltas se castigan más (5 → 7,7) y salirse en el tiro de salida también (3 → 5,5).
- **Qué se ve en el juego:** el campeón hace 4,7 / 2,1 / 10,4 touches por partido en cada fase (los pesos a mano, 1,2 / 0,2 / 1,4) y **saca 2,5 / 1,1 / 6,7 bolas rivales** (contra 1,1 / 0,2 / 1,0). Cada touch da un spark y un golpe más, por eso juega más golpes (19,6 / 6,8 / 36,4 contra 13,0 / 2,7 / 16,9): encadena touch, spark y golpe continuo sin perder turnos.
- **Resultado:** en el final suma **10,1 puntos por partido contra 1,5**, y recibe 0,9 touches contra 6,3. No se defiende escondiéndose (el peso de la exposición es 0): su defensa es sacar de la cancha las bolas rivales que podrían tocarlo.
- Los pesos a mano son muy pasivos: en el medio y el final dedican el 79 % y el 74 % de sus golpes a «acomodarse», contra el 33 % y el 30 % del campeón. Parte de la ventaja es explotar esa pasividad.

### 2. Según el momento del partido
Casi todo es igual en las tres fases. Las diferencias que dejó el entrenamiento:
- **Inicio:** puntos propios casi sin valor (1,0), y la certeza al acomodar apagada (peso 0): lo que importa es meter las bolas por la puerta 1 y empezar a atacar. Hace 8 % de touches a rivales y 9 % a bolas propias (para acomodarlas con el spark).
- **Medio:** valora más puntuar (1,9) y sacar bolas rivales (2,7), y enciende la certeza al acomodar (0,64).
- **Final:** el touch al rival sube a 10,2 (el doble que antes), la certeza al acomodar a 0,74, y valora **menos** llegar al poste (el extra de poste baja de 0,33 a 0,06 y tocar una bola rival que va al poste de 1,4 a 0,3). Es decir: en el final prefiere sacar las bolas rivales a asegurar el +2 del poste. La última bola siempre es blanca, pero el campeón no lo usa de forma especial: el término que lo modelaba (puntos esperados) quedó en 0.

### 3. Según la certeza de los jugadores
- **Certeza de quien tira (sí cambia la jugada):** con la misma posición y los mismos sorteos, solo cambiando el perfil del tirador, el campeón elige otra jugada en el **70 %** de las posiciones del medio y el final (los pesos a mano, 0 %). Un **certero de corto deja la bola a 4,8 m de su siguiente puerta**; un **certero de largo, a 7,8 m** (pesos a mano: 6,8 m en ambos casos). Para llegar tan cerca, el certero de corto hace golpes de acomodo más largos (9,0 m de media contra 7,6 m): se acerca a la puerta hasta donde es certero. El certero de largo se conforma con quedarse a media distancia.
- **Acomodar pensando en el compañero que juega después:** pesa un 66 % más (`nextMateBonus`) la posición de la bola del compañero que juega justo después.
- **Certeza del rival que juega después (no cambia nada):** con el mismo experimento, cambiar el perfil del rival no cambia ninguna jugada (0 %): como la exposición vale 0, el campeón no «esconde» las bolas de un rival certero ni se acerca más a uno errático.
- La certeza también entra en la simulación de cada golpe con el error del jugador, pero **eso no aporta de forma medible** (ver abajo).

## Resultados del entrenamiento del v1

Entrenamiento de 60 generaciones (80 min, 7 hilos). Validación con 200 partidos completos y 60 desde posiciones de final, colores cambiados, semillas nuevas (`npm run validate`):

| Prueba | Partidos completos | Desde finales |
|---|---|---|
| **Campeón contra pesos a mano** | **93,3 %** (±3,5), +8,31 puntos; 89/100 como rojas, 95/100 como blancas | 73,3 % (±11,2), +3,70 |
| Kantoku **sin entrenar** contra pesos a mano | 41,5 % (±6,8), −1,72 puntos | 36,7 % (±12,2), −1,92 |
| **Campeón contra el kantoku sin entrenar** | 93,0 % (±3,5), +9,09 puntos | 76,7 % (±10,7), +4,13 |

- **Cuánto aporta el planificador nuevo y cuánto el entrenamiento.** El planificador nuevo **con los pesos de partida es peor** que los pesos a mano (41,5 %): por sí solo (certeza, fases, puntos esperados) no gana. Todo el salto (de 41,5 % a 93,3 %, unos 52 puntos de victorias) viene del entrenamiento. No se puede separar de verdad «estructura» y «pesos», porque la estructura solo vale con buenos pesos; las piezas se miden mejor quitándolas del campeón.
- **No aprendió solo a ganarle a un rival:** contra el kantoku sin entrenar gana lo mismo (93,0 %) y con más puntos de diferencia. **Límite de esta prueba:** los dos rivales son de la misma familia (el planificador a mano y su versión sin entrenar, ambos más débiles que el campeón y ninguno defiende bien). Contra una persona, o contra un rival que cuide sus bolas, no se sabe.

### Qué piezas aportan (el campeón con una pieza quitada, contra pesos a mano, 200 partidos)
| Campeón… | Victorias | Diferencia de puntos |
|---|---|---|
| completo | 93,3 % (±3,5) | +8,31 |
| sin fases (los mismos pesos en todo el partido) | 96,3 % (±2,6) | +9,07 |
| sin simular con error (tiro exacto) | 93,0 % (±3,5) | +7,64 |
| **sin la certeza al acomodar** (`posProb` y `nextMateBonus` a 0) | **87,5 %** (±4,6) | **+6,18** |

- Las **fases no aportan** de forma medible (sin fases es igual o algo mejor, dentro del ruido) y la **simulación con error tampoco**. La pieza que sí aporta es la **certeza al acomodar**: sin ella baja unos 6 puntos de victorias y 2 de diferencia.
- La mayor parte de la ventaja viene de la **agresividad con touch y spark** (pesos de la sección 1), que no depende de ninguna de las tres piezas.

### Evolución
- **La mejora se estancó pronto.** Medido contra pesos a mano (100 partidos cada una): generación 10 → 94,5 %, 20 → 93,5 %, 30 → 93,5 %, 40 → 92,0 %, 50 → 95,5 %, 60 → 93,3 %: todas iguales dentro del margen (±5 %). Cara a cara (200 partidos): la generación 60 contra la 10 gana 59,8 % (±6,8, +1,36 puntos): una pequeña ventaja real; contra la 30, 52,5 % (±6,9, +0,12): sin diferencia. **Casi todo se aprendió en las primeras 10 a 30 generaciones.**
- En el registro del entrenamiento la aptitud de la población sube hasta la generación 6–11 y después oscila entre 0,6 y 0,8 sin tendencia; la media contra los pesos a mano (16 partidos cada cinco generaciones) se mueve entre 81 % y 94 % sin tendencia. El paso del optimizador (σ) no se reduce (0,38 → 0,53 → 0,42): con tan poco señal en cada generación, el ruido manda.
- **¿Seguir hasta 80? No conviene.** Más generaciones de lo mismo no van a mejorar nada medible (30 habrían bastado: unos 40 minutos). Para mejorar de verdad haría falta menos ruido (más partidos por candidato, unos 4× el coste) y, sobre todo, **rivales más duros y variados** (por ejemplo, campeones de generaciones anteriores y una CPU que defienda): hoy el campeón ya gana el 93 % contra todo lo que se le pone enfrente, y la aptitud no distingue entre candidatos buenos.

### Piloto
Banco de finales: 400 posiciones en 2,2 min (una sola vez, `training/endbank.json`), con los marcadores repartidos 58 / 96 / 82 / 92 / 72 (≤−6, −5…−2, −1…1, 2…5, ≥6 de diferencia). Cada generación: ≈2,0 min en el piloto (184 partidos de 4,2–4,7 s) y 1,3 min de media en el entrenamiento completo (80 min en total, 60 generaciones).

## Iteración C: kantoku v2 (entrenado y adoptado como campeón del nivel «Kantoku IA»)

`cpuWeights.json` es hoy el **v2**; el v1 está de respaldo en `cpuWeights.v1.json` (para volver, copiar ese archivo sobre `cpuWeights.json`). `npm run train` entrena el v2 en `training/v2` (el estado del v1 queda en `training/`); publica en `src/game/cpuWeights.next.json` y no reemplaza nada por sí solo. Las referencias internas siguen así: los valores de partida y los límites de los genes salen del v1 (`championV1` en `scripts/trainLib.ts`), y el rival fijo de la liga y la referencia de la validación son lo que haya en `cpuWeights.json` (`currentChampion`).

```
npm run train                          # 30 generaciones (retoma solo si se corta); para seguir más: npm run train -- --generations 50
npm run select -- --verdict            # elige entre los puntos de control (--from 20 --to 30 por defecto) y comprueba los criterios
npm run exposure -- --brain champion --rival v1 --human-rival --trials 40     # exposición como en el juego (rival humano)
npm run validate -- --vs v1 --error-scale 0.4 --games 200                      # contra el respaldo
```

### Qué cambia respecto al v1
- **Riesgo (reemplaza a la exposición):** para las próximas bolas rivales que van a jugar (peso 1, 0,5 y 0,25 según el orden), la probabilidad de su **mejor opción**: pasar su puerta o tocar una bola mía (con más valor si tiene puntos). Usa su certeza y el desvío del pasto. Cubre dos casos que la exposición ignoraba: la bola mía que acaba de volver a entrar desde fuera cuenta como cualquier bola mía en juego, y las rivales aún en la salida cuentan con «pasar la puerta 1 y tocar con el golpe continuo». **Piso del peso del riesgo: 1,0** (decisión de Chris: exponerse siempre cuesta algo).
- **Zona:** premio por las bolas mías con buena probabilidad de pasar su puerta y sin un ángulo de tiro sencillo para el rival (`P(pasar) × (1 − amenaza)`). **Apoyo:** premio por tener otra bola mía que juega pronto a 1–6 m (línea limpia) de las que aún no pasan, para encadenar touch y spark. **Acomodo** y **poste** como en el v1. Ya no hay puntos esperados ni exposición a mano.
- **Pasto en las probabilidades:** `hitProbability` suma el desvío del pasto (medido con la física) y la puerta usa su margen efectivo de ±11 cm. Con eso las probabilidades coinciden con la física (`tests/grass.test.ts`).
- **Rival humano:** cuando el rival es una persona (el nivel «Kantoku IA»), sus opciones se miden con el error de un «buen jugador humano» (`CONFIG.humanRivalError`), calibrado con la referencia de Chris: touch ≈ 50 % hasta 6 m y ≈ 20 % a 13 m (96 % a 2 m, 85 % a 3 m, 72 % a 4 m, 50 % a 6 m, 36 % a 8 m, 28 % a 10 m, 20 % a 13 m). En el entrenamiento (CPU contra CPU) se usa el error de la CPU: **97 % a 6 m y 54 % a 13 m medidos con la física** (el modelo dice 63 % a 13 m); con el error original (×1), 88 % y 48 %. Un rival en la salida amenaza la zona de la puerta 1 (41 % cerca, 6 % lejos); se dibuja con F2.
- **Genoma de 29 números** (21 pesos base + 4 términos clave × inicio y final: riesgo, zona, puntos y touch al rival), que parte de los pesos del v1 y de valores moderados para lo nuevo.
- **Liga:** por candidato y generación, 2 pares contra los **pesos a mano**, 2 contra el **campeón v1** (congelado), 2 contra el **salón de la fama** (punto de partida y puntos de control de la corrida cada 5 generaciones) y 2 rondas contra el grupo: 16 partidos por candidato. Error de entrenamiento: `kantokuLevelErrorScale` 0,4 en ejecución y en lo que el planificador cree, en los dos equipos. 40 % de los partidos desde posiciones de final.

### Cómo se eligió el piso del riesgo (1,0)
Barrido del peso del riesgo sobre los pesos del v1 (40 intentos de cada escenario de exposición, 100 partidos contra pesos a mano, error ×0,4, rival CPU que ataca):

| riesgo | 0 | 0,5 | **1** | 2 | 3 | 5 | 8 |
|---|---|---|---|---|---|---|---|
| reentrada tocada o sacada | 70 % | 55 % | **46 %** | 23 % | 32 % | 23 % | 10 % |
| reentra | 100 % | 100 % | **100 %** | 70 % | 55 % | 28 % | 13 % |
| pasa la puerta 1 | 100 % | 100 % | **100 %** | 80 % | 74 % | 25 % | 4 % |
| gana a pesos a mano | 94 % | 91 % | **96 %** | 93 % | 95 % | 91 % | 80 % |

Con 1 la reentrada expuesta baja por debajo de los pesos a mano (50 %) sin dejar de entrar ni de pasar la puerta 1; con 2 o más la CPU empieza a dudar (un rival CPU tan certero deja todo a su alcance). El piso es un mínimo, no un objetivo. **Dato del resultado:** el peso base del riesgo del v2 terminó **exactamente en el piso (1,00)**: en la fase media el optimizador habría bajado más el riesgo, así que ese valor es el que impuso la restricción, no una preferencia aprendida (en inicio y final subió a 1,44 y 1,32 con los multiplicadores).

### Entrenamiento (2026-10-21)
30 generaciones en 94 min (3,1 min por generación; el piloto había dado 2,6–3,2). Paso del optimizador σ: 0,37 → 0,28. La aptitud media de la población apenas se mueve (0,66 → 0,62 → 0,65 → 0,64): con rivales cada vez mejores del salón de la fama, una media estable significa que los candidatos mejoran a la par que el campo. Control cada 5 generaciones con 12 partidos (muy ruidoso): contra pesos a mano 92, 79, 67, 83, 92, 100 y 75 %; contra el campeón v1 50, 71, 75, 42, 33, 58 y 58 %.

### Elección del campeón: puntos de control contra el campeón v1 (100 partidos cada uno, error ×0,4)

| generación | 20 | 22 | 24 | 26 | 28 | **30** |
|---|---|---|---|---|---|---|
| victorias | 56,0 % | 53,5 % | 55,0 % | 59,0 % | 64,5 % | **70,0 %** |
| intervalo 95 % | ±9,7 | ±9,8 | ±9,8 | ±9,6 | ±9,4 | ±9,0 |
| puntos de diferencia | +2,37 | +2,46 | +2,80 | +3,63 | +3,74 | +4,50 |

Mejora casi continua entre la 24 y la 30 y **el mejor punto es el último: el v2 seguía mejorando al terminar**. Eso significa que 30 generaciones se quedaron cortas (en el v1 la mejora se estancó antes de la 30) y conviene probar más, después de que Chris lo juegue.

### Veredicto (200 partidos, error ×0,4, semillas nuevas) — cumple los tres criterios
| Criterio | Pedido | Resultado |
|---|---|---|
| Contra el campeón v1 | ≥ 57 % con límite inferior > 50 % | **60,0 %** (±6,8; 119 victorias, 2 empates, 79 derrotas), +3,27 puntos; como rojas 52/100 y como blancas 67/100 |
| Contra los pesos a mano | ≥ 90 % | **95,5 %** (±2,9), +9,52 puntos; como rojas 93/100 y como blancas 95/100 |
| Menos exposición que el v1 | (ver tabla) | sí |

**Exposición** (`npm run exposure`; rival: el v1 que ataca; 80 intentos de reentrada, 160 de salida):

| | pesos a mano | v1 | **v2** |
|---|---|---|---|
| *Rival CPU* (como en la validación) · reentrada desde fuera: la tocan o sacan | 50 % | 83 % | **44 %** |
| · salida de la puerta 1: pasa / la tocan o sacan | 99 % / 76 % | 92 % / 31 % | **100 % / 24 %** |
| · partidos completos: reentradas tocadas antes de volver a jugar | 17 % | 74 % | **69 %** |
| *Rival humano* (como en el juego: el kantoku mide sus opciones con `humanRivalError` y el rival ejecuta con ese error) · reentrada: entra / la tocan o sacan | 79 % / 17 % | 100 % / 39 % | **100 % / 26 %** |
| · salida de la puerta 1: pasa / la tocan o sacan | 99 % / 31 % | 91 % / 11 % | **99 % / 18 %** |

Las cifras con rival CPU vienen de la corrida de Chris; las de rival humano, de esta comparación (los pesos a mano con el rival CPU, de la medición anterior). Con el rival humano la reentrada del v2 queda mejor que la del v1 (26 % contra 39 %), pero en la salida de la puerta 1 el v1 queda algo menos expuesto (11 % contra 18 %, aunque el v1 pasa la puerta solo el 91 % de las veces: tira más seguro y pasa menos). Con 160 intentos la diferencia está en el límite del ruido.

### Qué valora distinto el v2 (en gateball)
**Riesgo** (el v1 lo tenía en 0). Antes de elegir un golpe, el v2 piensa en lo que hará cada una de las próximas tres bolas rivales: ¿puede pasar su puerta?, ¿puede tocar alguna bola mía? Y se castiga por dejar a su rival una buena opción, con más peso a la que juega primero (1, 0,5 y 0,25). Dos casos que el v1 no veía: la bola que vuelve a entrar desde fuera (la tocan el 44 % de las veces, no el 83 %) y las bolas rivales que aún esperan en la salida, que pasan la puerta 1 y tocan con su golpe continuo. El peso es chico (1,0 en el medio, 1,4 al inicio, 1,3 al final): atacar sigue valiendo más que defender, pero ya no es gratis.
**Zona.** El v2 premia tener una bola en el lugar desde donde pasa su puerta con probabilidad alta (la zona de entrada: un abanico de unos 5–6 m frente a la puerta) y que además el rival no tenga un tiro fácil a ella. Pesa poco al inicio (0,37, hay bolas en la salida y no hay zona que dominar) y crece: 0,80 en el medio y 0,94 en el final. Es la forma de «controlar la zona» sin bloquear: una bola mía bien puesta frente a la puerta 2 o la 3, con una línea de tiro difícil para el rival.
**Apoyo.** 0,43 en todo el partido: valora tener otra bola propia, que juegue pronto, a 1–6 m de una bola que aún no pasa su puerta, con línea limpia, para encadenar touch y spark y mandarla a puntuar. Es lo que hace útil el touch a una bola propia (que ahora vale 0,82, antes 0,46).
**Lo demás, comparado con el v1:** el punto propio vale más en el final (1,56 contra 1,07); el touch al rival vale menos al inicio y al final (3,3 y 7,7 contra 4,7 y 10,2: sigue atacando, pero no tanto); perder una bola cuesta más (−2,10 contra −1,58) y no lograr volver a entrar también (2,8 contra 1,9); sacar una bola rival vale más (3,7 contra 2,7); las faltas cuestan menos (5,6 contra 7,7, porque el filtro de seguridad ya las evita); y llegar al poste ya no se devalúa en el final (la zona de ir al poste se mantiene).

**Comportamiento contra los pesos a mano** (200 partidos, error ×1, por partido; v1 entre paréntesis): sigue siendo ofensivo, con 4,5 / 1,6 / 9,8 touches por fase (4,7 / 2,1 / 10,4) y 2,7 / 0,9 / 7,0 bolas rivales sacadas (2,5 / 1,1 / 6,7); pero **suma más puntos al inicio** (7,4 contra 5,8, igual que los pesos a mano: 7,1), pierde menos bolas propias en el final (0,46 contra 0,70), no comete faltas (0,00–0,01 por partido, antes 0,06 en el inicio) y apunta más a la meta (16 / 20 / 21 % de sus golpes, contra 10 / 14 / 20 %). Los pesos a mano dedican el 70–75 % de sus golpes del medio y el final a acomodarse, el v2 el 31–38 %.

### Límites conocidos
- La validación usa CPU contra CPU; contra una persona no se sabe. En el juego el v2 mide a su rival con el error de un buen jugador humano, que **no es lo que se validó** (se validó con rivales CPU). Por eso se midió también la exposición con rival humano (tabla de arriba).
- El piso del riesgo está activo (peso base en el límite inferior): el optimizador quería menos riesgo.
- Los dos rivales de la validación (pesos a mano y v1) son de la misma familia.
- El v2 sigue mejorando en la generación 30.

## Afinado del v2: el riesgo con las cinco bolas rivales (iteración C2, preparado; falta correrlo)

**Por qué.** Jugando contra el v2, Chris vio que una vez la CPU reentró desde fuera y se quedó junto a una bola suya (frente al arco 2), que la botó. Causa (reproducida con `npm run turnorder`): el riesgo del v2 solo mira las 3 próximas bolas rivales (pesos 1 / 0,5 / 0,25) y una bola de la CPU se queda quieta toda la ronda, así que le toca el turno a las **cinco**. Si la bola de Chris juega 1.ª, la CPU la evita; si juega 2.ª a 5.ª, se queda a ≤4 m de ella el 75–90 % de las veces (pesos a mano 5 %, v1 23 %).

**Qué se probó sin reentrenar** (`riskWeights` en el archivo de pesos v2; por defecto 1 / 0,5 / 0,25): solo **[1, 1, 1, 1, 1]** lo arregla del todo (0 % en los cinco turnos). [1, 0,75, 0,5, 0,5, 0,5] arregla solo la 1.ª y 2.ª; [1, 0,9, 0,8, 0,7, 0,6] hasta la 3.ª; con pesos más bajos y repartidos ([0,5 ×5], [0,7, 0,5, 0,45, 0,4, 0,4]) no se arregla y pierde fuerza. Aplicado sin reentrenar, [1 ×5] cuesta algo: contra el v2 actual 55,0 % (±6,9), contra pesos a mano 89,5 % (±4,2) y pasa la puerta 1 el 93 % (antes 99 %). No se aplicó.

**Cómo correrlo.** El entrenamiento retoma desde la generación 30 y cambia la estructura del riesgo; los puntos de control anteriores conservan la suya (cada `gen_NNN.json` guarda `riskWeights`, y `select` y `validate` la usan):

```
npm run train -- --generations 50 --risk-weights 1,1,1,1,1      # ≈ 20 generaciones más, ≈ 1 h
npm run select -- --from 40 --to 50 --verdict
npm run exposure -- --brain src/game/cpuWeights.next.json --rival v1 --human-rival --trials 40
npm run turnorder -- --brain src/game/cpuWeights.next.json
```
(`npm run train` a secas no sirve: el estado ya está en la generación 30 y no cambiaría la estructura.) El piso del riesgo sigue en 1,0, ahora **por cada bola rival**: con los cinco pesos iguales pesa casi 3 veces más que antes (el barrido que lo eligió se hizo con la estructura vieja), y es lo que protege el caso de Chris; el optimizador puede subirlo pero no bajarlo.

**Piloto (2 generaciones sobre una copia del estado, `training/pilot3`):** sin errores; 2,7 min por generación (360 partidos de 3,1 s). Resultado tras esas 2 generaciones: el caso de Chris da **0 %** en los cinco turnos; 63,0 % contra el campeón actual (±9,5, 100 partidos); 93,5 % contra pesos a mano (±4,8); exposición con rival humano: reentrada tocada 25 %, salida de la puerta 1 tocada 24 %, **pasa la puerta 1 el 82 %** (el v2 actual 99 %). **A vigilar:** si el afinado deja a la CPU tímida al pasar la puerta 1. Conviene añadir a los criterios de reemplazo que pase la puerta 1 en la exposición con ≥ 95 % (y que `turnorder` dé ≤ 10 % en todos los turnos).
**Tiempo estimado del afinado completo:** 2,7–3,1 min por generación, o sea ≈ 55–60 min para 20 generaciones, más ≈ 15 min de selección, veredicto y exposición.

**Nota:** `outBallOffsetM` pasó de 0,1 a 0,25 m en el juego (claridad visual); el entrenamiento y las pruebas usan la geometría de la cancha de `config.ts`, así que el afinado se entrena ya con 0,25.

## Tras el afinado: golpe continuo en cadena, spark de expulsión y nuevo campeón

**Campeón.** `cpuWeights.json` es ahora el **v2 afinado** (generación 50 del afinado C2, `--risk-weights 1,1,1,1,1`); el v2 anterior quedó de respaldo en `cpuWeights.v2.json` (el v1 sigue en `cpuWeights.v1.json`; para volver, copiar el respaldo sobre `cpuWeights.json`). `train` publica la **última** generación en `cpuWeights.next.json`, no la elegida por `select` (que sí escribe la elegida ahí).

**1. Golpe continuo (corrección en cadena).** El riesgo del v2 se evaluaba sobre el tablero tras el golpe, como si el turno terminara ahí; con rivales cerca de la salida, la puerta 1 se pasaba el 40 % (33 % con dos). Ahora, tras un golpe que pasa una puerta o que toca, los rivales a su alcance se atacan en cadena (de cerca a lejos, desde el mismo sitio, porque tras un spark exitoso hay otro golpe): la parte de su amenaza que se da por resuelta es `CONFIG.kantokuContinuationAttack` × probabilidad de tocar × lo resuelto antes; su riesgo baja en esa proporción y se premia el touch esperado (`cpuPlanner.ts`, `certaintyTermsV2`). **`kantokuContinuationAttack` = 0,6 es un valor estimado, no entrenado** (touch × spark que saca ≈ 0,6); no se metió en el genoma porque obligaría a empezar un CMA nuevo (el estado y los puntos de control no valdrían) y el optimizador podría usarlo como un ajuste sin significado. Si hace falta cambiarlo, probar 0,4 / 0,6 / 0,8 sobre `tests/continuation.test.ts` y `validate`.

Prueba `tests/continuation.test.ts` (60 intentos, turno completo de la bola 2 con rivales cerca de la salida), 1 rival / 2 rivales:

| | pasa la puerta 1 | toca en el mismo turno | saca al menos una | saca las dos |
|---|---|---|---|---|
| v2 anterior, sin corrección (30 intentos) | – | 30/30 · 26/30 | – | – |
| gen 50 sin la cadena (30 intentos) | 30/30 · 28/30 | 21/30 · 8/30 | – | – |
| gen 50 con la cadena (= campeón nuevo) | 59/60 · 58/60 | 58/60 · 57/60 | 58/60 · 57/60 | – · 56/60 |

(`kantoku` v2 anterior con la cadena, 60 intentos: toca 58 · 60, saca las dos 51/60.) La prueba exige que, con dos rivales, el touch no baje claramente (≤ 6 de 60) respecto a uno.

**2. Spark de expulsión (sacar la bola rival con el spark).** Medido con `npm run spark` (40 partidos kantoku contra kantoku): cuando el kantoku decide sacar la bola rival (su golpe sin error la saca), salía de verdad el **97,3 %** (623 de 640); fallos sobre todo por combinaciones de errores y el pasto (9), choques con otras bolas (4) y casos sueltos de mira, rumbo y fuerza. Corrección (`knockoutCandidates` en `cpuPlanner.ts`, solo kantoku y solo su spark; el spark del humano y los niveles 1–4 no cambian): se prueban 24 direcciones hacia todas las líneas, con la mira 1 m pasada la línea y la fuerza de sobra para que la bola ruede `kantokuKnockoutOvershootM` (2,5 m) más allá de la línea (hasta `kantokuKnockoutMaxPower` = 0,95 de la barra); se descartan las que no la sacan o la hacen chocar con otras bolas; se miden con 12 muestras de error (`kantokuKnockoutSamples`) y gana la más segura y, a igual seguridad, la línea más cercana. Resultado: **99,2 %** (643 de 648; la prueba en `tests/spark.test.ts`, 250 tableros al azar: 99,2 % con la corrección, 96,3 % sin ella; exige ≥ 98 %). El planificador del kantoku tarda más: media 61 ms por golpe (`bench:plan --kantoku`), con un máximo de 364 ms en un spark de expulsión.

**3. Victorias y exposición con las dos correcciones** (error ×0,4; `validate`, 200 partidos; `exposure --rival v1 --human-rival --trials 40`):

| | gen 50 (campeón nuevo) | v2 anterior |
|---|---|---|
| contra el campeón anterior | 69,3 % (±6,4), +4,30 puntos | – |
| contra pesos a mano | 97,8 % (±2,1) | 97,8 % (±2,1) |
| pasa la puerta 1 en la exposición | 100 % | 99 % |
| salida de la puerta 1 tocada o sacada | 18 % | 19 % |
| reentrada tocada o sacada | 20 % | 26 % |
| `turnorder` (≤ 4 m de la bola de Chris, 5 turnos) | 0 % en todos | – |

Antes de la cadena, la gen 50 pasaba la puerta 1 el 68 % (40 % con un rival y 33 % con dos cerca).

## Iteración D: reglas avanzadas (línea, recogida, ventanas) — hechas, NO activadas en el campeón

**Qué hay.** Se activan con `"advanced": true` en el archivo de pesos (`WeightFile2.advanced`); **`cpuWeights.json` no lo lleva todavía** (el criterio «ganarle al campeón sin las reglas» no se cumplió, ver abajo). Para probarlo: `{...file, advanced: true}` como en `tests/advanced.test.ts`. Sin genes nuevos (el genoma sigue en 29 números); constantes fijas en `config.ts` (`kantokuContinuationAttack` 0,6 estimado, `kantokuRivalSupport` 1).
1. **Amenaza del rival como valor esperado** (`attackThreat`, `cpuPlanner.ts`): ya no es la probabilidad de tocar, sino lo que gana el rival si acierta menos lo que pierde si falla, con las frecuencias de los cinco resultados de un intento de touch (tabla `src/game/attackTable.json`, generada con `npm run lineplay -- --write`: física real; según la distancia de mi bola a la línea más cercana, el ángulo del tiro respecto a esa línea y la distancia del tiro; una tabla para el rival humano —error `humanRivalError` y fuerza +10 % y +20 %, promediadas— y otra para la CPU, sin fuerza extra). Valores: los pesos del kantoku (`touchRivalBase`, `outRivalBase`, `shooterOutLater`). La zona premia entonces la bola con buen ángulo a su puerta también cerca de la línea (su amenaza baja).
2. **Recogida por compañeras:** la amenaza del rival `r` sobre mi bola baja por la mejor probabilidad de touch (× 0,6) de una compañera que juega antes que `r`; y la amenaza de `r` baja si una compañera que juega antes puede tocarlo y sacarlo.
3. **Ventanas:** el apoyo entre bolas propias depende de los rivales que juegan entre ellas (fuera o lejos = ventana abierta); y el mismo apoyo del rival se resta (si mi bola está fuera, los rivales a su alrededor se juntan sin miedo: atacar o sacar a uno cierra la ventana).
**Reglas del touch con salidas (Art. 15 cl. 1; `match.ts`):** el derecho a spark exige que la bola que golpea y la tocada queden en juego: si sale la que golpea no hay touch ni spark; si sale solo la tocada, el touch no es válido y el golpe termina el turno.

**Experimento de la línea (física real, rival humano, 400 intentos por celda)**: resultados a, e, b, b2, c, d en % (a falla y su bola sale · e falla y todo dentro · b salen las dos · b2 sale solo la suya · c sale mi bola, sin spark · d touch y spark) y valor esperado ilustrativo del rival con los pesos del campeón. Distancia de mi bola a la línea `dl`, tiro de frente (φ = 0°) a 10 m:

| fuerza | dl | a | e | b | b2 | c | d | mi bola sale tras d | valor esperado |
|---|---|---|---|---|---|---|---|---|---|
| +10 % | 0,2 m | 70 | 1 | 1 | 8 | 17 | 3 | 23 % | −1,27 |
| +10 % | 0,5 m | 55 | 7 | 0 | 7 | 18 | 14 | 75 % | −0,03 |
| +10 % | 1 m | 19 | 45 | 0 | 1 | 2 | 33 | 98 % | 1,92 |
| +10 % | 2 m | 0 | 68 | 0 | 0 | 0 | 33 | 100 % | 2,35 |
| +20 % | 0,5 m | 66 | 0 | 2 | 10 | 23 | 0 | 0 % | −1,29 |
| +20 % | 1 m | 62 | 0 | 0 | 8 | 18 | 12 | 73 % | −0,42 |
| +20 % | 1,5 m | 53 | 9 | 0 | 3 | 5 | 30 | 92 % | 0,82 |
| +20 % | 2 m | 19 | 41 | 1 | 1 | 1 | 38 | 99 % | 2,26 |

A 6 m el efecto se reduce a la bola a ≤ 0,5 m de la línea (+10 %: valor 0,81 a 0,2 m, 3,13 a 0,5 m, 4,24 a 1 m); con tiro en ángulo (45°) se parece al de frente pero algo más débil. Sin fuerza extra el rival casi nunca se sale al fallar, así que el efecto depende de que el rival se pase de fuerza (lo que dijo Chris). El spark saca mi bola casi siempre tras un touch aceptado (≥ 90 % con dl ≥ 0,5 m).

**Pruebas (`tests/advanced.test.ts`, 30 intentos por escenario; solo están las bolas indicadas).** Se exige el campeón con las reglas; entre paréntesis, el mismo sin ellas:
| escenario | con reglas (sin reglas) |
|---|---|
| L1: reentrada de mi blanca 2 con un rojo a 6 m que juega después: queda a ≤ 0,6 m de la línea | 30/30 (0/30) |
| L2: lo mismo con el rival fuera: no pega la bola a la línea | 0/30 |
| W1: roja 1 fuera, blancas 10 y 2 a 5 m: la 10 se junta con la 2 (con la 1 en juego entre ellas) | 8/30 (1/30) |
| W2: rojas 1 y 3 fuera: la 10 se junta con la 2 o la 4 (con las dos rojas en juego) | 19/30 (0/30) |
| W3: el doble, pasa la puerta 2 y toca a la roja 1 detrás | 30/30 |
| W4: dos rivales a tiro, ataca primero al que juega antes que mi 2 (la roja 1) | 30/30 (sin reglas 0/30: ataca a la 5) |
| R: mi blanca 2 fuera, rojas 1 y 3 juntas cerca de la 10: toca a una roja | 30/30 |
| R2: rojas juntas a 12 m: con mi blanca 2 fuera se acerca a ≤ 6 m (con mi blanca en juego a su lado) | 29/30 (11/30) |
Solo L1 y W4 los distingue la regla nueva; en W1, W2 y R2 la ventana abierta contra cerrada **ya se notaba sin las reglas** (la bola rival fuera ya no cuenta como amenaza), la regla no los mejora. Siguen pasando con las reglas puestas `continuation.test.ts` (toca con dos rivales 57/60, saca las dos 57/60), `spark.test.ts` (99,2 %), exposición y `turnorder`.

**Validación (error ×0,4, 200 partidos) y exposición, campeón con reglas contra sin ellas:**
| | con reglas | sin reglas |
|---|---|---|
| contra el campeón sin reglas | 51,0 % (±6,9), +0,51 puntos | – |
| contra pesos a mano | 99,0 % (±1,4) | 97,8 % (±2,1) |
| exposición: salida de la puerta 1 tocada o sacada · pasa la puerta 1 | 16 % · 100 % | 18 % · 100 % |
| exposición: reentrada tocada o sacada | 21 % | 20 % |
| `turnorder` | 0 % en los cinco turnos | 0 % |

**Actualización: las reglas se activaron en el campeón** (`"advanced": true` en `cpuWeights.json`, decisión de Chris) y se midieron con un rival tipo humano (`npm run humanduel`; ver BACKLOG): sin diferencia medible (98,3 % con reglas contra 99,0 % sin ellas, efecto techo con un rival débil). **El criterio «ganarle al campeón sin las reglas» no se cumple (51,0 %, empate técnico).** Causa probable: en los partidos CPU contra CPU el rival es una CPU que ejecuta con poco error y sin fuerza extra, así que la tabla del humano no se parece a ese rival y el efecto de la línea, la recogida y las ventanas casi no aparece. Para medirlas hace falta un rival que se parezca a una persona (error `humanRivalError` y fuerza de más). Por eso **las reglas quedan hechas y probadas pero apagadas** y **no recomiendo reentrenar 20 generaciones todavía** (el entrenamiento es CPU contra CPU y tampoco las vería). Tiempo del planificador con las reglas: media 39 ms por golpe (mediana 30, p90 58, máx. 172; `bench:plan --kantoku`).

## Correcciones tras jugarlo (iteración B2)

- **Faltas desde fuera:** el planificador tiraba por líneas que pasaban a pocos centímetros de otra bola. Ahora `cpuPlanner.safeCandidates` descarta los tiros cuyo margen de error puede tocar una bola que no se debe tocar (con una bola fuera, cualquiera; en un golpe normal, las ya sparkeadas) y, con una bola fuera, prueba más formas de entrar. Solo afecta al kantoku. Faltas desde fuera en posiciones reales: 2,9 % → 0,1 %. El campeón no se reentrenó para esto (sus pesos siguen siendo los mismos).
- **El pasto es una fuente de error mayor que la mira:** un tiro recto y exacto se desvía de lado 0,9 cm a 1 m, 5 cm a 4 m, 12 cm a 8 m y 23 cm a 14 m (`grassSigma`, medido con la física real). El filtro de seguridad ya lo incluye; `hitProbability` (que usan `posProb`, la exposición y los puntos esperados) todavía no, así que subestima la dispersión a distancias largas. Hay que incluirlo antes de reentrenar. Si cambian la fricción o `grassBumpiness`, hay que volver a medirlo.
- **Error del nivel «Kantoku IA»:** `kantokuLevelErrorScale` y `kantokuLevelPlanScale` en `config.ts` (0,4 los dos): lo que de verdad se equivoca y lo que el planificador cree que se equivoca. Bajar solo el primero no cambia la estrategia entrenada; bajar también el segundo la cambia en ≈42 % de las posiciones (con distancias casi iguales).

## Nota: hay que reentrenar si cambian…
- **`clockFactor`** (o las esperas: `messageSeconds`, `cpuAnimSpeed`): cambia cuántos turnos tiene un partido, y con ellos lo que significa cada fase y cuánto vale arriesgar. Volver a medir con `npm run rounds` y actualizar `CONFIG.kantokuRoundSeconds`.
- **Las reglas** de `src/game/match.ts` (puertas, touch, spark, faltas, bola fuera…): el kantoku aprende sobre ellas.
- **Los perfiles de certeza** (`playerCertainty`, `certaintyBands`) o el error base (`kantokuBaseError`): cambian qué tan arriesgado es cada golpe.
- **La física** (fricción, rebotes, tamaño de bola y puerta).
- **El genoma** (`GENES` en `weights.ts`): el estado guardado en `training/` es de otro genoma; usar `--fresh`.

## Propuesta de uso por nivel (a confirmar con el campeón)

Hoy solo existe el nivel temporal **«Kantoku IA»** (campeón con `kantokuBaseError` × certeza). Con lo medido, esta es la propuesta para cuando Chris lo pruebe:

| Nivel | Cerebro | Estrategia (`strategy`) | Ruido de valoración | Error de ejecución |
|---|---|---|---|---|
| 1 Torneo del barrio | pesos a mano | 0,6 | 1,2 | el de hoy (mira 0,15 m) |
| 2 Torneo distrital | pesos a mano | 0,8 | 0,7 | el de hoy (mira 0,08 m) |
| 3 Torneo nacional | campeón | 0,95 | 0,3 | error base × certeza del jugador |
| 4 Mundial | campeón | 1 | 0 | error base × 0,7 × certeza del jugador (en vez del error de 1 cm) |

Dos advertencias: (1) el campeón es **muy agresivo** (saca 6,7 bolas rivales por partido en el final): conviene que lo juegue Chris antes de decidir que es el nivel más alto o si resulta frustrante; y (2) los niveles 1–2 con pesos a mano son muy pasivos (74–79 % de golpes de acomodo en el medio y el final), y quizá convenga un nivel intermedio con el campeón con más ruido y más error.

## Iteración E (2026-10-22): kantoku v3 — entrenado y, tras corregir un criterio, **campeón** (ver la corrección al final de la sección)

**Qué se entrenó.** `npm run train -- --v3 --generations 30 --sigma 0.25 --risk-weights 1,1,1,1,1` (117 min): los 29 números del v2, con los valores de partida del campeón actual, más 5 constantes de reglas como genes (`RULE_GENES` en `weights.ts`; el archivo de pesos las lleva en `rules`). Liga por candidato: 2 pares contra el campeón actual, 1 contra el v2 de respaldo, 1 contra el salón de la fama, 1 contra pesos a mano y 2 rondas de grupo; cada 5 generaciones, diagnóstico de la media contra un rival tipo humano (no entra en la aptitud). Los factores de línea, recogida y ventanas quedaron fijos en 1: `npm run lineplay -- --compare` mostró que en CPU contra CPU la línea no pesa (su intento de touch casi nunca saca bolas). La fuerza extra al atacar (0,2 m por metro) también es fija.

**Selección** (puntos de control 20–30, 100 partidos cada uno contra el campeón actual): 56,5 / 62,5 / 63,5 / 52,0 / 57,5 / 57,5 / 60,0 / 60,5 / 58,5 / 60,0 / 54,5 %. Elegida la generación 22; guardada como `src/game/cpuWeights.v3.json`. **No mejora desde la generación 21:** de la 21 a la 30 la media es 58,7 % (21–25: 58,6 %; 26–30: 58,7 %; cada punto ±9,6), sin tendencia, y σ solo baja de 0,18 a 0,15. El 63,5 % de la generación 22 es el máximo de 11 valores ruidosos; en el veredicto (200 partidos) bajó a 60,0 %, que es lo que cabe esperar de una meseta en ≈ 59 %.

**Validación de los criterios de reemplazo** (la generación 22 contra el campeón actual, mismos escenarios y semillas):

| Criterio | Valor | ¿Cumple? |
|---|---|---|
| ≥ 57 % contra el campeón actual, límite inferior > 50 % (200 partidos) | 60,0 % (±6,8; límite inferior 53,2), +1,60 puntos | sí |
| ≥ 90 % contra pesos a mano (200 partidos) | 98,5 % (±1,7), +11,06 | sí |
| Pasa la puerta 1 ≥ 95 % | exposure A: 84 % (en «todos en la salida» solo 39 %; el actual 99 %); `gate1exit`: 249 de 300 = 83 % (actual 298/300); `gate1.test.ts`: 81,7 % | **NO** |
| `turnorder` ≤ 10 % en los cinco turnos | 0 / 0 / 0 / 0 / 0 % (el actual 0 %) | sí |
| `humanduel` ≥ 96 % (200 partidos) | 98,0 % (±1,8), +11,63 puntos (el actual 97,8 %, +13,22) | sí |
| Menos exposición que el actual | reentrada tocada 14 % (actual 18 %); salida de la puerta 1 tocada 20 % (actual 24 %); cerca de la salida es poco frecuente en los dos | sí |
| Pruebas | pasan `rules`, `planner`, `cma`, `entry`, `grass`, `threat`, `continuation`, `spark`, `advanced`, `touchattempt`, `gateexit`, `heap`; fallan `gate1` (81,7 %), `heaprisk` (J1 0,06 < 0,08 y J4 0,08 < 0,1: los umbrales suponen `heapRisk` ≈ 0,2) y `genes3` (3 comprobaciones que suponen las reglas de `config.ts`) | **NO** (`gate1`) |
| `test:smoke` (también `LEVEL=4`) y `test:browser` | sin errores | sí |
| Tiempo por golpe ≤ 100 ms | 42,0 ms de media (actual 37,4), máx. 368 ms | sí |

**Por qué falla la puerta 1.** Con todas las bolas en la salida y ninguna rival en juego, el v3 elige muchas veces un golpe de 2,5 m que no sale del área de salida (la bola vuelve a la salida): «pasa el turno». Puntos casi sin valor al inicio (`inicio.point` 0,43 → 0,17), faltas más caras (5,1 → 7,1) y salir de la cancha más barato (2,6 → 1,7) le hacen preferir esperar a que otra bola abra el juego. Contra una CPU eso no cuesta (gana 60 %), pero contra una persona es perder tiempo y turnos, y es justo el comportamiento que Chris no quiere. El campeón actual pasa la puerta 1 casi siempre.

**Los 5 genes nuevos** (valor inicial → v3):

| Gen | Inicial | v3 | Qué significa en gateball |
|---|---|---|---|
| `contAttack` | 0,60 | 0,72 | Cuánto confía en que un touch + spark salga: tras pasar una puerta o hacer un touch cuenta más con seguir atacando a las bolas rivales a tiro. Está más cerca de lo medido (touch ≈ 90 % y spark 99 %). |
| `heapRisk` | 0,20 | 0,07 | Casi no le importa que el rival entre a su montón y le saque varias bolas de una vez. Coincide con lo medido: con pesos altos perdía fuerza contra CPU; las CPU no explotan los montones. |
| `heapValue` | 1,00 | 1,38 | Le gusta más mandar una compañera al montón rival (tocarla y mandarla con el spark al medio). |
| `heapSparkP` | 0,60 | 0,65 | Casi igual: la estimación de que el spark deje la bola en el montón estaba bien. |
| `rivalSupport` | 1,00 | 0,88 | Casi igual: mide algo menos el apoyo entre las bolas rivales. |

**Diagnóstico con rival tipo humano en los puntos de control** (24 partidos cada uno, solo una alarma): gen 1 98 %, **6 90 %, 11 92 %, 16 85 %**, 21 98 %, 26 96 %, **30 94 %** (las medias de las generaciones 6, 11, 16 y 30 bajaron de 96 %; con 24 partidos una sola derrota ya es 96 %). La generación 22 elegida no estaba entre los puntos medidos; su medida de verdad (`humanduel`, 200 partidos) es 98,0 %.

**Decisión:** el campeón actual se queda. El v3 está en `src/game/cpuWeights.v3.json` por si se retoma. Opciones: (a) seguir entrenando con una condición de «pasar la puerta 1» (penalizar la aptitud si no sale de la salida cuando no hay nada que hacer, o un golpe de salida forzado); (b) no entrenar más: el v3 no pasa de ≈ 59 % contra el actual y es un empate técnico con él fuera del escenario de la salida.

### Corrección (2026-10-22): esperar a pasar la puerta 1 es una táctica real — el v3 es el campeón

**El criterio de «pasar la puerta 1 ≥ 95 %» estaba mal planteado.** Chris: en el gateball real es común dejar una o algunas bolas sin pasar la puerta 1 a propósito; el entrenamiento la descubrió solo. Se reemplazó por criterios de que **espere con sentido** (`tests/gate1.test.ts`, ver abajo) y, con ellos, el v3 (generación 22) cumple todo y es el campeón (`src/game/cpuWeights.json`); el anterior quedó en `src/game/cpuWeights.v3prev.json` (para volver, copiarlo sobre `cpuWeights.json`).

**Cuándo espera el v3** (`npm run waitdiag -- --games 60 --human`: 60 partidos por cerebro, mismas semillas y colores, contra un rival tipo humano —el v1 con `humanRivalError` y +10 %/+20 % de fuerza— y el kantoku sabiéndolo, como en el juego; un turno cuenta como «espera» si el golpe elegido, sin error, no pasa la puerta 1 de una bola que aún no la pasó):

| | v3 | campeón anterior |
|---|---|---|
| Turnos con una bola sin pasar la puerta 1 / de ellos espera | 333 / 27 (8 %) | 306 / 0 (0 %) |
| Por bola de su equipo (1.ª a 5.ª) | 25 / 8 / 3 / 0 / 0 % | 0 % en todas |
| Por fase | inicio 9 %, medio 0 %, final 0 % | 0 % |
| Turnos que quedan (5-7 / 3-4 / ≤2) | 10 / 0 / 0 % | 0 / 0 / 0 % |
| Marcador (pierde por ≥4 / parejo / gana por ≥4) | 0 / 8 / 0 % | 0 / 0 / 0 % |
| Rivales en juego (ninguno / 1-2 / 3+) | 34 / 0 / 0 % | 0 / 0 / 0 % |
| Rival a ≤ 8 m de la salida de la puerta 1 | 0 % (45 turnos) | 0 % |
| Bolas que esperaron y pasaron después / quedan sin pasar al terminar | 27 de 27 / 0 de 60 equipos | – / 0 |

Es decir, el v3 espera **solo en la primera vuelta y casi siempre con el tablero vacío** (ninguna rival en juego): sobre todo la 1.ª bola de su equipo (la primera en mover: 25 % de sus turnos, 20 de 81) y a veces la 2.ª y la 3.ª; **nunca** con una rival a tiro de la salida (ahí pasa y ataca), nunca con 4 turnos o menos, nunca perdiendo, y todas las bolas que esperaron pasaron después (ninguna queda sin pasar al terminar). Una vuelta de espera de una bola es un uso moderado, no un exceso. **No es la táctica de dejar bolas sin pasar hasta el final para atacar luego**. Chris no completó su descripción de cómo se usa (el mensaje traía la plantilla «[por ejemplo: …]» sin rellenar), así que comparé con esas hipótesis: el v3 coincide en que no espera con poco tiempo, perdiendo ni ante una oportunidad clara, pero no en «las últimas bolas» ni «hasta el final». Si Chris describe su uso real (qué bolas, cuándo, hasta cuándo), se puede medir contra eso con `waitdiag`.

**Aparte: en CPU contra CPU, el campeón anterior también se queda parado toda la primera vuelta** (`npm run waitdiag -- --games 60`, sin `--human`): sus 10 bolas apuntan a (20,5; 15,5) en los 10 primeros turnos, porque el kantoku cree que su rival es una CPU certera y que pasar la puerta 1 es entregar la bola a las cinco rivales de la salida. Contra una persona (`rivalIsHuman`) no pasa. Importante para el entrenamiento: en la liga el kantoku modela a su rival como CPU, y por eso el v3 aprendió una espera que contra una persona aparece menos (8 % de los turnos, frente al 54 % en CPU contra CPU).

**Criterio nuevo de la puerta 1** (`gate1.test.ts`, sin exigir «pasar siempre»): S1 con una o dos rivales a tiro de la salida pasa y ataca ≥ 90 % (v3 30/30 y 30/30; antes 30/30); S2 con poco tiempo (le queda un turno) y tablero vacío pasa ≥ 90 % (v3 29/30; antes 29/30); S3 perdiendo por 9 con pocos turnos pasa ≥ 90 % (v3 30/30; antes 30/30); S4 cuando pasa, queda a ≤ 5 m de la salida en ≤ 10 % (v3 0 %; antes 1,7 %) y la bola rival siguiente la toca o la saca en ≤ 35 % (v3 18 %; antes 22 %). Solo se imprime, sin exigencia: la espera con el tablero vacío en la primera vuelta (v3 pasa 12/30, antes 30/30). `continuation.test.ts` ya medía la oportunidad clara y sigue pasando con el v3.

**Pruebas reescritas para no depender de lo que entrene el campeón:**
- `heaprisk.test.ts`: ya no usa el `heapRisk` del campeón (el v3 lo dejó en 0,07): la prueba lo fija en 1 en el archivo de pesos (`REF`) y mide cuánto sube el premio por separar las bolas con ese peso (J1 ≥ 0,3, J4 ≥ 0,3, J3 menos que J1, J5 la certera menos que la torpe, J2 sin cambio). Además comprueba que el término **escala con el peso** (con la mitad, la mitad del efecto ±25 %; con 0 desaparece). Así el umbral mide el mecanismo, no la constante entrenada.
- `genes3.test.ts`: el punto de partida de la prueba son los pesos del campeón sin sus `rules` (así las reglas valen lo de `config.ts`); un partido con ese genoma es idéntico al del campeón sin reglas, y «con otras reglas el partido cambia» se comprueba en cuatro partidos (basta que cambie uno) y 150 golpes, porque en los primeros golpes (la espera de la primera vuelta) las reglas del montón no intervienen.

**Resultado final de la validación del v3** (200 partidos salvo lo indicado): contra el campeón anterior 60,0 % (±6,8), contra pesos a mano 98,5 %, `turnorder` 0 %, `humanduel` 98,0 % (±1,8), reentrada tocada 14 % (18 %), tiempo 41,7 ms por golpe (37,4), `npm test` con todas las pruebas, `test:browser` y `test:smoke` (también con `LEVEL=4`), spark 98,1 %. Pendiente: que Chris juegue contra él (¿se nota la espera de la primera vuelta?, ¿el montón?).

## Vocabulario del gateball que usa el kantoku (Chris, 2026-10-23)

- **Agari (上がり, «llegar / terminar»):** llevar la bola al poste y sacarla del juego (+2 puntos). En el gateball real el agari **temprano es una desventaja**: la bola sale del juego, el equipo queda con menos bolas para atacar, defender y hacer tsunagi, y el rival avanza sin peligro. Un kantoku calcula el momento: normalmente la última o penúltima vuelta de esa bola. **Regla del kantoku** (`kantokuAgariTurns` = 2 en `config.ts`; `legacyAgari: true` en el archivo de pesos la apaga para comparar): una bola lista para el poste no va mientras le queden **más de 2 turnos** (el turno actual cuenta; turnos que quedan = los del reloj, `upcomingTurns`); se queda en juego, cerca del poste (premio `kantokuAgariReady` por su probabilidad de llegar al poste desde donde queda, y candidatos que paran a 0,9 y 1,6 m del poste) o en una posición útil (el planificador la escondió junto a la línea a 8–9 m del poste con probabilidad 0,79 de llegar: la amenaza de las rivales lejanas pesa más). **Excepciones** en las que sí puede ir antes: (1) que ir dé el juego perfecto (25 puntos); (2) que la bola vaya a ser sacada casi seguro en cualquier alternativa (la mínima amenaza de las próximas tres rivales sobre ella, `ballThreat`, ≥ `kantokuAgariThreat` = 0,8); (3) que sea la última bola del equipo y el partido ya esté decidido (sus puntos con el poste superan los del rival más todo lo que aún le puede sumar). Si no queda otra jugada, también va. `tests/agari.test.ts`: lista para el poste con 6 turnos por delante va 0/30 (sin la regla 29/30); con 1 turno 29/30; juego perfecto 29/30; amenaza con un anillo de rojas 0,87 (sin anillo 0,39); última bola con el partido decidido 24/30 (sin decidir 0/30).
- **Tsunagi (つなぎ, «puente, enlace»):** una bola lejos de su blanco se acerca encadenando touches a otras bolas cercanas (suyas o de cualquier equipo): toca una, gana el spark y un golpe extra desde donde quedó (junto a la bola tocada), y desde ahí toca la siguiente, pasa su puerta o toca el blanco. Antes el riesgo solo miraba lo que la rival lograba con **un** tiro (pasar su puerta o tocar directo; y «pasar su puerta y tocar con el golpe continuo»), así que daba por lejana a una rival que con dos bolas de puente no lo estaba (el caso de la blanca 6 detrás de la puerta 3 y la roja 7). **`ChainModel`** (`src/game/threat.ts`): cadenas de 2 y 3 pasos (`kantokuChainDepth`), con la probabilidad de cada touch según la certeza del tirador a esa distancia y `K` = `kantokuContinuationAttack` (probabilidad de que el touch y el spark den el golpe extra) entre pasos; una cadena puede terminar pasando la puerta del tirador y tocando con el golpe continuo; solo los 5 puentes más cercanos al tirador y 4 más al siguiente (acota el costo), con memorias compartidas de geometría y de probabilidades. **En el riesgo:** `Math.max(touchThreat, cadena)` por rival y bola mía. **Al revés** (`bridgePass`): una bola propia que se acerca a su puerta tocando una bola cercana y pasando desde ahí cuenta con esa probabilidad en su zona de entrada, con `kantokuBridgeWeight` = 0,5. **F2** (sexto modo, «TSUNAGI») dibuja las cadenas de las próximas rivales sobre las bolas de la CPU (≥ 8 %, más gruesa = más probable). `legacyChains`, `legacyChainRisk` y `legacyBridges` en el archivo de pesos las apagan (solo para comparar). Caso de Chris con el modelo: la roja 7 a (4; 7), puentes en (6,2; 9,2) y (8; 11,4), mi blanca detrás de la puerta 3 en (12,6; 13): amenaza **0,20** por la cadena 7 → 1 → 6 (rival humano; sin puentes 0,00); dejar la bola ahí vale 0,06 menos que antes (sin puentes 0,03); con una compañera en su camino a la puerta 2, una bola propia cuenta con 0,50 de pasarla encadenando (sola 0,00).
- **Otros términos usados en el código y los documentos:** *kantoku* (監督, el director técnico que decide la jugada), *touch* y *spark* (reglamento, Art. 15–16), *golpe continuo*, *bola fuera*, *montón* (bolas juntas), *apertura* (libro de la primera vuelta, `opening.ts`).

## Iteración F (2026-10-24): entrenar juntos los términos agregados tras jugar contra el v3 — entrenada y DESCARTADA (2026-10-25)

**Por qué.** Tras las partidas de Chris se agregaron cuatro términos al planificador y, medidos a mano, cada uno costaba fuerza contra los pesos a mano (`validate` 200 partidos, base +10,26 puntos, 98,0 %): touch a compañeras con destinos de spark (`kantokuMateWeight` 1), premio a esperar pegado a la línea (`kantokuLineSpotBonus`), riesgo por valor (`kantokuRiskByValue`, pasar su puerta en la escala de tocar y sacar) y el doble del rival (`kantokuTouchPassScale`). Los pesos del campeón no se entrenaron con ellos, así que sus valores a mano desequilibran la valoración. Ver `BACKLOG.md` («Touch a compañeras…» y «Espera pegada a la línea»).

**Qué cambia.** Cuatro genes de reglas nuevos en `RULE_GENES` (`src/game/weights.ts`), con su valor de `config.ts` como punto de partida: `lineSpot` (0–1,5), `mateWeight` (0–1,5), `passScale` (0,14–1; 1 = como antes, 0,14 = por valor) y `touchPass` (0–3). Quedan 38 números (29 del v2 + 9 reglas). `--human-fit N` (nuevo en `scripts/train.ts`): N pares por candidato contra un rival tipo humano (el v1 con `humanRivalError` y fuerza de más en el touch) **que sí entran en la aptitud**; hasta ahora ese rival solo se medía como diagnóstico, y justo la exposición ante una persona (centro frente a la puerta, sitios de la línea) es lo que Chris vio fallar.

**Cómo correrlo** (en otra terminal; ≈ 10 min por generación con 7 hilos, unas 5 h las 30):

```
npm run train -- --v3 --dir training/f --generations 30 --sigma 0.25 --risk-weights 1,1,1,1,1 --human-fit 3
npm run select -- --dir training/f --from 20 --to 30 --step 2 --games 100 --verdict
```

Parte del campeón actual (`src/game/cpuWeights.json`, guardado en `training/f/start.json`), retoma solo si se corta y publica en `src/game/cpuWeights.next.json`, **sin reemplazar al campeón** (usa un `--dir` nuevo: el estado de `training/v3` es de otro tamaño de genoma). El piloto de 1 generación (λ = 4) corre bien: 67 s, 42 partidos.

**Criterios para adoptarlo** (hay que cumplirlos todos antes de reemplazar el campeón; lo decide Chris):
1. `validate` 200 partidos (error ×0,4) contra pesos a mano: ≥ 98 % y diferencia media ≥ +10 puntos (hoy +10,26).
2. `humanduel` 200 partidos ≥ 96 %, y mejor que el campeón actual en diferencia de puntos.
3. Contra el campeón actual (`select --verdict`): ≥ 57 % con límite inferior > 50 %.
4. Pasan `npm test` completo, en especial `matespark`, `touchpass`, `outofcourt` y `openings`.
5. `npm run audit -- --games 40`: touches a compañeras por partido ≥ 14 (hoy 16,5) y salidas de cancha ≤ 0,3 por partido.
6. A mano: que la espera junto a la línea y el touch a compañeras se vean en partida (registro en `partidas/`, `npm run replay`).

**Resultado (2026-10-25): no adoptado.** Generación 28 elegida (67,0 % contra el campeón, +2,98 puntos), pero falló `continuation.test.ts` (0/60 al pasar la puerta 1 con rivales cerca): aprendió a esperar (`contAttack` 0,49 contra 0,72 y menos peso al touch en la base), en todas las generaciones 20-30. Con la regla de ataque fija (puertas 1 a 3) el candidato recupera esa prueba (60/60) y gana al campeón 74,0 % (200 partidos), pero **pasa 17 de las 24 pruebas** (corridas por separado con `npm run tests:todas`; el campeón con la regla pasa las 24) y **no pasan 7**: fallan `gateexit` (pasa la puerta 3 en 34/50, mínimo 35), `advanced` W4 (toca primero a la roja 1: 1/30), `heap` (16/40 frente a ≥ 50 %), `tsunagi` B (0,03 frente a ≥ 0,04), `spark` (97,9 % frente a 98 %) y `matespark` B (6/19), y `touchpass` (A y C) no se puede aplicar a un candidato con genes propios. Además hace menos touch a compañeras (12,3 contra 15,4 por partido). Detalle en `HISTORIAL.md` («Iteración F: el candidato NO se adopta»).

**Decisión (Chris, 2026-10-25): candidato DESCARTADO; se queda el campeón actual con la regla fija de ataque.** El archivo está en `candidatos-descartados/cpuWeights.F-gen28.json`. Gana más (74,0 % contra el campeón con la regla, 200 partidos) pero no respeta las reglas de kantoku real que Chris enseñó: pasa solo 17 de las 24 pruebas de comportamiento (fallan 7).

**Lección.** El entrenamiento solo premia ganar (victorias + 0,02 × diferencia de puntos contra una liga de CPU). Un comportamiento que no está en la aptitud —pasar la puerta y atacar con rivales cerca, hacer touch a compañeras, esperar junto a la línea— se pierde si el optimizador encuentra algo que gane igual sin él, y aquí lo hizo en todas las generaciones 20-30. Si se repite un entrenamiento:
1. **Fijar los genes de esas reglas** (quitarlos de `RULE_GENES`/la base, o acotarlos a un rango estrecho alrededor del campeón: `contAttack`, `touchRivalBase`, `continuation`), o
2. **meter las pruebas de comportamiento en la aptitud**: antes de contar a un candidato, correr una versión corta de `continuation`, `attackrule` y `matespark` (cientos de ms por prueba con pocos intentos) y restarle aptitud —o descartarlo— si falla; o ambas.
Las reglas que no deben perderse se programan como reglas fijas (como `kantokuAttackRule`) y no como genes.

## Nota (2026-10-26): la certeza del nivel «Kantoku IA» ya no es la del entrenamiento
El nivel usa `humanRivalError` × 0,6 (`kantokuLevelHuman`); el entrenamiento y `select` siguen con `kantokuBaseError` × 0,4 (`kantokuTrainErrorScale`). Los pesos del campeón suponen un 94 % de acierto en el touch; con la certeza nueva hay más esperas en la salida, más salidas de cancha y menos fuerza (humanduel 95,8 % → 85,0 %). Si se reentrena: usar la certeza del nivel en la liga (error base y escalas), `--human-fit`, y fijar los genes de las reglas o meter las pruebas de comportamiento en la aptitud. Ver `BACKLOG.md` («Certeza del nivel Kantoku IA»).

## Iteración G (2026-10-26): kantoku v4 de consolidación — IMPLEMENTADA Y PILOTADA, sin correr completa

**Por qué.** Desde el v3 se agregaron reglas fijas por lo que Chris vio jugando (touch lejano y de línea, doble ángulo, combos, punto seguro primero, avance con pocos turnos, valor de sacar una rival por su peligro, supervivencia de la compañera, destinos del spark sin postes) y la certeza bajó al ×0,6. El campeón se entrenó sin ellas. Medido: `validate` 200 partidos (×0,4) contra pesos a mano, **92,8 % (+8,06 puntos)** con las reglas y el riesgo por valor apagado, **88,0 % (+6,17)** con él encendido; antes de las reglas, 98,3 % (+10,08). El v4 debe recuperar ese costo.

**Qué queda fijo.** Certeza humana ×0,6 (`kantokuLevelErrorScale`; el v4 usa `baseHuman`: error base `humanRivalError`, no el del entrenamiento ×0,4). Todas las reglas de `config.ts` y las constantes de reglas del campeón de partida (`start.json` → `rules`, no son genes). Rebote 0,35. Rival de la aptitud: el v1 con error humano y fuerza de más (`--human-fit`).

**Qué aprende** (31 números): los 29 del v2 (pesos base y multiplicadores por fase) más `leadSlope` y `clockSlope` (0–1,5; 0 = neutro). `balanceMul` (`cpuPlanner.ts`): `1 + leadSlope × clamp(−ventaja/6) + clockSlope × (avance del partido − 0,5)`, acotado a [0,5; 2]. Multiplica el valor de los puntos y **divide** el del ataque (touch, oportunidad de touch, spark propio, preparar el turno de una compañera). Perdiendo o con poco tiempo pesan más los puntos; ganando y con tiempo, el ataque.

**Aptitud.** `partidos (victorias + 0,02 × diferencia) + 0,5 × comportamiento`; un candidato con comportamiento < 60 % resta 1 (descarte práctico). `scripts/behavior.ts` (`npm run behavior [-- --file x.json]`): seis escenarios con tablero literal de la partida de Chris (S2 poco tiempo pasa la puerta 1, T34, T54b, T12, T42, T54a), 4 semillas cada uno, ≈ 3 s por candidato. Para agregar un escenario basta una entrada en `SCENARIOS`. Las pruebas de verdad siguen siendo las de `tests/`.

**Decisión pendiente de Chris: riesgo por valor.** Encendido arregla el T12 y mejora humanduel (86,3 % contra 82,8 %), pero con los pesos actuales rompe `gate1` S2, `combo`, `longtouch` D y `survival` (las pruebas se calibraron con la certeza ×0,4). Por eso `kantokuRiskByValue` sigue en `false` en `config.ts`. La propuesta es entrenar el v4 **con él encendido** (`NANABAN_SET=kantokuRiskByValue=true`, los hilos lo heredan) para que los pesos se acomoden, y adoptar ambos juntos (pasar `kantokuRiskByValue` a `true` y reemplazar `cpuWeights.json`). Si se prefiere apagado, quitar el prefijo del comando.

**Piloto (2 generaciones, λ = 24, 7 hilos, `training/pilot4`):** sin errores. 23,5 min en total (≈ 11–12 min por generación, de los cuales ≈ 1 min es la batería de comportamiento). Tras 2 generaciones: comportamiento 99 %; la media gana 83 % a los pesos a mano y 46 % al campeón actual (12 partidos, ruido); contra el rival tipo humano 75 % (24 partidos, **bajo el 96 %** de referencia, todavía sin afinar; es lo que hay que vigilar).

**Cuánto tarda y cómo correrlo.**
- **Opción A (≈ 6 h):** 24 generaciones, comportamiento en todas. 24 × ≈ 11,7 min ≈ 4,7 h de entrenamiento + ≈ 1,3 h de selección y validación.
  ```
  NANABAN_SET="kantokuRiskByValue=true" npm run train -- --v4 --generations 24 --sigma 0.25 --risk-weights 1,1,1,1,1 --human-fit 3 --behavior 0.5
  NANABAN_SET="kantokuRiskByValue=true" npm run select -- --v4 --dir training/v4 --from 14 --to 24 --step 2 --games 100 --verdict
  ```
- **Opción B (≈ 7 h):** 30 generaciones con la batería cada 2 (`--behavior-every 2`): 30 × ≈ 11,1 min ≈ 5,5 h + ≈ 1,3 h. La batería es solo ≈ 10 % de cada generación, así que correrla cada 2 ahorra ≈ 5 %: lo que más ahorra es bajar las generaciones.
  ```
  NANABAN_SET="kantokuRiskByValue=true" npm run train -- --v4 --generations 30 --sigma 0.25 --risk-weights 1,1,1,1,1 --human-fit 3 --behavior 0.5 --behavior-every 2
  NANABAN_SET="kantokuRiskByValue=true" npm run select -- --v4 --dir training/v4 --from 20 --to 30 --step 2 --games 100 --verdict
  ```
Se retoma solo si se corta (mismo comando) y publica en `src/game/cpuWeights.next.json` sin reemplazar al campeón. Mientras entrena, no uses el equipo para otra cosa pesada (los tiempos suponen la máquina libre).

**Criterios para adoptarlo** (todos; lo decide Chris):
1. `validate` 200 partidos (`--error-scale 0.4`) contra pesos a mano: **mejor que el campeón de hoy (92,8 %, +8,06)** y, como meta, ≥ 96 % con ≥ +9 puntos. El 98 % histórico se midió antes de las reglas fijas; con ellas puede no recuperarse del todo: es una decisión de Chris si se acepta menos.
2. `humanduel` 200 partidos: ≥ 86 % y límite inferior por encima del campeón actual.
3. Contra el campeón actual (`select --v4 --verdict`): ≥ 57 % con límite inferior > 50 %.
4. Pasa `npm test` completo **con `kantokuRiskByValue` en `true` y sin ablandar ningún umbral** (hoy `matespark` B está debilitado y se espera que el v4 lo recupere).
5. `audit --games 100`: puertas por turno ≥ 0,50, touches de más de 6 m ≤ 8 por partido con acierto ≥ 55 %, salidas de cancha ≤ 0,3 por partido.
6. `npm run behavior -- --file cpuWeights.next.json` ≥ 95 %, y a mano: los seis turnos (12, 28, 34, 42, 54a, 54b) corregidos en una partida nueva.

### Comandos para lanzar el v4 en PowerShell (decisiones de Chris, 2026-10-26: riesgo por valor encendido y adoptado junto con el v4, piso de `validate` 90 %, opción A)

Todo en la **misma ventana de PowerShell** (la variable de entorno vale solo en ella), desde `d:\Projects\gateball\gateball-retro`:

```powershell
# 1. Entrenar (≈ 5 h): 24 generaciones; se retoma solo con el mismo comando si se corta
$env:NANABAN_SET="kantokuRiskByValue=true"
npm run train -- --v4 --generations 24 --sigma 0.25 --risk-weights 1,1,1,1,1 --human-fit 3 --behavior 0.5

# 2. Elegir entre los puntos de control (≈ 40 min); escribe src/game/cpuWeights.next.json
npm run select -- --v4 --dir training/v4 --from 14 --to 24 --step 2 --games 100 --verdict

# 3. Validar el candidato (con la variable puesta, como se jugaría)
npm run validate -- --games 200 --error-scale 0.4 --file src/game/cpuWeights.next.json
npm run humanduel -- --variant rules --games 200 --file src/game/cpuWeights.next.json --tag _v4
npm run behavior -- --file src/game/cpuWeights.next.json
npm run audit -- --games 100 --brain src/game/cpuWeights.next.json --set kantokuRiskByValue=true

# 4. Para comparar con el campeón actual: SIN la variable (el campeón se calibró sin el riesgo por valor)
Remove-Item Env:NANABAN_SET
npm run humanduel -- --variant rules --games 200 --tag _champ
npm run audit -- --games 100
```

**Verificar que la variable se aplicó:** al arrancar, `train` imprime la primera línea `Configuración activa → NANABAN_SET='kantokuRiskByValue=true' · kantokuRiskByValue=true · kantokuZonePassP=0.5`. Si dice `kantokuRiskByValue=false`, la variable no llegó (el v4 además se detiene con un error). También se puede comprobar antes con `echo $env:NANABAN_SET`.

**Criterios (pisos acordados):** `validate` ≥ 90 % (hoy 92,8 %); `humanduel` ≥ 86 % y por encima del campeón; `behavior` ≥ 95 %; ≥ 57 % contra el campeón en `select --verdict`; `npm test` completo, con `matespark` B sin debilitar. **Para adoptarlo:** copiar `cpuWeights.next.json` sobre `src/game/cpuWeights.json` (guardar antes el actual como `cpuWeights.v3prev2.json`), pasar `kantokuRiskByValue` a `true` en `config.ts`, y correr `npm run build` y `npm run tests:todas` (algunas pruebas se calibraron con el riesgo por valor apagado: revisar con motivo, no ablandar en silencio).

### Cómo adoptarlo y etiquetar `kantoku-v1.0` (PowerShell, solo si cumple los criterios)

```powershell
# 0. Sin la variable de entorno en esta ventana (la adopción deja el riesgo por valor encendido en config.ts)
Remove-Item Env:NANABAN_SET -ErrorAction SilentlyContinue
# 1. Respaldo del campeón actual (v3) y reemplazo
Copy-Item src/game/cpuWeights.json src/game/cpuWeights.v3prev2.json
Copy-Item src/game/cpuWeights.next.json src/game/cpuWeights.json
# 2. En src/game/config.ts: kantokuRiskByValue: true (y actualizar su comentario)
# 3. Comprobar
npm run build
npm run tests:todas        # revisar con motivo cada umbral que cambie; matespark B debe recuperar su umbral original (0,2 y «más que antes»)
npm run behavior
# 4. Actualizar CLAUDE.md (campeón = v4, archivos de respaldo), BACKLOG.md, y commit
git add -A
git commit -m "Adopta el kantoku v4 (riesgo por valor encendido)"
git tag -a kantoku-v1.0 -m "Kantoku IA v1.0: campeon v4"
```
Si algo no cumple: no copiar nada y decidir con Chris (la `cpuWeights.next.json` se puede regenerar con `select`; el estado del entrenamiento queda en `training/v4/`).

### Resultado (2026-10-27): v4 entrenado, NO adoptado
24 generaciones; contra el campeón 55,5 % ±6,9 (no llega al 57 % pero el objetivo era consolidar); `behavior` 100 %; `matespark` B recuperado (14/20 contra 9/20). **Falla `npm test` completo con `kantokuRiskByValue` en `true`: 31/35** (`genes3`, `touchpass` A, `combo` A, `survival`); `combo` y `survival` fallan igual con el campeón v3 y ese riesgo. `leadSlope` 0,345 (perdiendo pesan más los puntos y menos el ataque, ±35 % a 6 puntos de diferencia); `clockSlope` 0 (en el límite: el avance del reloj no lo aprendió). Aviso al jugar: 9 salidas de la cancha por plan en 100 partidos (campeón 1) y 2,9 esperas en la salida de la puerta 1 por partido (campeón 1,7). `cpuWeights.next.json` queda sin adoptar; detalle en `BACKLOG.md`.

### Adopción (2026-10-27)
Chris eligió adoptar el v4 pese a no llegar al 57 % (humanduel 80,5 % ±5,4 contra 81,8 % ±5,2 del v3: dentro del ruido). Hecho: `cpuWeights.v3prev2.json` (respaldo), `cpuWeights.next.json` copiado a `cpuWeights.json`, `kantokuRiskByValue: true`, `genes3`, `combo`, `touchpass`, `survival` y `matespark` ajustadas con motivo en cada una (detalle en `BACKLOG.md`), `npm run build` y `npm run tests:todas` 35/35. Falta la etiqueta `kantoku-v1.0` (después del cálculo de turnos que quedan).

### Turnos que quedan según la cancha y doble «bola y puerta» (2026-10-27, sin reentrenar)
Ver `BACKLOG.md`. Archivos nuevos: `src/game/pace.ts`, `scripts/pacedata.ts` y `pacefit.ts` (ajustan el modelo a partidos reales: `npm run pacedata -- --games 30`, `npm run pacefit -- --search`), `scripts/h2h.ts` (`npm run h2h -- --file A.json --vs B.json --games 200`: dos kantokus con la certeza del nivel) y `cpuWeights.v4base.json` (el v4 de la adopción con `legacyComboFront`, `legacyFailPunish` y `legacyTurnModel`: el rival «sin estos cambios»). Resultado: 51,0 % ±6,9 contra él (200 partidos), humanduel 80,3 % (v4: 80,5 %), behavior 100 %, `npm test` 36/36, error de los turnos que quedan 1,14 → 0,54. Los pesos del v4 no cambiaron; `clockSlope` sigue en 0 y la urgencia es una regla fija (`kantokuClockUrgency`).

### Kantoku v1.1 (2026-10-27, sin reentrenar): enviar a marcar, cobertura que puede caer, cancha abierta y exposición de la reentrada
Ver `BACKLOG.md`. Archivos nuevos: `tests/mark.test.ts`, `src/game/cpuWeights.v10.json` (el archivo de pesos con las piezas nuevas apagadas: el «v1.0» para comparar con `npm run h2h -- --file src/game/cpuWeights.json --vs src/game/cpuWeights.v10.json`), escenarios `EXPOSURE_CASES` en `scripts/behavior.ts` y la sección 7 (exposición) de `npm run audit`. Resultado: 50,4 % ±4,9 contra el v1.0 (400 partidos), humanduel 81,5 % (v1.0: 80,3 %), behavior 96 %, `npm test` 37/37, exposición de las reentradas 0,776 → 0,690. Los pesos del v4 siguen siendo los mismos (`clockSlope` 0). Si se reentrena, las piezas del v1.1 (`kantokuSendSparkP`, `kantokuRiskRest`, `kantokuOwnExposure`, `kantokuCoverWeight`, `kantokuOpenField`) son candidatas a genes: la primera versión con valores altos costó fuerza.

### Kantoku v1.5 (2026-10-29, sin reentrenar): último turno con el resultado asegurado
Ver `BACKLOG.md` (observaciones de Chris de la partida 2026-10-28). Cambia una sola jugada: con el reloj en cero y el equipo ganando, la cadena final (`lastTurn.ts`) alcanza bolas a 18 m (`kantokuLastReachM`) y, a igualdad de valor, prefiere tocar a una compañera (`legacyLastReach` lo apaga). Nuevo: `tests/lastturn.test.ts`, `src/game/cpuWeights.v14.json` (la v1.4 para `npm run h2h`). Medido y NO cambiado: turno 24 (el riesgo es el máximo de las cadenas de cada rival), turno 28 (reentrada forzada, la cadena sí estaba en el modelo) y turno 16 (estilo).
- **Intentos descartados:** (1) alcance largo y desempate en TODO último/penúltimo turno: h2h 44,0 % contra la v1.4 (más candidatos con valoración ruidosa elige peor con el resultado en juego); (2) combo «bola y puerta 2» de rivales sin puerta 1: h2h 46,0 %, no cambia la jugada del turno 24. Con solo el último turno ganado: h2h 47,8 % (88/15/97, −0,57); **v1.4 contra v1.4 con las mismas semillas: 47,8 % (88/15/97, −0,60)**: el h2h de 200 partidos tiene ese sesgo.
- Validación: `humanduel` 200 = 84,5 % (7,05 puntos); `behavior` 98 %; `bench:plan --kantoku` 52,9 ms por golpe; `tests/i18n.test.ts` reproduce la v1.4.1 en 360/360 golpes con `legacyLastReach`.

### Kantoku v1.4 (2026-10-27, sin reentrenar): spark sin chocar con bolas mías, aperturas bloqueadas por cualquier bola, juntarse con ventana y avanzar según vuelva a jugar
Ver `BACKLOG.md`. Nuevos: `tests/partida1027c.test.ts`, `src/game/cpuWeights.v13.json` (`legacySparkClear`, `legacyOpeningRivals`, `legacyJoinWindow`, `legacyLateAgain`, `legacyLongSpot`: el «v1.3» para `npm run h2h -- --file src/game/cpuWeights.json --vs src/game/cpuWeights.v13.json`), `CONFIG.explainAlternatives` (alternativas que anota el registro). Resultado: 49,8 % ±6,9 contra el v1.3 en h2h, humanduel 87,3 % ±4,6 (v1.3: 86,0 %), 40/40 pruebas. Constantes candidatas a genes si se reentrena: `kantokuOwnOutCost/PerPoint`, `kantokuLongSpotM/Samples`, `SPOT_MARGIN` de `opening.ts`.

### Kantoku v1.3 (2026-10-27, sin reentrenar): último turno, salir a propósito, reentrada lejana y certeza ×0,53
Ver `BACKLOG.md`. Nuevos: `src/game/lastTurn.ts` (cadena de más puntos en el último turno y el penúltimo sin rivales que ataquen), `Match.clone`, `tests/partida1027b.test.ts`, `src/game/cpuWeights.v12.json` (`legacyLastTurn`, `legacySelfOut`, `legacyFarEntry`: el «v1.2» para `npm run h2h -- --file src/game/cpuWeights.json --vs src/game/cpuWeights.v12.json`). Resultado: 48,3 % ±6,9 contra el v1.2 en h2h, humanduel 86,8 % ±4,6 (v1.2: 74,3 %), 39/39 pruebas. Los genes no cambian; las constantes `kantokuLast*`, `kantokuSelfOutCost`, `kantokuReentryTried/Samples` son candidatas a genes si se reentrena. La certeza del nivel pasa a ×0,53 (el entrenamiento sigue con base × 0,4: no cambia).

### Kantoku v1.2 (2026-10-27, sin reentrenar): casi siempre se reentra
Ver `BACKLOG.md`. Nuevos: `tests/reentry.test.ts`, `src/game/cpuWeights.v11.json` (el archivo de pesos con `legacyLineCands` y `legacyReentryMust`: el «v1.1» para `npm run h2h -- --file src/game/cpuWeights.json --vs src/game/cpuWeights.v11.json`), la clasificación decisión/ejecución de las reentradas fallidas en la sección 7 de `npm run audit` y dos escenarios más en `npm run behavior`. Resultado: se quedan fuera 10,7 % → 0,4 % (el 10,7 % era 100 % decisión), exposición de las reentradas 0,753 → 0,629, 48,8 % ±6,9 contra el v1.1, `npm test` 38/38. Constantes candidatas a genes si se reentrena: `kantokuReentryMust`, `kantokuReentryLead`.
