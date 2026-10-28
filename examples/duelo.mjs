// Saihai (Rojas / Red) contra Saihai (Blancas / White) con semilla fija; imprime un resumen por golpe, en inglés (por defecto) o en español.
// Uso: node examples/duelo.mjs [semilla] [--lang en|es] [--raw]    (--raw imprime también los eventos tal cual)
// Solo usa la API raíz de 'saihai-gateball'. Dentro de este repositorio necesita `npm run build` antes (usa dist/).
// El partido es el mismo en los dos idiomas: el idioma solo cambia los textos.
import { createMatch, Saihai, playShot, SAIHAI_MODEL } from 'saihai-gateball';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const li = args.indexOf('--lang');
const lang = li >= 0 ? args[li + 1] : 'en';
if (lang !== 'en' && lang !== 'es') { console.error(`--lang must be en or es / --lang debe ser en o es (got/recibido: ${lang})`); process.exit(2); }
const seed = Number(args.find((a, i) => !a.startsWith('--') && i !== li + 1) ?? 42);

const FOULS = {
  en: { touchedOther: 'touched another ball', touchedTwice: 'touched the same ball twice' },
  es: { touchedOther: 'tocó otra bola', touchedTwice: 'tocó dos veces la misma bola' },
}[lang];
const SPARK_REASONS = {
  en: { short: 'short', outside: 'ball outside the court' },
  es: { short: 'corto', outside: 'bola fuera del campo' },
}[lang];
const T = {
  en: {
    teams: ['Red', 'White'],
    gate: (e) => `passes gate ${e.gate}${e.stroker ? '' : ` (ball ${e.ball})`}`,
    pole: (e) => `reaches the pole${e.stroker ? '' : ` (ball ${e.ball})`}`,
    out: (e) => `ball ${e.ball} goes out`,
    noTouch: 'no touch',
    strokerOut: (e) => (e.start ? 'goes out without passing gate 1' : `ends up out${e.foul ? ` by foul (${FOULS[e.foul]})` : ''}`),
    backInPlay: 'back in play',
    ballOut: 'ball out',
    failGate1: 'misses gate 1',
    touch: (e) => `touch on ball(s) ${e.balls.join(', ')}`,
    spark: 'spark',
    sparkFoul: (e) => `spark foul (${SPARK_REASONS[e.reason]})`,
    nothing: 'nothing',
    shot: (n, ball, team, text, r, b) => `#${n} ball ${ball} (${team}): ${text} | Red ${r} - White ${b}`,
    reasons: { perfect: 'perfect game (25 points)', time: 'time is up', allIn: 'all balls finished' },
    final: (model, seed, n, r, b, res, why) => `FINAL (${model}, seed ${seed}, ${n} shots): Red ${r} - White ${b} → ${res}; ${why}`,
    result: (r, b) => (r === b ? 'draw' : r > b ? 'Red wins' : 'White wins'),
  },
  es: {
    teams: ['Rojas', 'Blancas'],
    gate: (e) => `pasa la puerta ${e.gate}${e.stroker ? '' : ` (bola ${e.ball})`}`,
    pole: (e) => `llega al poste${e.stroker ? '' : ` (bola ${e.ball})`}`,
    out: (e) => `la bola ${e.ball} sale`,
    noTouch: 'sin touch',
    strokerOut: (e) => (e.start ? 'sale sin pasar la puerta 1' : `queda fuera${e.foul ? ` por falta (${FOULS[e.foul]})` : ''}`),
    backInPlay: 'vuelve a juego',
    ballOut: 'bola fuera',
    failGate1: 'falla la puerta 1',
    touch: (e) => `touch a la(s) bola(s) ${e.balls.join(', ')}`,
    spark: 'spark',
    sparkFoul: (e) => `falta de spark (${SPARK_REASONS[e.reason]})`,
    nothing: 'nada',
    shot: (n, ball, team, text, r, b) => `#${n} bola ${ball} (${team}): ${text} | Rojas ${r} - Blancas ${b}`,
    reasons: { perfect: 'juego perfecto (25 puntos)', time: 'se acabó el tiempo', allIn: 'todas las bolas terminaron' },
    final: (model, seed, n, r, b, res, why) => `FINAL (${model}, semilla ${seed}, ${n} golpes): Rojas ${r} - Blancas ${b} → ${res}; ${why}`,
    result: (r, b) => (r === b ? 'empate' : r > b ? 'ganan Rojas' : 'ganan Blancas'),
  },
}[lang];

const match = createMatch({ seed });
// Una instancia por equipo (Saihai no guarda estado entre golpes: solo sus opciones). Los dos son Saihai, así que cada uno juzga al rival con 'saihai'.
const agentes = [new Saihai({ opponent: 'saihai', lang }), new Saihai({ opponent: 'saihai', lang })];

const texto = (e) => {
  const t = T[e.type];
  return typeof t === 'function' ? t(e) : t;
};

let golpes = 0;
while (match.stage !== 'done' && golpes < 3000) { // el tope es solo una red de seguridad
  golpes++;
  const bola = match.b.n;           // bola que juega
  const eq = match.b.team;          // 0 = Rojas / Red (impares / odd), 1 = Blancas / White (pares / even)
  const res = playShot(match, agentes[eq].chooseShot(match));
  console.log(T.shot(golpes, bola, T.teams[eq], res.events.map(texto).join('; ') || T.nothing, match.teamScore(0), match.teamScore(1)));
  if (raw) console.log('   ', JSON.stringify(res.events), 'touches:', JSON.stringify(res.touches), 'next:', res.next);
  match.proceed();
}
const r = match.teamScore(0), b = match.teamScore(1);
console.log(T.final(SAIHAI_MODEL, seed, golpes, r, b, T.result(r, b), T.reasons[match.endReason()]));
