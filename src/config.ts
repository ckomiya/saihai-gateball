// ============================================================
// AJUSTES DEL JUEGO — cambia estos valores para probar sensaciones.
// Todas las distancias están en METROS y los tiempos en SEGUNDOS.
// ============================================================

/** Patrón de una barra: dónde está el triángulo, qué tan rápido va y en qué tramos cambia la velocidad. */
export interface BarPattern {
  sweetSpot: number;
  cycleSeconds: number;
  zones: { from: number; to: number; speed: number }[];
}

export const CONFIG = {
  // --- Cancha (reglamento: 20–25 m × 15–20 m) ---
  court: {
    widthM: 20,
    heightM: 15,
  },

  // --- Bola ---
  // Medidas propias del juego, más grandes que las del reglamento (decisión de Chris; antes todo se veía muy grande).
  // Se tomó el área de salida (2 m) como escala de referencia, ≈ 45 px/m (iteración 11):
  // bola ≈ 0,17–0,25 m de diámetro y puerta ≈ 0,4 m de ancho interior. Real: bola 7,5 cm, puerta 22 cm.
  ballRadiusM: 0.1,

  // --- Puertas ---
  gateWidthM: 0.4,
  gatePostRadiusM: 0.03,
  poleRadiusM: 0.025, // medida propia; bajado de 0,05 a 0,025 por pedido de Chris (2026-10-28): el poste de meta se veía muy grueso y era demasiado fácil

  // --- Física del golpe ---
  minShotSpeed: 0.6, // m/s con fuerza 0 %
  maxShotSpeed: 16, // m/s con fuerza 100 %  (≈ 23 m de recorrido)
  // El pasto frena de dos formas:
  grassFriction: 2.2, // freno fijo en m/s² (roce constante del pasto)
  grassDrag: 0.35, // freno extra proporcional a la velocidad (la bola rápida pierde fuerza enseguida)
  slowZoneSpeed: 0.5, // por debajo de esta velocidad la bola "se clava" en el pasto…
  slowZoneFriction: 3, // …y frena este múltiplo más fuerte
  grassBumpiness: 0.04, // desvío aleatorio por irregularidades del pasto (0 = mesa de billar)
  bounce: 0.35, // cuánto rebota la bola contra postes (0 = nada, 1 = perfecto); bajado de 0,45 a 0,35 por pedido de Chris (2026-10-26)
  ballBounce: 0.7, // cuánto rebota una bola contra otra (choque entre bolas del mismo tamaño y masa)
  sparkMinGapM: 0.1, // spark exitoso: la bola golpeada queda con su borde a 10 cm o más de la que golpea (Art. 16 cl. 3)
  stopSpeed: 0.05, // por debajo de esta velocidad la bola se detiene

  // --- Controles ---
  // A mayor fuerza elegida, más rápido va el selector de precisión (multiplicador con fuerza 0 % y con 100 %).
  // Pedido de Chris: tiros fuertes más difíciles de apuntar. Historial: 0,7 / 1,6 (inicial) → 1,5 / 3,0 (tras jugar contra el kantoku: «para mí es muy fácil
  // acertar») → 1,1 / 2,2 (probó 1,5 / 3,0 y le pareció «demasiado rápida, difícil de jugar»). Modelo (`.build/bar.ts`: error de tiempo de quien tira × velocidad
  // de la barra, más el pasto): pasar la puerta 1 de un tiro (4,5 m) para un jugador con muy buen pulso (40 ms) / bueno (70 ms) / normal (100 ms) da 65 / 54 / 44 %
  // con 0,7 / 1,6; 51 / 35 / 26 % con 1,5 / 3,0 y **59 / 44 / 34 % con 1,1 / 2,2**: justo a mitad de camino; tocar una bola a 8 m, 83 / 73 / 63 %, 71 / 52 / 40 % y
  // 78 / 63 / 51 %. A fuerza 0,6 la barra va a 2,4 unidades por segundo (antes 1,7 y 3,3). Alternativa con la barra más lenta y la misma dificultad: `accuracyMaxAngleDeg`
  // en 6°, pero eso también cambia el error de la CPU. La CPU usa esta velocidad solo para animar su barra (se detiene en su punto).
  // 2026-10-26 (Chris: de muy lejos «el indicador de precisión no es muy rápido», el tiro no es tan difícil): la velocidad ya NO depende de la posición de la barra de fuerza (en el triángulo queda casi siempre en el
  // mismo punto sea cual sea la distancia, así que no cambiaba con la lejanía) sino de lo que va a recorrer la bola: `accuracySpeedMin` hasta `accuracyNearM` y `accuracySpeedMax` desde `accuracyFarM`, lineal entre los dos.
  // Antes 1,1 a 2,2 según la fuerza (≈ 1,8 en todos los tiros); ahora un tiro de 4,5 m (puerta 1) va a ≈ 1,5, uno de 8 m a ≈ 2,0 y desde 15 m a 2,6.
  accuracySpeedMin: 1.1,
  accuracySpeedMax: 2.6,
  accuracyNearM: 2,
  accuracyFarM: 15,
  // Barras por jugador (mecánica propia). En el orden del equipo.
  // PROVISIONAL hasta los atributos de la fase 5. Cada jugador tiene dos barras, cada una con:
  //  - sweetSpot: posición (0-1) del triángulo.
  //  - cycleSeconds: tiempo base que tarda la barra en ir y volver.
  //  - zones: tramos donde la velocidad se multiplica (speed < 1 = más lenta, > 1 = más rápida).
  // `power` (fuerza): en el triángulo la bola llega a la mira; más arriba se pasa, más abajo se queda corta.
  //   El jugador 1 usa 0,64.
  // `accuracy` (puntería izquierda-derecha): en el triángulo la bola va directa; a un lado o al otro se desvía.
  playerBars: [
    {
      power: { sweetSpot: 0.64, cycleSeconds: 1.6, zones: [{ from: 0.55, to: 0.75, speed: 0.55 }] },
      accuracy: { sweetSpot: 0.5, cycleSeconds: 1.8, zones: [{ from: 0, to: 0.3, speed: 1.6 }, { from: 0.7, to: 1, speed: 1.6 }] },
    },
    {
      power: { sweetSpot: 0.55, cycleSeconds: 1.2, zones: [{ from: 0.8, to: 1, speed: 1.6 }] },
      accuracy: { sweetSpot: 0.45, cycleSeconds: 1.4, zones: [{ from: 0, to: 0.25, speed: 1.8 }] },
    },
    {
      power: { sweetSpot: 0.7, cycleSeconds: 1.4, zones: [{ from: 0, to: 0.3, speed: 0.5 }] },
      accuracy: { sweetSpot: 0.55, cycleSeconds: 1.6, zones: [{ from: 0.7, to: 1, speed: 0.5 }] },
    },
    {
      power: { sweetSpot: 0.6, cycleSeconds: 1.0, zones: [] },
      accuracy: { sweetSpot: 0.5, cycleSeconds: 1.2, zones: [] },
    },
    {
      power: { sweetSpot: 0.5, cycleSeconds: 1.8, zones: [{ from: 0.4, to: 0.6, speed: 1.8 }] },
      accuracy: { sweetSpot: 0.5, cycleSeconds: 2.0, zones: [{ from: 0.3, to: 0.5, speed: 1.7 }] },
    },
  ] as { power: BarPattern; accuracy: BarPattern }[],
  // Desvío máximo del tiro (grados) cuando la barra de puntería está en un extremo y el triángulo en el centro.
  // A 4 m (salida → puerta 1) 4° equivalen a unos 0,28 m de desvío. Bajado de 10° a 4° al achicar bola y puerta
  // (iteración 11): el margen de la puerta pasó de ±0,25 m a ±0,1 m, y con 10° apenas se podía pasar.
  accuracyMaxAngleDeg: 4,
  startAreaMoveSpeed: 2, // m/s al ubicar la bola en el área de salida

  // --- Certeza por jugador y kantoku artificial (iteración B) ---
  // PROVISIONAL hasta la fase 5 (sustituye a unos atributos S / M / L de corto, medio y largo). Cada jugador tiene un factor de error por distancia de
  // tiro: corto (≤ shortMax m), medio (hasta mediumMax m) y largo. Multiplica el error base (mira, fuerza y rumbo): 0,6 = mucho más certero
  // que el promedio a esa distancia; 1,8 = mucho menos. En el mismo orden que `playerBars` (el jugador de una bola es floor((n − 1) / 2)).
  certaintyBands: { shortMax: 4, mediumMax: 9 },
  playerCertainty: [
    { short: 0.6, medium: 1.0, long: 1.8 }, // certero de corto
    { short: 1.5, medium: 1.0, long: 0.6 }, // certero de largo
    { short: 1.0, medium: 1.0, long: 1.0 }, // regular
    { short: 1.4, medium: 1.4, long: 1.4 }, // irregular
  ] as { short: number; medium: number; long: number }[],
  // Error base REALISTA que usa el entrenamiento del kantoku (× el perfil del jugador a esa distancia): entre el nivel 2 y el 3 del menú
  // (media geométrica), para que el riesgo importe. El nivel 4 (1 cm de mira) es sobrehumano y vuelve irrelevantes la estrategia y la
  // exposición: no se cambia todavía; se revisa con el campeón. Ver TRAINING.md.
  kantokuBaseError: { aimErr: 0.056, powerErr: 0.022, accErr: 0.022 },
  // Nivel temporal «Kantoku IA» del menú: multiplicador del error de ejecución (× el error base × la certeza del jugador) y de lo que el
  // planificador cree que se equivoca. 1 = el error del entrenamiento. Bajados a 0,4 tras jugar contra él («sus jugadores fallan mucho»):
  // mira 2,2 cm, fuerza 0,9 % y rumbo 0,9 %, entre el error del nivel 3 (4 cm) y el del 4 (1 cm). Medido contra pesos a mano (200 partidos):
  // 96,0 % con 1 / 1; 95,8 % con ejecución 0,4 y el planificador creyendo 1; 97,8 % con 0,4 / 0,4 (el planificador sabe que es más certero), así que van los dos.
  // Cambiar solo `PlanScale` cambia la jugada en el 42 % de las posiciones (en distancias casi iguales: el golpe mide 8,4 m contra 8,5 m).
  // 2026-10-26 (Chris: «sin una certeza demasiado alta, el kantoku no pide hacer touch a una bola rival algo lejos y en la línea»): la certeza del nivel baja a la de un buen jugador humano. Con `kantokuLevelHuman` el
  // error del nivel es `humanRivalError` × estos multiplicadores (ejecución y lo que el kantoku cree de sí mismo, iguales); con false, el de antes: `kantokuBaseError` × 0,4 (touch a 6 m 97 %, a 13 m 63 %).
  // Tabla de touch a 4/6/9/13 m: antes 98/97/84/63 %; humano ×1 72/50/32/20 %; ×0,85 80/58/38/24 %; ×0,7 88/68/45/29 %; ×0,6 (el elegido) ≈ 92/74/52/34 %. Ver BACKLOG.md.
  // Error de rumbo en tiros cortos (2026-10-26): el de `humanRivalError` se calibró con touches (≥ 6 m) y con él un buen jugador pasaba la puerta 1 desde la salida solo ~50-70 % de las veces. El error de rumbo se multiplica por
  // un factor que vale 1 desde `accLongM` y baja hasta `accShortFactor` a `accShortM` o menos (tiro corto y recto). Los touches de 6 m o más no cambian. Ver `accFactor` en certainty.ts.
  // Amenaza de una bola rival en el área de salida (pasar la puerta 1 y atacar con el golpe continuo): probabilidad de pasar pesimista, al menos esta (0 = la del modelo).
  kantokuStartPassP: 0.9,
  kantokuExitFar: true, // la amenaza desde la salida de la puerta 1 incluye las paradas a 9 y 11 m más allá de la puerta (false: solo hasta 6 m, como antes del 2026-10-26)
  // ... y lo mismo para las puertas 2 y 3 con una rival bien colocada (el modelo la pasa con ≥ `kantokuPlacedPassMin`): se supone que la pasa con al menos `kantokuPlacedPassP`. 0 = apagado.
  kantokuPlacedPassP: 0,
  kantokuPlacedPassMin: 0.6,
  accShortM: 4.5,
  accLongM: 6,
  accShortFactor: 0.25, // medido: puerta 1 desde la salida con tiro real: kantoku ×0,6 98 %, humano ×1 90 % (con 1: 63 % y 48 %)
  // 2026-10-27 (Chris, jugando kantoku-v1.2: «los jugadores de la CPU fallan bastante»): de ×0,6 a ×0,53, los dos a la vez (lo que ejecuta y lo que el kantoku cree de sí mismo). Medido con la física (300 tiros): puerta 1 desde la salida 298 → ≈ 295/300 (≥ 98 % las dos);
  // touch a 6 m 210 → ≈ 228/300 (modelo 74 → 79 %); a 9 m 142 → ≈ 154/300 (52 → 57 %); a 13 m 34 → 38 %; salidas de la cancha al tocar: 0 en los dos. Se eligió 0,53 y no 0,5 porque con 0,5 el touch a 6 m sale 81,0 % y a 13 m 39,8 % (`tests/threat.test.ts` fija el techo «humano» en 80 % y 40 %) y con 0,52 `tests/grass.test.ts` (modelo contra física a 9 m, tolerancia 9 puntos) queda en el límite del ruido; 0,53 pasa las dos.
  // No cambia lo que el kantoku supone de mí como rival (`humanRivalError` × 1). Ver BACKLOG.md, v1.3.
  kantokuLevelHuman: true,
  kantokuLevelErrorScale: 0.53,
  kantokuLevelPlanScale: 0.53,
  // El entrenamiento del kantoku (v1 a v3) se hizo con `kantokuBaseError` × 0,4; el entrenamiento y la selección lo siguen usando, no cambia con la certeza del nivel.
  kantokuTrainErrorScale: 0.4,
  // Error de un «buen jugador humano» como RIVAL del kantoku (iteración C). Calibrado con la referencia de Chris (jugando): un buen jugador acierta un touch la mitad de
  // las veces hasta unos 6 m y 1 de cada 5 a 13 m. Con el modelo con pasto da touch 96 % a 2 m, 85 % a 3 m, 72 % a 4 m, 50 % a 6 m, 36 % a 8 m, 28 % a 10 m y 20 % a 13 m
  // (`.build/fit_human.ts`; `tests/human.test.ts` lo comprueba). La CPU con su error (×0,4) da 97 % a 6 m y 54 % a 13 m medidos con la física (el modelo dice 63 %); con el
  // error de entrenamiento inicial (×1), 88 % y 48 %. Cuando el rival es una persona, el planificador usa este error para lo que el rival puede hacer; en el entrenamiento
  // (CPU contra CPU) usa el de la CPU.
  humanRivalError: { aimErr: 0.05, powerErr: 0.025, accErr: 0.29 },
  // Piso del peso del riesgo (iteración C): «exponerse siempre cuesta algo» (decisión de Chris). Se aplica en cualquier fase. Elegido con un barrido del peso del riesgo
  // sobre los pesos del campeón actual (`.build/sweep.sh`, 40 intentos de cada escenario y 100 partidos contra pesos a mano, error ×0,4; rival CPU que ataca):
  //   riesgo        0     0,5     1       2       3       5       8
  //   reentrada tocada   70 %    55 %    46 %    23 %    32 %    23 %    10 %   (pesos a mano: 50 %; campeón actual: 80 %)
  //   reentra       100 %   100 %   100 %   70 %    55 %    28 %    13 %
  //   pasa puerta 1 100 %   100 %   100 %   80 %    74 %    25 %     4 %
  //   gana a mano    94 %    91 %    96 %    93 %    95 %    91 %    80 %
  // Con 1 la reentrada expuesta baja por debajo de los pesos a mano sin dejar de entrar ni de pasar la puerta 1; con 2 o más empieza a dudar (rival CPU muy certero:
  // todo queda a su alcance). Es un mínimo, no un objetivo: el entrenamiento puede subirlo.
  kantokuRiskFloor: 1,
  // Golpe continuo (kantoku v2): al pasar una puerta la bola vuelve a jugar antes que el rival, así que una bola rival a su alcance es una oportunidad de touch (y spark para sacarla), no solo
  // un peligro. Fracción de una bola rival tocable que se da por resuelta (su riesgo baja en esa proporción y se premia el touch esperado). 0 = como el v2 original (el riesgo ignoraba
  // el golpe continuo: con rivales cerca de la salida la generación 42 pasaba la puerta 1 solo el 40 %). Se estimó, no se entrenó: touch (≈ 98 %/70 % cerca/lejos) por spark que saca (≈ 60 %).
  kantokuContinuationAttack: 0.6,
  // Spark de expulsión del kantoku (sacar una bola rival): apunta pasada la línea y con fuerza de sobra, para que el error de fuerza y el pasto no la dejen adentro. Metros que debe rodar
  // la bola más allá de la línea por la que sale (si la fuerza máxima no alcanza, lo que se pueda: la barra no pasa de `kantokuKnockoutMaxPower` del recorrido).
  // Reglas avanzadas del kantoku (iteración D; `advanced` en el archivo de pesos): la amenaza de un rival es el valor esperado de su intento de touch (`attackTable.json`: acierta y spark,
  // sale mi bola, salen las dos, o falla y sale su bola), las compañeras que juegan antes del rival recogen la bola o lo atacan (con el mismo 0,6 de `kantokuContinuationAttack`), el
  // apoyo entre bolas propias depende de los rivales que juegan entre ellas (ventanas, también las que abre una bola mía fuera a los rivales) y el rival se apoya entre sí con este peso.
  kantokuRivalSupport: 1,
  // Intentos de touch del kantoku (pedido de Chris tras jugar, 2.ª vez): REGLA, no valor esperado. Un jugador que decide dar se pasa un poco, porque el pasto y la fuerza pueden dejarla corta, y si
  // falla de lado su bola sigue de largo en vez de quedar pegada a la rival. La mira queda kantokuTouchOvershootPerM × la distancia más allá del blanco (0,2: +1 m a 5 m, +2 m a 10 m), reducida cerca
  // de la línea al espacio que queda hasta ella menos kantokuTouchLineMarginM. Medido antes (npm run touchshort): cortos 0,9 %, pero el fallo al lado a 8-10 m dejaba la bola a 0,4-0,6 m de la rival.
  kantokuTouchOvershootPerM: 0.2,
  kantokuTouchLineMarginM: 1, // era 0,5: con el error de fuerza o el pasto, sobraban salidas de cancha al atacar (Chris: «su bola sale por fuerza»; `npm run audit`)
  // Margen a la línea para los golpes que no son touch (salida de la puerta 1 hacia el fondo, acomodos): el kantoku no apunta a quedarse a menos de esto de la línea. Los tiros largos de la salida de la
  // puerta 1 terminaban justo en la línea (+11 m desde la puerta) y 9 de las 17 salidas de cancha de la auditoría eran de ahí.
  kantokuLineMarginM: 0.8,
  kantokuTouchSamples: 14, // muestras con error de cada candidato de touch (las normales son errorSamples)
  kantokuTouchTried: 6, // ... y cuántos candidatos de touch se miden además de los mejores por valor exacto
  // Mandar una bola propia al montón de rivales (spark de una compañera tocada): si ninguna rival que juegue antes que ella la puede tocar, su turno vale lo que pueda tocar y sacar de las rivales
  // juntas (cadena de touches, con kantokuContinuationAttack). kantokuHeapValue  multiplica ese valor; kantokuHeapSparkP = probabilidad estimada de que el spark la deje en el montón (al planear el touch a la compañera).
  kantokuHeapValue: 1,
  kantokuHeapSparkP: 0.6,
  // La otra cara: el rival que entra al montón MÍO (touch directo, pasando su puerta y quedando cerca, o mandando una bola suya con spark) saca varias bolas en su turno. Multiplica ese riesgo extra
  // (las bolas del montón después de la primera; la primera ya la cuenta el riesgo normal). Se resta lo que mis compañeras que juegan antes que el rival pueden mover a tiempo (según su certeza).
  kantokuHeapRisk: 0.2,
  kantokuHeapRadiusM: 2.5,
  // Juntarse: costo de acercar una bola mía a otra (≤ `kantokuJoinM`) por la amenaza que una rival en juego tiene sobre ella (0 = sin costo).
  kantokuJoinPenalty: 3, // medido en tests/advanced W2; el riesgo de montón entrenado (heapRisk 0,07) casi no lo veía
  kantokuJoinM: 3,
  // Agari (上がり: llegar al poste y salir del juego). Es una ventaja el momento oportuno, no antes: la bola que sale deja al equipo con menos bolas para atacar, defender y hacer tsunagi (puentes), y el
  // rival avanza sin peligro (Chris, 2026-10-23). El kantoku no va al poste mientras a la bola le queden MÁS de `kantokuAgariTurns` turnos (el turno actual cuenta), salvo que sea el juego perfecto (25 puntos),
  // que la bola vaya a ser sacada casi seguro (la amenaza sobre ella supera `kantokuAgariThreat` en todas sus alternativas), o que sea la última bola del equipo y el partido ya esté decidido.
  // El «doble» del rival en el riesgo (Chris: «doble ángulo», 2026-10-23): tocar mi bola y, desde donde queda, pasar su puerta con el golpe extra. Multiplica el valor del punto de la puerta frente al de tocar y sacar
  // mi bola (con los pesos del campeón, un punto vale ≈ 14 % de tocar y sacar). 0 = sin el doble.
  kantokuTouchPassScale: 1,
  // Doble ángulo (Chris, 2026-10-26): lugar desde donde la rival que juega después tiene dos oportunidades seguidas (bola y bola, puerta y bola, bola y puerta). El riesgo valora la combinación y no solo la mejor opción.
  // `kantokuComboScale` multiplica el valor del segundo evento (1 = completo). Reemplaza al multiplicador pequeño de `kantokuTouchPassScale`. false = como antes.
  // Regla fija: se descartan las jugadas que dejan una bola mía con doble ángulo para la rival que juega después cuando la probabilidad conjunta de sus dos oportunidades es ≥ este valor (0 = sin la regla).
  // Mover compañeras con el spark (Chris, 2026-10-26, turno 28: no consideró llevar a la 10 al segundo arco, a 12,7 m): alcance de los destinos (antes 10 m).
  kantokuMateRangeM: 14,
  // Punto seguro primero (Chris, 2026-10-26, turno 34): si pasar su puerta es casi seguro (≥ `kantokuSafePointP`), un touch a una rival necesita ≥ `kantokuSureTouchP` de probabilidad (−0,1 si va ganando por 3 o más con más del 40 % del
  // tiempo; +0,06 si va perdiendo por 3 o más o queda menos del 20 %), salvo rival de valor claro. 0 = sin la regla.
  kantokuSafePointP: 0.85,
  kantokuSureTouchP: 0.93,
  // Una bola a la que le quedan ≤ `kantokuLateTurns` turnos no se esconde (turno 54): acercarse a su puerta vale `kantokuLateProgress` × la mejora de su probabilidad de pasarla.
  kantokuLateTurns: 2,
  kantokuLateProgress: 3,
  // Valor de sacar una bola rival según su peligro real (Chris, 2026-10-26, turno 28: sacar a la roja 7, pegada a la línea y lejos de todo, no es buen negocio): ver `rivalWorth`. Base 0,8 (sube a 1 cerca de mis bolas o de su puerta),
  // 0,4 si está pegada a la línea (≤ `kantokuLineTouchEdgeM`) y aislada (sin otra bola a `kantokuDangerIsoM`). El bono de poste solo cuenta si el agari es posible pronto o amenaza a una bola mía. `kantokuDanger: false` = como antes.
  // Jugada de varios beneficios: punto de puerta, sacar una rival y acomodar a una compañera (≥ `kantokuMultiMateGain` de ganancia). Cada beneficio de más suma `kantokuMultiBonus` (0 = sin bono).
  kantokuMultiBonus: 0.6,
  kantokuMultiMateGain: 0.15,
  // Destinos del spark a compañeras: el camino debe pasar a ≥ radio de la bola + radio del poste + este margen de cada poste (turno 28: el poste de meta tapaba el camino de la 10 al 2º arco; `reach` trata la bola como un punto).
  kantokuPostClearM: 0.08,
  legacyPostClear: false,
  // Spark que acomoda a una compañera (Chris, 2026-10-26, turno 28): el éxito es quedar dentro de la zona de entrada de su puerta (probabilidad de pasar desde ahí ≥ `kantokuZonePassP`), no en un punto exacto. Esos candidatos se prueban
  // siempre (hasta `kantokuZoneExtra` fuera de los mejores por valor exacto), con `kantokuZoneSamples` muestras de error, y la regla del doble ángulo no los descarta. `kantokuZonePassP: 0` = como antes.
  kantokuZonePassP: 0.5,
  kantokuZoneExtra: 4,
  kantokuZoneSamples: 12,
  kantokuDanger: true,
  kantokuDangerBase: 0.8,
  kantokuDangerFloor: 0.4,
  kantokuDangerIsoM: 4,
  kantokuDoubleMax: 0.2,
  kantokuDoubleMargin: 0.04, // ... y solo se descartan las jugadas peores que la mejor en más de esto (una bola sola a tiro de la rival que sale ya tiene ≈ 0,3 de «pasar y tocar»)
  kantokuComboRisk: true,
  kantokuComboScale: 1,
  kantokuComboContinuation: 0.25, // fracción de la combinación que cuenta si el golpe pasó una puerta (la bola sigue moviéndose con el golpe continuo)
  // Doble «bola y puerta» según dónde esté mi bola (Chris, 2026-10-27). Delante de la puerta del rival (en el lado desde el que se pasa, a ≤ `kantokuComboFrontM`): el touch es fácil y la bola sigue a su puerta, muy peligroso; el punto de la
  // puerta cuenta como `kantokuComboFrontUnit` de lo que vale tocar y sacar mi bola (antes `passUnit`, ≈ 0,14). `legacyComboFront` lo apaga.
  kantokuComboFrontUnit: 0.6,
  kantokuComboFrontM: 5,
  // Lejos de él, el rival arriesga al intentar el touch: si falla, su bola queda cerca de mi bola, expuesta a mis bolas que juegan después (tocan o pasan su puerta y la sacan). Eso resta a su amenaza: (1 − P(touch)) × P(la castigo)
  // × lo que pierde (`shooterOutLater` ÷ lo que gana) × `kantokuFailPunish`, creciendo con la distancia desde `kantokuFailFromM` hasta `kantokuFailFullM`. `legacyFailPunish` lo apaga; 0 = sin castigo.
  kantokuFailPunish: 1,
  kantokuFailFromM: 4,
  kantokuFailFullM: 9,
  kantokuFailMaxCut: 0.6, // lo máximo que el castigo puede restar de la amenaza (fracción): un rival lejano sigue siendo un riesgo
  // «Enviar a marcar» y bolas expuestas (Chris, 2026-10-27, partida 20261027-114432: el kantoku se colocaba en zonas vulnerables al reentrar). Cada una se apaga con su `legacy…` en el archivo de pesos.
  //  - `kantokuSendSparkP`: probabilidad de que el spark de la rival deje a su compañera junto a mi bola (la amenaza de «mandar a marcar» = P(toca a su compañera) × continuación × esto × P(ataque desde ahí); 0 = sin la amenaza).
  //  - `kantokuRiskRest`: fracción de las demás opciones de touch de cada rival que se suma a su mejor opción (0 = solo la mejor, como antes).
  //  - `kantokuOpenField`: cuánto sube el riesgo sin compañeras en juego (con 0 compañeras × (1 + esto), con 3 o más × 1) si alguna rival puede mandar bolas a marcar con probabilidad ≥ `kantokuOpenSendP`.
  kantokuSendSparkP: 0.3, // 0,6 con todo lo demás encendido daba 45,8 % contra el kantoku v1.0 (200 partidos); cada componente por separado, entre 46 y 51 %
  kantokuRiskRest: 0.2,
  kantokuOpenField: 0.25, // 1 y 0,5 hacían que la CPU dejara de entrar a propósito (turno 32) y fallaban escenarios de la batería

  kantokuOpenSendP: 0.15,
  //  - `kantokuOwnExposure`: lo que paga la bola que reentra por su exposición (× su valor × la amenaza completa; 0 = nada, como antes).
  kantokuOwnExposure: 3, // solo en la reentrada; con 1 el caso T40 (frente al 2º arco, ≈ 0,67 de exposición) no cambiaba: el premio de la zona de entrada pesa ≈ 1,0
  //  - `kantokuCoverWeight`: cuánto de la cobertura de una compañera se pierde si una rival que juega antes puede sacarla (1 = toda; 0 = nada, como antes).
  kantokuCoverWeight: 0.5,
  // Reentrada (v1.2): casi siempre hay que entrar. No entrar cuesta `kantokuReentryMust` más que lo normal (`failReenter` ≈ 4,7), salvo en la última vuelta de esa bola (le quedan menos de `kantokuReentryLastTurns` turnos después del actual)
  // yendo ganando por `kantokuReentryLead` puntos o más: ahí quedarse fuera no le da bolas al rival y se permite. `legacyReentryMust` lo apaga; `legacyLineCands` quita los candidatos pegados a la línea en otros tramos.
  kantokuReentryMust: 10,
  kantokuReentryLastTurns: 0.3,
  kantokuReentryLead: 1,
  // Último turno del partido (v1.3, Chris, 2026-10-27, partida 20261027-181359 turno 62): sin turnos rivales que ataquen, el riesgo no importa y se busca la cadena que más puntos suma (`lastTurn.ts`). Búsqueda en haz:
  // profundidad (golpes por delante), candidatos que se miden con error en el primer golpe y en los siguientes, muestras de error en cada caso. Un turno que sigue al llegar al horizonte vale lo de abajo
  // (un spark pendiente casi siempre manda a una compañera por su puerta; un golpe continuo, menos); en el penúltimo turno se suma además `kantokuLastNextGate` × la probabilidad de pasar la siguiente puerta de cada bola mía.
  kantokuLastDepth: 4,
  kantokuLastBeam: 5,
  kantokuLastBeamDeep: 3,
  kantokuLastSamples: 8,
  kantokuLastSamplesDeep: 4,
  kantokuLastLeafSpark: 0.6,
  kantokuLastLeafCont: 0.3,
  kantokuLastNextGate: 0.25,
  // v1.5 (Chris, 2026-10-28, partida 20261028-073420, último turno): la cadena final no consideraba las bolas a más de 12 m (la blanca 10 estaba a 13,7 m de la 8, con el partido ya ganado). Sin riesgo, un touch largo de poca probabilidad
  // pero con spark y puerta detrás vale la pena; `candidates` ahora toma este alcance en la cadena del último turno (0 = el de siempre, 12).
  kantokuLastReachM: 18,
  // Sacar a propósito la propia bola desde el juego (v1.3, Chris, 2026-10-27, partida 20261027-181359 turno 4): no es barato. Después de salir hay que gastar un turno en volver a entrar y esa reentrada suele quedar tan expuesta
  // como quedarse (en esa partida: -5,4 al reentrar contra -4 a -6 por quedarse). Se suma a `shooterOutLater` (≈ 1,25) cuando la bola ya está en juego (puertas 2 a poste) y sale por decisión. `legacySelfOut` lo apaga.
  kantokuSelfOutCost: 3,
  // Reentrada con candidatos lejanos (v1.3): cuántos candidatos más que `topN` se miden con error (la cuadrícula de destinos suma unos 35 que empatan con los de la línea sin error).
  kantokuReentryTried: 6,
  explainAlternatives: 5, // cuántas alternativas anota el registro de partidas (las pruebas lo suben para ver todas las medidas)
  // Bola mía que sale por un touch o un spark mío (v1.4, turno 48): cuesta `kantokuOwnOutCost` + `kantokuOwnOutPerPoint` × sus puntos, además de `outOwn` (≈ 1): hay que gastar un turno en reentrar. `legacySparkClear` lo apaga.
  kantokuOwnOutCost: 3,
  kantokuOwnOutPerPoint: 0.5,
  // Golpes de acomodo largos (turno 44): a `kantokuLongSpotM` m o más se miden con `kantokuLongSpotSamples` muestras de error (dónde queda de verdad la bola si no llega); `legacyLongSpot` lo apaga.
  kantokuLongSpotM: 8,
  kantokuLongSpotSamples: 12,
  // ... y con más muestras de error cada uno: medir más candidatos con las mismas 5 muestras elige el que tuvo suerte (T40 de `behavior` bajaba de 75 a 50 %).
  kantokuReentrySamples: 12,
  // Regla de ataque (fija, para cualquier kantoku; Chris, 2026-10-25: el candidato de la iteración F esperaba en la salida con rivales a tiro). Con una rival a tiro de la salida de la puerta que la bola necesita pasar,
  // la bola pasa y ataca (toca con el golpe continuo y el spark la saca). Probabilidad de la jugada «pasar y tocar» × spark: desde `kantokuAttackPlayGate1` en la puerta 1 (casi siempre: es la jugada normal) y desde
  // `kantokuAttackPlayGate23` en las puertas 2 y 3 (la jugada es más difícil: por debajo, la bola puede elegir otra). En el golpe continuo, si una rival está a ≥ `kantokuAttackTouch` de touch, la ataca.
  // Touch lejano (Chris, 2026-10-25: la bola 4 tiró a tocar la 3 a 11,8 m y la 6 a la 5 a 10,2 m): un kantoku real no se arriesga a un touch lejano (cuanto más lejos, más fácil errar) salvo que el tiro toque varias bolas.
  // Los intentos de touch a más de estos metros que tocan una sola bola se descartan (0 = sin el límite).
  kantokuTouchMaxM: 9,
  // Bola rival pegada a la línea (a ≤ `kantokuLineTouchEdgeM` de ella) y a más de `kantokuLineTouchMaxM`: no se intenta el touch (Chris, 2026-10-26), salvo que la bola esté lista para el poste o sume ≥ `kantokuLineTouchPoints` puntos.
  // Probabilidad mínima de acertar un touch (con la certeza de quien tira y lo que el kantoku cree de sí mismo) para intentarlo: con la certeza de un buen jugador humano el touch a 9 m ya es 38 %. Salvo bola de valor claro.
  kantokuTouchMinP: 0.45,
  kantokuLineTouchMaxM: 5,
  kantokuLineTouchEdgeM: 1,
  kantokuLineTouchPoints: 3,
  kantokuAttackRule: true,
  kantokuAttackPlayGate1: 0.25,
  kantokuAttackPlayGate23: 0.6, // propuesto 0,35 y medido: con 0,35 y 0,5 la regla desplaza las aperturas de las blancas (tests/openings B y F); 0,6 = «buena probabilidad»
  kantokuAttackTouch: 0.5,
  kantokuAttackKeep: 0.85, // de las jugadas que pasan la puerta, las que dejan la bola con ≥ esta fracción de la mejor probabilidad de touch; la valoración elige entre ellas
  kantokuAttackSparkP: 0.97, // probabilidad del spark de expulsión (medida: 99 %)
  kantokuOpeningAttackP: 0.35, // el libro de aperturas no espera si una rival está a más de esta probabilidad de touch desde la salida de la puerta 1 (era 0,6)
  // Riesgo por valor (Chris, 2026-10-24: la blanca 8 al centro frente a la puerta 2, a la vista de la roja 9): la opción de pasar su puerta del rival se pone en la misma escala que la de tocar mi bola
  // (un punto frente a tocar y sacar ≈ 14 %). false = como antes (se comparaban las probabilidades y la exposición de mi bola no contaba si el rival podía pasar su puerta).
  // Riesgo por valor (turnos 12 y 42). Encendido desde la adopción del v4 (2026-10-27, Chris): el v4 se entrenó con él (`NANABAN_SET=kantokuRiskByValue=true`, TRAINING.md, iteración G). Con el campeón v3 fallaban `gate1` S2, `combo`, `longtouch` D y
  // `survival`; el v3 se guarda en `cpuWeights.v3prev2.json`. Antes: apagado, humanduel 82,8 % contra 86,3 % con él y la reentrada de la 2 se pegaba a la roja 5 (0,7 → 5,6 m).
  kantokuRiskByValue: true,
  // Lugar de espera junto a la línea (Chris, 2026-10-24): premio a una bola mía de las puertas 2 y 3 que espera a ≤ `kantokuLineSpotM` de la línea y a ≤ 5 m de su puerta, con ángulo en diagonal para pasarla (como la
  // apertura de la roja 1), en vez de al centro frente a la puerta, a la vista de las rivales. 0 = sin premio.
  kantokuLineSpotBonus: 0.2, // medido (validate 200, puntos): 0 → +10,26 · 0,2 → +8,88 · 0,6 → +8,05; con los dos cambios (riesgo por valor y 0,6) +6,63
  kantokuLineSpotM: 1.2,
  // Touch a compañeras (Chris, 2026-10-23: «casi no hace touch a sus compañeros»): antes el golpe que tocaba a una compañera solo valía `touchOwn` y el spark propio se valoraba sin anticipar lo que ella
  // podrá hacer en su turno. Ahora el turno de la compañera (pasar su puerta y tocar, tocar y pasar su puerta, descontando lo que las rivales que juegan antes pueden hacerle) entra en la valoración del
  // spark y, al tocarla, del golpe. Multiplicador de ese término (0 = como antes).
  kantokuMateWeight: 1, // medido (validate 200, puntos): 0 → +12,13 · 0,25 → +11,70 · 0,5 → +11,03 · 1 → +10,26; con 0,25 y 0,5 las escenas de `tests/matespark.test.ts` ya no se cumplen
  // La amenaza sobre una bola mía (la que reduce el premio de la zona de entrada) como la probabilidad de que ALGUNO de los rivales que juegan pronto la toque, no solo el mayor. false = como antes.
  kantokuThreatUnion: true,
  // Agari por accidente (medido con `npm run audit`: la mira pasaba cerca del poste y con el error o el pasto lo tocaba): castigo al valor de un golpe cuyas muestras con error llegan al poste antes de tiempo.
  kantokuAgariAccidentPenalty: 4,
  // Piso del reloj para el agari (Chris vio uno con 15 min de reloj): con más de estos segundos de partido por jugar no va al poste (salvo las excepciones). Medido con `npm run audit`, la estimación de
  // turnos que quedan se queda corta a media partida (a 10-15 min cree 2,5 y quedan 3,2), así que además de los turnos se exige el reloj.
  kantokuAgariMinClock: 600,
  kantokuAgariTurns: 2,
  kantokuAgariThreat: 0.8,
  // Mientras espera el momento del agari, la bola se queda cerca del poste (lista para ir): premio por su probabilidad de llegar al poste desde donde queda. Sin esto se escondía a 9 m, junto a la línea.
  kantokuAgariReady: 1.5,
  // Tsunagi (つなぎ, puentes): cadenas de touches de hasta `kantokuChainDepth` pasos (2 = un puente, 3 = dos) en la amenaza del rival y en el acercamiento de las bolas propias. Si el planificador pasa de ≈ 100 ms por golpe, bajar a 2.
  kantokuChainDepth: 3,
  // Puentes propios (acercar una bola a su puerta encadenando touches con una compañera): fracción de la probabilidad de la cadena que cuenta en la zona de entrada de la bola. Con todo el peso (1) y también en el
  // apoyo, el kantoku perdía fuerza contra CPU (45,0 %, −0,72 puntos, 200 partidos): se pensaba más cerca de su puerta de lo que está y juntaba menos las bolas. 0 = sin puentes propios.
  kantokuBridgeWeight: 0.5, // rivales a esta distancia entre sí forman un montón
  // Chris vio fallar varios sparks de expulsión en partida (2026-10-23): margen subido de 2,5 a 4 m y la fuerza máxima de 0,95 a 1 de la barra (el error de fuerza solo puede quitar fuerza, no sumarla).
  kantokuKnockoutOvershootM: 4,
  kantokuKnockoutSamples: 12, // muestras con error por dirección al elegir cómo sacar la bola (las normales son `errorSamples`)
  kantokuKnockoutMaxPower: 1, // fuerza máxima (0-1 de la barra) que planea el kantoku para sacar la bola (antes 0,95)
  // Fases del partido para el kantoku (ver `src/game/phase.ts`): inicio hasta que cada bola jugó su primer turno; después, final cuando le
  // quedan `kantokuFinalTurns` turnos o menos (o el partido está en su última bola); lo demás es medio.
  kantokuFinalTurns: 2,
  // Segundos de reloj que gasta una vuelta de las 10 bolas antes de haber visto una en el partido (≈ medido con `npm run rounds` a clockFactor 5).
  kantokuRoundSeconds: 290,
  // Cómo estima el kantoku los turnos que le quedan a cada bola. false = como antes: reloj ÷ la media de las vueltas ya jugadas. true = reloj ÷ (lo que cuesta un turno × las bolas vivas). Motivo (Chris vio un agari
  // con 15 min de reloj): la vuelta se acorta a medida que las bolas salen y la estimación vieja subestimaba los turnos reales (a 10-15 min de reloj creía 2,1 y quedaban 3,2; `npm run audit`).
  kantokuPaceByTurn: true,
  // Ritmo según la cancha (`pace.ts`, Chris, 2026-10-27): golpes del turno = 1 + c/(1 − κ·c) + sparkW·pTouch, con c = 1 − (1 − pPuerta)(1 − touchW·pTouch); cada golpe gasta ≈ `kantokuPaceStrokeSeconds` s de reloj (se corrige con lo observado,
  // con el peso de `kantokuPaceN0` golpes). Valores ajustados con `npm run pacefit` a 1272 turnos de 30 partidos del kantoku contra el rival tipo humano (golpes por turno: 2,85 predichos contra 2,86 reales, error cuadrático 7,7 contra 9,3 de una constante). `legacyTurnModel` en el archivo de pesos vuelve al promedio de reloj por turno.
  // Apuro por puntos (regla fija; `clockSlope` quedó en 0): perdiendo y con pocos turnos por delante los puntos pesan más y el ataque menos, hasta `kantokuClockUrgency` × lo que se pierde (÷ 6 puntos) con un solo turno; con
  // `kantokuUrgentTurns` turnos o más no hay apuro. 0 = sin la regla.
  kantokuClockUrgency: 0.5,
  kantokuUrgentTurns: 4,
  kantokuPaceStrokeSeconds: 14.5,
  kantokuPaceN0: 8,
  kantokuPaceStrokeCv: 0.35,
  kantokuPaceTouchMaxM: 14,
  kantokuPaceTouchW: 0.3,
  kantokuPaceKappa: 0.6,
  kantokuPaceSparkW: 1.2,

  // --- Partido ---
  matchMinutes: 30,
  // El reloj del partido corre más rápido que el real (el «30:00» dura menos en pantalla). 1,5 fue el primer valor (3 s de reloj cada 2 s reales). Con 1,5 el partido
  // dura unos 20 min reales. Provisional: se ajusta con el feedback de Chris.
  // 5 (iteración B, medido con `npm run rounds`): un partido real de 30 min da 5–6 turnos por bola; con 6 el partido simulado daba solo 3–4
  // (2,2 en CPU contra CPU). Con 5, mensajes de `messageSeconds` y la animación de la CPU `cpuAnimSpeed` veces más rápida, un partido contra
  // la CPU da 5,1–6,7 turnos por bola y dura 6–7 min de pantalla, casi lo mismo que antes. Historial: 1,5 (inicial) → 3 → 6 por
  // feedback de Chris (el partido avanzaba muy lento). Si cambia, hay que reentrenar el kantoku (ver TRAINING.md).
  clockFactor: 5,
  messageSeconds: 1, // cada mensaje pasa solo después de este tiempo (o al pulsar Z/Enter); antes 1,8 s: el reloj corre durante los mensajes de la CPU
  cpuAnimSpeed: 2, // la animación de la CPU (mover la bola, la mira y las barras, y sus esperas) va tantas veces más rápida; no toca las barras del humano
  perfectPoints: 25, // juego perfecto: un equipo llega a 25 puntos (Art. 7 cl. 3)

  // --- CPU (fase 3) ---
  cpuTeam: 1 as 0 | 1 | null, // equipo que juega la CPU: 1 = blancas (pares); null = dos jugadores humanos (pruebas)
  // Error de la CPU por nivel (el del menú de nivel). PROVISIONAL hasta calibrar con partidas.
  // Reducidos varias veces por feedback de Chris (la CPU seguía fácil): ahora es muy certera en todos los niveles.
  //  - aimErr: desvío de la mira (metros, desviación típica)
  //  - powerErr: error relativo al detener la barra de fuerza
  //  - accErr: error al detener la barra de rumbo (0-1)
  //  - strategy: probabilidad (0-1) de usar el planificador (simula golpes y elige el mejor); si no, juega lo simple
  //  - evalNoise: ruido en la valoración del planificador (más ruido = elige peor)
  cpuLevels: [
    { aimErr: 0.15, powerErr: 0.05, accErr: 0.05, strategy: 0.6, evalNoise: 1.2 },
    { aimErr: 0.08, powerErr: 0.03, accErr: 0.03, strategy: 0.8, evalNoise: 0.7 },
    { aimErr: 0.04, powerErr: 0.015, accErr: 0.015, strategy: 0.95, evalNoise: 0.3 },
    { aimErr: 0.01, powerErr: 0.005, accErr: 0.005, strategy: 1, evalNoise: 0 },
  ],

  // --- Puntos ---
  gatePoints: 1,
  polePoints: 2,
  // Bola fuera: queda con su borde a esta distancia de la línea interior. El reglamento (Art. 17 cl. 2) dice 10 cm; se puso 25 cm por claridad visual (Chris, tras jugar: con 10 cm la bola
  // se dibuja pisando la línea y parece que sigue dentro del campo, porque en pantalla la bola mide más que en la física: 4 px de radio contra 2,4). Con 25 cm el borde dibujado queda
  // a unos 4 px de la línea. Las pruebas de reglas fijan 0,1 (el golden se grabó así); el kantoku se entrenó con 0,1 y conviene reentrenarlo (ver TRAINING.md).
  outBallOffsetM: 0.25,
  poleTouchMarginM: 0.03, // margen para detectar que la bola tocó el poste (tras el rebote queda un poco separada); bajado de 0,06 al achicar el poste
};

// Posiciones de puertas y poste (metros desde la esquina superior izquierda).
// Confirmado con el reglamento oficial de gateball 2025 (Art. 1 y 13).
export const LAYOUT = {
  // Área de salida (reglamento, Art. 1 cl. 1-3): rectángulo de 1 × 3 m en la franja exterior,
  // de 1 m a 3 m desde la esquina derecha del lado inferior. La bola se coloca a mano dentro (ballY).
  // Corregido: antes estaba en y=15 (sobre la línea) y con otro ancho.
  startArea: { x1: 17, x2: 19, y1: 15, y2: 16, ballY: 15.5 },
  // 'h' = puerta horizontal (los postes están a izquierda y derecha), 'v' = vertical.
  // 'dir' = dirección en que hay que cruzarla, de la cara delantera a la trasera (Art. 1 cl. 4 y Art. 13).
  // Reglamento: 1 a 4 m de la esquina 1 y 2 m del lado derecho; 2 a 12 m de la esquina 2 y 2 m del lado superior;
  // 3 en el centro del lado inferior y 2 m hacia dentro.
  gates: [
    { n: 1, x: 18, y: 11, orient: 'h' as const, dir: 'up' as const },
    { n: 2, x: 8, y: 2, orient: 'v' as const, dir: 'left' as const },
    { n: 3, x: 10, y: 13, orient: 'v' as const, dir: 'right' as const },
  ],
  pole: { x: 10, y: 7.5 },
};

/** Error base del nivel «Kantoku IA» (antes de multiplicarlo por `kantokuLevelErrorScale` / `kantokuLevelPlanScale`): el de un buen jugador humano, o el base del entrenamiento si `kantokuLevelHuman` es false. */
export const kantokuLevelBase = () => (CONFIG.kantokuLevelHuman ? CONFIG.humanRivalError : CONFIG.kantokuBaseError);

// Solo para comparar reglas en Node: NANABAN_SET="clave=valor,clave=valor" cambia valores de CONFIG (no hace nada en el navegador).
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
if (nodeEnv?.NANABAN_SET) {
  for (const kv of nodeEnv.NANABAN_SET.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    (CONFIG as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
}
