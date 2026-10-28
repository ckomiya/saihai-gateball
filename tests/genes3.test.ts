// Genes del v3 y del v4 (iteración E y G). Comprueba que
//  - los genes del v3 tienen el tamaño esperado (29 del v2 + 9 de reglas) y los del v4 son los 29 del v2 + `leadSlope` y `clockSlope` (31; las demás reglas quedan fijas);
//  - el piso del riesgo se mantiene;
//  - el genoma del v4 construido con los valores del campeón actual (v4, `cpuWeights.json`) reproduce sus pesos base, multiplicadores y `leadSlope`/`clockSlope`;
//  - un partido con ese archivo (más las reglas fijas del campeón) da exactamente lo mismo que con el campeón, y con otras reglas el partido cambia;
//  - los límites se respetan al convertir un genoma.
// 2026-10-27 (adopción del v4): reescrita. Antes partía del campeón v3 sin sus reglas y esperaba el mismo partido; con el riesgo por valor encendido el gen `passScale` parte de 0,14 (no del 1 de `config.ts` que usa el archivo sin reglas), y el v4 trae sus reglas y dos genes más.
import { CONFIG } from '../src/config';
import { kantokuLevelErrors } from '../src/game/cpuDriver';
import { kantokuBrain } from '../src/game/kantoku';
import { AnyWeightFile, Brain, RULE_GENES, RULE_GENES4, WeightFile2, clampGene, genes2, genes3, genes4, genomeToFile2, weightsFor } from '../src/game/weights';
import { championV1 } from '../scripts/trainLib';
import { playMatch } from '../scripts/selfplay';

let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log((ok ? '✓ ' : '✗ ') + msg); };
const champion = (kantokuBrain as { file: AnyWeightFile }).file as WeightFile2;
const g2 = genes2(championV1), g3 = genes3(champion, championV1), g4 = genes4(champion, championV1);
check(g2.length === 29 && g3.length === 29 + RULE_GENES.length && RULE_GENES.length === 9, `genes del v3: ${g2.length} del v2 y ${g3.length - g2.length} de reglas`);
check(g4.length === 29 + RULE_GENES4.length && RULE_GENES4.length === 2, `genes del v4: ${g2.length} del v2 y ${g4.length - g2.length} de reglas (leadSlope y clockSlope)`);
const risk = g4.find((g) => g.name === 'risk')!;
check(risk.lo >= CONFIG.kantokuRiskFloor && risk.init >= CONFIG.kantokuRiskFloor, `el piso del riesgo se mantiene (límite inferior ${risk.lo})`);
const x0 = g4.map((g) => g.init);
const f0 = genomeToFile2(x0, g4, undefined, champion.riskWeights, true);
const sameBase = Object.keys(champion.base).every((k) => Math.abs((f0.base as Record<string, number>)[k] - (champion.base as Record<string, number>)[k]) < 1e-9);
const sameMult = (['inicio', 'final'] as const).every((p) => Object.keys(champion.mult[p]).every((k) => Math.abs((f0.mult[p] as Record<string, number>)[k] - (champion.mult[p] as Record<string, number>)[k]) < 1e-9));
check(sameBase && sameMult, 'el genoma del v4 reproduce los pesos base y los multiplicadores del campeón');
const r0 = f0.rules as Record<string, number>, rc = champion.rules as Record<string, number>;
check(f0.advanced === true && RULE_GENES4.every((r) => Math.abs(r0[r.name] - rc[r.name]) < 1e-3), `leadSlope (${r0.leadSlope}) y clockSlope (${r0.clockSlope}) de partida valen los del campeón y las reglas avanzadas van activadas`);
const hi = genomeToFile2(g4.map((g) => g.hi * 10), g4, undefined, undefined, true);
check((hi.rules as Record<string, number>).leadSlope === 1.5 && (hi.rules as Record<string, number>).clockSlope === 1.5, 'los límites de las reglas del v4 se respetan');
check(g4.every((g, i) => clampGene(g, x0[i]) === x0[i]), 'el genoma de partida está dentro de los límites');
const w = weightsFor({ kind: 'kantoku', file: { ...f0, rules: { ...rc, ...f0.rules } } }, 'medio');
check(w.heapRisk === rc.heapRisk && w.contAttack === rc.contAttack && w.leadSlope === rc.leadSlope, 'el archivo de pesos entrega las reglas al planificador');
const fixed = { ...f0, rules: { ...rc, ...f0.rules } } as WeightFile2; // las reglas del v3 se conservan fijas (como en `fileFromGenome`)

// Un partido igual con el campeón y con el archivo de partida
const err = kantokuLevelErrors();
const play = (file: AnyWeightFile, seed = 12) => {
  const b: Brain = { kind: 'kantoku', file };
  return playMatch({ seed, levels: [3, 3], errors: { ...err, rivalIsHuman: false }, brains: [b, kantokuBrain], errorScales: [{ exec: 0.4, plan: 0.4 }, { exec: 0.4, plan: 0.4 }], maxStrokes: 150 });
};
const a = play(champion), b = play(fixed);
check(a.red === b.red && a.white === b.white && a.strokes === b.strokes, `un partido con el genoma de partida es idéntico al del campeón (${a.red}-${a.white} en ${a.strokes} golpes)`);
const other = { ...f0, rules: { ...fixed.rules, heapRisk: 1.5, heapValue: 0, contAttack: 0.2 } };
const differs = [12, 13, 14, 15].some((s) => { const x = play(champion, s), y = play(other, s); return x.red !== y.red || x.white !== y.white || x.strokes !== y.strokes; });
check(differs, 'con otras reglas al menos uno de cuatro partidos cambia (los genes de reglas tienen efecto)');
if (fail) { console.log(`\n${fail} comprobaciones fallaron`); process.exit(1); }
console.log('\nTodo bien');
