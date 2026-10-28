// Compara dos ejecuciones de escenarios (el golden grabado y otra) y devuelve las diferencias.
const TOL = 2e-6;

export function compareRuns(expected: any[], actual: any[]): string[] {
  const diffs: string[] = [];
  if (expected.length !== actual.length) diffs.push(`Número de escenarios: esperado ${expected.length}, obtenido ${actual.length}`);
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    const e = expected[i], a = actual[i];
    if (e.name !== a.name) { diffs.push(`Escenario ${i}: nombre ${e.name} ≠ ${a.name}`); continue; }
    const steps = Math.max(e.steps.length, a.steps.length);
    for (let s = 0; s < steps; s++) {
      const es = e.steps[s], as = a.steps[s];
      const tag = `«${e.name}» golpe ${s + 1}`;
      if (!es || !as) { diffs.push(`${tag}: falta el golpe`); continue; }
      for (const k of ['who', 'turn', 'phase', 'owed', 'spark', 'ending', 'endNow']) {
        if (es[k] !== as[k]) diffs.push(`${tag}: ${k} esperado ${es[k]}, obtenido ${as[k]}`);
      }
      if (JSON.stringify(es.msgs) !== JSON.stringify(as.msgs)) diffs.push(`${tag}: mensajes esperados ${JSON.stringify(es.msgs)}, obtenidos ${JSON.stringify(as.msgs)}`);
      if (JSON.stringify(es.sparked) !== JSON.stringify(as.sparked)) diffs.push(`${tag}: sparkeadas ${JSON.stringify(es.sparked)} ≠ ${JSON.stringify(as.sparked)}`);
      if (Math.abs(es.clock - as.clock) > 1e-4) diffs.push(`${tag}: reloj esperado ${es.clock}, obtenido ${as.clock}`);
      for (let b = 0; b < es.balls.length; b++) {
        const eb = es.balls[b], ab = as.balls[b];
        if (eb.g !== ab.g || eb.out !== ab.out || eb.p !== ab.p) diffs.push(`${tag}: bola ${eb.n} estado esperado g${eb.g} fuera ${eb.out} pts ${eb.p}, obtenido g${ab.g} fuera ${ab.out} pts ${ab.p}`);
        if (Math.abs(eb.x - ab.x) > TOL || Math.abs(eb.y - ab.y) > TOL) diffs.push(`${tag}: bola ${eb.n} en (${eb.x}, ${eb.y}), obtenida (${ab.x}, ${ab.y})`);
      }
    }
  }
  return diffs;
}
