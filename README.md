# Saihai

**Saihai** (采配, la forma de dirigir de un *kantoku*, el director técnico del gateball) es un agente de IA para gateball: el motor de reglas, la física y el planificador que elige cada golpe, con un modelo afinado por autojuego. No tiene interfaz: es una librería de TypeScript para integrarla en un juego de gateball, más las herramientas para medirla y reentrenarla.

- Sin Phaser ni DOM; corre en Node y en el navegador.
- Azar con semilla inyectable: las partidas se repiten exactamente.
- Modelo actual: `saihai-v1.4`. Cada decisión puede explicarse (`explain`).

> Estado: en desarrollo, repositorio privado.

## Instalación

```bash
npm install github:ckomiya/saihai-gateball#v1.4.0
```

Mientras trabajas en local con otro proyecto, `npm install ../saihai-gateball` (enlace) y `npm run build` en este repo cada vez que cambies algo. Se compila a `dist/` (JavaScript ESM con los pesos adentro y tipos `.d.ts`).

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

## Entradas del paquete

| Import | Qué trae |
|---|---|
| `saihai-gateball` | `createMatch`, `Saihai`, `playShot`, `SAIHAI_MODEL` |
| `saihai-gateball/engine` | `Match` (el motor de reglas), `CONFIG`, `LAYOUT`, geometría de la cancha, `Rng`, mensajes en español y las funciones de la CPU |
| `saihai-gateball/debug` | Zonas de entrada y de peligro, sitios de apertura, cadenas de touches y el registro de partidas (`MatchLogger`) |
| `saihai-gateball/testing` | Los escenarios de reglas y su resultado grabado (`golden`), para comprobar un motor de pantalla contra este |

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
