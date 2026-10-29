// API pública (`src/index.ts`): crear un partido, pedir una jugada y aplicarla. Debe dar lo mismo que usar el motor y el planificador directamente,
// ser repetible con la misma semilla y, si `dist/` está compilado, dar exactamente lo mismo desde el paquete publicado (`npm run build`).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Saihai, createMatch, playShot } from '../src/index';
import { KANTOKU_LEVEL, cpuPlan, kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { Match } from '../src/game/match';
import { mulberry32 } from '../src/game/rng';

let bad = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) bad++; };

interface Api { createMatch: typeof createMatch; Saihai: typeof Saihai; playShot: typeof playShot }

/** Veinte golpes de Saihai contra sí mismo, desde la semilla `seed`; devuelve una huella de lo ocurrido. */
function flow(api: Api, seed: number, shots = 20): string {
  const m = api.createMatch({ seed });
  const saihai = new api.Saihai({ opponent: 'human' });
  const out: string[] = [];
  for (let i = 0; i < shots && m.stage !== 'done'; i++) {
    const shot = saihai.chooseShot(m);
    const res = api.playShot(m, shot);
    out.push(`${m.turn}:${shot.aim.x.toFixed(3)},${shot.aim.y.toFixed(3)},${shot.power.toFixed(3)},${shot.accuracy.toFixed(3)}:${res.events.length}`);
    m.proceed();
  }
  return out.join('|') + `|${m.teamScore(0)}-${m.teamScore(1)}`;
}

const api: Api = { createMatch, Saihai, playShot };

// 1) La fachada elige lo mismo que el planificador usado directamente (mismo partido, mismo azar)
{
  const a = createMatch({ seed: 7 }), b = new Match(mulberry32(7));
  b.reset();
  const shot = new Saihai({ opponent: 'human' }).chooseShot(a);
  const plan = cpuPlan(b, KANTOKU_LEVEL, { brain: kantokuBrain, errors: { ...kantokuLevelErrors(), rivalIsHuman: true } });
  check(shot.aim.x === plan.aim.x && shot.aim.y === plan.aim.y && shot.power === plan.power && shot.accuracy === plan.acc && shot.startX === plan.startX, 'chooseShot elige lo mismo que cpuPlan con el nivel «Kantoku IA»');
}

// 2) Repetible
const f1 = flow(api, 11), f2 = flow(api, 11), f3 = flow(api, 12);
check(f1 === f2, 'la misma semilla da la misma partida');
check(f1 !== f3, 'otra semilla da otra partida');

// 3) Los golpes se aplican y el partido avanza
{
  const m = createMatch({ seed: 3 });
  const saihai = new Saihai();
  let strokes = 0;
  for (; strokes < 30 && m.stage !== 'done'; strokes++) {
    const res = playShot(m, saihai.chooseShot(m));
    if (!res || m.stage === 'rolling') break;
    m.proceed();
  }
  check(strokes === 30 || m.stage === 'done', `30 golpes de Saihai sin quedarse trabado (${strokes})`);
  check(m.balls.some((b) => b.nextGate > 1), 'alguna bola pasó la puerta 1');
}

// 4) Con explain, anota la decisión
{
  const m = createMatch({ seed: 5 });
  const shot = new Saihai({ explain: true }).chooseShot(m);
  check(!!shot.plan.decision, 'con explain el plan trae la decisión');
}

// 5) El paquete compilado (dist/) da lo mismo
const distIndex = resolve('dist/index.js');
if (existsSync(distIndex)) {
  const dist = (await import(pathToFileURL(distIndex).href)) as Api;
  const engine = (await import(pathToFileURL(resolve('dist/engine.js')).href)) as { Match: typeof Match };
  check(flow(dist, 11) === f1, 'dist/index.js juega exactamente la misma partida que src');
  const dm = dist.createMatch({ seed: 1 });
  check(dm instanceof engine.Match, 'index y engine comparten el mismo Match (sin copias del módulo)');
} else {
  console.log('· dist/ no está compilado (npm run build): se omite la comprobación del paquete');
}

// 6) La etiqueta del modelo coincide con la versión declarada: `package.json` (X.Y de X.Y.Z) y la última entrada con modelo de los dos CHANGELOG
{
  const { readFileSync } = await import('node:fs');
  const { SAIHAI_MODEL } = await import('../src/index');
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  const [major, minor] = version.split('.');
  check(SAIHAI_MODEL === `saihai-v${major}.${minor}`, `SAIHAI_MODEL (${SAIHAI_MODEL}) coincide con el modelo de package.json (saihai-v${major}.${minor})`);
  for (const file of ['CHANGELOG.md', 'CHANGELOG.es.md']) {
    const text = readFileSync(file, 'utf8');
    const top = text.match(/^## (\d+\.\d+\.\d+)/m)?.[1];
    const model = text.match(/^## [^\n]*`(saihai-v\d+\.\d+)`/m)?.[1];
    check(top === version, `${file}: la primera entrada (${top}) es la versión de package.json (${version})`);
    check(model === SAIHAI_MODEL, `${file}: el último modelo anotado (${model}) coincide con SAIHAI_MODEL`);
  }
}

console.log(bad ? `\n${bad} fallas` : '\nTodo bien');
if (bad) process.exit(1);
