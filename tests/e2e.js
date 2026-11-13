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

// ---------------------------------------------------------------- v0.6: fixtures (tests/fixtures) servidas con page.route
const FX = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const CL_APUESTAS = 'nba_semaforo_apuestas_v1';
const ESPN = /site\.api\.espn\.com/;
const espnEstado = (estado) => {                                   // el resumen de ESPN de fixture, «pre» / «in» / «post»
  const d = FX('espn-summary-vivo.json'), t = d.header.competitions[0].status;
  if (estado === 'pre') Object.assign(t, { period: 0, displayClock: '0:00', type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false } });
  if (estado === 'post') Object.assign(t, { period: 4, displayClock: '0:00', type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true } });
  return d;
};
async function rutasResultados(q) {
  await q.route('**/data/calibracion.json', (r) => r.fulfill({ json: FX('calibracion.json') }));
  await q.route('**/data/historial/2026-11-12.json', (r) => r.fulfill({ json: FX('historial/2026-11-12.json') }));
  await q.route('**/data/resultados/2026-11-12.json', (r) => r.fulfill({ json: FX('resultados/2026-11-12.json') }));
}
const apuestasGuardadas = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), CL_APUESTAS);
const estadoApuesta = (p, id) => p.textContent(`#apuestas .apu[data-id="${id}"] .estado-apu`);
const patasDeTicket = (gs) => gs.map(([g, s]) => ({ key: gkey(g) + '|' + s.L + '|mas', gkey: gkey(g), id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: s.L, lado: 'mas', cuota: s.cu, cuotaOrig: s.cu, fuente: 'Betano', p: s.p, c: s.c, ju: s.ju, est: g.est, fl: [] }));
const U = require('../docs/app.js');

(async () => {
  const browser = await chromium.launch();
  const errores = [];

  // ====================================================================== CELULAR 390×844
  const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'es-AR', acceptDownloads: true });
  await movil.route(ESPN, (r) => r.fulfill({ json: espnEstado('pre') }));   // nunca sale a ESPN: «por empezar» salvo que la prueba diga otra cosa
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
    for (const v of ['partidos', 'lineas', 'sugeridas', 'combinada', 'mas', 'resultados', 'apuestas', 'metodo']) { await ir(p, '#/' + v); await sinScrollHorizontal(p, v + ' con 12 patas'); }
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

  // ====================================================================== v0.6 (celular)
  await paso('móvil: 5 pestañas entran en 390 px; «Más» lleva a Resultados, Mis apuestas y Cómo se calcula', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-mas');
    await ir(q);
    const tabs = await q.$$eval('#nav-secciones a', (as) => as.map((a) => {
      const r = a.getBoundingClientRect(), t = a.querySelector('.sec-txt');
      return { v: a.dataset.vista, w: r.width, top: Math.round(r.top), h: r.height, trunc: t.scrollWidth > t.clientWidth + 0.5, alto: t.getBoundingClientRect().height };
    }));
    assert.deepStrictEqual(tabs.map((t) => t.v), ['partidos', 'lineas', 'sugeridas', 'combinada', 'mas']);
    assert.ok(tabs.every((t) => t.w >= 74 && t.w <= 80), 'cada pestaña ≈ 78 px: ' + tabs.map((t) => t.w).join(','));
    assert.strictEqual(new Set(tabs.map((t) => t.top)).size, 1, 'una sola fila');
    assert.ok(tabs.every((t) => !t.trunc && t.alto < 20), 'rótulos sin cortar ni partir: ' + JSON.stringify(tabs));
    await q.click('#nav-secciones a[data-vista="mas"]'); await esperar(q);
    let s = await st(q);
    assert.strictEqual(s.hash, '#/mas'); assert.deepStrictEqual(s.visibles, ['mas']); assert.strictEqual(s.actual, 'mas'); assert.strictEqual(s.foco, 'h-mas');
    assert.strictEqual(await q.locator('#vista-mas .hub-item').count(), 3);
    await sinScrollHorizontal(q, 'Más'); await captura(q, 'm-mas');
    for (const [href, vista, h] of [['#/resultados', 'resultados', 'h-res'], ['#/apuestas', 'apuestas', 'h-apu'], ['#/metodo', 'metodo', 'h-metodo']]) {
      await q.click(`#vista-mas a[href="${href}"]`); await esperar(q);
      s = await st(q);
      assert.strictEqual(s.hash, href); assert.deepStrictEqual(s.visibles, [vista]); assert.strictEqual(s.foco, h);
      assert.strictEqual(await q.getAttribute('#nav-secciones a[data-vista="mas"]', 'aria-current'), 'true', 'la pestaña «Más» queda activa en ' + vista);
      assert.strictEqual(await q.locator('#nav-secciones a[aria-current]').count(), 1);
      await q.click(`#vista-${vista} .volver`); await esperar(q);
      assert.strictEqual((await st(q)).hash, '#/mas');
    }
    await q.click('#vista-mas a[href="#/metodo"]'); await esperar(q);
    await q.click('#nav-secciones a[data-vista="mas"]'); await esperar(q);
    assert.strictEqual((await st(q)).hash, '#/mas', 'tocar «Más» desde una subsección vuelve al índice');
    await q.close();
  });

  await paso('móvil: Resultados sin días corregidos muestra el estado vacío', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-res-vacio');
    const vacio = FX('calibracion.json'); vacio.dias = [];
    await q.route('**/data/calibracion.json', (r) => r.fulfill({ json: vacio }));
    await ir(q, '#/resultados');
    await q.waitForSelector('#resultados .res-vacio');
    assert.match(await q.textContent('#resultados'), /Todavía no hay días corregidos: el primero aparece mañana, cuando terminen los partidos de hoy/);
    assert.strictEqual(await q.locator('#resultados svg.cal').count(), 0);
    await sinScrollHorizontal(q, 'Resultados vacío'); await captura(q, 'm-resultados-vacio');
    await q.close();
  });

  await paso('móvil: Resultados con 3 días (fixture): colores, gráfico con n chica marcada, Brier, ROI, sugeridas y detalle del día', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-res');
    await rutasResultados(q);
    await ir(q, '#/resultados');
    await q.waitForSelector('#resultados svg.cal');
    const txt = await q.textContent('#resultados');
    assert.match(txt, /3 días corregidos \(del 10\/11 al 12\/11\)/);
    assert.match(txt, /Muestra chica/);
    assert.strictEqual(await q.locator('svg.cal .cal-pt').count(), 6);
    assert.strictEqual(await q.locator('svg.cal .cal-pt.chica').count(), 2, 'los tramos con n < 30 se marcan');
    assert.match(await q.textContent('svg.cal'), /n=3\?/);
    assert.match(await q.getAttribute('svg.cal', 'aria-label'), /70–80%: esperado 74%, acertado 64%, n=64/);
    assert.match(txt, /0,231/); assert.match(txt, /0,236/); assert.match(txt, /más bajo es mejor/);
    const roi = await q.$$eval('#h-res-roi ~ .tabla-x tbody tr', (tr) => tr.map((x) => x.textContent));
    assert.match(roi[0], /Verde.*412.*301.*−9,84 u.*−2,4%/); assert.match(roi[1], /\+1,9%/);
    const sug = await q.$$eval('#h-res-sug ~ .tabla-x tbody tr', (tr) => tr.map((x) => x.textContent));
    assert.match(sug[0], /Segura3–3/); assert.match(sug[2], /Soñadora0–2–1/);
    // color: líneas principales → escalera
    assert.match(await q.textContent('#h-res-col ~ .tabla-x tbody tr:first-child'), /71%.*69%.*66\/96/);
    await q.click('[data-conjunto="escalera"]'); await esperar(q);
    assert.match(await q.textContent('#h-res-col ~ .tabla-x tbody tr:first-child'), /75%.*73%.*301\/412/);
    assert.strictEqual(await q.locator('#h-res-brier').count(), 0, 'el Brier es de las líneas principales');
    await q.click('[data-conjunto="lineas"]'); await esperar(q);
    // detalle del día (el más reciente)
    assert.strictEqual(await q.inputValue('#r-dia'), '2026-11-12');
    await q.waitForSelector('#r-dia-cuerpo .res-comb');
    const combs = await q.$$eval('#r-dia-cuerpo .res-comb', (a) => a.map((x) => ({ est: x.querySelector('.estado-apu').textContent, icos: [...x.querySelectorAll('.res-pata')].map((l) => l.className.replace('res-pata ', '')), txt: x.textContent })));
    assert.deepStrictEqual(combs.map((c) => c.est), ['Ganada @1,63', 'Perdida', 'Pendiente']);
    assert.deepStrictEqual(combs[0].icos, ['ganada', 'ganada', 'anulada']);
    assert.match(combs[0].txt, /Marcos Ribeiro.*hizo 24/); assert.match(combs[0].txt, /no jugó · anulada/);
    assert.deepStrictEqual(combs[1].icos, ['ganada', 'perdida', 'perdida']);
    assert.match(combs[1].txt, /Tomás Ledesma.*hizo 5/);
    assert.deepStrictEqual(combs[2].icos, ['ganada', 'pendiente', 'ganada']);
    const verdes = await q.textContent('#r-dia-cuerpo .res-resumen');
    assert.match(verdes, /2 de 3 superaron la línea \(67%\) · 1 anulada · 2 pendientes/);
    assert.match(await q.textContent('#r-dia-cuerpo'), /Jugador #9007/, 'sin nombre en el historial ni en hoy.json');
    assert.match(await q.textContent('#r-dia-cuerpo'), /todavía no terminó de corregirse/);
    await sinScrollHorizontal(q, 'Resultados');
    await captura(q, 'm-resultados');
    await q.evaluate(() => document.querySelector('#h-res-cal').scrollIntoView()); await captura(q, 'm-resultados-grafico');
    await q.evaluate(() => document.querySelector('#h-res-dia').scrollIntoView()); await captura(q, 'm-resultados-dia');
    await q.close();
  });

  await paso('móvil: registrar la combinada como apuesta con cuota «1,85»', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-registrar');
    await ir(q); await q.evaluate(() => localStorage.clear());
    await ir(q, '#/lineas');
    await q.click('#lineas .linea:nth-child(1) .col-acc .add'); await q.click('#lineas .linea:nth-child(2) .col-acc .add'); await esperar(q, 150);
    await q.click('#nav-secciones a[data-vista="combinada"]'); await esperar(q);
    const total = (await ticketGuardado(q)).legs.reduce((a, l) => a * l.cuota, 1);
    await q.click('#t-registrar'); await esperar(q);
    assert.strictEqual(await q.evaluate(() => document.activeElement.id), 'h-reg');
    assert.strictEqual(await q.inputValue('#reg-cuota'), U.fC(total), 'la cuota real arranca con la del ticket');
    await captura(q, 'm-registrar');
    await q.fill('#reg-cuota', 'abc'); await q.click('#registrar button[type="submit"]'); await esperar(q);
    assert.match(await q.textContent('#reg-error'), /cuota real con coma/);
    assert.strictEqual((await apuestasGuardadas(q)).length, 0);
    await q.selectOption('#reg-casa', 'Stake'); await q.fill('#reg-monto', '1.500'); await q.fill('#reg-cuota', '1,85');
    await q.click('#registrar button[type="submit"]'); await esperar(q);
    const a = await apuestasGuardadas(q);
    assert.strictEqual(a.length, 1);
    assert.deepStrictEqual([a[0].casa, a[0].monto, a[0].cuota, a[0].fecha, a[0].manual, a[0].legs.length], ['Stake', 1500, 1.85, DATOS.fecha, null, 2]);
    assert.deepStrictEqual(Object.keys(a[0].legs[0]).sort(), ['L', 'c', 'cu', 'eq', 'gid', 'id', 'j', 'lado', 'm', 'mn', 'p', 'per', 'riv'].sort());
    assert.match(await q.textContent('#registrar .reg-ok'), /Apuesta registrada: Stake, \$1\.500 @1,85/);
    assert.match((await st(q)).anuncio, /Apuesta registrada/);
    await sinScrollHorizontal(q, 'Registrar apuesta'); await captura(q, 'm-registrada');
    // vaciar la combinada cierra el formulario
    await q.click('#t-registrar'); await q.click('#t-limpiar'); await esperar(q);
    assert.strictEqual(await q.isHidden('#registrar'), true);
    await q.close();
  });

  await paso('móvil: Mis apuestas: importar, corregir (ganada / perdida / anulada / pendiente), marcar a mano, exportar y borrar', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-apuestas');
    await rutasResultados(q);
    await ir(q, '#/apuestas');
    assert.strictEqual(await q.locator('#apuestas .apu').count(), 1, 'la registrada en el paso anterior');
    assert.strictEqual(await q.textContent('#apuestas .apu .estado-apu'), 'Pendiente', 'los partidos de hoy no terminaron');
    await q.setInputFiles('#apu-archivo', path.join(__dirname, 'fixtures/apuestas.json')); await esperar(q, 300);
    assert.match(await q.textContent('#apu-msg'), /Importé 5 apuestas; descarté 1 inválida\./);
    await q.waitForFunction(() => /Ganada/.test((document.querySelector('#apuestas .apu[data-id="fx-ganada"] .estado-apu') || {}).textContent || ''));
    assert.strictEqual(await estadoApuesta(q, 'fx-ganada'), 'Ganada');
    assert.strictEqual(await estadoApuesta(q, 'fx-perdida'), 'Perdida');
    assert.strictEqual(await estadoApuesta(q, 'fx-anulada'), 'Anulada');
    assert.strictEqual(await estadoApuesta(q, 'fx-pendiente'), 'Pendiente');
    assert.strictEqual(await estadoApuesta(q, 'fx-con-anulada'), 'Ganada');
    assert.match(await q.textContent('.apu[data-id="fx-con-anulada"] .apu-cobro'), /Cobró \$160 \(\+\$60\)/);
    assert.match(await q.textContent('.apu[data-id="fx-anulada"] .apu-cobro'), /Se devolvió \$200/);
    const icos = await q.$$eval('.apu[data-id="fx-perdida"] .res-pata', (l) => l.map((x) => x.querySelector('.res-ico').textContent + ' ' + x.querySelector('.res-hizo').textContent));
    assert.deepStrictEqual(icos, ['✓ hizo 24', '✗ hizo 5']);
    assert.match(await q.textContent('.apu[data-id="fx-pendiente"] .res-pata:first-child'), /^…Pendiente: Nico Paz.*pendiente$/);
    const tot = await q.$$eval('#apuestas .apu-tot .total', (t) => t.map((x) => x.textContent));
    assert.match(tot[0], /Apostado\$3\.600\$1\.800 pendiente/);
    assert.match(tot[1], /Cobrado\$2\.460/); assert.match(tot[2], /Neto\+\$660/); assert.match(tot[3], /ROI\+41%/); assert.match(tot[4], /Aciertos2 de 3/);
    assert.match(await q.textContent('#apuestas .apu-casas'), /Stake.*−\$440/);
    await sinScrollHorizontal(q, 'Mis apuestas'); await captura(q, 'm-apuestas');
    // importar de nuevo no duplica
    await q.setInputFiles('#apu-archivo', path.join(__dirname, 'fixtures/apuestas.json')); await esperar(q, 300);
    assert.match(await q.textContent('#apu-msg'), /Importé 0 apuestas \(5 ya estaban\)/);
    assert.strictEqual(await q.locator('#apuestas .apu').count(), 6);
    // marcar a mano y volver a automático
    await q.selectOption('#apu-man-fx-pendiente', 'ganada'); await esperar(q);
    assert.strictEqual(await estadoApuesta(q, 'fx-pendiente'), 'Ganada (manual)');
    assert.strictEqual((await apuestasGuardadas(q)).find((a) => a.id === 'fx-pendiente').manual, 'ganada');
    assert.match(await q.textContent('.apu[data-id="fx-pendiente"] .apu-cobro'), /Cobró \$750/);
    assert.strictEqual(await q.evaluate(() => document.activeElement.id), 'apu-man-fx-pendiente', 'el foco sigue en el selector');
    await q.selectOption('#apu-man-fx-pendiente', ''); await esperar(q);
    assert.strictEqual(await estadoApuesta(q, 'fx-pendiente'), 'Pendiente');
    // exportar
    const [descarga] = await Promise.all([q.waitForEvent('download'), q.click('#apuestas [data-exportar]')]);
    assert.match(descarga.suggestedFilename(), /^nba-semaforo-apuestas-\d{4}-\d{2}-\d{2}\.json$/);
    const exp = JSON.parse(fs.readFileSync(await descarga.path(), 'utf8'));
    assert.strictEqual(exp.apuestas.length, 6); assert.strictEqual(exp.app, 'nba-semaforo');
    // borrar (el diálogo de confirmación se acepta)
    await q.click('#apuestas [data-borrar-apu="fx-perdida"]'); await esperar(q);
    assert.strictEqual(await q.locator('#apuestas .apu').count(), 5);
    assert.strictEqual((await apuestasGuardadas(q)).some((a) => a.id === 'fx-perdida'), false);
    // la apuesta registrada hoy se corrige «al otro día»: se mueve a una fecha pasada y se sirve su box score
    const reg = (await apuestasGuardadas(q)).find((a) => !a.id.startsWith('fx-'));
    const res = { fecha: '2026-11-11', completo: true, partidos: {}, jugadores: {} };
    reg.legs.forEach((l) => {
      res.partidos[l.gid] = { estado: 3, local: l.eq, visita: l.riv, box: true };
      const v = Math.floor(l.L) + 1;
      res.jugadores[l.id] = { min: 30, pts: v, reb: v, ast: v, fg3m: v, stl: v, blk: v, tov: 0, fgm: 0, fga: 0, fta: 0, ftm: 0, pf: 2 };
    });
    await q.route('**/data/resultados/2026-11-11.json', (r) => r.fulfill({ json: res }));
    await q.evaluate(([k, id]) => { const l = JSON.parse(localStorage.getItem(k)); l.find((a) => a.id === id).fecha = '2026-11-11'; localStorage.setItem(k, JSON.stringify(l)); }, [CL_APUESTAS, reg.id]);
    await ir(q, '#/apuestas');
    await q.waitForFunction((id) => /Ganada/.test((document.querySelector(`#apuestas .apu[data-id="${id}"] .estado-apu`) || {}).textContent || ''), reg.id);
    assert.match(await q.textContent(`.apu[data-id="${reg.id}"] .apu-cobro`), /Cobró \$2\.775/);
    // corrupto: no rompe
    await q.evaluate((k) => localStorage.setItem(k, '[{"fecha":"x"},null,5,"a"]'), CL_APUESTAS);
    await ir(q, '#/apuestas');
    assert.match(await q.textContent('#apuestas'), /Todavía no registraste apuestas/);
    await q.evaluate(() => localStorage.clear());
    await q.close();
  });

  await paso('móvil: combinada en vivo con el resumen de ESPN (fixture): lleva / le faltan, ✓ al pasar, ✗ al final y sin datos', async () => {
    const d = clon(), P = d.partidos[0]; P.estado = 2;
    const conL = (g) => g.pasos.find((s) => s.L >= 6);
    const local = GRUPOS.find((g) => g.gid === P.gid && g.m === 'pts' && g.eq === P.local && conL(g));
    const visita = GRUPOS.find((g) => g.gid === P.gid && g.m === 'pts' && g.eq === P.visita && conL(g));
    const otro = GRUPOS.find((g) => g.gid === P.gid && g.m === 'reb' && g.id !== local.id && g.id !== visita.id);
    const sL = conL(local), sV = conL(visita);
    const fx = espnEstado('in'), comp = fx.header.competitions[0];
    const idCasa = comp.competitors.find((c) => c.homeAway === 'home').team.id;
    const caja = (lado) => fx.boxscore.players.find((t) => (t.team.id === idCasa) === (lado === 'home')).statistics[0];
    const ponerJug = (lado, nombre, pts, min, pf) => { const a = caja(lado).athletes[0]; a.athlete.displayName = nombre; a.stats[0] = String(min); a.stats[1] = String(pts); a.stats[12] = String(pf); };
    // nombre con otra forma (sin tildes, mayúsculas y «Jr.»): igual se encuentra
    ponerJug('home', local.j.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() + ' Jr.', Math.floor(sL.L) + 3, 25, 2);
    ponerJug('away', visita.j, Math.floor(sV.L) - 3, 21, 3);
    let pedidos = 0, respuesta = fx;
    const q = await nuevaPagina(movil, errores, 'móvil-vivo');
    await q.clock.install();
    await q.route('**/data/hoy.json', (r) => r.fulfill({ json: d }));
    await q.route(ESPN, (r) => { pedidos++; assert.ok(r.request().url().endsWith('event=' + P.espn), r.request().url()); r.fulfill({ json: respuesta }); });
    await q.goto(BASE + 'data/hoy.json');
    await q.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [CL_TICKET, JSON.stringify({ fecha: DATOS.fecha, legs: patasDeTicket([[local, sL], [visita, sV], [otro, otro.pasos[0]]]), stake: 1000 })]);
    await ir(q, '#/combinada');
    await q.waitForSelector('#vivo:not([hidden]) .vivo-pata');
    assert.strictEqual(pedidos, 1, 'una consulta por partido en vivo');
    assert.match(await q.textContent('#h-vivo'), /En vivo/);
    assert.match(await q.textContent('#vivo .vivo-marcador'), new RegExp(P.visita + ' 71 – 88 ' + P.local + '3er cuarto · 5:32'));
    const filas = await q.$$eval('#vivo .vivo-pata', (l) => l.map((x) => ({ cls: x.className, txt: x.textContent })));
    const fila = (j) => filas.find((f) => f.txt.includes(j));
    assert.match(fila(local.j).cls, /ganada/); assert.match(fila(local.j).txt, /✓/); assert.match(fila(local.j).txt, new RegExp('lleva ' + (Math.floor(sL.L) + 3) + ' · ya pasó la línea · 25 min · 2 faltas'));
    assert.match(fila(visita.j).cls, /abierta/); assert.match(fila(visita.j).txt, new RegExp('lleva ' + (Math.floor(sV.L) - 3) + ' · le faltan 4 · 21 min · 3 faltas'));
    assert.match(fila(otro.j).txt, /sin datos en vivo/);
    await sinScrollHorizontal(q, 'En vivo'); await captura(q, 'm-vivo');
    // cada 45 s mientras la combinada está a la vista; no en otra sección
    await q.clock.fastForward(46000); await esperar(q, 200);
    assert.strictEqual(pedidos, 2, 'se actualiza a los 45 s');
    await q.click('#nav-secciones a[data-vista="partidos"]'); await esperar(q);
    await q.clock.fastForward(100000); await esperar(q, 200);
    assert.strictEqual(pedidos, 2, 'fuera de la combinada no consulta');
    await q.click('#nav-secciones a[data-vista="combinada"]'); await esperar(q, 300);
    assert.strictEqual(pedidos, 3, 'al volver, actualiza');
    // terminó: la que no llegó queda ✗; un partido terminado no se vuelve a pedir
    respuesta = espnEstado('post'); respuesta.boxscore = fx.boxscore;     // mismas estadísticas, partido terminado
    await q.click('#vivo [data-vivo-act]'); await esperar(q, 300);
    assert.strictEqual(pedidos, 4);
    assert.match(await q.textContent('#h-vivo'), /Terminados/);
    const fin = await q.$$eval('#vivo .vivo-pata', (l) => l.map((x) => ({ cls: x.className, txt: x.textContent })));
    const f2 = fin.find((f) => f.txt.includes(visita.j));
    assert.match(f2.cls, /perdida/); assert.match(f2.txt, /✗/); assert.match(f2.txt, /no llegó/);
    assert.match(await q.textContent('#vivo .vivo-reloj'), /Final/);
    await captura(q, 'm-vivo-final');
    await q.click('#vivo [data-vivo-act]'); await esperar(q, 300);
    assert.strictEqual(pedidos, 4, 'no vuelve a pedir un partido terminado');
    await q.evaluate(() => localStorage.clear());
    await q.close();
  });

  await paso('móvil: Armá tu combinada cumple la cuota objetivo y las reglas; «Otra opción», cargar y casos imposibles', async () => {
    const q = await nuevaPagina(movil, errores, 'móvil-armar');
    await ir(q); await q.evaluate(() => localStorage.clear());
    await ir(q, '#/sugeridas');
    assert.ok(await q.evaluate(() => document.querySelector('#armar').compareDocumentPosition(document.querySelector('#sug-dia')) & Node.DOCUMENT_POSITION_FOLLOWING), 'arriba de las sugeridas');
    assert.strictEqual(await q.inputValue('#a-cuota'), '3,00'); assert.strictEqual(await q.inputValue('#a-n'), '3'); assert.strictEqual(await q.inputValue('#a-pmin'), '0.65');
    await captura(q, 'm-armar-form');
    const leerCard = () => q.evaluate(() => {
      const c = document.querySelector('#armar-res .comb'); if (!c) return null;
      return { cuota: parseFloat(c.querySelector('.comb-nums b').textContent.replace('@', '').replace(',', '.')),
        patas: [...c.querySelectorAll('.comb-patas li')].map((li) => ({ j: li.querySelector('b').textContent, txt: li.textContent, small: li.querySelector('small').textContent })) };
    });
    await q.fill('#a-cuota', '3'); await q.click('#armar .armar-btn'); await esperar(q, 300);
    const r1 = await leerCard();
    if (!r1) assert.fail('sin resultado: ' + await q.textContent('#armar-res'));
    assert.ok(r1.cuota >= 3, 'cuota ' + r1.cuota); assert.strictEqual(r1.patas.length, 3);
    r1.patas.forEach((x) => {
      const [partido, prob, , color] = x.small.split(' · ');
      assert.ok(parseInt(prob, 10) >= 65, x.small); assert.ok(/verde|amarillo/.test(color), x.small);
      assert.ok(/^Más de /.test(x.txt.split(' · ')[1]), x.txt);
    });
    const partidos = r1.patas.map((x) => x.small.split(' · ')[0].split(/ vs | @ /).sort().join('-'));
    assert.strictEqual(new Set(partidos).size, 3, 'máximo 1 por partido: ' + partidos);
    await esperar(q, 800); await captura(q, 'm-armar');
    // solo rebotes, 2 patas
    await q.click('#a-tipos [data-v="pts"]'); await q.click('#a-tipos [data-v="ast"]'); await q.click('#a-tipos [data-v="combos"]'); await q.click('#a-tipos [data-v="otros"]');
    await q.selectOption('#a-n', '2'); await q.fill('#a-cuota', '2'); await q.click('#armar .armar-btn'); await esperar(q, 300);
    const rr = await leerCard();
    if (rr) assert.ok(rr.patas.every((x) => / rebotes/.test(x.txt)), 'solo rebotes');
    else assert.match(await q.textContent('#armar-res'), /Probá/);
    for (const v of ['pts', 'ast', 'combos', 'otros']) await q.click(`#a-tipos [data-v="${v}"]`);
    await q.selectOption('#a-n', '3'); await q.fill('#a-cuota', '3,00'); await q.click('#armar .armar-btn'); await esperar(q, 300);
    // otra opción: jugadores distintos
    const a1 = (await leerCard()).patas.map((x) => x.j);
    await q.click('#armar-res [data-propia="otra"]'); await esperar(q, 300);
    const r2 = await leerCard();
    if (r2) { assert.ok(r2.patas.every((x) => !a1.includes(x.j)), 'otra opción repite jugadores'); assert.ok(r2.cuota >= 3); assert.match(await q.textContent('#armar-res .comb-tipo'), /opción 2/); }
    else assert.match(await q.textContent('#armar-res'), /No hay otra opción/);
    // cargar en mi combinada y después «evitar jugadores que ya están»
    await q.click('#armar .armar-btn'); await esperar(q, 300);
    const cargada = (await leerCard()).patas.map((x) => x.j);
    await q.click('#armar-res [data-propia="cargar"]'); await esperar(q, 200);
    let s = await st(q);
    assert.strictEqual(s.hash, '#/combinada'); assert.strictEqual(s.patas, 3);
    await q.goBack(); await esperar(q);
    await q.check('#a-evitar'); await q.click('#armar .armar-btn'); await esperar(q, 300);
    const r3 = await leerCard();
    if (r3) assert.ok(r3.patas.every((x) => !cargada.includes(x.j)), 'evita los de la combinada');
    await q.uncheck('#a-evitar');
    // imposibles
    await q.fill('#a-cuota', 'abc'); await q.click('#armar .armar-btn'); await esperar(q);
    assert.match(await q.textContent('#armar-res'), /Escribí una cuota objetivo válida/);
    assert.strictEqual(await q.getAttribute('#a-cuota', 'aria-invalid'), 'true');
    await q.fill('#a-cuota', '3'); await q.selectOption('#a-n', '10'); await q.selectOption('#a-porjuego', '1'); await q.click('#armar .armar-btn'); await esperar(q);
    assert.match(await q.textContent('#armar-res .armar-msg'), new RegExp('No hay suficientes líneas que cumplan .*alcanzan para \\d+ de 10 patas. Probá bajar la probabilidad mínima'));
    await esperar(q, 800); await captura(q, 'm-armar-imposible');
    await q.selectOption('#a-n', '2'); await q.fill('#a-cuota', '900'); await q.click('#armar .armar-btn'); await esperar(q);
    assert.match(await q.textContent('#armar-res .armar-msg'), /la cuota más alta posible es ≈ [\d,.]+: no llega a 900,00\. Probá bajar la cuota objetivo/);
    await q.click('#a-colores [data-v="verde"]'); await q.click('#a-colores [data-v="amarillo"]'); await q.click('#armar .armar-btn'); await esperar(q);
    assert.match(await q.textContent('#armar-res'), /Elegí al menos un color/);
    await sinScrollHorizontal(q, 'Armá tu combinada');
    await q.evaluate(() => localStorage.clear());
    await q.close();
  });

  await paso('móvil: Contexto en la escalera (splits de la temporada para la línea mostrada, filas de hoy resaltadas)', async () => {
    // preferir un jugador cuyo partido tenga riesgo alto de paliza o back-to-back (más filas «hoy»)
    const conTg = GRUPOS.filter((g) => ['pts', 'reb', 'ast'].includes(g.m) && Array.isArray(g.tg) && g.tg.length >= 5 && g.pasos.length > 1);
    const pDe = (g) => DATOS.partidos.find((x) => x.gid === g.gid);
    const g = conTg.find((x) => (pDe(x).p_blowout || 0) >= 0.45) || conTg.find((x) => ((pDe(x).descanso || {})[x.eq] || {}).b2b) || conTg[0];
    const s = U.recPaso(g), sp = U.splits(g.tg, s.L), hoy = U.contextoHoy(g, pDe(g));
    const q = await nuevaPagina(movil, errores, 'móvil-contexto');
    await ir(q, '#/lineas');
    await q.selectOption('#f-prob', 'rec'); await q.click('#f-color [data-c="rojo"]');
    await q.fill('#f-q', g.j); await esperar(q, 300);
    const sel = `#lineas .linea[data-k="${gkey(g)}"]`;
    await q.click(`${sel} [data-desplegar]`); await esperar(q);
    await q.waitForSelector(`${sel} .contexto`);
    assert.match(await q.textContent(`${sel} .ctx-tit`), new RegExp('línea ' + U.fL(s.L).replace('.', '\\.')));
    const filas = await q.$$eval(`${sel} .contexto tbody tr`, (tr) => tr.map((x) => ({ cls: x.className, n: +x.querySelector('.ctx-n').textContent, sup: x.lastElementChild.textContent, txt: x.textContent })));
    assert.strictEqual(filas.length, 7);
    sp.filas.forEach((f, i) => {
      assert.strictEqual(filas[i].n, f.n, f.id);
      assert.strictEqual(filas[i].sup, f.n ? U.fP(f.sup) + ' ' + f.k + '/' + f.n : '—', f.id);
      assert.strictEqual(/\bhoy\b/.test(filas[i].cls), !!hoy[f.id], 'hoy ' + f.id);
      assert.strictEqual(/\bchica\b/.test(filas[i].cls), f.n < 5, 'chica ' + f.id);
      if (f.n < 5) assert.match(filas[i].txt, /muestra chica/);
    });
    assert.ok(filas.filter((f) => /\bhoy\b/.test(f.cls)).length >= 1, 'al menos local/visitante');
    assert.match(await q.textContent(`${sel} .contexto .nota`), /contexto, no una predicción/);
    await sinScrollHorizontal(q, 'Contexto');
    await q.locator(`${sel} .contexto`).scrollIntoViewIfNeeded(); await captura(q, 'm-contexto');
    await q.close();
  });

  // ====================================================================== ESCRITORIO 1360×900
  const escritorio = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'es-AR' });
  await escritorio.route(ESPN, (r) => r.fulfill({ json: espnEstado('pre') }));
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

  await paso('escritorio: pestaña «Más» arriba, Resultados (fixture), Mis apuestas y Armá tu combinada', async () => {
    await rutasResultados(e);
    await e.evaluate(() => localStorage.clear());
    await ir(e, '#/sugeridas');
    assert.strictEqual(await e.isVisible('#nav-secciones a[data-vista="mas"]'), true);
    await e.click('#armar .armar-btn'); await esperar(e, 300);
    assert.ok(await e.locator('#armar-res .comb').count() === 1 || /Probá/.test(await e.textContent('#armar-res')));
    await captura(e, 'd-armar');
    await e.click('#nav-secciones a[data-vista="mas"]'); await esperar(e);
    assert.deepStrictEqual((await st(e)).visibles, ['mas']); await captura(e, 'd-mas');
    await e.click('#vista-mas a[href="#/resultados"]');
    await e.waitForSelector('#r-dia-cuerpo .res-comb');
    assert.strictEqual(await e.getAttribute('#nav-secciones a[data-vista="mas"]', 'aria-current'), 'true');
    assert.strictEqual((await st(e)).ticketVisible, true);
    await captura(e, 'd-resultados');
    await e.evaluate(() => document.querySelector('#h-res-dia').scrollIntoView()); await captura(e, 'd-resultados-dia');
    await e.evaluate(([k, v]) => localStorage.setItem(k, v), [CL_APUESTAS, JSON.stringify(FX('apuestas.json').apuestas)]);
    await ir(e, '#/apuestas');
    await e.waitForFunction(() => /Ganada/.test((document.querySelector('#apuestas .apu[data-id="fx-ganada"] .estado-apu') || {}).textContent || ''));
    assert.strictEqual(await e.locator('#apuestas .apu').count(), 5);
    await captura(e, 'd-apuestas');
    await e.evaluate(() => localStorage.clear());
  });

  await paso('escritorio: en vivo y registrar apuesta en la columna; contexto en la escalera', async () => {
    const d = clon();
    const g1 = GRUPOS.find((g) => ['pts', 'reb', 'ast'].includes(g.m) && g.pasos.length > 1 && g.tg && g.tg.length);
    const P = d.partidos.find((x) => x.gid === g1.gid); P.estado = 2;
    const g2 = GRUPOS.find((g) => g.gid === P.gid && g.eq !== g1.eq);
    const fx = espnEstado('in');
    const idCasa = fx.header.competitions[0].competitors.find((c) => c.homeAway === 'home').team.id;
    const [casa, visita] = g1.eq === P.local ? [g1, g2] : [g2, g1];
    fx.boxscore.players.forEach((t) => { t.statistics[0].athletes[0].athlete.displayName = t.team.id === idCasa ? casa.j : visita.j; });
    const q = await nuevaPagina(escritorio, errores, 'escritorio-vivo');
    await q.route('**/data/hoy.json', (r) => r.fulfill({ json: d }));
    await q.route(ESPN, (r) => r.fulfill({ json: fx }));
    await q.goto(BASE + 'data/hoy.json');
    await q.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [CL_TICKET, JSON.stringify({ fecha: DATOS.fecha, legs: patasDeTicket([[g1, g1.pasos[0]], [g2, g2.pasos[0]]]), stake: 1000 })]);
    await ir(q, '#/lineas');
    await q.waitForSelector('#vivo:not([hidden]) .vivo-pata');
    assert.strictEqual(await q.locator('#vivo .vivo-pata').count(), 2, 'en escritorio la columna está siempre a la vista');
    await q.click('#t-registrar'); await esperar(q);
    await captura(q, 'd-vivo-registrar');
    await q.click('#registrar [data-reg-cancelar]');
    await q.selectOption('#f-prob', 'rec'); await q.click('#f-color [data-c="rojo"]');
    await q.fill('#f-q', g1.j); await esperar(q, 300);
    await q.click(`#lineas .linea[data-k="${gkey(g1)}"] [data-desplegar]`); await esperar(q);
    await q.waitForSelector('#lineas .contexto');
    await q.locator('#lineas .contexto').scrollIntoViewIfNeeded(); await captura(q, 'd-contexto');
    await q.evaluate(() => localStorage.clear());
    await q.close();
  });
  await e.close();

  await paso('sin errores de consola en todo el recorrido', async () => { assert.deepStrictEqual(errores, []); });
  await browser.close();
  console.log(`\n${ok} pasos ok, ${fallas.length} con fallas`);
  if (fallas.length) { console.log(fallas.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
