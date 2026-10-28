// Saihai (Rojas) contra Saihai (Blancas) con semilla fija; imprime un resumen en español por golpe.
// Uso: node examples/duelo.mjs [semilla] [--raw]    (--raw imprime también los eventos tal cual)
// Solo usa la API raíz de 'saihai-gateball'. Dentro de este repositorio necesita `npm run build` antes (usa dist/).
import { createMatch, Saihai, playShot, SAIHAI_MODEL } from 'saihai-gateball';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const seed = Number(args.find((a) => !a.startsWith('--')) ?? 42);

const match = createMatch({ seed });
// Una instancia por equipo (Saihai no guarda estado entre golpes: solo sus opciones). Los dos son Saihai, así que cada uno juzga al rival con 'saihai'.
const agentes = [new Saihai({ opponent: 'saihai' }), new Saihai({ opponent: 'saihai' })];
const equipo = ['Rojas', 'Blancas'];

const texto = (e) => {
  switch (e.type) {
    case 'gate': return `pasa la puerta ${e.gate}${e.stroker ? '' : ` (bola ${e.ball})`}`;
    case 'pole': return `llega al poste${e.stroker ? '' : ` (bola ${e.ball})`}`;
    case 'out': return `la bola ${e.ball} sale`;
    case 'noTouch': return 'sin touch';
    case 'strokerOut': return e.start ? 'sale sin pasar la puerta 1' : `queda fuera${e.foul ? ` por falta (${e.foul})` : ''}`;
    case 'backInPlay': return 'vuelve a juego';
    case 'ballOut': return 'bola fuera';
    case 'failGate1': return 'falla la puerta 1';
    case 'touch': return `touch a la(s) bola(s) ${e.balls.join(', ')}`;
    case 'spark': return 'spark';
    case 'sparkFoul': return `falta de spark (${e.reason})`;
  }
};

let golpes = 0;
while (match.stage !== 'done' && golpes < 3000) { // el tope es solo una red de seguridad
  golpes++;
  const bola = match.b.n;           // bola que juega
  const eq = match.b.team;          // 0 = Rojas (impares), 1 = Blancas (pares)
  const res = playShot(match, agentes[eq].chooseShot(match));
  console.log(`#${golpes} bola ${bola} (${equipo[eq]}): ${res.events.map(texto).join('; ') || 'nada'} | Rojas ${match.teamScore(0)} - Blancas ${match.teamScore(1)}`);
  if (raw) console.log('   ', JSON.stringify(res.events), 'touches:', JSON.stringify(res.touches), 'next:', res.next);
  match.proceed();
}
const r = match.teamScore(0), b = match.teamScore(1);
const motivos = { perfect: 'juego perfecto (25 puntos)', time: 'se acabó el tiempo', allIn: 'todas las bolas terminaron' };
console.log(`FINAL (${SAIHAI_MODEL}, semilla ${seed}, ${golpes} golpes): Rojas ${r} - Blancas ${b} → ${r === b ? 'empate' : r > b ? 'ganan Rojas' : 'ganan Blancas'}; ${motivos[match.endReason()]}`);
