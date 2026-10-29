# Gateball rules implemented by Saihai

🇪🇸 [Leer en español](RULES.es.md)

This document describes, in our own words, which rules the engine applies (`src/game/match.ts`) and which are decisions or simplifications of this project.
The "Art. N" references point to the articles of the official gateball rulebook (2025 edition, World Gateball Union); the full text is there. It is not copied here.
**Done** = it is in the engine. **Own** = our own decision or interpretation. **No** = not implemented.

## Court and balls (Art. 1, 6)
- Inner court of 20 × 15 m. The positions of the gates and the pole are in `LAYOUT` (`src/config.ts`) and follow the rulebook geometry. **Done.**
- Start area of 1 × 3 m in the outer strip, next to corner 1. **Done.**
- Two teams of 5 balls: red the odd ones, white the even ones. They play alternately in numeric order. **Done.**
- A ball that reaches the pole leaves the game; its player no longer plays. **Done.**
- Ball, gate and pole sizes: **Own** (measurements chosen to look good on screen, not the rulebook ones), in `config.ts`.

## Run and points (Art. 7, 13, 14)
- Fixed order: gate 1 → gate 2 → gate 3 → pole. Each gate is worth 1 point; reaching the pole is worth 2. 5 in total per ball. **Done.**
- A gate is passed in its direction, with the ball crossing the gate line completely (measured with the edge of the ball). **Done.**
- Gate 1 is attempted with the start shot. If it fails, the ball leaves the court and tries again on its next turn. **Done.**
- A ball that passes a gate by an out-ball stroke does not score. **Done.**
- The pole is reached by hitting it with an in-play ball that has already passed gate 3. **Done.**
- Whoever has more points at the end wins; with a tie, it is a draw. Detailed tie-breakers and the gate 1 round: **No.**

## Continuous stroke (Art. 12)
- A stroke that passes a gate and leaves the ball still and in play earns one more stroke; it chains while each stroke passes another gate. Several gates in a single stroke give only one extra stroke. **Done.**
- A touch does not give a continuous stroke: it gives the right to a spark (see below). **Done.**

## Touch (Art. 11, 15)
- There is a touch when an in-play ball (one that has already passed gate 1) hits another. **Done.**
- If the striking ball has not yet passed gate 1 and moves another one, that movement does not count and the other ball returns to its place. **Done.**
- Balls that get in the way of the start shot to gate 1 become "ghosts" (they do not collide with the ball that is starting) until it passes the gate or the turn changes. **Done** (the rulebook has the referee move them aside).
- If the start shot passes gate 1 and then hits a ball, the balls follow their movement; there is no touch and no spark, and the player gets the continuous stroke. **Own.**
- Touching the same ball twice in a turn is a foul: the moved ball returns and the striking ball goes out. **Done.**
- A ball pushed by another can pass a gate or the pole and scores for its team; if it is pushed out, it becomes an out ball. **Own.**

## Spark (Art. 16)
- After a touch, the touched ball is placed against the striking ball, on the side of the aim. **Own** (the rulebook has the player place it by hand).
- The striking ball does not move: the power and direction go to the touched ball, which can pass gates, reach the pole or go out. **Done.**
- Successful spark: the touched ball ends with its edge 10 cm or more from the striking ball, reaches the pole or goes out. It gives one more stroke; two if the touch and a gate came from the same stroke. **Done.**
- Failed spark (short, or the touched ball ends up in the outer field when struck): everything returns to its place and the striking ball goes out. **Done.** Other spark fouls, such as stepping on the ball: **No.**
- With several balls touched in one stroke, they are sparked one by one in the order of the touch. **Own.**
- The spark goes before the continuous stroke. **Done.**

## Out ball (Art. 17)
- If a ball that has already passed gate 1 leaves the inner court by a valid stroke, it ends up near the line, where it crossed (25 cm in the game; the rulebook says 10 cm, `outBallOffsetM`), and keeps the points it earned in that stroke. **Done.**
- The inner line belongs to the court: the ball is out when it crosses it completely. **Own.**
- It is struck again from there on its next turn; if it gets in, it is an in-play ball again. It scores nothing while it is out. **Done.**
- A ball struck from outside that hits another commits a foul: the other returns and the striking ball ends up out at the nearest point. **Done.**

## Clock and end of the match (Art. 5, 6, 7)
- A 30-minute countdown, which runs faster than real time according to `clockFactor`. **Own.**
- When time runs out, or when a team reaches 25 points (perfect game), the match ends after a white ball has played. Simplification: if white reaches 25 through a red ball's play, the next white ball also plays. **Own.**
- Draw for who starts (Art. 5): **Pending (future phase)** (red starts for now).
- 10-second limit per stroke: **Not enforced (design decision).**
