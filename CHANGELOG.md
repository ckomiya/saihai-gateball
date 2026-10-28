# Changelog

🇪🇸 [Leer en español](CHANGELOG.es.md)

Versions are `X.Y.Z`: `X.Y` is the model (`saihai-vX.Y`) and `Z` are fixes that do not change the plays. An incompatible API change only happens with a new major version.

## Relation with the game tags (`gateball-retro`)

| Tag in gateball-retro | Saihai | What changed |
|---|---|---|
| `kantoku-v1.0` | `saihai-v1.0` (historical weights only) | Champion v4 with the pace model |
| `kantoku-v1.1` | `saihai-v1.1` (same) | "Send to mark", cover that can fall, open court, re-entry exposure |
| `kantoku-v1.2` | `saihai-v1.2` (same) | Re-entries that almost always get in; candidates against the line |
| `kantoku-v1.3` | `saihai-v1.3` (same) | Last turn: search for the chain that scores the most points |
| `kantoku-v1.4` | **`saihai-v1.4`** | Spark without hitting own balls, opening blocked by any ball, `juntarse` (regroup) and `avanza` (advance) depending on who plays again |

The v1.0 to v1.3 weights are not republished as versions; they are in `src/game/cpuWeights.v10.json` to `v13.json` only for comparison (`npm run h2h`).

## 1.4.2 (multi-language; same plays)
- No gameplay changes: the goldens, the planner-golden and the tests give the same as in 1.4.1.
- Texts in Spanish or English: `messageFor(event, lang?)`, `messagesFor(events, lang?)` and the new `noTouchMessage(lang?)` (`/engine`; `messageFor` and `messagesFor` also from the root), `new Saihai({ lang })` for `Shot.plan.decision`, and `OPENING_SITES[…].noteEn`. The default language is `'es'`: if you pass nothing, the output is identical to 1.4.1 (`tests/i18n.test.ts`, against a 360-stroke fingerprint recorded with 1.4.1). An unknown `lang` in `Saihai` throws a `RangeError`.
- Documentation in two languages: `README.md` (English) and `README.es.md`; `RULES.md` and `RULES.es.md`; `CHANGELOG.md` and `CHANGELOG.es.md`. Glossary of gateball terms in both READMEs. `CLAUDE.md` and the code comments stay in Spanish.
- `examples/duelo.mjs`: `--lang en|es` option (English by default in the example); the match is the same in both languages.
- Internal identifiers (`Decision` keys, `MatchEvent` types, the match log) remain untranslated: they are data, not texts for the player.

## 1.4.1 (documentation and types; same plays)
- No gameplay changes: the goldens, the planner-golden and the tests give the same as in 1.4.0.
- Root API: the types `MatchEvent`, `Transition`, `FoulReason`, `BallState` and `SoundCue` are exported (before, they were only in `/engine`). Nothing was removed.
- README: gateball concepts (teams and colors, turn and stroke, clock, end of the match, determinism), an events table with real output, the meaning of `Resolution.touches` (indexes, not ball numbers), `opponent` and `execution` with examples, installation (build in `prepare`, `allow-scripts` warning, why `private: true` stays), public status, and what the `/engine` messages are for.
- `examples/duelo.mjs`: Saihai against Saihai with a fixed seed; human-against-Saihai example in pseudocode.
- Origin: report from the external developer test (clean install from GitHub).

## 1.4.0 (first version of Saihai as a package)
- Split from gateball-retro: the rules engine, the physics, the planner, the weights, the training tools and the tests live here. The game consumes it as a dependency.
- Public API: `createMatch`, `Saihai.chooseShot`, `playShot` (`saihai-gateball`), plus `/engine`, `/debug` and `/testing`.
- **Note on the goal pole:** `saihai-v1.4` was first measured with a 0.05 m pole (h2h 49.8 %, 91/17/92; humanduel 87.3 %, 7.31 points). Since 2026-10-28 the pole measures 0.025 m (`poleRadiusM` in `src/config.ts`, at Chris's request) and the same measurements give h2h 46.5 % (85/16/99, -0.38) and humanduel 84.5 % (7.00 points). The weights did not change: with the pole at 0.05 m the earlier figures are recovered exactly. The reference for this version is the 0.025 m pole.
- Behavior is identical to gateball-retro at `pre-separacion` (goal pole of 0.025 m): same goldens, same `h2h`, `behavior`, `humanduel` and `selfplay` with the same seeds.
