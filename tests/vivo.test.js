// Pruebas de las funciones puras del panel «En vivo» (docs/vivo.js). Ejecutar: node --test tests/vivo.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../docs/vivo.js');

const ESPN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/espn-summary-vivo.json'), 'utf8'));

test('normaliza nombres: tildes, puntuación, sufijos y mayúsculas', () => {
  assert.strictEqual(V.normNombre('Nikola Jokić'), 'nikola jokic');
  assert.strictEqual(V.normNombre('Walter Clayton Jr.'), 'walter clayton');
  assert.strictEqual(V.normNombre('P.J. Washington'), 'pj washington');
  assert.strictEqual(V.normNombre('PJ Washington'), 'pj washington');
  assert.strictEqual(V.normNombre('Jaren Jackson Jr'), 'jaren jackson');
  assert.strictEqual(V.normNombre('Gary Trent Jr. II'), 'gary trent');
  assert.strictEqual(V.normNombre("De'Aaron Fox"), 'deaaron fox');
  assert.strictEqual(V.normNombre('Shai Gilgeous-Alexander'), 'shai gilgeous alexander');
  assert.strictEqual(V.normNombre('KELLY OUBRE JR.'), 'kelly oubre');
});

test('lee el resumen de ESPN: estado, marcador, reloj y estadísticas por jugador', () => {
  const r = V.leerResumen(ESPN);
  assert.strictEqual(r.estado, 'in'); assert.strictEqual(r.periodo, 3); assert.strictEqual(r.reloj, '5:32');
  assert.deepStrictEqual([r.local.abrev, r.local.pts, r.visita.abrev, r.visita.pts], ['MIN', 88, 'DAL', 71]);
  assert.strictEqual(V.reloj(r), '3er cuarto · 5:32');
  const j = r.jugadores.find((x) => x.nombre === 'Bones Hyland');
  assert.deepStrictEqual([j.lado, j.st.min, j.st.pts, j.st.reb, j.st.ast, j.st.fg3m, j.st.pf], ['home', 23, 24, 3, 8, 5, 1]);
  assert.strictEqual(V.leerResumen({}).jugadores.length, 0);                      // respuesta vacía no rompe
});

test('empareja por nombre normalizado y equipo; si no hay, apellido + inicial; si no, null', () => {
  const r = V.leerResumen(ESPN), p = { local: 'MIN', visita: 'DAL' };
  assert.strictEqual(V.emparejar({ j: 'Walter Clayton', eq: 'DAL' }, r, p).nombre, 'Walter Clayton Jr.');
  assert.strictEqual(V.emparejar({ j: 'PJ Washington', eq: 'DAL' }, r, p).nombre, 'P.J. Washington');
  assert.strictEqual(V.emparejar({ j: 'Bones Hyland', eq: 'XXX' }, r, p).nombre, 'Bones Hyland');   // equipo desconocido: busca en los dos
  assert.strictEqual(V.emparejar({ j: 'J. McDaniels', eq: 'MIN' }, r, p).nombre, 'Jaden McDaniels');
  assert.strictEqual(V.emparejar({ j: 'Jaden McDaniels', eq: 'DAL' }, r, p), null);         // otro equipo
  assert.strictEqual(V.emparejar({ j: 'Nadie Conocido', eq: 'MIN' }, r, p), null);
});

test('avance: lleva / le faltan, ✓ al pasar la línea, ✗ al final sin pasarla, anulada si no jugó', () => {
  const jug = { dnp: false, st: { min: 21, pts: 7, reb: 2, ast: 5, pf: 3 } };
  assert.deepStrictEqual(V.avance({ m: 'pts', L: 10.5 }, jug, false), { v: 7, r: null, faltan: 4, sobran: null });
  assert.strictEqual(V.avance({ m: 'pts', L: 6.5 }, jug, false).r, 'ganada');
  assert.strictEqual(V.avance({ m: 'pts', L: 10.5 }, jug, true).r, 'perdida');
  assert.strictEqual(V.avance({ m: 'pra', L: 13.5 }, jug, false).r, 'ganada');                // 7 + 2 + 5
  assert.strictEqual(V.avance({ m: 'pts', L: 10.5, lado: 'menos' }, jug, false).sobran, 3);
  assert.strictEqual(V.avance({ m: 'pts', L: 6.5, lado: 'menos' }, jug, false).r, 'perdida');
  assert.strictEqual(V.avance({ m: 'pts', L: 10.5 }, { dnp: true, st: {} }, true).r, 'anulada');
  assert.strictEqual(V.avance({ m: 'tov', L: 1.5 }, jug, false).sinMercado, true);
});
