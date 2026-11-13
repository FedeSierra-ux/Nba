// Pruebas de las funciones puras de la interfaz (docs/app.js → NbaUtil). Ejecutar: node --test tests/app.test.js
const test = require('node:test');
const assert = require('node:assert');
const U = require('../docs/app.js');

test('lee cuotas con coma decimal (es-AR) y con punto', () => {
  assert.strictEqual(U.leerCuota('1,85'), 1.85);
  assert.strictEqual(U.leerCuota('1.85'), 1.85);
  assert.strictEqual(U.leerCuota(' 2,1 '), 2.1);
  assert.strictEqual(U.leerCuota('@1,44'), 1.44);
  assert.strictEqual(U.leerCuota('185'), 185);           // número entero válido, no se inventa la coma
  assert.strictEqual(U.leerCuota('1'), null);            // una cuota tiene que ser mayor que 1
  assert.strictEqual(U.leerCuota('abc'), null);
  assert.strictEqual(U.leerCuota(''), null);
  assert.strictEqual(U.leerCuota('1,8,5'), null);
});

test('lee montos con coma decimal y separador de miles', () => {
  assert.strictEqual(U.leerMonto('1500,5'), 1500.5);
  assert.strictEqual(U.leerMonto('1.500'), 1500);        // en es-AR el punto separa miles
  assert.strictEqual(U.leerMonto('1.500,50'), 1500.5);
  assert.strictEqual(U.leerMonto('2.000.000'), 2000000);
  assert.strictEqual(U.leerMonto('1500.5'), 1500.5);
  assert.strictEqual(U.leerMonto('1,5'), 1.5);
  assert.strictEqual(U.leerMonto(''), 0);
  assert.strictEqual(U.leerMonto('-5'), 0);
});

test('formato es-AR: porcentajes, cuotas y moneyline solo numérica', () => {
  assert.strictEqual(U.fP(0.083), '8,3%');
  assert.strictEqual(U.fP(0.7), '70%');
  assert.strictEqual(U.fP(0), '0%');
  assert.strictEqual(U.fP(null), '—');
  assert.strictEqual(U.fC(1.5), '1,50');
  assert.strictEqual(U.fMonto(1500.5), '1500,5');
  assert.strictEqual(U.fmtML(150), '+150');
  assert.strictEqual(U.fmtML(-337), '−337');
  assert.strictEqual(U.fmtML('<img src=x onerror=alert(1)>'), '—');
  assert.strictEqual(U.fmtML('EVEN'), '—');
});

test('etiquetas: sin duplicar la lesión, cortas, graves primero y decimales con coma', () => {
  const g = { est: 'Questionable', fl: ['minutos justos (25)', 'lesión: Questionable'] };
  const s = { fl: ['riesgo de blowout alto (spread 15.5): titulares pueden sentarse', 'historial en contra'] };
  const t = U.etiquetas(g, s);
  assert.deepStrictEqual(t.map((x) => x.txt), ['Questionable', 'Blowout alto', 'Minutos justos (25)', 'Historial en contra']);
  assert.deepStrictEqual(t.map((x) => x.nivel), ['alerta', 'alerta', 'medio', 'medio']);
  assert.ok(t[1].full.includes('spread 15,5'));
  assert.strictEqual(U.etiquetas({ est: 'Probable', fl: [] }, {})[0].nivel, 'medio');
  assert.strictEqual(U.corto('el modelo lo ve mucho más probable que la casa (83% vs 61%)'), 'Modelo 83% vs casa 61%');
});

// ---------------------------------------------------------------- reconstrucción de patas con datos nuevos
const grupo = (o) => Object.assign({ id: 7, j: 'Jugador', eq: 'AAA', riv: 'BBB', loc: true, gid: 'g1', m: 'pts', mn: 'Puntos', per: null, est: null, fl: [], L: 12.5, rec: 10.5,
  pasos: [{ L: 10.5, cu: 1.44, p: 0.70, c: 'amarillo', ju: 1.43, fl: [] }, { L: 12.5, cu: 1.9, p: 0.55, c: 'rojo', ju: 1.82, fl: [] }],
  menos: { L: 12.5, cu: 1.85, p: 0.45, c: 'rojo', ju: 2.2 } }, o);
const mapa = (gs) => new Map(gs.map((g) => [U.gkey(g), g]));

test('refrescarPata toma la probabilidad, el color y la cuota de los datos nuevos', () => {
  const vieja = U.nuevaPata(grupo(), grupo().pasos[0], 'mas');
  const nuevo = grupo({ est: 'Doubtful', pasos: [{ L: 10.5, cu: 1.6, p: 0.6, c: 'rojo', ju: 1.67, fl: [] }] });
  const n = U.refrescarPata(vieja, mapa([nuevo]));
  assert.strictEqual(n.p, 0.6); assert.strictEqual(n.c, 'rojo'); assert.strictEqual(n.cuota, 1.6); assert.strictEqual(n.est, 'Doubtful');
});

test('refrescarPata respeta la cuota editada a mano y descarta líneas que ya no existen', () => {
  const vieja = Object.assign(U.nuevaPata(grupo(), grupo().pasos[0], 'mas'), { cuota: 1.5 });
  assert.strictEqual(U.refrescarPata(vieja, mapa([grupo()])).cuota, 1.5);
  const sinLinea = grupo({ pasos: [{ L: 12.5, cu: 1.9, p: 0.55, c: 'rojo', ju: 1.82 }] });
  assert.strictEqual(U.refrescarPata(vieja, mapa([sinLinea])), null);
  assert.strictEqual(U.refrescarPata(vieja, new Map()), null);
  const menos = U.nuevaPata(grupo(), null, 'menos');
  assert.strictEqual(U.refrescarPata(menos, mapa([grupo()])).lado, 'menos');
  assert.strictEqual(U.refrescarPata(menos, mapa([grupo({ menos: null })])), null);
});

test('refrescarPata no rompe con datos corruptos de localStorage', () => {
  const m = mapa([grupo()]);
  [null, 5, 'x', {}, { gkey: 3 }, { gkey: '7|pts|', L: 'a' }, { gkey: '7|pts|', L: 10.5, lado: 'otro' }].forEach((l) => assert.strictEqual(U.refrescarPata(l, m), null));
});

test('recPaso devuelve la recomendada o, si falta, la de mejor color más alta', () => {
  assert.strictEqual(U.recPaso(grupo()).L, 10.5);
  assert.strictEqual(U.recPaso(grupo({ rec: 99 })).L, 10.5);
});

// ---------------------------------------------------------------- contexto (splits de la temporada)
// [valor, minutos, local, margen, b2b]
const TG = [
  [20, 34, 1, 5, 0], [12, 30, 0, -18, 1], [25, 36, 1, 16, 0], [8, 18, 0, -25, 0], [15, 33, 1, null, 0],
  [22, null, 0, 3, 1], [18, 32, 1, -7, 0],
];
test('splits: local/visitante, paliza (|margen| ≥ 15), parejo (≤ 8), back-to-back y minutos normales', () => {
  const s = U.splits(TG, 17.5), f = Object.fromEntries(s.filas.map((x) => [x.id, x]));
  assert.strictEqual(s.mediana, 32.5);
  assert.deepStrictEqual([f.todos.n, f.todos.k], [7, 4]);
  assert.ok(Math.abs(f.todos.prom - 120 / 7) < 1e-9);
  assert.deepStrictEqual([f.local.n, f.local.k, f.local.prom], [4, 3, 19.5]);
  assert.deepStrictEqual([f.visitante.n, f.visitante.k], [3, 1]);
  assert.deepStrictEqual([f.paliza.n, f.paliza.k], [3, 1]);             // 12, 25, 8 (el margen null no cuenta)
  assert.deepStrictEqual([f.parejo.n, f.parejo.k], [3, 3]);             // 20, 22, 18
  assert.deepStrictEqual([f.b2b.n, f.b2b.k], [2, 1]);
  assert.deepStrictEqual([f.minutos.n, f.minutos.k], [5, 3]);           // minutos ≥ 0,85 × 32,5 = 27,6: 34, 30, 36, 33, 32
  assert.strictEqual(f.minutos.sup, 3 / 5);
});
test('splits: sin datos no rompe', () => {
  const s = U.splits(undefined, 10.5);
  assert.strictEqual(s.mediana, null);
  assert.ok(s.filas.every((x) => x.n === 0 && x.prom === null && x.sup === null));
  assert.strictEqual(U.splits([null, 'x', [null, 30, 1, 2, 0], [5, 30, 1, 2, 0]], 4.5).filas[0].n, 1);
});
test('contextoHoy: local/visitante, back-to-back del equipo y paliza con p_blowout ≥ 0,45', () => {
  const p = { descanso: { AAA: { b2b: true }, BBB: { b2b: false } }, p_blowout: 0.47 };
  assert.deepStrictEqual(U.contextoHoy({ loc: true, eq: 'AAA' }, p), { local: true, b2b: true, paliza: true });
  assert.deepStrictEqual(U.contextoHoy({ loc: false, eq: 'BBB' }, Object.assign({}, p, { p_blowout: 0.44 })), { visitante: true });
  assert.deepStrictEqual(U.contextoHoy({ loc: false, eq: 'BBB' }, null), { visitante: true });
});

// ---------------------------------------------------------------- armá tu combinada
const Sug = require('../docs/sugeridas.js');
const fs = require('node:fs');
const path = require('node:path');
test('tipoMercado agrupa puntos, rebotes, asistencias, combos y otros', () => {
  assert.deepStrictEqual(['pts', 'reb', 'ast', 'pra', 'ra', 'fg3m', 'stl'].map((m) => U.tipoMercado({ m })), ['pts', 'reb', 'ast', 'combos', 'combos', 'otros', 'otros']);
  assert.strictEqual(U.tipoMercado({ m: 'pts', per: '1Q' }), 'otros');
});
test('armarCombinada (datos reales): cumple cuota objetivo, patas, colores, probabilidad, mercados y máximo por partido',
  { skip: process.env.SKIP_DATOS_REALES === '1' || !fs.existsSync(path.join(__dirname, '../docs/data/hoy.json')) }, () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/hoy.json'), 'utf8'));
  const grupos = d.grupos.filter((g) => g.pasos && g.pasos.length);
  const op = { T: 3, n: 3, pmin: 0.65, colores: ['verde', 'amarillo'], porJuego: 1, tipos: ['pts', 'reb', 'ast', 'combos', 'otros'], excluidos: {} };
  const r = U.armarCombinada(grupos, op, Sug);
  if (r.error) return;                                                // un día sin líneas suficientes: se prueba el caso imposible abajo
  assert.strictEqual(r.legs.length, 3);
  assert.ok(r.legs.reduce((a, l) => a * l.cu, 1) >= 3 - 1e-9);
  assert.ok(r.legs.every((l) => l.s.p >= 0.65 && ['verde', 'amarillo'].includes(l.s.c) && l.cu >= 1.1));
  assert.strictEqual(new Set(r.legs.map((l) => l.g.gid)).size, 3, 'una pata por partido');
  assert.strictEqual(new Set(r.legs.map((l) => l.g.id)).size, 3, 'jugadores distintos');
  // solo rebotes
  const reb = U.armarCombinada(grupos, Object.assign({}, op, { tipos: ['reb'], T: 2 }), Sug);
  if (!reb.error) assert.ok(reb.legs.every((l) => l.g.m === 'reb'));
  // «otra opción»: excluye los jugadores anteriores
  const excl = Object.fromEntries(r.legs.map((l) => [l.g.id, true]));
  const otra = U.armarCombinada(grupos, Object.assign({}, op, { excluidos: excl }), Sug);
  if (!otra.error) assert.ok(otra.legs.every((l) => !excl[l.g.id]));
});
test('armarCombinada: explica por qué no se puede (pocas líneas o cuota inalcanzable)', () => {
  const g = (id, gid, p, cu, c = 'verde') => ({ id, gid, j: 'J' + id, eq: 'A', riv: 'B', m: 'pts', mod: 'completo', est: null, pasos: [{ L: 10.5, p, cu, c }] });
  const grupos = [g(1, 'x', 0.8, 1.3), g(2, 'y', 0.75, 1.4), g(3, 'z', 0.5, 2.5)];
  const op = { T: 3, n: 3, pmin: 0.65, colores: ['verde'], porJuego: 1, tipos: ['pts'], excluidos: {} };
  const pocas = U.armarCombinada(grupos, op, Sug);
  assert.strictEqual(pocas.error, 'pocas'); assert.strictEqual(pocas.alcanza, 2);
  const cuota = U.armarCombinada(grupos, Object.assign({}, op, { n: 2 }), Sug);
  assert.strictEqual(cuota.error, 'cuota'); assert.ok(Math.abs(cuota.maxCuota - 1.82) < 1e-9);
  const ok = U.armarCombinada(grupos, Object.assign({}, op, { n: 2, T: 1.8 }), Sug);
  assert.deepStrictEqual(ok.legs.map((l) => l.g.id).sort(), [1, 2]);
  assert.strictEqual(U.armarCombinada(grupos, Object.assign({}, op, { n: 2, T: 1.8, porJuego: 1, excluidos: { 1: true } }), Sug).error, 'pocas');
});
