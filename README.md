# Saihai

**Saihai** (采配, la forma de dirigir de un *kantoku*, el director técnico del gateball) es un agente de IA para gateball: el motor de reglas, la física y el planificador que elige cada golpe, con un modelo afinado por autojuego. No tiene interfaz: es una librería de TypeScript para integrarla en un juego de gateball, más las herramientas para medirla y reentrenarla.

- Sin Phaser ni DOM; corre en Node y en el navegador.
- Azar con semilla inyectable: las partidas se repiten exactamente.
- Modelo actual: `saihai-v1.4`. Cada decisión puede explicarse (`explain`).

> Estado: en desarrollo. El repositorio es **público** (MIT); se instala directo desde GitHub.

## Instalación

```bash
npm install github:ckomiya/saihai-gateball#v1.4.1
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

**Fin del partido.** Termina cuando se acaba el tiempo, un equipo llega a 25 puntos o todas las bolas terminan, y siempre con una bola blanca (decisión de diseño; ver [RULES.md](RULES.md)). `match.stage === 'done'` lo indica y `match.endReason()` dice por qué: `'perfect'` (25 puntos), `'time'` (se acabó el reloj) o `'allIn'` (todas las bolas terminaron).

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

- [`examples/duelo.mjs`](examples/duelo.mjs): Saihai (Rojas) contra Saihai (Blancas) con semilla fija, un resumen en español por golpe y el resultado final. `node examples/duelo.mjs [semilla] [--raw]` (dentro de este repo necesita `npm run build`; desde otro proyecto es el mismo código importando `'saihai-gateball'`).
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
| `saihai-gateball` | `createMatch`, `Saihai`, `playShot`, `SAIHAI_MODEL`, `Match` y los tipos `Shot`, `SaihaiOptions`, `Resolution`, `MatchEvent`, `Transition`, `FoulReason`, `BallState`, `SoundCue`, `CpuPlan`, `ErrorBase`, `Rng` |
| `saihai-gateball/engine` | `Match` (el motor de reglas), `CONFIG`, `LAYOUT`, geometría de la cancha, `Rng`, mensajes en español y las funciones de la CPU |
| `saihai-gateball/debug` | Zonas de entrada y de peligro, sitios de apertura, cadenas de touches y el registro de partidas (`MatchLogger`) |
| `saihai-gateball/testing` | Los escenarios de reglas y su resultado grabado (`golden`), para comprobar un motor de pantalla contra este |

**Mensajes en español (`saihai-gateball/engine`).** `messageFor(evento)` y `messagesFor(res.events)` convierten los eventos en los textos que muestra el juego, en mayúsculas y pensados para un marcador de pantalla (por ejemplo `¡PASÓ LA PUERTA 1! +1`, `FALLÓ LA PUERTA 1`, `¡TOUCH A LA BOLA 4!`). Úsalos si quieres los mismos textos que el juego sin escribir tu propio `switch`: `import { messagesFor } from 'saihai-gateball/engine'; messagesFor(res.events).forEach(mostrar)`. Si prefieres otro tono o idioma, escribe el tuyo con los eventos de la raíz (ver `examples/duelo.mjs`).

`CONFIG` es un objeto compartido y mutable (los scripts y las pruebas cambian valores a propósito): asegúrate de tener una sola copia del paquete en tu bundler (`resolve.dedupe` en Vite).

## Niveles y certeza

Saihai planea con la certeza de cada jugador a cada distancia (corto, medio, largo) y con el error base de ejecución (`SaihaiOptions.execution`). Con `opponent: 'human'` mide las opciones del rival con el error de un buen jugador humano; con `'saihai'`, con el suyo. Los niveles 1 a 4 del juego de ejemplo usan una CPU más simple (`cpuPlan` con un nivel numérico) que no necesita el modelo.

## Reglas

Qué reglas de gateball implementa el motor, y cuáles son decisiones propias: [RULES.md](RULES.md).

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

`X.Y.Z`: `X.Y` es el modelo (`saihai-vX.Y`); `Z` son correcciones que no cambian las jugadas. La relación con las etiquetas `kantoku-v1.x` del juego está en [CHANGELOG.md](CHANGELOG.md).

## Licencia

[MIT](LICENSE) © 2026 Christian Komiya.
