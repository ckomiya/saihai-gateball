# Saihai

🇬🇧 [Read in English](README.md)

**Saihai** (采配, la forma de dirigir de un *kantoku*, el director técnico del gateball) es un agente de IA para gateball: el motor de reglas, la física y el planificador que elige cada golpe, con un modelo afinado por autojuego. No tiene interfaz: es una librería de TypeScript para integrarla en un juego de gateball, más las herramientas para medirla y reentrenarla.

- Sin Phaser ni DOM; corre en Node y en el navegador.
- Azar con semilla inyectable: las partidas se repiten exactamente.
- Modelo actual: `saihai-v1.4`. Cada decisión puede explicarse (`explain`).
- Textos en español (por defecto) o inglés: `lang: 'es' | 'en'` (ver [Idiomas](#idiomas)). Los términos del gateball se conservan tal cual; el [glosario](#glosario) los explica.

> Estado: en desarrollo. El repositorio es **público** (MIT); se instala directo desde GitHub.

- **Hugging Face:** [ficha del modelo y pesos](https://huggingface.co/ckomiya/saihai-gateball) · [juega contra Saihai en el navegador (Space)](https://huggingface.co/spaces/ckomiya/saihai-gateball-demo)
- **itch.io:** [juega la demo en itch.io](https://ckomiya.itch.io/nana-ban)

## Instalación

```bash
npm install github:ckomiya/saihai-gateball#v1.4.2
```

- **Se compila al instalar.** El paquete se instala desde Git, así que npm ejecuta su script `prepare` (`node scripts/build.mjs`), que genera `dist/` (JavaScript ESM con los pesos adentro y tipos `.d.ts`). Necesita `esbuild` y `typescript` (están en `devDependencies`; npm los instala para ese paso), por eso el primer `install` tarda unos segundos más.
- **Aviso `allow-scripts`.** Las versiones recientes de npm avisan: `1 package has install scripts not yet covered by allowScripts: saihai-gateball (prepare)`. En las pruebas `dist/` se generó igualmente; si en tu entorno no, o si quieres silenciar el aviso, aprueba el script con `npm approve-scripts saihai-gateball` (o `npm approve-scripts --allow-scripts-pending` para revisarlos todos) y vuelve a instalar.
- **`"private": true` en `package.json` se queda.** Solo impide publicar el paquete en el registro de npm por descuido; no afecta a la instalación desde GitHub. Saihai se distribuye por etiquetas de Git, no por npm.
- Mientras trabajas en local con otro proyecto, `npm install ../saihai-gateball` (enlace) y `npm run build` en este repo cada vez que cambies algo.

## Ejemplo mínimo

```ts
import { createMatch, Saihai, playShot } from 'saihai-gateball';

const match = createMatch({ seed: 42 });            // partido nuevo (azar con semilla)
const saihai = new Saihai({ opponent: 'human' });   // juzga a su rival como una persona

while (match.stage !== 'done') {
  const shot = saihai.chooseShot(match);            // { startX, aim, power, accuracy, plan }
  const res = playShot(match, shot);                // aplica el golpe y deja rodar las bolas
  console.log(res.events);                          // puertas, touches, sparks, faltas…
  match.proceed();                                  // siguiente golpe o turno
}
console.log(match.teamScore(0), match.teamScore(1));
```

`power` y `accuracy` son las posiciones (0 a 1) donde se detienen las dos barras con triángulo de la mecánica del juego; `aim` está en metros. Si tu juego usa otro control, `shot.plan.ideal` trae el golpe sin error.

## Conceptos de gateball para desarrolladores

**Equipos y colores.** Hay dos equipos de cinco bolas: **Rojas = equipo 0 = bolas impares** (1, 3, 5, 7, 9) y **Blancas = equipo 1 = bolas pares** (2, 4, 6, 8, 10). `match.b` es la bola que juega ahora (`match.b.n` su número, `match.b.team` su equipo) y `match.teamScore(0)` / `match.teamScore(1)` son los puntos de las rojas y de las blancas. Se juega por turnos en orden numérico. Cada bola recorre puerta 1 → 2 → 3 → poste (1 punto por puerta, 2 por el poste).

**Turno y golpe.** Un *turno* es lo que juega una bola; un *golpe* es una llamada a `playShot`. Un turno puede tener varios golpes de la misma bola: al pasar una puerta y quedar en juego hay un **golpe continuo** (encadenable), y un touch a otra bola da un **spark** (el golpe a la bola tocada), que va antes. Después de cada `playShot`, `match.proceed()` pasa a lo que sigue y devuelve una `Transition`:

| `Transition` | Qué viene |
|---|---|
| `'turn'` | pasa a la bola siguiente |
| `'continue'` | golpe continuo: vuelve a jugar la misma bola |
| `'spark'` | hay que hacer el spark de una bola tocada (`chooseShot` lo resuelve solo) |
| `'end'` | el partido terminó (`match.stage === 'done'`) |

`res.next` (de `playShot`) adelanta `'turn'`, `'continue'` o `'spark'`. Por eso el resumen más natural es **por golpe**, no por turno.

**Reloj.** El partido es una cuenta regresiva (`match.clock`, empieza en 1800 s de reloj de partido y corre más rápido que el real, `CONFIG.clockFactor`). `playShot` **sí cobra el rodar**: mientras las bolas se mueven el reloj corre. **No cobra el pensar** ni leer mensajes: ese tiempo lo decide quien integra el motor (el juego detiene el reloj mientras el humano mide y apunta). Si quieres que pensar también cueste, llama tú a `match.update(dt, true)`.

**Fin del partido.** Termina cuando se acaba el tiempo, un equipo llega a 25 puntos o todas las bolas terminan, y siempre con una bola blanca (decisión de diseño; ver [RULES.es.md](RULES.es.md)). `match.stage === 'done'` lo indica y `match.endReason()` dice por qué: `'perfect'` (25 puntos), `'time'` (se acabó el reloj) o `'allIn'` (todas las bolas terminaron).

**Determinismo.** `createMatch({ seed })` usa un azar con semilla. **La misma semilla con la misma configuración (mismas opciones de `Saihai`, mismos valores de `CONFIG`, misma versión del paquete) da exactamente el mismo partido.** Cambiar `opponent`, `execution` o un valor de `CONFIG` da otro partido. También puedes inyectar tu propio `rng` (`createMatch({ rng })`).

## Eventos (`Resolution.events`)

`playShot` devuelve una `Resolution` con `events: MatchEvent[]` (en el orden en que conviene mostrarlos), `touches`, `next` y más. Los tipos se exportan desde la raíz (`MatchEvent`, `Resolution`, `Transition`, `FoulReason`, `BallState`, `SoundCue`). `stroker: true` significa que el evento es de la bola que golpea; si es `false`, `ball` es otra bola movida por el golpe.

| `type` | Significado | Salida real (Saihai contra Saihai, `node examples/duelo.mjs 42 --raw`) |
|---|---|---|
| `gate` | una bola pasó la puerta `gate` (+1 punto) | `[{"type":"gate","ball":1,"gate":1,"stroker":true}]` |
| `pole` | una bola llegó al poste (+2) | `[{"type":"spark"},{"type":"pole","ball":6,"stroker":false}]` |
| `out` | **otra** bola (no la que golpea) salió de la cancha | `[{"type":"spark"},{"type":"out","ball":4}]` |
| `noTouch` | tiro de salida: pasó la puerta 1 y luego tocó una bola; sin touch ni spark | no apareció en las 13 partidas de muestra (es rara) |
| `strokerOut` | la bola que golpea salió. `start`: aún sin puerta 1; `gate`: última puerta pasada en el golpe; `foul`: `'touchedOther'` o `'touchedTwice'` si fue falta | `[{"type":"strokerOut","start":false,"gate":1,"foul":null}]`; con falta: `[{"type":"strokerOut","start":false,"gate":2,"foul":"touchedTwice"}]` |
| `backInPlay` | una bola que estaba fuera volvió a entrar | `[{"type":"backInPlay"}]` |
| `ballOut` | bola fuera (no entró o salió tras un spark) | no apareció en las 13 partidas de muestra |
| `failGate1` | no pasó la puerta 1; volverá a intentarlo en su siguiente turno. Es lo más común en las primeras vueltas | `[{"type":"failGate1"}]` |
| `touch` | touch válido; `balls` son **números de bola** (1 a 10) | `[{"type":"touch","balls":[4]}]` |
| `spark` | el spark salió bien | `[{"type":"spark"},{"type":"out","ball":4}]` |
| `sparkFoul` | falta de spark: `'short'` (la bola golpeada quedó a menos de 10 cm) o `'outside'` (bola tocada en el campo exterior) | no apareció en las 13 partidas de muestra |

**`Resolution.touches` usa índices, no números de bola:** son posiciones en `match.balls` (empiezan en 0), así que la bola número `n` es el índice `n - 1`. En el touch de la tabla: `events = [{"type":"touch","balls":[4]}]` y `touches = [3]`, o sea, la bola 4 es el índice 3. Un golpe con touch trae `next: 'spark'`.

El resto de la `Resolution`: `kind` (`'stroke'`, `'spark'` o `'sparkFoul'`), `strokerOut`, `foul` y `shotGate` (última puerta pasada por la que golpea; 0 = ninguna).

## Ejemplos

- [`examples/duelo.mjs`](examples/duelo.mjs): Saihai (Rojas) contra Saihai (Blancas) con semilla fija, un resumen por golpe y el resultado final, en inglés (por defecto en el ejemplo) o en español; es el mismo partido en los dos idiomas. `node examples/duelo.mjs [semilla] [--lang en|es] [--raw]` (viene en el paquete: tras instalarlo puedes correrlo con `node node_modules/saihai-gateball/examples/duelo.mjs --lang en`; dentro de este repo necesita `npm run build` antes).
- **Humano contra Saihai** (pseudocódigo; tu interfaz decide cómo se capturan las barras):

```js
import { createMatch, Saihai, playShot } from 'saihai-gateball';

const match = createMatch({ seed: Date.now() });   // sin semilla fija: partido distinto cada vez
const saihai = new Saihai({ opponent: 'human' });  // el humano es el equipo 0 (rojas)

while (match.stage !== 'done') {
  let res;
  if (match.b.team === 0) {
    // Turno del humano: tu interfaz entrega lo mismo que devuelve Saihai.chooseShot
    const shot = await pedirGolpeAlHumano(match);  // { startX, aim: {x, y}, power 0..1, accuracy 0..1 }
    res = playShot(match, shot);
  } else {
    res = playShot(match, saihai.chooseShot(match));
  }
  mostrar(res.events);                             // animación y mensajes
  match.proceed();                                 // 'turn' | 'continue' | 'spark' | 'end'
}
```

  Si animas las barras y la bola (como la escena del juego), usa `match.shoot` y `match.step(dt)` en vez de `playShot`, que es la versión sin animación.

**`opponent` (`'human'` o `'saihai'`).** Es cómo Saihai *juzga a su rival* al planear (qué riesgos cree que puede aprovechar): con `'human'` (por defecto) supone el error de un buen jugador humano; con `'saihai'`, el suyo. Contra una persona usa `'human'`; en Saihai contra Saihai, `'saihai'`. No cambia cómo ejecuta sus propios tiros (eso es `execution`).

**Una instancia por equipo.** `new Saihai(opts)` solo guarda sus opciones: **no guarda estado entre golpes** (todo está en `match`, y el azar en `match.rng`). Se puede reutilizar una instancia, pero si los dos equipos son Saihai con opciones distintas conviene una por equipo, como en `examples/duelo.mjs`.

**`execution`.** Es el error base de los propios tiros de Saihai: `{ aimErr, powerErr, accErr }` (desviación típica de la mira en metros, de la fuerza relativa y de la barra de rumbo 0-1; se multiplica por la certeza del jugador a cada distancia). Por defecto, el de un buen jugador humano: `{ aimErr: 0.05, powerErr: 0.025, accErr: 0.29 }`. Ejemplos sin calibrar: más certero, `new Saihai({ execution: { aimErr: 0.025, powerErr: 0.012, accErr: 0.15 } })`; más torpe, `{ aimErr: 0.1, powerErr: 0.05, accErr: 0.5 }`. La fuerza de Saihai se midió con el valor por defecto.

## Entradas del paquete

| Import | Qué trae |
|---|---|
| `saihai-gateball` | `createMatch`, `Saihai`, `playShot`, `messageFor`, `messagesFor`, `SAIHAI_MODEL`, `Match` y los tipos `Shot`, `SaihaiOptions`, `Resolution`, `MatchEvent`, `Transition`, `FoulReason`, `BallState`, `SoundCue`, `CpuPlan`, `ErrorBase`, `Rng`, `Lang` |
| `saihai-gateball/engine` | `Match` (el motor de reglas), `CONFIG`, `LAYOUT`, geometría de la cancha, `Rng`, mensajes en español e inglés (`messageFor`, `messagesFor`, `noTouchMessage`) y las funciones de la CPU |
| `saihai-gateball/debug` | Zonas de entrada y de peligro, sitios de apertura, cadenas de touches y el registro de partidas (`MatchLogger`) |
| `saihai-gateball/testing` | Los escenarios de reglas y su resultado grabado (`golden`), para comprobar un motor de pantalla contra este |

**Mensajes (`saihai-gateball/engine`, y también la raíz).** `messageFor(evento, lang?)` y `messagesFor(res.events, lang?)` convierten los eventos en los textos que muestra el juego, en mayúsculas y pensados para un marcador de pantalla (por ejemplo `¡PASÓ LA PUERTA 1! +1`, `FALLÓ LA PUERTA 1`, `¡TOUCH A LA BOLA 4!`; en inglés, `GATE 1 PASSED! +1`, `MISSED GATE 1`, `TOUCH ON BALL 4!`). Úsalos si quieres los mismos textos que el juego sin escribir tu propio `switch`: `import { messagesFor } from 'saihai-gateball/engine'; messagesFor(res.events, 'en').forEach(mostrar)`. Si prefieres otro tono u otro idioma, escribe el tuyo con los eventos de la raíz (ver `examples/duelo.mjs`).

`CONFIG` es un objeto compartido y mutable (los scripts y las pruebas cambian valores a propósito): asegúrate de tener una sola copia del paquete en tu bundler (`resolve.dedupe` en Vite).

## Idiomas

Desde 1.4.2 los textos que salen de Saihai pueden estar en español o en inglés. **El idioma por defecto es `'es'`: sin indicar nada, todo es idéntico a 1.4.1** (lo comprueba `tests/i18n.test.ts` contra una huella grabada con el código anterior). El idioma solo cambia textos; **nunca cambia una jugada** (mismas barras, mismos eventos, mismo partido).

| Dónde | Cómo | Qué cambia |
|---|---|---|
| Mensajes de los eventos | `messagesFor(res.events, 'en')`, `messageFor(evento, 'en')`, `noTouchMessage('en')` | Los textos del marcador (`GATE 1 PASSED! +1`) |
| Explicación de la decisión | `new Saihai({ explain: true, lang: 'en' })` | Los textos de `shot.plan.decision`: `source`, `kind` (`'touch on a rival'`, `'spark: knock out rival ball'`, `'gate 2'`…), las claves de `terms` (`points`, `risk`, `exposure`…), `why` y `released` del agari, `chain.turn` |
| Sitios de apertura (`/debug`) | `OPENING_SITES.red1.note` / `.noteEn` | La nota de cada sitio |
| Ejemplo | `node examples/duelo.mjs 42 --lang es` | El resumen impreso |

- `lang` solo admite `'es'` o `'en'`. En `new Saihai({ lang })` cualquier otro valor lanza `RangeError` (no cae en silencio al español). `messageFor` y `messagesFor` solo reconocen `'en'`; con cualquier otro valor dan español, para que `events.map(messageFor)` (que pasa el índice como segundo argumento) siga funcionando como antes.
- **Los eventos (`MatchEvent`) y los identificadores del código no se traducen:** `type`, `reason` y `foul` (`'touchedOther'`, `'short'`…) son claves en inglés para tu código, no textos para el jugador. Tampoco se traducen el registro de partidas de `/debug` (`MatchLogger`: causas y detalles de las bolas que salen) ni los scripts de medición: son datos y herramientas de desarrollo en español.
- Los términos del gateball (touch, spark, agari, tsunagi, kantoku…) se mantienen en su forma original en los dos idiomas.

## Glosario

| Término | Significado |
|---|---|
| **Gateball** | Deporte de equipos de origen japonés: con un mazo se golpea una bola para pasarla por tres puertas y llegar a un poste. |
| **Puerta / *gate*** | Arco por el que debe pasar la bola, en orden 1 → 2 → 3. Cada una vale 1 punto. |
| **Poste / *pole*** | Meta del recorrido, después de la puerta 3. Llegar vale 2 puntos y la bola sale del juego. |
| **Área de salida / *start area*** | Zona junto a la esquina 1 desde donde se hace el **tiro de salida** (*start shot*), que intenta pasar la puerta 1. |
| **Touch** | Una bola en juego toca a otra. Da derecho a un spark. |
| **Spark** | Tras un touch, la bola tocada se coloca pegada a la que golpea y se golpea ella (la que golpea queda quieta): se puede mandar lejos o sacar de la cancha. |
| **Golpe continuo / *continuous stroke*** | Golpe extra al pasar una puerta y quedar en juego; se encadena mientras cada golpe pase otra puerta. |
| **Bola fuera / *out ball*** | Bola que salió de la cancha interior; vuelve a intentar entrar en su siguiente turno y mientras tanto no puntúa. |
| **Kantoku (監督)** | El director técnico del equipo, que decide las jugadas. Saihai es un kantoku artificial. |
| **Saihai (采配)** | La forma de dirigir de un kantoku; el nombre de este proyecto. |
| **Agari (上がり)** | Llevar la bola al poste y sacarla del juego. Hacerlo pronto es una desventaja (el equipo queda con menos bolas), así que un kantoku elige el momento. |
| **Tsunagi (つなぎ)** | «Puente»: acercar una bola lejana encadenando touches a otras bolas cercanas. |
| **Equipos** | Rojas = equipo 0 = bolas impares; Blancas = equipo 1 = bolas pares. |
| **Barras de fuerza y de rumbo** | Mecánica del juego de ejemplo: dos barras con triángulo que se detienen para fijar la fuerza y la dirección del golpe. |

## Niveles y certeza

Saihai planea con la certeza de cada jugador a cada distancia (corto, medio, largo) y con el error base de ejecución (`SaihaiOptions.execution`). Con `opponent: 'human'` mide las opciones del rival con el error de un buen jugador humano; con `'saihai'`, con el suyo. Los niveles 1 a 4 del juego de ejemplo usan una CPU más simple (`cpuPlan` con un nivel numérico) que no necesita el modelo.

## Reglas

Qué reglas de gateball implementa el motor, y cuáles son decisiones propias: [RULES.es.md](RULES.es.md).

## Pruebas

```bash
npm test                # escenarios de reglas, planificador, kantoku y API (≈ 30 min)
npm run typecheck       # tipos de src/
npm run build           # dist/ con tipos
npm run h2h -- --games 200 --vs src/game/cpuWeights.v13.json    # contra la versión anterior
npm run behavior        # batería de jugadas de partidas reales
npm run humanduel -- --variant rules --games 200                # contra un rival tipo humano
npm run bench:plan -- --kantoku                                 # tiempo por golpe (≈ 55 ms)
```

Todas las herramientas de `scripts/` (entrenar, validar, auditar, reproducir partidas…) están en [CLAUDE.md](CLAUDE.md) y [TRAINING.md](TRAINING.md).

## Reentrenar

`npm run train` afina los pesos por autojuego (sep-CMA-ES) y publica en `src/game/cpuWeights.next.json` sin reemplazar al campeón. Ver [TRAINING.md](TRAINING.md). Las carpetas `training/` (puntos de control) y `partidas/` no se versionan; para el banco de finales hace falta `training/endbank.json`.

## Versiones

`X.Y.Z`: `X.Y` es el modelo (`saihai-vX.Y`); `Z` son correcciones que no cambian las jugadas. La relación con las etiquetas `kantoku-v1.x` del juego está en [CHANGELOG.es.md](CHANGELOG.es.md).

## Licencia

[MIT](LICENSE) © 2026 Christian Komiya.
