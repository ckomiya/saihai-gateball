// Revisar un turno de una partida registrada: dibuja la cancha (SVG) y explica la decisión de la CPU.
// Uso: npm run replay -- partidas/<archivo>.json --turn 23        (dibuja y explica el turno 23; con --shot N, el golpe N de la partida)
//      npm run replay -- partidas/<archivo>.json --list            (una línea por golpe)
//      npm run replay -- partidas/<archivo>.json --turn 23 --out ruta.svg
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CONFIG, LAYOUT } from '../src/config';
import { COURT_H, COURT_W, GATES } from '../src/game/court';
import type { BallRec, MatchLogData, ShotLog } from '../src/game/matchLog';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && a.endsWith('.json'));
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };
if (!file) { console.error('Uso: npm run replay -- partidas/<archivo>.json --turn 23   (o --shot N, o --list)'); process.exit(2); }
const data = JSON.parse(readFileSync(file, 'utf8')) as MatchLogData;

const f2 = (v: number | undefined) => (v === undefined ? '–' : v.toFixed(2));
const pos = (p: { x: number; y: number }) => `(${f2(p.x)}; ${f2(p.y)})`;
const who = (s: ShotLog) => `bola ${s.ball} (${s.team === 0 ? 'roja' : 'blanca'}${s.cpu ? ', CPU' : ', humano'})`;

if (argv.includes('--list')) {
  console.log(`${data.id} · nivel ${data.level + 1} · ${data.shots.length} golpes${data.final ? ` · final ${data.final.score[0]}-${data.final.score[1]} (${data.final.reason})` : ' · sin terminar'}`);
  for (const s of data.shots) {
    const d = s.decision;
    const r = s.result;
    console.log(`  golpe ${String(s.shot).padStart(3)} · turno ${String(s.turn).padStart(3)}.${s.stroke} · ${s.clockText} · ${who(s).padEnd(22)} · ${(d?.kind ?? s.mode).padEnd(28)} · ${r ? r.messages.join(' / ') || '–' : 'sin resolver'}${s.outCause ? ` · SALE: ${s.outCause.cause}` : ''}`);
  }
  process.exit(0);
}

const shotN = opt('shot');
const turnN = opt('turn');
const shots = shotN ? data.shots.filter((s) => s.shot === Number(shotN)) : turnN ? data.shots.filter((s) => s.turn === Number(turnN)) : [];
if (!shots.length) { console.error(`No hay golpes ${shotN ? `con golpe ${shotN}` : turnN ? `en el turno ${turnN}` : '(pasa --turn N, --shot N o --list)'}. Turnos: 1 a ${data.shots.at(-1)?.turn}.`); process.exit(1); }

// ---------- Dibujo (SVG) ----------

const K = 40, M = 60; // px por metro y margen
const X = (x: number) => M + x * K, Y = (y: number) => M + y * K;
const WIDTH = M * 2 + COURT_W * K, HEIGHT = M * 2 + COURT_H * K + 70;

function drawShot(s: ShotLog): string {
  const o: string[] = [];
  const ballColor = (n: number) => (n % 2 === 1 ? '#e03b3b' : '#f4f4f4');
  o.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#1c3a1c"/>`);
  o.push(`<rect x="${X(-1)}" y="${Y(-1)}" width="${(COURT_W + 2) * K}" height="${(COURT_H + 2) * K}" fill="#2f6b2f"/>`);
  o.push(`<rect x="${X(0)}" y="${Y(0)}" width="${COURT_W * K}" height="${COURT_H * K}" fill="none" stroke="#fff" stroke-width="2"/>`);
  const sa = LAYOUT.startArea;
  o.push(`<rect x="${X(sa.x1)}" y="${Y(sa.y1)}" width="${(sa.x2 - sa.x1) * K}" height="${(sa.y2 - sa.y1) * K}" fill="none" stroke="#fff" stroke-opacity=".7"/>`);
  for (const g of GATES) {
    o.push(`<line x1="${X(g.a.x)}" y1="${Y(g.a.y)}" x2="${X(g.b.x)}" y2="${Y(g.b.y)}" stroke="#ffd23f" stroke-width="3"/>`);
    const ox = g.orient === 'h' ? 0 : 14, oy = g.orient === 'h' ? -10 : 0;
    o.push(`<text x="${X(g.x) + ox + 6}" y="${Y(g.y) + oy + 4}" fill="#ffd23f" font-size="13" font-family="monospace">P${g.n}</text>`);
  }
  o.push(`<circle cx="${X(LAYOUT.pole.x)}" cy="${Y(LAYOUT.pole.y)}" r="5" fill="#fff"/>`);
  const after = new Map((s.after ?? []).map((b) => [b.n, b]));
  const R = Math.max(6, CONFIG.ballRadiusM * K);
  const visible = (b: BallRec) => (b.gate >= 2 && b.gate <= 4) || b.out;
  // posición final (hueco) y trayecto
  for (const b of s.before) {
    const a = after.get(b.n);
    if (!a) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) > 0.02 && (visible(b) || visible(a))) {
      o.push(`<line x1="${X(b.x)}" y1="${Y(b.y)}" x2="${X(a.x)}" y2="${Y(a.y)}" stroke="${b.n === s.ball ? '#ffd23f' : '#ff9a3c'}" stroke-width="2" stroke-dasharray="5 4"/>`);
      if (visible(a)) o.push(`<circle cx="${X(a.x)}" cy="${Y(a.y)}" r="${R}" fill="none" stroke="${ballColor(b.n)}" stroke-width="2" stroke-dasharray="3 3"/>`);
    }
  }
  // bolas antes del golpe
  for (const b of s.before) {
    if (!visible(b) && b.n !== s.ball) continue;
    o.push(`<circle cx="${X(b.x)}" cy="${Y(b.y)}" r="${R}" fill="${ballColor(b.n)}" stroke="${b.n === s.ball ? '#ffd23f' : '#000'}" stroke-width="${b.n === s.ball ? 3 : 1}"/>`);
    o.push(`<text x="${X(b.x)}" y="${Y(b.y) - R - 4}" fill="#fff" font-size="12" font-family="monospace" text-anchor="middle" stroke="#000" stroke-width="3" paint-order="stroke">${b.n}${b.out ? '⊗' : ''}</text>`);
  }
  // mira del golpe y mira de las alternativas (1 = la elegida)
  const alts = s.decision?.explanation?.alternatives ?? [];
  alts.forEach((a, i) => {
    if (i === 0) return;
    o.push(`<g stroke="#8ec5ff" stroke-width="1.5" opacity=".8"><line x1="${X(a.aim.x) - 5}" y1="${Y(a.aim.y)}" x2="${X(a.aim.x) + 5}" y2="${Y(a.aim.y)}"/><line x1="${X(a.aim.x)}" y1="${Y(a.aim.y) - 5}" x2="${X(a.aim.x)}" y2="${Y(a.aim.y) + 5}"/></g>`);
    o.push(`<text x="${X(a.aim.x) + 7}" y="${Y(a.aim.y) - 5}" fill="#8ec5ff" font-size="12" font-family="monospace">${i + 1}</text>`);
  });
  const a = s.decision?.explanation?.alternatives[0]?.aim ?? s.plan?.aim ?? s.input.shownAim;
  const bb = s.before.find((b) => b.n === s.ball)!;
  o.push(`<line x1="${X(bb.x)}" y1="${Y(bb.y)}" x2="${X(a.x)}" y2="${Y(a.y)}" stroke="#fff" stroke-opacity=".5" stroke-dasharray="2 4"/>`);
  o.push(`<g stroke="#ffd23f" stroke-width="2.5"><line x1="${X(a.x) - 8}" y1="${Y(a.y)}" x2="${X(a.x) + 8}" y2="${Y(a.y)}"/><line x1="${X(a.x)}" y1="${Y(a.y) - 8}" x2="${X(a.x)}" y2="${Y(a.y) + 8}"/></g>`);
  if (s.plan && Math.hypot(s.plan.aim.x - a.x, s.plan.aim.y - a.y) > 0.01) o.push(`<circle cx="${X(s.plan.aim.x)}" cy="${Y(s.plan.aim.y)}" r="4" fill="#ff5a5a"/>`);
  // rótulo
  const lines = [
    `${data.id} · turno ${s.turn}.${s.stroke} (golpe ${s.shot}) · reloj ${s.clockText} · ${who(s)} · ${s.decision?.kind ?? s.mode}`,
    `+ amarillo: mira elegida · punto rojo: mira real de la CPU (con error) · azul: alternativas 2-5 · línea discontinua: recorrido de las bolas`,
    `marcador al terminar el golpe: rojo ${s.score?.[0] ?? '?'} - ${s.score?.[1] ?? '?'} blanco · ${s.result?.messages.join(' / ') || 'sin mensajes'}`,
  ];
  lines.forEach((t, i) => o.push(`<text x="${M}" y="${M + COURT_H * K + 30 + i * 18}" fill="#fff" font-size="13" font-family="monospace">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">\n${o.join('\n')}\n</svg>\n`;
}

// ---------- Explicación ----------

const TERM_NAMES: Record<string, string> = {
  puntos: 'puntos', bolasFuera: 'bolas fuera', falta: 'falta', miBolaSale: 'mi bola sale', salidaPropia: 'salir a propósito', noEntra: 'no entra', touch: 'touch', continuo: 'golpe continuo', posicion: 'posición', exposicion: 'exposición',
  acomodo: 'acomodo', oportunidadTouch: 'oportunidad de touch', riesgo: 'RIESGO', agariListo: 'agari: espera cerca', zona: 'zona de entrada', apoyo: 'apoyo', apoyoRival: 'apoyo del rival',
  montonRiesgo: 'riesgo de montón', montonValor: 'valor de montón', poste: 'poste',
};
const termsText = (t: Record<string, number>, n = 6) =>
  Object.entries(t).filter(([, v]) => Math.abs(v) > 1e-9).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n).map(([k, v]) => `${TERM_NAMES[k] ?? k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join(' · ');

function explain(s: ShotLog) {
  console.log(`\n══ Turno ${s.turn}.${s.stroke} · golpe ${s.shot} de la partida · reloj ${s.clockText} (${s.clock.toFixed(0)} s de partido) ══`);
  console.log(`${who(s)} · ${s.mode}${s.sparkBall ? ` de la bola ${s.sparkBall}` : ''}`);
  console.log(`Ritmo: ${s.pacing.secondsPerRound.toFixed(0)} s de reloj por vuelta → al kantoku le quedan ${s.pacing.turnsLeft} turnos por bola · fase ${s.pacing.phase}`);
  const live = s.before.filter((b) => b.gate >= 2 && b.gate <= 4);
  console.log(`Bolas (antes): ${s.before.map((b) => `${b.n}${b.out ? ' fuera' : b.gate === 1 ? ' sin salir' : b.gate === 5 ? ' meta' : ` P${b.gate}`}${b.gate >= 2 && b.gate <= 4 ? ` ${pos(b)}` : ''}${b.pts ? ` ${b.pts}p` : ''}`).join(' | ')}`);
  void live;
  const d = s.decision;
  if (d) {
    console.log(`\nDecisión [${d.source}${d.opening ? ' ' + d.opening : ''}]: ${d.kind}`);
    console.log(`  mira ${pos(s.plan!.aim)} · fuerza ${f2(s.plan!.power)} (ideal ${f2(s.plan!.idealPower)}) · rumbo ${f2(s.plan!.acc)} (ideal ${f2(s.plan!.idealAcc)})`);
    if (d.chain) console.log(`  ${d.chain.turn === 'ultimo' ? 'ÚLTIMO TURNO' : 'PENÚLTIMO TURNO sin rivales que ataquen'}: busca la cadena que más puntos suma, sin riesgo · valor esperado ${d.chain.value.toFixed(2)} puntos · ${d.chain.nodes} nodos`);
    const i = d.intended;
    console.log(`  si sale exacto: ${i.pole ? 'llega al poste · ' : ''}${i.gate ? 'pasa una puerta · ' : ''}${i.touched.length ? `toca ${i.touched.join(', ')} · ` : ''}${i.out.length ? `saca ${i.out.join(', ')} · ` : ''}${i.shooterOut ? 'SU BOLA SALE · ' : ''}${i.foul ? 'falta · ' : ''}${d.intended.sparkOk === false ? 'spark fallido · ' : ''}`.replace(/ · $/, '') || '  (nada especial)');
    const ex = d.explanation;
    if (ex) {
      console.log(`\nAlternativas (${ex.candidates} candidatos, ${ex.scored} válidos; valor medio con error, y términos del golpe exacto):`);
      ex.alternatives.forEach((a, k) => console.log(`  ${k + 1}${a.chosen ? '*' : ' '} ${a.kind.padEnd(26)} mira ${pos(a.aim)}${a.powerMul ? ` ×${a.powerMul.toFixed(2)} fuerza` : ''} · valor ${a.value.toFixed(2)}\n       ${termsText(a.terms)}`));
      if (ex.risk.length) {
        console.log('\nRiesgo del golpe elegido (por cada rival que juega pronto; «pasa» = que pase su puerta; «toca» = que toque una bola mía):');
        for (const r of ex.risk) {
          const t = [...r.touches].sort((a, b) => b.weighted - a.weighted).slice(0, 3).map((x) => `toca ${x.ball}: ${(100 * x.pTouch).toFixed(0)} % → amenaza ${x.threat.toFixed(2)}`).join(' · ');
          console.log(`  rival ${r.rival} (peso ${r.weight}): pasa ${r.pass.toFixed(2)} · ${t || 'sin bolas mías a tiro'} → cuenta solo la mayor: ${r.best.toFixed(2)}${r.free < 0.999 ? ` (queda libre ${(100 * r.free).toFixed(0)} %)` : ''}`);
        }
      }
      if (ex.agari) {
        const a = ex.agari;
        console.log(`\nAgari: a la bola le quedan ${a.turnsLeft} turnos (el límite es ${a.limit}) · retenidas ${a.heldBack} jugadas al poste · amenaza mínima ${a.minThreat.toFixed(2)} (límite ${a.threatLimit})${a.chosenIsAgari ? ` → ELIGIÓ EL POSTE: ${a.why}` : ' → no fue al poste'}`);
      }
    }
  }
  console.log(`\nGolpe real: mira ${pos(s.input.shownAim)} · fuerza ${f2(s.input.power)} · rumbo ${f2(s.input.acc)}`);
  if (s.result) console.log(`Resultado: ${s.result.messages.join(' / ') || '(sin mensajes)'}${s.outCause ? `\n  Su bola SALIÓ: ${s.outCause.cause} — ${s.outCause.detail}` : ''}`);
  const moved = (s.after ?? []).filter((a) => { const b = s.before.find((x) => x.n === a.n)!; return Math.hypot(a.x - b.x, a.y - b.y) > 0.02 || a.gate !== b.gate || a.out !== b.out; });
  if (moved.length) console.log(`Cambios: ${moved.map((a) => `${a.n}→${a.out ? 'fuera' : a.gate === 5 ? 'meta' : pos(a)}`).join(' · ')}`);
}

const outDir = opt('out') ? dirname(opt('out')!) : join(dirname(file), 'replays');
mkdirSync(outDir, { recursive: true });
for (const s of shots) {
  explain(s);
  const out = opt('out') && shots.length === 1 ? opt('out')! : join(outDir, `${basename(file, '.json')}-t${s.turn}-${s.stroke}.svg`);
  writeFileSync(out, drawShot(s));
  console.log(`Dibujo: ${out}`);
}
