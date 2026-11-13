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

test('ninguna pata es de relleno: cada una cumple la cuota mínima de su nivel (1,30 en los tres)', () => {
  S.NIVELES.forEach((n) => assert.strictEqual(n.cmin, 1.3, n.id));
  S.todas(grupos()).forEach((c) => {
    const nivel = S.NIVELES.find((x) => x.id === c.id);
    c.legs.forEach((l) => assert.ok(l.cu >= nivel.cmin, `${c.nombre}: pata @${l.cu} < ${nivel.cmin}`));
  });
});

test('con patas de 1,30 o más la Segura llega a 1,99 con 3 patas', () => {
  // la línea de p 0,9 paga 1,18 (no entra); la de p 0,8 paga 1,33: 1,33³ = 2,35 ≥ 1,99
  const segura = S.todas(grupos()).filter((c) => c.id === 'segura');
  assert.ok(segura.some((c) => c.n === 3));
  segura.forEach((c) => c.legs.forEach((l) => assert.ok(l.cu >= 1.3)));
});

test('con pocas candidatas encuentra la combinada que la voraz no ve (reglas por partido y por mercado)', () => {
  // como el 13/11 con cuota mínima 1,30: las de cuota más alta comparten partido o mercado; la única Segura válida mezcla mercados
  const g = (id, gid, m, cu, p) => ({ id, j: 'J' + id, eq: 'E', riv: 'R', gid, m, mod: 'completo', est: null, pasos: [{ L: 9.5, cu, p, c: 'verde' }] });
  const gs = [g(1, 'a', 'pts', 1.40, 0.725), g(2, 'b', 'pts', 1.39, 0.737), g(3, 'c', 'pts', 1.39, 0.727), g(4, 'b', 'pts', 1.36, 0.727),
    g(5, 'a', 'ast', 1.32, 0.726), g(6, 'd', 'pts', 1.31, 0.746)];
  const segura = S.todas(gs).filter((c) => c.id === 'segura');
  assert.strictEqual(segura.length, 1, 'una Segura de 3 patas (no alcanzan para 4)');
  const c = segura[0], cuota = c.legs.reduce((a, l) => a * l.cu, 1);
  assert.ok(cuota >= 1.99, 'cuota ' + cuota);
  assert.strictEqual(new Set(c.legs.map((l) => l.g.gid)).size, 3, 'una por partido');
  assert.ok(c.legs.filter((l) => l.g.m === 'pts').length <= 2, 'máximo 2 por mercado');
  // es la de mayor probabilidad entre todas las válidas (fuerza bruta)
  const nivel = S.NIVELES[0], pool = S.candidatas(gs, nivel, {});
  let mejor = -Infinity;
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let d = b + 1; d < pool.length; d++) {
    const t = [pool[a], pool[b], pool[d]];
    if (new Set(t.map((x) => x.g.gid)).size < 3 || t.filter((x) => x.g.m === 'pts').length > 2) continue;
    if (t.reduce((s, x) => s * x.cu, 1) < 1.99) continue;
    mejor = Math.max(mejor, t.reduce((s, x) => s * x.s.p, 1));
  }
  assert.ok(Math.abs(c.legs.reduce((s, l) => s * l.s.p, 1) - mejor) < 1e-12);
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
  res.forEach((c) => c.legs.forEach((l) => assert.ok(l.cu >= 1.3, `${c.nombre}: @${l.cu}`)));
});
