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

// ---------------------------------------------------------------- v0.5: normal bivariada exacta y bloques por partido
test('phi y bvnu coinciden con valores conocidos', () => {
  assert.ok(Math.abs(C.phi(1.959964) - 0.975) < 1e-6);
  assert.ok(Math.abs(C.bvnu(0, 0, 0) - 0.25) < 1e-7);
  assert.ok(Math.abs(C.bvnu(0, 0, 0.5) - (0.25 + Math.asin(0.5) / (2 * Math.PI))) < 1e-7);   // fórmula cerrada en el origen
  assert.ok(Math.abs(C.bvnu(0, 0, -0.9) - (0.25 + Math.asin(-0.9) / (2 * Math.PI))) < 1e-7);
  assert.ok(Math.abs(C.bvnu(-1, 0.5, 0.95) - (1 - C.phi(0.5))) < 0.01);                       // casi perfectamente correlacionadas
});

test('bvnu contra integración numérica', () => {
  const dens = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const integ = (h, k, r) => {               // P(X>h, Y>k) = ∫_h^∞ φ(x) · P(Y>k | x) dx
    let s = 0; const dx = 0.001;
    for (let x = h; x < 9; x += dx) s += dens(x + dx / 2) * (1 - C.phi((k - r * (x + dx / 2)) / Math.sqrt(1 - r * r))) * dx;
    return s;
  };
  [[-0.5, 0.3, 0.06], [0.2, -0.8, 0.55], [-1.2, -0.4, 0.75], [0.5, 0.5, -0.25], [-0.3, 0.1, 0.96]].forEach(([h, k, r]) => {
    assert.ok(Math.abs(C.bvnu(h, k, r) - integ(h, k, r)) < 1e-5, `${h},${k},${r}`);
  });
});

test('dos patas correlacionadas: el cálculo exacto coincide con Monte Carlo de 1 millón', () => {
  let seed = 987654321;                       // mulberry32, independiente del generador interno
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (((t ^ t >>> 14) >>> 0) + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  [[pata({ p: 0.7 }), pata({ id: 2, m: 'reb', p: 0.6 })], [pata({ p: 0.72 }), pata({ m: 'pra', p: 0.58 })]].forEach((p) => {
    const r = C.rho(p[0], p[1]), t = p.map((x) => C.normInv(x.p));
    let ok = 0; const N = 1000000;
    for (let s = 0; s < N; s++) { const a = gauss(), b = r * a + Math.sqrt(1 - r * r) * gauss(); if (a < t[0] && b < t[1]) ok++; }
    const res = C.conjunta(p);
    assert.strictEqual(res.correlacionadas, 1);
    assert.ok(Math.abs(res.conj - ok / N) < 0.002, `exacta=${res.conj} mc=${ok / N}`);
  });
});

test('tres patas del mismo jugador se simulan y quedan entre la independiente y la más débil', () => {
  const p = [pata({ p: 0.7 }), pata({ m: 'pra', p: 0.65 }), pata({ m: 'pr', p: 0.6 })];
  const r = C.conjunta(p);
  assert.strictEqual(r.correlacionadas, 3);
  assert.ok(r.conj > r.indep && r.conj <= 0.6 + 0.01, `conj=${r.conj}`);
});
