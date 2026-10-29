# Saihai

🇪🇸 [Leer en español](README.es.md)

**Saihai** (采配, the way a *kantoku*, the gateball team manager, directs a team) is an AI agent for gateball: the rules engine, the physics and the planner that picks every stroke, with a model tuned by self-play. It has no user interface: it is a TypeScript library to plug into a gateball game, plus the tools to measure and retrain it.

- No Phaser, no DOM; runs in Node and in the browser.
- Injectable seeded randomness: matches replay exactly.
- Current model: `saihai-v1.5`. Every decision can be explained (`explain`).
- Texts in Spanish (default) or English: `lang: 'es' | 'en'` (see [Languages](#languages)). Gateball terms are kept in their original form; the [glossary](#glossary) explains them.

> Status: in development. The repository is **public** (MIT); install it straight from GitHub.

- **Hugging Face:** [model card and weights](https://huggingface.co/ckomiya/saihai-gateball) · [play against Saihai in the browser (Space)](https://huggingface.co/spaces/ckomiya/saihai-gateball-demo)
- **itch.io:** [play the demo on itch.io](https://ckomiya.itch.io/nana-ban)

## Installation

```bash
npm install github:ckomiya/saihai-gateball#v1.5.0
```

- **It is built on install.** The package is installed from Git, so npm runs its `prepare` script (`node scripts/build.mjs`), which generates `dist/` (ESM JavaScript with the weights inside, and `.d.ts` types). It needs `esbuild` and `typescript` (both in `devDependencies`; npm installs them for that step), which is why the first `install` takes a few extra seconds.
- **`allow-scripts` warning.** Recent npm versions warn: `1 package has install scripts not yet covered by allowScripts: saihai-gateball (prepare)`. In our tests `dist/` was generated anyway; if it is not in your environment, or you want to silence the warning, approve the script with `npm approve-scripts saihai-gateball` (or `npm approve-scripts --allow-scripts-pending` to review them all) and install again.
- **`"private": true` in `package.json` stays.** It only prevents publishing the package to the npm registry by accident; it does not affect installing from GitHub. Saihai is distributed through Git tags, not through npm.
- While you work locally with another project, use `npm install ../saihai-gateball` (a link) and run `npm run build` in this repo every time you change something.

## Minimal example

```ts
import { createMatch, Saihai, playShot } from 'saihai-gateball';

const match = createMatch({ seed: 42 });            // new match (seeded randomness)
const saihai = new Saihai({ opponent: 'human' });   // judges its rival as a person would

while (match.stage !== 'done') {
  const shot = saihai.chooseShot(match);            // { startX, aim, power, accuracy, plan }
  const res = playShot(match, shot);                // applies the stroke and lets the balls roll
  console.log(res.events);                          // gates, touches, sparks, fouls…
  match.proceed();                                  // next stroke or turn
}
console.log(match.teamScore(0), match.teamScore(1));
```

`power` and `accuracy` are the positions (0 to 1) where the two triangle bars of the game mechanic stop; `aim` is in meters. If your game uses another control scheme, `shot.plan.ideal` carries the error-free stroke.

## Gateball concepts for developers

**Teams and colors.** There are two teams of five balls: **Red = team 0 = odd balls** (1, 3, 5, 7, 9) and **White = team 1 = even balls** (2, 4, 6, 8, 10). `match.b` is the ball playing now (`match.b.n` its number, `match.b.team` its team) and `match.teamScore(0)` / `match.teamScore(1)` are the Red and White points. Play goes in numeric order. Each ball runs gate 1 → 2 → 3 → pole (1 point per gate, 2 for the pole).

**Turn and stroke.** A *turn* is what one ball plays; a *stroke* is one call to `playShot`. A turn can have several strokes by the same ball: passing a gate and staying in play gives a **continuous stroke** (chainable), and a touch on another ball gives a **spark** (the stroke on the touched ball), which goes first. After each `playShot`, `match.proceed()` moves on to what comes next and returns a `Transition`:

| `Transition` | What comes next |
|---|---|
| `'turn'` | the next ball plays |
| `'continue'` | continuous stroke: the same ball plays again |
| `'spark'` | a touched ball's spark must be played (`chooseShot` handles it by itself) |
| `'end'` | the match is over (`match.stage === 'done'`) |

`res.next` (from `playShot`) previews `'turn'`, `'continue'` or `'spark'`. That is why the most natural summary is **per stroke**, not per turn.

**Clock.** The match is a countdown (`match.clock`, starting at 1800 s of match clock and running faster than real time, `CONFIG.clockFactor`). `playShot` **does charge the rolling**: the clock runs while the balls move. It **does not charge the thinking** or reading messages: whoever integrates the engine decides that time (the game stops the clock while the human measures and aims). If you want thinking to cost time too, call `match.update(dt, true)` yourself.

**End of the match.** It ends when time runs out, a team reaches 25 points, or all balls finish, and always after a White ball has played (a design decision; see [RULES.md](RULES.md)). `match.stage === 'done'` tells you, and `match.endReason()` says why: `'perfect'` (25 points), `'time'` (the clock ran out) or `'allIn'` (all balls finished).

**Determinism.** `createMatch({ seed })` uses seeded randomness. **The same seed with the same configuration (same `Saihai` options, same `CONFIG` values, same package version) gives exactly the same match.** Changing `opponent`, `execution` or a `CONFIG` value gives a different match. You can also inject your own `rng` (`createMatch({ rng })`).

## Events (`Resolution.events`)

`playShot` returns a `Resolution` with `events: MatchEvent[]` (in the order in which they are best shown), `touches`, `next` and more. The types are exported from the root (`MatchEvent`, `Resolution`, `Transition`, `FoulReason`, `BallState`, `SoundCue`). `stroker: true` means the event belongs to the ball that strikes; if it is `false`, `ball` is another ball moved by the stroke.

| `type` | Meaning | Real output (Saihai vs Saihai, `node examples/duelo.mjs 42 --raw`) |
|---|---|---|
| `gate` | a ball passed gate `gate` (+1 point) | `[{"type":"gate","ball":1,"gate":1,"stroker":true}]` |
| `pole` | a ball reached the pole (+2) | `[{"type":"spark"},{"type":"pole","ball":6,"stroker":false}]` |
| `out` | **another** ball (not the striking one) left the court | `[{"type":"spark"},{"type":"out","ball":4}]` |
| `noTouch` | start shot: it passed gate 1 and then hit a ball; no touch and no spark | did not appear in the 13 sample matches (it is rare) |
| `strokerOut` | the striking ball went out. `start`: still without gate 1; `gate`: last gate passed in the stroke; `foul`: `'touchedOther'` or `'touchedTwice'` if it was a foul | `[{"type":"strokerOut","start":false,"gate":1,"foul":null}]`; with a foul: `[{"type":"strokerOut","start":false,"gate":2,"foul":"touchedTwice"}]` |
| `backInPlay` | a ball that was out came back in | `[{"type":"backInPlay"}]` |
| `ballOut` | out ball (did not get in, or went out after a spark) | did not appear in the 13 sample matches |
| `failGate1` | it did not pass gate 1; it will try again in its next turn. The most common event in the first rounds | `[{"type":"failGate1"}]` |
| `touch` | valid touch; `balls` are **ball numbers** (1 to 10) | `[{"type":"touch","balls":[4]}]` |
| `spark` | the spark succeeded | `[{"type":"spark"},{"type":"out","ball":4}]` |
| `sparkFoul` | spark foul: `'short'` (the struck ball ended less than 10 cm away) or `'outside'` (ball touched in the outer field) | did not appear in the 13 sample matches |

**`Resolution.touches` uses indexes, not ball numbers:** they are positions in `match.balls` (starting at 0), so ball number `n` is index `n - 1`. In the touch of the table: `events = [{"type":"touch","balls":[4]}]` and `touches = [3]`, that is, ball 4 is index 3. A stroke with a touch carries `next: 'spark'`.

The rest of the `Resolution`: `kind` (`'stroke'`, `'spark'` or `'sparkFoul'`), `strokerOut`, `foul` and `shotGate` (last gate passed by the striking ball; 0 = none).

## Examples

- [`examples/duelo.mjs`](examples/duelo.mjs): Saihai (Red) against Saihai (White) with a fixed seed, a summary per stroke and the final result, in English (default in the example) or Spanish. `node examples/duelo.mjs [seed] [--lang en|es] [--raw]` It ships with the package, so after installing you can run it with `node node_modules/saihai-gateball/examples/duelo.mjs --lang en` (inside this repo it needs `npm run build` first). It is the same match in both languages.
- **Human against Saihai** (pseudocode; your interface decides how the bars are captured):

```js
import { createMatch, Saihai, playShot } from 'saihai-gateball';

const match = createMatch({ seed: Date.now() });   // no fixed seed: a different match every time
const saihai = new Saihai({ opponent: 'human' });  // the human is team 0 (red)

while (match.stage !== 'done') {
  let res;
  if (match.b.team === 0) {
    // Human turn: your interface delivers the same thing Saihai.chooseShot returns
    const shot = await askHumanForShot(match);     // { startX, aim: {x, y}, power 0..1, accuracy 0..1 }
    res = playShot(match, shot);
  } else {
    res = playShot(match, saihai.chooseShot(match));
  }
  show(res.events);                                // animation and messages
  match.proceed();                                 // 'turn' | 'continue' | 'spark' | 'end'
}
```

  If you animate the bars and the ball (like the game scene does), use `match.shoot` and `match.step(dt)` instead of `playShot`, which is the non-animated version.

**`opponent` (`'human'` or `'saihai'`).** It is how Saihai *judges its rival* when planning (which risks it believes the rival can exploit): with `'human'` (default) it assumes the error of a good human player; with `'saihai'`, its own. Against a person use `'human'`; in Saihai vs Saihai, `'saihai'`. It does not change how it executes its own strokes (that is `execution`).

**One instance per team.** `new Saihai(opts)` only stores its options: it **keeps no state between strokes** (everything is in `match`, and the randomness in `match.rng`). One instance can be reused, but if both teams are Saihai with different options it is better to have one per team, as in `examples/duelo.mjs`.

**`execution`.** It is the base error of Saihai's own strokes: `{ aimErr, powerErr, accErr }` (standard deviation of the aim in meters, of the relative power and of the 0–1 direction bar; multiplied by the player's certainty at each distance). By default, that of a good human player: `{ aimErr: 0.05, powerErr: 0.025, accErr: 0.29 }`. Uncalibrated examples: more accurate, `new Saihai({ execution: { aimErr: 0.025, powerErr: 0.012, accErr: 0.15 } })`; clumsier, `{ aimErr: 0.1, powerErr: 0.05, accErr: 0.5 }`. Saihai's strength was measured with the default value.

## Package entry points

| Import | What it brings |
|---|---|
| `saihai-gateball` | `createMatch`, `Saihai`, `playShot`, `messageFor`, `messagesFor`, `SAIHAI_MODEL`, `Match` and the types `Shot`, `SaihaiOptions`, `Resolution`, `MatchEvent`, `Transition`, `FoulReason`, `BallState`, `SoundCue`, `CpuPlan`, `ErrorBase`, `Rng`, `Lang` |
| `saihai-gateball/engine` | `Match` (the rules engine), `CONFIG`, `LAYOUT`, court geometry, `Rng`, messages in Spanish and English (`messageFor`, `messagesFor`, `noTouchMessage`) and the CPU functions |
| `saihai-gateball/debug` | Entry and danger zones, opening sites, touch chains and the match log (`MatchLogger`) |
| `saihai-gateball/testing` | The rules scenarios and their recorded result (`golden`), to check an on-screen engine against this one |

**Messages (`saihai-gateball/engine`, also from the root).** `messageFor(event, lang?)` and `messagesFor(res.events, lang?)` turn events into the texts the game shows, in capitals and meant for an on-screen scoreboard (for example, in English, `GATE 1 PASSED! +1`, `MISSED GATE 1`, `TOUCH ON BALL 4!`; in Spanish, `¡PASÓ LA PUERTA 1! +1`, `FALLÓ LA PUERTA 1`, `¡TOUCH A LA BOLA 4!`). Use them if you want the same texts as the game without writing your own `switch`: `import { messagesFor } from 'saihai-gateball/engine'; messagesFor(res.events, 'en').forEach(show)`. If you prefer another tone or language, write your own from the root events (see `examples/duelo.mjs`).

`CONFIG` is a shared, mutable object (scripts and tests change values on purpose): make sure your bundler has a single copy of the package (`resolve.dedupe` in Vite).

## Languages

Since 1.4.2, the texts Saihai produces can be in Spanish or English. **The default language is `'es'`: if you pass nothing, everything is identical to 1.4.1** (`tests/i18n.test.ts` checks it against a fingerprint recorded with the previous code). The language only changes texts; **it never changes a play** (same bars, same events, same match).

| Where | How | What changes |
|---|---|---|
| Event messages | `messagesFor(res.events, 'en')`, `messageFor(event, 'en')`, `noTouchMessage('en')` | The scoreboard texts (`GATE 1 PASSED! +1`) |
| Decision explanation | `new Saihai({ explain: true, lang: 'en' })` | The texts in `shot.plan.decision`: `source`, `kind` (`'touch on a rival'`, `'spark: knock out rival ball'`, `'gate 2'`…), the `terms` keys (`points`, `risk`, `exposure`…), the agari `why` and `released`, `chain.turn` |
| Opening sites (`/debug`) | `OPENING_SITES.red1.note` / `.noteEn` | The note of each site |
| Example | `node examples/duelo.mjs 42 --lang es` | The printed summary |

- `lang` only accepts `'es'` or `'en'`. In `new Saihai({ lang })` any other value throws a `RangeError` (it does not silently fall back to Spanish). `messageFor` and `messagesFor` only recognize `'en'`; any other value gives Spanish, so that `events.map(messageFor)` (which passes the index as the second argument) keeps working as before.
- **Events (`MatchEvent`) and code identifiers are not translated:** `type`, `reason` and `foul` (`'touchedOther'`, `'short'`…) are English keys for your code, not texts for the player. The match log of `/debug` (`MatchLogger`: causes and details for balls that go out) and the measurement scripts are not translated either: they are data and developer tools, in Spanish.
- Gateball terms (touch, spark, agari, tsunagi, kantoku…) keep their original form in both languages.

## Glossary

| Term | Meaning |
|---|---|
| **Gateball** | A team sport of Japanese origin: you hit a ball with a mallet to pass it through three gates and reach a pole. |
| **Gate (*puerta*)** | A hoop the ball must pass through, in order 1 → 2 → 3. Each is worth 1 point. |
| **Pole (*poste*)** | The goal at the end of the run, after gate 3. Reaching it is worth 2 points and the ball leaves the game. |
| **Start area (*área de salida*)** | Zone next to corner 1 from which the **start shot** (*tiro de salida*) is played; it tries to pass gate 1. |
| **Touch** | An in-play ball hits another ball. It earns a spark. |
| **Spark** | After a touch, the touched ball is placed against the striking ball and is struck itself (the striking ball stays put): it can be sent far away or knocked out of the court. |
| **Continuous stroke (*golpe continuo*)** | An extra stroke after passing a gate and staying in play; it chains while each stroke passes another gate. |
| **Out ball (*bola fuera*)** | A ball that left the inner court; it tries to get back in on its next turn and scores nothing meanwhile. |
| **Kantoku (監督)** | The team manager, who decides the plays. Saihai is an artificial kantoku. |
| **Saihai (采配)** | The way a kantoku directs a team; the name of this project. |
| **Agari (上がり)** | Taking the ball to the pole and out of the game. Doing it early is a disadvantage (the team is left with fewer balls), so a kantoku chooses the moment. |
| **Tsunagi (つなぎ)** | "Bridge": bringing a distant ball closer by chaining touches on nearby balls. |
| **Teams** | Red = team 0 = odd balls; White = team 1 = even balls. |
| **Power and direction bars** | Mechanic of the example game: two triangle bars that are stopped to set the power and the direction of the stroke. |

## Levels and certainty

Saihai plans with each player's certainty at each distance (short, medium, long) and with the base execution error (`SaihaiOptions.execution`). With `opponent: 'human'` it measures the rival's options with the error of a good human player; with `'saihai'`, with its own. Levels 1 to 4 of the example game use a simpler CPU (`cpuPlan` with a numeric level) that does not need the model.

## Rules

Which gateball rules the engine implements, and which are our own decisions: [RULES.md](RULES.md).

## Tests

```bash
npm test                # rules scenarios, planner, kantoku and API (≈ 30 min)
npm run typecheck       # types of src/
npm run build           # dist/ with types
npm run h2h -- --games 200 --vs src/game/cpuWeights.v13.json    # against the previous version
npm run behavior        # battery of plays from real matches
npm run humanduel -- --variant rules --games 200                # against a human-like rival
npm run bench:plan -- --kantoku                                 # time per stroke (≈ 55 ms)
```

All the tools in `scripts/` (train, validate, audit, replay matches…) are described in [CLAUDE.md](CLAUDE.md) and [TRAINING.md](TRAINING.md), which are written in Spanish.

## Retraining

`npm run train` tunes the weights by self-play (sep-CMA-ES) and publishes to `src/game/cpuWeights.next.json` without replacing the champion. See [TRAINING.md](TRAINING.md). The `training/` (checkpoints) and `partidas/` folders are not versioned; the endgame bank needs `training/endbank.json`.

## Versions

`X.Y.Z`: `X.Y` is the model (`saihai-vX.Y`); `Z` are fixes that do not change the plays. The relation with the game's `kantoku-v1.x` tags is in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Christian Komiya.
