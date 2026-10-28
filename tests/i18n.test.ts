// Idiomas (v1.4.2): sin indicar idioma, los textos y las decisiones son idénticos a los de v1.4.1 (`fixtures/i18n-v1.4.1.json`, grabado con el código anterior);
// con `lang: 'en'` todo sale en inglés sin cambiar ninguna jugada; un idioma desconocido lanza error.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Saihai, createMatch, playShot } from '../src/index';
import { messageFor, messagesFor, noTouchMessage, NO_TOUCH_MSG } from '../src/game/messages';
import { OPENING_SITES } from '../src/game/openings';
import type { MatchEvent } from '../src/game/match';

let bad = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) bad++; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface Fixture { events: MatchEvent[]; messages: string[]; shots: { seed: number; aim: number[]; decisionSha: string; kind: string; messages: string[] }[] }
const fx: Fixture = JSON.parse(readFileSync('tests/fixtures/i18n-v1.4.1.json', 'utf8'));

// 1) Mensajes: sin idioma = v1.4.1; 'es' explícito = lo mismo; `.map(messageFor)` (índice como 2.º argumento) sigue dando español
check(JSON.stringify(messagesFor(fx.events)) === JSON.stringify(fx.messages), 'messagesFor sin idioma = v1.4.1 (19 eventos)');
check(JSON.stringify(messagesFor(fx.events, 'es')) === JSON.stringify(fx.messages), "messagesFor(…, 'es') = v1.4.1");
check(JSON.stringify(fx.events.map(messageFor as unknown as (e: MatchEvent, i: number) => string)) === JSON.stringify(fx.messages), 'events.map(messageFor) sigue dando español');
check(noTouchMessage() === NO_TOUCH_MSG, 'NO_TOUCH_MSG intacto');

// 2) Mensajes en inglés: los mismos eventos, sin restos del español
const en = messagesFor(fx.events, 'en');
const spanishWord = /[áéíóúñ¡¿]|\b(PUERTA|BOLA|FUERA|FALTA|SALIÓ|SALIDA|POSTE|TOCÓ|VUELVE|JUEGO|FALLÓ|TIRO|PASÓ|PERO|PUNTOS)\b/;
check(en.length === fx.messages.length && en.every((t, i) => t !== fx.messages[i]), 'cada mensaje cambia al traducir');
check(!en.some((t) => spanishWord.test(t)), 'ningún mensaje en inglés contiene palabras del español');
check(new Set(en).size === new Set(fx.messages).size, 'el inglés distingue los mismos mensajes que el español (los dos repiten «bola fuera»)');
check(noTouchMessage('en') === 'NO TOUCH: START SHOT', 'noTouchMessage("en")');
check(en[0] === 'GATE 1 PASSED! +1' || /^GATE 1 PASSED! \+\d+$/.test(en[0]), `forma de un mensaje: «${en[0]}»`);

// 3) Decisiones: sin idioma = v1.4.1 exacto (huella de la decisión completa, 360 golpes en 3 partidas)
const kindsEs = new Set<string>(), kindsEn = new Set<string>();
let same = 0, enTotal = 0, enClean = 0, aimSame = 0;
for (const seed of [5, 6, 7]) {
  const mDef = createMatch({ seed }), mEn = createMatch({ seed });
  const def = new Saihai({ opponent: 'saihai', explain: true }), eng = new Saihai({ opponent: 'saihai', explain: true, lang: 'en' });
  const rows = fx.shots.filter((s) => s.seed === seed);
  for (let i = 0; i < rows.length && mDef.stage !== 'done'; i++) {
    const a = def.chooseShot(mDef), b = eng.chooseShot(mEn);
    const rA = playShot(mDef, a), rB = playShot(mEn, b);
    const row = rows[i];
    if (sha(JSON.stringify(a.plan.decision)) === row.decisionSha && a.plan.decision!.kind === row.kind && JSON.stringify(messagesFor(rA.events)) === JSON.stringify(row.messages) && JSON.stringify([a.aim.x, a.aim.y, a.power, a.accuracy]) === JSON.stringify(row.aim)) same++;
    // el idioma no cambia la jugada: mismas barras y mismos eventos
    if (JSON.stringify([a.aim, a.power, a.accuracy, a.startX]) === JSON.stringify([b.aim, b.power, b.accuracy, b.startX]) && JSON.stringify(rA.events) === JSON.stringify(rB.events)) aimSame++;
    kindsEs.add(a.plan.decision!.kind); kindsEn.add(b.plan.decision!.kind);
    enTotal++;
    const json = JSON.stringify(b.plan.decision);
    // en inglés no deben quedar ni los tipos de jugada ni los textos del español (las claves del libro de aperturas son identificadores, no textos)
    if (!/"(source|kind|why)":"[^"]*(puerta|bola|acomodo|salida|reentrada|compañera|planificador|apertura|expulsar|mover|propio)/i.test(json) && !/"(puntos|riesgo|exposicion|bolasFuera|propiaFuera)":/.test(json)) enClean++;
    mDef.proceed(); mEn.proceed();
  }
}
check(same === fx.shots.length, `Saihai sin idioma = v1.4.1 en ${same}/${fx.shots.length} golpes (barras, mensajes y decisión completa)`);
check(aimSame === enTotal, `lang:'en' no cambia ninguna jugada (${aimSame}/${enTotal})`);
check(enClean === enTotal, `decisiones en inglés sin textos del español (${enClean}/${enTotal})`);
check(kindsEs.size >= 8 && kindsEn.size === kindsEs.size, `tipos de jugada traducidos: ${[...kindsEn].join(' | ')}`);

// 4) Idioma desconocido: error claro, no español en silencio
for (const bad_ of ['fr', null, 'EN']) {
  let msg = '';
  try { new Saihai({ lang: bad_ as never }); } catch (e) { msg = e instanceof RangeError ? e.message : 'otro error'; }
  check(/unsupported lang/.test(msg), `Saihai({ lang: ${JSON.stringify(bad_)} }) lanza RangeError`);
}

// 5) Sitios de apertura con nota en los dos idiomas
check(Object.values(OPENING_SITES).every((s) => s.note && s.noteEn && !spanishWord.test(s.noteEn.toUpperCase().replace(/\bFRONT\b/, ''))), 'OPENING_SITES: nota en español y en inglés');

console.log(bad ? `\n${bad} fallas` : '\nTodo bien');
if (bad) process.exit(1);
