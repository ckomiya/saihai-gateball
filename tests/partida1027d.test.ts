// OMITIDA (fuera de `npm test`): caso T12 «puente sin doble ángulo» para kantoku-v2.0. Ver BACKLOG.md, sección kantoku-v2.0.
// Tablero literal del turno 12 de la partida 20261027-205516 (reloj 1494, turno de la bola 2, que reentra). Criterio de Chris: la 2 a ≤ 2,5 m de la 4 en ≥ 16/24 y,
// en ≥ 90 % de esos casos, sin doble ángulo desde la roja 3. NO se cumple con kantoku-v1.4 (0/24) ni con los intentos de v1.5 (juntarse solo con doble ángulo real, descuento
// por reubicación con touch + spark): lo que decide son `exposicion` y `riesgo` por las amenazas largas (≈ 20 % por rival a 13 m, sumadas) de las rojas 1, 7 y 9 en el carril de la 4,
// y el mejor destino del spark (9,5; 1,6) está en ese mismo carril. Hay que calibrar ese peso con partidas reales, no a mano.
// Para retomarlo: cpuPlan(Match.fromBalls(mk(G23), { turn: 1, rng: mulberry32(500 + r) }), 3, { brain, errors }) con m.clock = 1494, turnStarts = 61, firstRoundDone, shots = 100, r = 0..23.
const G23 = [[1, 10.1, 13.49, 2, 0, 1], [2, 8.67, -0.35, 2, 1, 1], [3, 4.24, 14.48, 3, 0, 2], [4, 10.19, -0.03, 2, 0, 1], [5, 18, 15.5, 1, 0, 0], [6, 18, 15.5, 1, 0, 0], [7, 3.53, 14.56, 2, 0, 1], [8, 18, 15.5, 1, 0, 0], [9, 8.28, 14.42, 2, 0, 1], [10, 18, 15.5, 1, 0, 0]];
void G23;
console.log('omitida: caso T12 documentado para kantoku-v2.0 (ver BACKLOG.md)');
process.exit(0);
