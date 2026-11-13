// Pruebas de la correlación. Ejecutar: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../docs/correlacion.js');

const pata = (o) => Object.assign({ id: 1, eq: 'A', gid: 'g1', m: 'pts', lado: 'mas', p: 0.6 }, o);

test('patas de partidos distintos son independientes', () => {
  const r = C.conjunta([pata(), pata({ id: 2, gid: 'g2', m: 'reb' })]);
  assert.ok(Math.abs(r.conj - 0.36) < 1e-9);
  assert.strictEqual(r.correlacionadas, 0);
});

test('mismo jugador, estadísticas que se solapan: sube la probabilidad conjunta', () => {
  const r = C.conjunta([pata(), pata({ m: 'pra' })]);
  assert.ok(r.conj > r.indep + 0.05, `conj=${r.conj} indep=${r.indep}`);
});

test('mismo jugador, lados opuestos: baja la probabilidad conjunta', () => {
  const r = C.conjunta([pata({ m: 'pts', lado: 'mas', p: 0.6 }), pata({ m: 'pra', lado: 'menos', p: 0.4 })]);
  assert.ok(r.conj < r.indep, `conj=${r.conj} indep=${r.indep}`);
});

test('la probabilidad conjunta no supera a la de la pata más débil', () => {
  const r = C.conjunta([pata({ p: 0.7 }), pata({ m: 'pra', p: 0.55 }), pata({ id: 3, gid: 'g3', p: 0.65 })]);
  assert.ok(r.conj <= 0.55 + 0.01);
});

test('es determinista (semilla fija)', () => {
  const a = C.conjunta([pata(), pata({ m: 'pra' })]).conj;
  const b = C.conjunta([pata(), pata({ m: 'pra' })]).conj;
  assert.strictEqual(a, b);
});

test('una sola pata devuelve su probabilidad', () => {
  assert.strictEqual(C.conjunta([pata({ p: 0.7 })]).conj, 0.7);
});

test('inversa de la normal', () => {
  assert.ok(Math.abs(C.normInv(0.975) - 1.959964) < 1e-4);
  assert.ok(Math.abs(C.normInv(0.5)) < 1e-9);
});
