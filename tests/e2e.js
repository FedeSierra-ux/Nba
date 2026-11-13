// Pruebas de punta a punta de la interfaz (Playwright + Chromium), en celular (390×844) y escritorio (1360×900).
// Uso:
//   python3 -m http.server 8776 -d docs &          (en otra terminal)
//   PORT=8776 NODE_PATH=$(npm root -g) node tests/e2e.js
// Opcional: SHOTS=/ruta/a/carpeta guarda una captura de cada sección (celular y escritorio).
// No baja nada de internet: las variantes de datos (partidos empezados, datos regenerados, XSS) se sirven con page.route.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BASE = `http://localhost:${process.env.PORT || 8776}/`;
const SHOTS = process.env.SHOTS || '';
const DATOS = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/hoy.json'), 'utf8'));
const CL_TICKET = 'nba_semaforo_ticket_v2', CL_GUARDADAS = 'nba_semaforo_guardadas_v2';
const GRUPOS = DATOS.grupos.filter((g) => g.pasos && g.pasos.length && !['oreb', 'dreb'].includes(g.m));
const clon = () => JSON.parse(JSON.stringify(DATOS));
const gkey = (g) => g.id + '|' + g.m + '|' + (g.per || '');

let ok = 0; const fallas = [];
async function paso(nombre, fn) {
  try { await fn(); ok++; console.log('ok    ' + nombre); }
  catch (e) { fallas.push(nombre + ': ' + e.message.split('\n')[0]); console.log('FALLA ' + nombre + '\n      ' + e.message.split('\n')[0]); }
}
// cantidad esperada de jugadores con probabilidad mínima numérica (la misma regla que elegirPaso)
const esperados = (minP, colores = ['verde', 'amarillo'], filtro = () => true) =>
  GRUPOS.filter(filtro).filter((g) => g.pasos.some((s) => colores.includes(s.c) && s.p >= minP)).length;

async function nuevaPagina(ctx, errores, etiqueta) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(etiqueta + ' pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errores.push(etiqueta + ' console: ' + m.text()); });
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Prueba <b>e2e</b>' : undefined));
  return p;
}
// Carga nueva de la página (un goto que solo cambia el hash no recarga: se pasa por about:blank).
const ir = async (p, hash = '') => {
  await p.goto('about:blank'); await p.goto(BASE + hash, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !/Cargando/.test(document.querySelector('#info-actualizado').textContent));
};
const abrirMasFiltros = (p) => p.evaluate(() => { document.querySelector('#mas-filtros').open = true; });
const esperar = (p, ms = 120) => p.waitForTimeout(ms);
const st = (p) => p.evaluate(() => ({
  hash: location.hash, titulo: document.title, seccion: document.body.dataset.seccion,
  visibles: [...document.querySelectorAll('.vista')].filter((e) => !e.hidden).map((e) => e.dataset.vista),
  actual: (document.querySelector('#nav-secciones [aria-current="page"]') || {}).dataset?.vista,
  filas: document.querySelectorAll('#lineas .linea').length, contador: document.querySelector('#contador').textContent,
  foco: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
  patas: +document.querySelector('#ticket-n').textContent, badge: document.querySelector('#tab-ticket').hidden ? 0 : +document.querySelector('#tab-ticket-n').textContent,
  ancho: document.documentElement.scrollWidth, anuncio: document.querySelector('#anuncio').textContent,
  ticketVisible: getComputedStyle(document.querySelector('#ticket')).display !== 'none',
}));
const ticketGuardado = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), CL_TICKET);
const numContador = (s) => parseInt(s.contador, 10);
async function captura(p, nombre) { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, nombre + '.png') }); } }
async function sinScrollHorizontal(p, donde) { const w = await p.evaluate(() => document.documentElement.scrollWidth); assert.ok(w <= 390, `${donde}: scrollWidth ${w} > 390`); }

(async () => {
  const browser = await chromium.launch();
  const errores = [];

  // ====================================================================== CELULAR 390×844
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-AR' });
  let p = await nuevaPagina(movil, errores, 'móvil');

  await paso('móvil: arranca en Partidos, sin pintar Líneas ni robar el foco', async () => {
    await ir(p);
    const s = await st(p);
    assert.deepStrictEqual(s.visibles, ['partidos']);
    assert.strictEqual(s.actual, 'partidos');
    assert.strictEqual(s.titulo, 'Partidos · NBA Semáforo');
    assert.strictEqual(s.filas, 0);
    assert.strictEqual(s.foco, 'BODY');
    assert.strictEqual(await p.locator('#partidos .partido').count(), DATOS.partidos.length);
    await sinScrollHorizontal(p, 'Partidos');
    await captura(p, 'm-partidos');
  });

  await paso('móvil: cada sección por la barra de pestañas', async () => {
    for (const v of ['lineas', 'sugeridas', 'combinada', 'partidos']) {
      await p.click(`#nav-secciones a[data-vista="${v}"]`); await esperar(p);
      const s = await st(p);
      assert.ok(s.hash.startsWith('#/' + v), s.hash);
      assert.strictEqual(s.seccion, v);
      assert.strictEqual(s.actual, v);
      if (v !== 'combinada') assert.deepStrictEqual(s.visibles, [v]);
      else assert.ok(s.ticketVisible, 'el ticket se ve en la sección Combinada');
      assert.strictEqual(s.foco, { lineas: 'h-lineas', sugeridas: 'h-sug', combinada: 'h-ticket', partidos: 'h-partidos' }[v]);
      await sinScrollHorizontal(p, v);
    }
    assert.ok(await p.locator('#sug-dia .comb').count() >= 1, 'sugeridas pintadas');
  });

  await paso('móvil: secciones por hash y botón Atrás', async () => {
    await ir(p, '#/sugeridas'); assert.deepStrictEqual((await st(p)).visibles, ['sugeridas']);
    await p.click('.pie a[href="#/metodo"]'); await esperar(p);
    assert.deepStrictEqual((await st(p)).visibles, ['metodo']);
    assert.ok((await p.textContent('#metodo')).includes('Semáforo'));
    await p.goBack(); await esperar(p);
    assert.deepStrictEqual((await st(p)).visibles, ['sugeridas']);
    await ir(p, '#lineas');                                     // hash viejo
    assert.strictEqual((await st(p)).hash, '#/lineas');
    await ir(p, '#/lineas?partido=no-existe');                  // enlace de otro día
    const s = await st(p);
    assert.strictEqual(s.hash, '#/lineas'); assert.strictEqual(await p.inputValue('#f-partido'), '');
  });

  await paso('móvil: tarjeta de partido → Líneas filtradas; Atrás vuelve con la tarjeta marcada', async () => {
    await ir(p);
    const gid = DATOS.partidos[3].gid;
    await p.evaluate(() => scrollTo(0, 700)); await esperar(p, 80);
    await p.click(`.partido[data-gid="${gid}"] .p-sel`); await esperar(p, 250);
    let s = await st(p);
    assert.strictEqual(s.hash, '#/lineas?partido=' + gid);
    assert.strictEqual(await p.inputValue('#f-partido'), gid);
    assert.strictEqual(numContador(s), esperados(0.7, undefined, (g) => g.gid === gid));
    assert.strictEqual(await p.getAttribute('#nav-secciones a[data-vista="lineas"]', 'href'), '#/lineas?partido=' + gid);
    await captura(p, 'm-lineas-partido');
    await p.goBack(); await esperar(p, 200);
    s = await st(p);
    assert.deepStrictEqual(s.visibles, ['partidos']);
    assert.ok(await p.locator(`.partido.sel[data-gid="${gid}"]`).count() === 1);
    assert.ok(Math.abs(await p.evaluate(() => scrollY) - 700) < 5, 'conserva el scroll');
    await p.click('#nav-secciones a[data-vista="lineas"]'); await esperar(p);
    assert.strictEqual(await p.inputValue('#f-partido'), gid, 'la pestaña recuerda el partido');
    await p.selectOption('#f-partido', ''); await esperar(p);
    s = await st(p);
    assert.strictEqual(s.hash, '#/lineas');
    assert.strictEqual(numContador(s), esperados(0.7));
  });

  await paso('móvil: filtros (probabilidad, semáforo, grupos, búsqueda con tildes, partido, más filtros)', async () => {
    await ir(p, '#/lineas');
    assert.strictEqual(numContador(await st(p)), esperados(0.7));
    await p.selectOption('#f-prob', '0.55'); await esperar(p);
    assert.strictEqual(numContador(await st(p)), esperados(0.55));
    await p.click('#f-color [data-c="rojo"]'); await esperar(p);
    assert.strictEqual(numContador(await st(p)), esperados(0.55, ['verde', 'amarillo', 'rojo']));
    assert.strictEqual(await p.getAttribute('#f-color [data-c="rojo"]', 'aria-pressed'), 'true');
    // Recomendada: contadores = lista (cada jugador cuenta una vez, por el color de su línea recomendada)
    await p.selectOption('#f-prob', 'rec'); await esperar(p);
    const n = await p.evaluate(() => ['verde', 'amarillo', 'rojo'].map((c) => +document.querySelector('#n-' + c).textContent));
    assert.strictEqual(numContador(await st(p)), n[0] + n[1] + n[2]);
    assert.strictEqual(n[0] + n[1] + n[2], GRUPOS.length);
    await p.click('#f-color [data-c="verde"]'); await p.click('#f-color [data-c="amarillo"]'); await esperar(p);
    assert.strictEqual(numContador(await st(p)), n[2], 'solo rojo: la lista coincide con el contador rojo');
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('#lineas .linea')].every((e) => e.classList.contains('c-rojo'))));
    await p.click('#f-color [data-c="verde"]'); await p.click('#f-color [data-c="amarillo"]'); await esperar(p);
    // grupos
    await p.click('#f-grupo [data-g="pts"]'); await esperar(p);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('#lineas .apuesta')].every((e) => / puntos/.test(e.textContent))));
    await p.click('#f-grupo [data-g="otros"]'); await esperar(p);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('#lineas .apuesta')].every((e) => /triples|robos|tapas/.test(e.textContent))));
    await p.click('#f-grupo [data-g="todos"]'); await esperar(p);
    // búsqueda sin tildes encuentra «Matković»
    const acento = GRUPOS.find((g) => /[^\x00-\x7f]/.test(g.j));
    if (acento) {
      const sinTilde = acento.j.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      await p.fill('#f-q', sinTilde); await esperar(p, 300);
      const nombres = await p.$$eval('#lineas .nombre', (e) => e.map((x) => x.textContent));
      assert.ok(nombres.length > 0 && nombres.every((x) => x === acento.j), JSON.stringify(nombres));
      await p.fill('#f-q', ''); await esperar(p, 300);
    }
    // partido
    const gid = DATOS.partidos[1].gid;
    await p.selectOption('#f-partido', gid); await esperar(p);
    assert.strictEqual((await st(p)).hash, '#/lineas?partido=' + gid);
    await p.selectOption('#f-partido', ''); await esperar(p);
    // más filtros
    assert.strictEqual(await p.evaluate(() => document.querySelector('#mas-filtros').open), false, 'en el celular «Más filtros» arranca cerrado');
    await p.click('#mas-filtros > summary');
    assert.strictEqual(await p.evaluate(() => document.querySelector('#mas-filtros').open), true);
    const mercados = await p.$$eval('#f-mercado option', (o) => o.map((x) => x.value));
    assert.ok(!mercados.includes('oreb') && !mercados.includes('dreb'), 'sin rebotes ofensivos/defensivos');
    await p.selectOption('#f-mercado', 'reb'); await p.selectOption('#f-orden', 'p'); await esperar(p);
    assert.ok(await p.evaluate(() => [...document.querySelectorAll('#lineas .apuesta')].every((e) => / rebotes/.test(e.textContent))));
    const probs = await p.$$eval('#lineas .col-prob b', (e) => e.map((x) => parseFloat(x.textContent.replace(',', '.'))));
    assert.ok(probs.every((x, i) => i === 0 || x <= probs[i - 1]), 'ordenado por probabilidad');
    assert.match(await p.textContent('#mas-filtros-n'), /2 activos/);
    await p.selectOption('#f-mercado', ''); await p.selectOption('#f-orden', 'cuota'); await p.selectOption('#f-prob', '0.70'); await esperar(p);
    await sinScrollHorizontal(p, 'Líneas con filtros');
  });

  await paso('móvil: escalera, agregar, reemplazar y quitar patas (con foco y anuncio)', async () => {
    await ir(p, '#/lineas');
    const fila = p.locator('#lineas .linea').filter({ has: p.locator('[data-desplegar]') }).first();
    const k = await fila.getAttribute('data-k');
    const sel = `#lineas .linea[data-k="${k}"]`;
    await p.click(`${sel} [data-desplegar]`); await esperar(p);
    assert.strictEqual(await p.getAttribute(`${sel} [data-desplegar]`, 'aria-expanded'), 'true');
    assert.ok(await p.locator(`${sel} .escalera tbody tr`).count() >= 2);
    assert.strictEqual(await p.evaluate(() => document.activeElement.hasAttribute('data-desplegar')), true, 'el foco sigue en «Ocultar»');
    await captura(p, 'm-lineas-escalera');
    await p.click(`${sel} .col-acc .add`); await esperar(p, 150);
    let s = await st(p);
    assert.strictEqual(s.patas, 1); assert.strictEqual(s.badge, 1);
    assert.match(s.anuncio, /^Agregada: .* Combinada: 1 pata\./);
    assert.strictEqual(await p.textContent(`${sel} .col-acc .add`), '✓ En combinada');
    // otra línea del mismo jugador y mercado: reemplaza
    const Ls = await p.$$eval(`${sel} .escalera [data-add="mas"]`, (b) => b.map((x) => +x.dataset.l));
    const L0 = (await ticketGuardado(p)).legs[0].L, otra = Ls.find((L) => L !== L0);
    await p.click(`${sel} .escalera [data-add="mas"][data-l="${otra}"]`); await esperar(p, 150);
    let t = await ticketGuardado(p);
    assert.strictEqual(t.legs.length, 1); assert.strictEqual(t.legs[0].L, otra);
    // tocar de nuevo = quitar
    await p.click(`${sel} .escalera [data-add="mas"][data-l="${otra}"]`); await esperar(p, 150);
    s = await st(p);
    assert.strictEqual(s.patas, 0); assert.strictEqual(s.badge, 0); assert.match(s.anuncio, /^Quitada:/);
    // «menos»
    await abrirMasFiltros(p); await p.check('#f-menos'); await esperar(p);
    const menos = p.locator(`${sel} .escalera [data-add="menos"]`);
    if (await menos.count()) {
      await menos.click(); await esperar(p, 150);
      t = await ticketGuardado(p);
      assert.strictEqual(t.legs.length, 1); assert.strictEqual(t.legs[0].lado, 'menos');
      await p.click(`${sel} .escalera [data-add="menos"]`); await esperar(p, 150);
      assert.strictEqual((await ticketGuardado(p)).legs.length, 0);
    } else assert.fail('la fila no tiene «menos»');
    await p.uncheck('#f-menos');
  });

  await paso('móvil: cuota «1,85» y apuesta «1500,5» con coma decimal', async () => {
    await ir(p, '#/lineas');
    await p.click('#lineas .linea:nth-child(1) .col-acc .add'); await p.click('#lineas .linea:nth-child(2) .col-acc .add'); await esperar(p, 150);
    await p.click('#nav-secciones a[data-vista="combinada"]'); await esperar(p);
    await p.fill('#ticket-cuerpo [data-cuota="0"]', '1,85'); await esperar(p);
    let t = await ticketGuardado(p);
    assert.strictEqual(t.legs[0].cuota, 1.85);
    assert.match(await p.textContent('#ticket-cuerpo .pata:nth-child(1) .pata-cuota span'), /^editada/);
    await p.fill('#stake', '1500,5'); await esperar(p);
    t = await ticketGuardado(p);
    assert.strictEqual(t.stake, 1500.5);
    const total = t.legs.reduce((a, l) => a * l.cuota, 1);
    const cobro = await p.textContent('#t-totales .stake span:last-child');
    assert.strictEqual(cobro, 'cobrarías ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(1500.5 * total));
    await p.locator('#stake').blur(); await p.locator('[data-cuota="0"]').focus(); await p.locator('[data-cuota="0"]').blur();
    assert.strictEqual(await p.inputValue('#stake'), '1500,5');
    await p.fill('#ticket-cuerpo [data-cuota="1"]', 'abc'); await esperar(p);
    assert.strictEqual(await p.getAttribute('#ticket-cuerpo [data-cuota="1"]', 'aria-invalid'), 'true');
    await p.fill('#ticket-cuerpo [data-cuota="1"]', '1.5'); await esperar(p);
    assert.strictEqual((await ticketGuardado(p)).legs[1].cuota, 1.5);
    await sinScrollHorizontal(p, 'Combinada');
    await captura(p, 'm-combinada');
  });

  await paso('móvil: teclado en la combinada (sin foco fantasma fuera de la sección)', async () => {
    await p.click('#nav-secciones a[data-vista="partidos"]'); await esperar(p);
    const ids = [];
    await p.focus('#h-partidos');
    for (let i = 0; i < 25; i++) { await p.keyboard.press('Tab'); ids.push(await p.evaluate(() => document.activeElement.id || document.activeElement.className)); }
    assert.ok(!ids.some((x) => /stake|quitar|t-guardar/.test(x)), 'el ticket oculto no recibe foco: ' + ids.join(','));
    await p.click('#nav-secciones a[data-vista="combinada"]'); await esperar(p);
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'h-ticket');
    const seq = [];
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); seq.push(await p.evaluate(() => document.activeElement.id || document.activeElement.className || document.activeElement.tagName)); }
    assert.ok(seq.includes('quitar') && seq.includes('stake') && seq.includes('t-guardar'), seq.join(','));
  });

  await paso('móvil: guardar, vaciar, cargar y borrar una combinada guardada', async () => {
    await p.click('#t-guardar'); await esperar(p);
    assert.strictEqual(await p.locator('#guardadas .guardada').count(), 1);
    assert.match(await p.textContent('#guardadas .guardada b'), /Prueba <b>e2e<\/b>/, 'el nombre se muestra escapado');
    await p.click('#t-limpiar'); await esperar(p);
    assert.strictEqual((await st(p)).patas, 0);
    await p.click('#guardadas [data-cargar="0"]'); await esperar(p);
    const t = await ticketGuardado(p);
    assert.strictEqual(t.legs.length, 2); assert.strictEqual(t.legs[0].cuota, 1.85, 'conserva la cuota editada');
    await p.click('#guardadas [data-borrar="0"]'); await esperar(p);
    assert.strictEqual(await p.locator('#guardadas .guardada').count(), 0);
  });

  await paso('móvil: recargar conserva combinada y apuesta', async () => {
    await p.reload({ waitUntil: 'networkidle' }); await esperar(p, 300);
    const s = await st(p);
    assert.strictEqual(s.patas, 2); assert.strictEqual(s.badge, 2);
    assert.strictEqual(await p.inputValue('#stake'), '1500,5');
    assert.strictEqual(await p.inputValue('#ticket-cuerpo [data-cuota="0"]'), '1,85');
    assert.strictEqual(await p.isHidden('#aviso-ticket'), true, 'sin cambios de datos no hay aviso');
  });

  await paso('móvil: cargar una combinada sugerida (y Atrás vuelve a Sugeridas)', async () => {
    await p.click('#nav-secciones a[data-vista="sugeridas"]'); await esperar(p);
    await captura(p, 'm-sugeridas');
    const n = await p.locator('#sug-dia .comb:nth-child(1) .comb-patas li').count();
    await p.click('#sug-dia [data-comb="0"]'); await esperar(p, 200);
    let s = await st(p);
    assert.strictEqual(s.hash, '#/combinada'); assert.strictEqual(s.patas, n); assert.strictEqual(s.foco, 'h-ticket');
    await p.goBack(); await esperar(p);
    s = await st(p);
    assert.deepStrictEqual(s.visibles, ['sugeridas']);
  });

  await paso('móvil: sin desborde horizontal con una combinada larga en la píldora', async () => {
    await ir(p, '#/lineas');
    await p.selectOption('#f-prob', '0.55');
    await p.click('#f-color [data-c="rojo"]'); await esperar(p);
    for (let i = 1; i <= 12; i++) await p.click(`#lineas .linea:nth-child(${i}) .col-acc .add:not(.en-ticket)`).catch(() => {});
    await esperar(p, 200);
    assert.ok((await st(p)).patas >= 10);
    for (const v of ['partidos', 'lineas', 'sugeridas', 'combinada', 'metodo']) { await ir(p, '#/' + v); await sinScrollHorizontal(p, v + ' con 12 patas'); }
    await ir(p, '#/metodo'); await captura(p, 'm-metodo');
    await p.click('#nav-secciones a[data-vista="combinada"]'); await esperar(p);
    await p.click('#t-limpiar');
  });

  await paso('móvil: localStorage corrupto no rompe la página', async () => {
    const casos = [
      [JSON.stringify({ fecha: DATOS.fecha, legs: [null, { gkey: 5 }, 'x', { gkey: gkey(GRUPOS[0]), L: 'a' }], stake: 'abc' }), '{}'],
      ['no es json', JSON.stringify([{ nombre: 'sin patas' }, null, 3, { nombre: 'rota', legs: [null] }])],
      [JSON.stringify([1, 2]), JSON.stringify('texto')],
    ];
    for (const [t, g] of casos) {
      await p.evaluate(([a, b, ka, kb]) => { localStorage.setItem(ka, a); localStorage.setItem(kb, b); }, [t, g, CL_TICKET, CL_GUARDADAS]);
      await ir(p, '#/lineas');
      const s = await st(p);
      assert.ok(s.filas > 0, 'la lista se pinta');
      assert.strictEqual(await p.isHidden('#aviso'), true, 'sin aviso de error');
      assert.strictEqual(s.patas, 0);
      assert.ok(!(await p.textContent('#ticket-resumen')).includes('NaN'));
      await p.click('#lineas .linea:nth-child(1) .col-acc .add'); await esperar(p);
      await p.click('#nav-secciones a[data-vista="combinada"]'); await esperar(p);
      await p.click('#t-guardar'); await esperar(p);
      assert.ok(await p.locator('#guardadas .guardada').count() >= 1, 'se puede guardar');
      assert.ok(!(await p.textContent('#ticket')).includes('NaN'));
      await p.evaluate(() => localStorage.clear());
    }
  });

  await paso('móvil: filtros en sincronía al volver con Atrás desde otra página', async () => {
    await ir(p, '#/lineas');
    await p.selectOption('#f-prob', '0.55');
    await abrirMasFiltros(p); await p.check('#f-completo'); await p.selectOption('#f-orden', 'p'); await esperar(p);
    await p.goto(BASE + 'data/hoy.json'); await p.goBack({ waitUntil: 'networkidle' }); await esperar(p, 400);
    const v = await p.inputValue('#f-prob'), c = await p.textContent('#contador');
    assert.ok(c.includes('≥ ' + Math.round(parseFloat(v) * 100) + '%'), `select=${v} contador=${c}`);
    const completo = await p.isChecked('#f-completo');
    assert.strictEqual(numContador(await st(p)), esperados(parseFloat(v), undefined, (g) => !completo || g.mod === 'completo'));
  });
  await p.close();

  // ---------------------------------------------------------------------- variantes de datos
  await paso('móvil: partidos empezados (En juego / Final) no entran en sugeridas ni en patas nuevas', async () => {
    const d = clon(); d.partidos[0].estado = 2; d.partidos[1].estado = 3;
    const empez = [d.partidos[0], d.partidos[1]], equipos = new Set(empez.flatMap((x) => [x.local, x.visita]));
    const q = await nuevaPagina(movil, errores, 'móvil-empezados');
    await q.route('**/data/hoy.json', (r) => r.fulfill({ json: d }));
    await ir(q);
    assert.strictEqual(await q.textContent(`.partido[data-gid="${empez[0].gid}"] .estado-badge`), 'En juego');
    assert.strictEqual(await q.textContent(`.partido[data-gid="${empez[1].gid}"] .estado-badge`), 'Final');
    await captura(q, 'm-partidos-empezados');
    await ir(q, '#/lineas?partido=' + empez[0].gid);
    assert.ok(await q.locator('#lineas .linea .estado-badge').count() > 0);
    assert.ok(await q.evaluate(() => [...document.querySelectorAll('#lineas .col-acc .add')].every((b) => b.disabled && /empezado/.test(b.textContent))));
    await q.click('#lineas .linea:nth-child(1) .col-acc .add', { force: true }); await esperar(q);
    assert.strictEqual((await st(q)).patas, 0);
    await ir(q, '#/sugeridas');
    const txt = await q.$$eval('#sug-dia .comb-patas small', (e) => e.map((x) => x.textContent.split(' · ')[0]));
    assert.ok(txt.length > 0);
    txt.forEach((t) => { const [eq, , riv] = t.split(' '); assert.ok(!equipos.has(eq) || !equipos.has(riv), 'sugerida con partido empezado: ' + t); });
    await q.close();
  });

  await paso('móvil: datos regenerados el mismo día actualizan las patas (#2) y avisan las quitadas', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-regenerado');
    const g1 = GRUPOS.find((g) => g.pasos.length > 3), g2 = GRUPOS.find((g) => g.gid !== g1.gid && g.pasos.length > 1);
    const s1 = g1.pasos[0], s2 = g2.pasos[0];
    const pata = (g, s) => ({ key: gkey(g) + '|' + s.L + '|mas', gkey: gkey(g), id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: s.L, lado: 'mas', cuota: s.cu, cuotaOrig: s.cu, fuente: 'Betano', p: s.p, c: s.c, ju: s.ju, est: g.est, fl: [] });
    await q.goto(BASE + 'data/hoy.json');
    await q.evaluate(([k, v]) => localStorage.setItem(k, v), [CL_TICKET, JSON.stringify({ fecha: DATOS.fecha, legs: [pata(g1, s1), pata(g2, s2)], stake: 1000 })]);
    const d = clon();
    const n1 = d.grupos.find((g) => gkey(g) === gkey(g1)); n1.est = 'Doubtful'; Object.assign(n1.pasos.find((s) => s.L === s1.L), { c: 'rojo', p: 0.41, cu: 2.2 });
    const n2 = d.grupos.find((g) => gkey(g) === gkey(g2)); n2.pasos = n2.pasos.filter((s) => s.L !== s2.L);
    await q.route('**/data/hoy.json', (r) => r.fulfill({ json: d }));
    await ir(q, '#/partidos');
    const t = await ticketGuardado(q);
    assert.strictEqual(t.legs.length, 1);
    assert.deepStrictEqual([t.legs[0].c, t.legs[0].p, t.legs[0].cuota, t.legs[0].est], ['rojo', 0.41, 2.2, 'Doubtful']);
    assert.strictEqual(await q.isVisible('#aviso-ticket'), true, 'el aviso se ve fuera de la combinada');
    assert.match(await q.textContent('#aviso-ticket-txt'), new RegExp('saqué ' + g2.j));
    await captura(q, 'm-partidos-aviso-combinada');
    await q.click('#aviso-ticket-ver'); await esperar(q);
    assert.strictEqual((await st(q)).seccion, 'combinada');
    assert.strictEqual(await q.isHidden('#aviso-ticket'), true, 'en la combinada no se repite');
    assert.match(await q.textContent('#ticket-cuerpo .nota-ticket'), /Actualicé/);
    await captura(q, 'm-combinada-actualizada');
    await q.close();
  });

  await paso('móvil: combinada guardada de otro día se rearma con datos de hoy (#3)', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-otro-dia');
    const g1 = GRUPOS.find((g) => g.pasos.length > 2);
    const vieja = { key: 'x', gkey: gkey(g1), id: g1.id, j: g1.j, eq: g1.eq, riv: 'XXX', loc: true, gid: 'viejo', m: g1.m, mn: g1.mn, L: g1.pasos[1].L, lado: 'mas', cuota: 9.99, cuotaOrig: 9.99, fuente: 'Betano', p: 0.99, c: 'verde' };
    const inexistente = Object.assign({}, vieja, { gkey: '999|pts|', j: 'Jugador Viejo' });
    await q.goto(BASE + 'data/hoy.json');
    await q.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [CL_GUARDADAS, JSON.stringify([{ nombre: 'De ayer', fecha: '2000-01-01', legs: [vieja, inexistente], cuota: 5, p: 0.2 }])]);
    await ir(q, '#/combinada');
    assert.match(await q.textContent('#guardadas .guardada small'), /del 01\/01/);
    await q.click('#guardadas [data-cargar="0"]'); await esperar(q);
    const t = await ticketGuardado(q);
    assert.strictEqual(t.legs.length, 1);
    const hoy = g1.pasos[1];
    assert.deepStrictEqual([t.legs[0].gid, t.legs[0].riv, t.legs[0].p, t.legs[0].c, t.legs[0].cuota], [g1.gid, g1.riv, hoy.p, hoy.c, hoy.cu]);
    assert.match(await q.textContent('#ticket-cuerpo .nota-ticket'), /es del 01\/01.*Jugador Viejo/);
    // si no queda ninguna pata, no se toca el ticket
    await q.evaluate(([k, v]) => localStorage.setItem(k, v), [CL_GUARDADAS, JSON.stringify([{ nombre: 'Vacía', fecha: '2000-01-01', legs: [inexistente] }])]);
    await q.reload({ waitUntil: 'networkidle' }); await esperar(q, 300);
    await q.click('#guardadas [data-cargar="0"]'); await esperar(q);
    assert.strictEqual((await st(q)).patas, 1);
    assert.match(await q.textContent('#ticket-cuerpo .nota-ticket'), /No cargué/);
    await q.evaluate(() => localStorage.clear());
    await q.close();
  });

  await paso('móvil: moneyline escapada (#5), spread sin favorito y pick\'em (#9), mercados oreb/dreb filtrados', async () => {
    const d = clon();
    d.partidos[0].ml = { [d.partidos[0].visita]: '<img src=x onerror="window.__xss=1">', [d.partidos[0].local]: 150 };
    d.partidos[1].fav = null; d.partidos[2].spread = 0;
    const base = d.grupos.find((g) => g.m === 'reb' && g.pasos.some((s) => s.c === 'verde' && s.p >= 0.7));
    d.grupos.push(Object.assign(JSON.parse(JSON.stringify(base)), { m: 'oreb', mn: 'Rebotes ofensivos' }));
    const q = await nuevaPagina(movil, errores, 'móvil-xss');
    await q.route('**/data/hoy.json', (r) => r.fulfill({ json: d }));
    await ir(q);
    assert.strictEqual(await q.evaluate(() => window.__xss), undefined);
    assert.strictEqual(await q.locator('#partidos img').count(), 0);
    const tags = await q.$$eval('.partido .p-datos .tag:first-child', (e) => e.map((x) => x.textContent));
    assert.ok(/^Spread /.test(tags[1]) && !/^\s*−/.test(tags[1]), tags[1]);
    assert.strictEqual(tags[2], "Pick'em");
    await ir(q, '#/lineas');
    assert.ok(!(await q.$$eval('#f-mercado option', (o) => o.map((x) => x.value))).includes('oreb'));
    await q.click('#f-grupo [data-g="otros"]'); await esperar(q);
    assert.ok(!(await q.textContent('#lineas')).includes('ofensivos'));
    await q.close();
  });

  await paso('móvil: lector de pantalla: semáforo y rótulos de los % como texto (#12)', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-a11y');
    await ir(q, '#/lineas');
    const txt = await q.textContent('#lineas .linea:nth-child(1)');
    assert.match(txt, /Semáforo (verde|amarillo|rojo)\./);
    assert.match(txt, /Probabilidad/); assert.match(txt, /Acierto en los últimos 10/);
    await q.close();
  });

  // ====================================================================== ESCRITORIO 1360×900
  const escritorio = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'es-AR' });
  const e = await nuevaPagina(escritorio, errores, 'escritorio');

  await paso('escritorio: pestañas arriba, sin pestaña Combinada; columna siempre visible', async () => {
    await ir(e);
    assert.strictEqual(await e.isVisible('#nav-secciones a[data-vista="combinada"]'), false);
    for (const v of ['partidos', 'lineas', 'sugeridas']) {
      await e.click(`#nav-secciones a[data-vista="${v}"]`); await esperar(e);
      const s = await st(e);
      assert.deepStrictEqual(s.visibles, [v]); assert.ok(s.ticketVisible);
      await captura(e, 'd-' + v);
    }
    await e.click('.pie a[href="#/metodo"]'); await esperar(e);
    assert.deepStrictEqual((await st(e)).visibles, ['metodo']);
    await captura(e, 'd-metodo');
    await e.goBack(); await esperar(e);
    assert.deepStrictEqual((await st(e)).visibles, ['sugeridas']);
  });

  await paso('escritorio: #/combinada vuelve a la última sección y enfoca la columna; la píldora enfoca', async () => {
    await ir(e, '#/lineas');
    await e.evaluate(() => { location.hash = '#/combinada'; }); await esperar(e, 200);
    const s = await st(e);
    assert.strictEqual(s.hash, '#/lineas'); assert.deepStrictEqual(s.visibles, ['lineas']); assert.strictEqual(s.foco, 'h-ticket');
    await e.focus('#f-q');
    await e.click('#abrir-ticket'); await esperar(e);
    assert.strictEqual((await st(e)).foco, 'h-ticket');
    assert.strictEqual((await st(e)).hash, '#/lineas');
  });

  await paso('escritorio: agregar desde Líneas actualiza la columna, escalera y sugerida', async () => {
    await e.click('#lineas .linea:nth-child(1) .col-acc .add'); await esperar(e);
    assert.strictEqual(await e.locator('#ticket-cuerpo .pata').count(), 1);
    await e.click('#lineas .linea:nth-child(2) [data-desplegar]'); await esperar(e);
    assert.ok(await e.locator('#lineas .linea:nth-child(2) .escalera').count() === 1);
    await e.fill('#ticket-cuerpo [data-cuota="0"]', '2,05'); await esperar(e);
    assert.strictEqual((await ticketGuardado(e)).legs[0].cuota, 2.05);
    await captura(e, 'd-lineas-escalera');
    await e.click('#nav-secciones a[data-vista="sugeridas"]'); await esperar(e);
    await e.click('#sug-dia [data-comb="1"]'); await esperar(e);
    const s = await st(e);
    assert.strictEqual(s.hash, '#/sugeridas'); assert.strictEqual(s.foco, 'h-ticket');
    assert.ok(s.patas >= 3);
    await captura(e, 'd-sugeridas-cargada');
  });
  await e.close();

  await paso('sin errores de consola en todo el recorrido', async () => { assert.deepStrictEqual(errores, []); });
  await browser.close();
  console.log(`\n${ok} pasos ok, ${fallas.length} con fallas`);
  if (fallas.length) { console.log(fallas.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
