// Pruebas de la calificación de patas, combinadas y apuestas propias (docs/calificar.js). Ejecutar: node --test tests/calificar.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../docs/calificar.js');

const RES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/resultados/2026-11-12.json'), 'utf8'));
const APUESTAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apuestas.json'), 'utf8'));
const pata = (o) => Object.assign({ id: 9001, gid: '0022699001', m: 'pts', per: null, L: 18.5, lado: 'mas' }, o);

test('pata «más de»: gana si supera la línea, pierde si no; combos suman', () => {
  assert.deepStrictEqual(C.calificarPata(pata(), RES), { r: 'ganada', v: 24, min: 34 });
  assert.strictEqual(C.calificarPata(pata({ L: 24.5 }), RES).r, 'perdida');
  assert.strictEqual(C.calificarPata(pata({ id: 9004, gid: '0022699002', m: 'pra', L: 32.5 }), RES).v, 33);
  assert.strictEqual(C.calificarPata(pata({ id: 9004, gid: '0022699002', m: 'pra', L: 32.5 }), RES).r, 'ganada');
  assert.strictEqual(C.calificarPata(pata({ id: 9004, gid: '0022699002', m: 'ra', L: 13.5 }), RES).r, 'perdida');   // 8 + 5
});

test('pata: empate con línea entera, 0 minutos o fuera del box score → anulada', () => {
  assert.strictEqual(C.calificarPata(pata({ L: 24 }), RES).r, 'anulada');
  assert.strictEqual(C.calificarPata(pata({ id: 9003, m: 'ast', L: 4.5 }), RES).r, 'anulada');
  assert.strictEqual(C.calificarPata(pata({ id: 12345 }), RES).r, 'anulada');                 // partido terminado con box, no figura
});

test('pata: partido sin terminar, sin archivo, período o mercado desconocido → pendiente (null)', () => {
  assert.strictEqual(C.calificarPata(pata({ id: 9006, gid: '0022699003' }), RES).r, null);
  assert.strictEqual(C.calificarPata(pata(), null).r, null);
  assert.strictEqual(C.calificarPata(pata({ per: '1Q' }), RES).r, null);
  assert.strictEqual(C.calificarPata(pata({ gid: 'otro' }), RES).r, null);
  assert.strictEqual(C.calificarPata(pata({ m: 'raro' }), RES).r, null);
});

test('pata «menos de»: gana si queda abajo', () => {
  assert.strictEqual(C.calificarPata(pata({ lado: 'menos', L: 25.5 }), RES).r, 'ganada');
  assert.strictEqual(C.calificarPata(pata({ lado: 'menos', L: 20.5 }), RES).r, 'perdida');
});

test('combinada: una perdida la pierde, anuladas a 1,00, todas anuladas se devuelve, pendientes esperan', () => {
  assert.deepStrictEqual(C.calificarCombinada(['ganada', 'perdida', null], [2, 2, 2]), { estado: 'perdida', pago: 0 });
  assert.deepStrictEqual(C.calificarCombinada(['ganada', null], [2, 2]), { estado: null, pago: null });
  assert.deepStrictEqual(C.calificarCombinada(['anulada', 'anulada'], [2, 2]), { estado: 'anulada', pago: 1 });
  const g = C.calificarCombinada(['ganada', 'anulada', 'ganada'], [1.5, 3, 2]);
  assert.strictEqual(g.estado, 'ganada'); assert.ok(Math.abs(g.pago - 3) < 1e-9);
});

test('apuestas importadas: valida, descarta inválidas y califica ganada / perdida / anulada / pendiente', () => {
  const { apuestas, descartadas } = C.leerApuestas(APUESTAS);
  assert.strictEqual(apuestas.length, 5); assert.strictEqual(descartadas, 1);
  const por = Object.fromEntries(apuestas.map((a) => [a.id, C.calificarApuesta(a, RES)]));
  assert.strictEqual(por['fx-ganada'].estado, 'ganada'); assert.strictEqual(por['fx-ganada'].cobro, 2100);
  assert.strictEqual(por['fx-perdida'].estado, 'perdida'); assert.strictEqual(por['fx-perdida'].cobro, 0);
  assert.strictEqual(por['fx-anulada'].estado, 'anulada'); assert.strictEqual(por['fx-anulada'].cobro, 200);
  assert.strictEqual(por['fx-pendiente'].estado, null); assert.strictEqual(por['fx-pendiente'].cobro, null);
  // ganada con una pata anulada: la cuota real se divide por la cuota de la anulada (2,80 / 1,75 = 1,60)
  assert.strictEqual(por['fx-con-anulada'].estado, 'ganada'); assert.ok(Math.abs(por['fx-con-anulada'].cobro - 160) < 1e-9);
  // sin archivo de resultados: todo pendiente
  assert.strictEqual(C.calificarApuesta(apuestas[0], null).estado, null);
});

test('apuesta marcada a mano gana sobre el resultado calculado', () => {
  const a = C.validarApuesta(Object.assign({}, APUESTAS.apuestas[3], { manual: 'ganada' }));
  const c = C.calificarApuesta(a, RES);
  assert.strictEqual(c.estado, 'ganada'); assert.strictEqual(c.manual, true); assert.strictEqual(c.auto, null); assert.strictEqual(c.cobro, 750);
  const p = C.calificarApuesta(C.validarApuesta(Object.assign({}, APUESTAS.apuestas[0], { manual: 'perdida' })), RES);
  assert.strictEqual(p.estado, 'perdida'); assert.strictEqual(p.cobro, 0);
  assert.strictEqual(C.validarApuesta(Object.assign({}, APUESTAS.apuestas[0], { manual: 'cualquiera' })).manual, null);
});

test('resumen: apostado, cobrado, neto, ROI (sin anuladas ni pendientes), aciertos y por casa', () => {
  const items = C.leerApuestas(APUESTAS).apuestas.map((a) => ({ a, c: C.calificarApuesta(a, RES) }));
  const r = C.resumenApuestas(items);
  assert.strictEqual(r.total.apostado, 2100);
  assert.strictEqual(r.total.pendiente, 300);
  assert.strictEqual(r.total.cobrado, 2460);
  assert.strictEqual(r.total.neto, 660);              // 2460 − 1800 resueltas
  assert.ok(Math.abs(r.total.roi - 660 / 1600) < 1e-9);
  assert.strictEqual(r.total.ganadas, 2); assert.strictEqual(r.total.perdidas, 1); assert.strictEqual(r.total.anuladas, 1);
  assert.ok(Math.abs(r.total.aciertos - 2 / 3) < 1e-9);
  assert.strictEqual(r.casas.Stake.neto, -440);      // 160 − 600
  assert.strictEqual(r.casas.Betano.neto, 1100);
  assert.strictEqual(r.casas.Otra.roi, null);
});

test('validación: datos corruptos de localStorage no pasan', () => {
  [null, 3, 'x', {}, { fecha: '2026-11-12', monto: 10, cuota: 2, legs: [] }, { fecha: '2026-11-12', monto: -1, cuota: 2, legs: [{ id: 1, m: 'pts', L: 3.5 }] },
    { fecha: '2026-11-12', monto: 10, cuota: 1, legs: [{ id: 1, m: 'pts', L: 3.5 }] }, { fecha: '2026-11-12', monto: 10, cuota: 2, legs: [{ id: 'x', m: 'pts', L: 3.5 }] },
    { fecha: '2026-11-12', monto: 10, cuota: 2, legs: [{ id: 1, m: '<b>', L: 3.5 }] }, { fecha: '2026-11-12', monto: 10, cuota: 2, legs: [{ id: 1, m: 'pts', L: null }] }]
    .forEach((a) => assert.strictEqual(C.validarApuesta(a), null, JSON.stringify(a)));
  const ok = C.validarApuesta({ fecha: '2026-11-12', monto: 10, cuota: 1.85, casa: 'Bet365', legs: [{ id: '5', m: 'pts', L: '3.5' }] });
  assert.strictEqual(ok.casa, 'Otra'); assert.strictEqual(ok.legs[0].id, 5); assert.strictEqual(ok.legs[0].L, 3.5); assert.strictEqual(ok.legs[0].lado, 'mas');
  assert.deepStrictEqual(C.leerApuestas('no es una lista'), { apuestas: [], descartadas: 0 });
  const dup = C.leerApuestas([APUESTAS.apuestas[0], APUESTAS.apuestas[0]]);
  assert.strictEqual(dup.apuestas.length, 1); assert.strictEqual(dup.descartadas, 1);
});
