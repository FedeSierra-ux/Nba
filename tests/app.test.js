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
