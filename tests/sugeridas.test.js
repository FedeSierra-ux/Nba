// Pruebas de las combinadas sugeridas. Ejecutar: node --test tests/sugeridas.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../docs/sugeridas.js');
const C = require('../docs/correlacion.js');

// grupos sintéticos: jugador i, partido i%6, varios mercados y líneas con probabilidad y cuota coherentes
function grupos() {
  const mercados = ['pts', 'reb', 'ast'];
  const out = [];
  for (let i = 1; i <= 40; i++) {
    const m = mercados[i % 3];
    const pasos = [];
    for (let k = 0; k < 6; k++) {
      const p = 0.9 - k * 0.1;                              // 0.9 ... 0.4
      pasos.push({ L: 2.5 + k, cu: +(1 / p * 1.06).toFixed(2), cb: null, p, c: p >= 0.6 ? 'verde' : 'amarillo', ju: +(1 / p).toFixed(2) });
    }
    out.push({ id: i, j: 'J' + i, eq: 'E' + i, riv: 'R' + i, gid: 'g' + (i % 6), m, mod: 'completo', est: null, pasos });
  }
  return out;
}

const mismaPata = (a, b) => a.g.id === b.g.id;

test('cada nivel cumple la cuota mínima y el número de patas', () => {
  const res = S.todas(grupos());
  assert.ok(res.length >= 4);
  res.forEach((c) => {
    const cuota = c.legs.reduce((a, l) => a * l.cu, 1);
    assert.ok(cuota >= c.T - 1e-9, `${c.nombre}: cuota ${cuota} < ${c.T}`);
    assert.strictEqual(c.legs.length, c.n);
  });
});

test('un jugador por pata y respeta el máximo por partido', () => {
  S.todas(grupos()).forEach((c) => {
    const nivel = S.NIVELES.find((x) => x.id === c.id);
    const ids = c.legs.map((l) => l.g.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    const porJuego = {};
    c.legs.forEach((l) => { porJuego[l.g.gid] = (porJuego[l.g.gid] || 0) + 1; });
    Object.values(porJuego).forEach((n) => assert.ok(n <= nivel.porJuego));
  });
});

test('la Segura solo usa verdes con probabilidad alta; la Soñadora es la menos probable', () => {
  const res = S.todas(grupos());
  const prob = (c) => C.conjunta(c.legs.map((l) => ({ id: l.g.id, eq: l.g.eq, gid: l.g.gid, m: l.g.m, lado: 'mas', p: l.s.p }))).conj;
  const segura = res.filter((c) => c.id === 'segura'), inter = res.filter((c) => c.id === 'intermedia'), sueno = res.filter((c) => c.id === 'sonadora');
  segura.forEach((c) => c.legs.forEach((l) => { assert.strictEqual(l.s.c, 'verde'); assert.ok(l.s.p >= 0.72); }));
  assert.ok(Math.max(...segura.map(prob)) > Math.max(...inter.map(prob)));
  assert.ok(Math.max(...inter.map(prob)) > Math.max(...sueno.map(prob)));
});

test('las dos variantes del mismo nivel no repiten jugadores', () => {
  const res = S.todas(grupos()).filter((c) => c.id === 'segura');
  assert.strictEqual(res.length, 2);
  const a = new Set(res[0].legs.map((l) => l.g.id));
  res[1].legs.forEach((l) => assert.ok(!a.has(l.g.id)));
});

test('descarta dudosos, modelo básico y líneas sin cuota', () => {
  const g = grupos();
  g[0].est = 'Out'; g[1].mod = 'basico';
  g[2].pasos.forEach((s) => { s.cu = null; });
  const pool = S.candidatas(g, S.NIVELES[1], {});
  [1, 2, 3].forEach((id) => assert.ok(!pool.some((x) => x.g.id === id), `no debería incluir al jugador ${id}`));
});

test('ninguna pata es de relleno: cada una cumple la cuota mínima de su nivel', () => {
  S.todas(grupos()).forEach((c) => {
    const nivel = S.NIVELES.find((x) => x.id === c.id);
    c.legs.forEach((l) => assert.ok(l.cu >= nivel.cmin, `${c.nombre}: pata @${l.cu} < ${nivel.cmin}`));
  });
});

test('devuelve vacío si no se puede alcanzar la cuota', () => {
  const g = grupos().slice(0, 3);
  assert.strictEqual(S.todas(g).filter((c) => c.id === 'sonadora').length, 0);
});

test('es determinista', () => {
  const a = JSON.stringify(S.todas(grupos()).map((c) => c.legs.map((l) => [l.g.id, l.s.L])));
  const b = JSON.stringify(S.todas(grupos()).map((c) => c.legs.map((l) => [l.g.id, l.s.L])));
  assert.strictEqual(a, b);
});

test('con los datos reales (si existen) toda combinada armada cumple su cuota mínima', { skip: process.env.SKIP_DATOS_REALES === '1' || !fs.existsSync(path.join(__dirname, '../docs/data/hoy.json')) }, () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/hoy.json'), 'utf8'));
  const res = S.todas(d.grupos);
  res.forEach((c) => assert.ok(c.legs.reduce((a, l) => a * l.cu, 1) >= c.T));
});
