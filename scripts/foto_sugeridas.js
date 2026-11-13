#!/usr/bin/env node
/* Guarda en la foto del día (docs/data/historial/<fecha>.json) las combinadas sugeridas pre-partido,
   para poder medir después cuántas se ganaron (scripts/resultados.py).

   Usa el mismo optimizador que la página (docs/sugeridas.js) y la misma probabilidad conjunta
   con correlación (docs/correlacion.js, Correlacion.conjunta). Solo considera partidos que no empezaron
   (estado 1). La primera foto pre-partido gana: si el día ya tiene «sugeridas», no se toca.
   Si hoy no se puede armar ninguna combinada, no se escribe nada (una corrida posterior puede intentarlo).

   Uso: node scripts/foto_sugeridas.js [--datos docs/data]
   Node >= 18, sin dependencias. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const Sugeridas = require(path.join(RAIZ, 'docs', 'sugeridas.js'));
const Correlacion = require(path.join(RAIZ, 'docs', 'correlacion.js'));

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const r = (x, d) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/* hoy: contenido de hoy.json. Devuelve la lista de combinadas en el formato del historial. */
function fotoSugeridas(hoy) {
  const noEmpezados = new Set((hoy.partidos || []).filter((p) => p.estado === 1).map((p) => p.gid));
  const grupos = (hoy.grupos || []).filter((g) => noEmpezados.has(g.gid));
  if (!grupos.length) return [];
  return Sugeridas.todas(grupos).map((c) => {
    const patas = c.legs.map((l) => ({ id: l.g.id, eq: l.g.eq, gid: l.g.gid, m: l.g.m, lado: 'mas', p: l.s.p }));
    const cj = Correlacion.conjunta(patas);
    const cuota = c.legs.reduce((a, l) => a * l.cu, 1);
    return {
      id: c.id, nombre: c.nombre, n: c.n, T: c.T, cuota: r(cuota, 3), p: r(cj.conj, 4),
      legs: c.legs.map((l) => ({ id: l.g.id, gid: l.g.gid, m: l.g.m, per: l.g.per == null ? null : l.g.per, L: l.s.L, cu: l.cu, p: l.s.p })),
    };
  });
}

function main() {
  const datos = path.resolve(argumento('--datos', path.join(RAIZ, 'docs', 'data')));
  const hoy = JSON.parse(fs.readFileSync(path.join(datos, 'hoy.json'), 'utf8'));
  const ruta = path.join(datos, 'historial', hoy.fecha + '.json');
  let foto = { fecha: hoy.fecha, lineas: [], escalera: [] };
  if (fs.existsSync(ruta)) foto = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (Object.prototype.hasOwnProperty.call(foto, 'sugeridas')) {
    console.log(`${hoy.fecha}: las sugeridas ya estaban guardadas (${foto.sugeridas.length}); no se tocan.`);
    return;
  }
  const sug = fotoSugeridas(hoy);
  if (!sug.length) {
    console.log(`${hoy.fecha}: no hay combinadas sugeridas con partidos sin empezar; no se escribe nada.`);
    return;
  }
  foto.sugeridas = sug;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(foto));
  console.log(`${hoy.fecha}: ${sug.length} combinadas sugeridas guardadas en ${path.relative(process.cwd(), ruta) || ruta}.`);
  sug.forEach((c) => console.log(`  ${c.nombre} ${c.n} patas: cuota ${c.cuota}, p ${c.p}`));
}

if (require.main === module) main();
module.exports = { fotoSugeridas };
