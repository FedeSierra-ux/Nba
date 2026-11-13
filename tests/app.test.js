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

// ---------------------------------------------------------------- cuota mínima 1,30 (hoy.json generado antes del filtro del script)
test('filtrarCuotaMin saca las líneas que pagan menos de 1,30, descarta grupos vacíos y recalcula la recomendada', () => {
  assert.strictEqual(U.CUOTA_MIN, 1.3);
  const paso = (L, cu, p, c) => ({ L, cu, p, c, r10: 0.5, rt: 0.5, fl: [] });
  const original = [
    // la verde más alta (7,5 @1,20) se va: la recomendada pasa a la verde que queda (8,5 @1,30, el borde se queda)
    grupo({ id: 1, rec: 9.5, pasos: [paso(6.5, 1.12, 0.9, 'verde'), paso(9.5, 1.25, 0.82, 'verde'), paso(8.5, 1.3, 0.78, 'verde'), paso(10.5, 1.6, 0.6, 'amarillo')] }),
    // sin verdes con cuota: la amarilla más alta
    grupo({ id: 2, rec: 4.5, pasos: [paso(4.5, 1.2, 0.85, 'verde'), paso(5.5, 1.4, 0.7, 'amarillo'), paso(6.5, 1.7, 0.62, 'amarillo'), paso(7.5, 2.1, 0.5, 'rojo')] }),
    // sin verdes ni amarillas: la de mayor probabilidad
    grupo({ id: 3, rec: 1.5, pasos: [paso(1.5, 1.1, 0.9, 'verde'), paso(2.5, 1.9, 0.48, 'rojo'), paso(3.5, 2.6, 0.35, 'rojo')] }),
    // todas por debajo de 1,30: el grupo desaparece
    grupo({ id: 4, pasos: [paso(0.5, 1.05, 0.95, 'verde'), paso(1.5, 1.29, 0.8, 'verde')] }),
    // nada que sacar: el mismo objeto, sin tocar
    grupo({ id: 5 }),
    // el «menos» con cuota baja también se va
    grupo({ id: 6, menos: { L: 12.5, cu: 1.18, p: 0.85, c: 'verde' } }),
  ];
  const copia = JSON.stringify(original);
  const r = U.filtrarCuotaMin(original);
  assert.strictEqual(JSON.stringify(original), copia, 'no modifica los datos de entrada');
  assert.deepStrictEqual(r.map((g) => g.id), [1, 2, 3, 5, 6]);
  const por = Object.fromEntries(r.map((g) => [g.id, g]));
  r.forEach((g) => g.pasos.forEach((s) => assert.ok(s.cu >= 1.3, `grupo ${g.id}: línea ${s.L} @${s.cu}`)));
  assert.deepStrictEqual(por[1].pasos.map((s) => s.L), [8.5, 10.5]);
  assert.strictEqual(por[1].rec, 8.5);
  assert.strictEqual(por[2].rec, 6.5);
  assert.strictEqual(por[3].rec, 2.5);
  assert.strictEqual(por[5], original[4]);
  assert.strictEqual(por[6].menos, null);
  assert.strictEqual(U.recPaso(por[1]).L, 8.5, 'recPaso usa la recomendada recalculada');
  // otra cuota mínima, entradas raras y líneas sin cuota (se dejan: no pagan menos, no tienen cuota publicada)
  assert.deepStrictEqual(U.filtrarCuotaMin([original[0]], 1.5)[0].pasos.map((s) => s.L), [10.5]);
  assert.deepStrictEqual(U.filtrarCuotaMin(null), []);
  assert.deepStrictEqual(U.filtrarCuotaMin([null, 3, { pasos: 'x' }, { pasos: [] }]), []);
  assert.strictEqual(U.filtrarCuotaMin([grupo({ pasos: [paso(3.5, null, 0.7, 'verde')] })])[0].pasos.length, 1);
});
test('recLinea: verde más alta, si no amarilla más alta, si no la de mayor probabilidad', () => {
  assert.strictEqual(U.recLinea([]), null);
  assert.strictEqual(U.recLinea([{ L: 1, c: 'verde', p: 0.9 }, { L: 3, c: 'verde', p: 0.7 }, { L: 5, c: 'amarillo', p: 0.6 }]), 3);
  assert.strictEqual(U.recLinea([{ L: 1, c: 'rojo', p: 0.9 }, { L: 3, c: 'amarillo', p: 0.7 }, { L: 5, c: 'amarillo', p: 0.6 }]), 5);
  assert.strictEqual(U.recLinea([{ L: 1, c: 'rojo', p: 0.4 }, { L: 3, c: 'rojo', p: 0.45 }, { L: 5, c: 'rojo', p: 0.45 }]), 3);
});
test('iniciales para la foto de reemplazo', () => {
  assert.strictEqual(U.iniciales('Shai Gilgeous-Alexander'), 'SG');
  assert.strictEqual(U.iniciales('Jaren Jackson Jr.'), 'JJ');
  assert.strictEqual(U.iniciales('Nikola Jokić'), 'NJ');
  assert.strictEqual(U.iniciales('Nenê'), 'N');
  assert.strictEqual(U.iniciales(''), '?');
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
  const grupos = U.filtrarCuotaMin(d.grupos.filter((g) => g.pasos && g.pasos.length));
  const op = { T: 3, n: 3, pmin: 0.65, colores: ['verde', 'amarillo'], porJuego: 1, tipos: ['pts', 'reb', 'ast', 'combos', 'otros'], excluidos: {} };
  const r = U.armarCombinada(grupos, op, Sug);
  if (r.error) return;                                                // un día sin líneas suficientes: se prueba el caso imposible abajo
  assert.strictEqual(r.legs.length, 3);
  assert.ok(r.legs.reduce((a, l) => a * l.cu, 1) >= 3 - 1e-9);
  assert.ok(r.legs.every((l) => l.s.p >= 0.65 && ['verde', 'amarillo'].includes(l.s.c) && l.cu >= 1.3));
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
test('armarCombinada: ninguna pata paga menos de 1,30 aunque los datos la traigan', () => {
  const g = (id, gid, p, cu) => ({ id, gid, j: 'J' + id, eq: 'A', riv: 'B', m: 'pts', mod: 'completo', est: null, pasos: [{ L: 10.5, p, cu, c: 'verde' }] });
  const grupos = [g(1, 'x', 0.9, 1.29), g(2, 'y', 0.88, 1.2), g(3, 'z', 0.7, 1.45), g(4, 'w', 0.68, 1.5), g(5, 'v', 0.66, 1.6)];
  const op = { T: 2, n: 2, pmin: 0.65, colores: ['verde'], porJuego: 1, tipos: ['pts'], excluidos: {} };
  const r = U.armarCombinada(grupos, op, Sug);
  assert.ok(!r.error, JSON.stringify(r.error));
  assert.ok(r.legs.every((l) => l.cu >= 1.3), r.legs.map((l) => l.cu).join(', '));
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
