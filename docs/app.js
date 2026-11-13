/* NBA Semáforo — interfaz. Lee data/hoy.json (generado por scripts/actualizar.py).
   Cada «grupo» es un jugador + mercado con todas sus líneas «más de» (escalera).
   El primer bloque (NbaUtil) son funciones puras: formato es-AR, lectura de números con coma, etiquetas y
   reconstrucción de patas. Se prueban en Node (tests/app.test.js); el segundo bloque es la interfaz. */
var NbaUtil = (function () {
  'use strict';
  var nfLinea = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  var nfCuota = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfP1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nfMonto = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, useGrouping: false });
  var esNum = function (x) { return x != null && x !== '' && isFinite(+x); };
  var fL = function (x) { return esNum(x) ? nfLinea.format(+x) : '—'; };
  var fC = function (x) { return esNum(x) ? nfCuota.format(+x) : '—'; };
  /* Porcentaje es-AR: «71%», y con un decimal por debajo de 10 % («8,3%»). */
  var fP = function (p) {
    if (!esNum(p)) return '—';
    p = +p; if (p === 0) return '0%';
    return (p < 0.1 ? nfP1.format(p * 100) : Math.round(p * 100)) + '%';
  };
  var fMonto = function (x) { return esNum(x) ? nfMonto.format(+x) : ''; };
  /* Moneyline: solo números (el dato viene de una API no oficial y va a innerHTML). */
  var fmtML = function (x) {
    if (!esNum(x)) return '—';
    x = Math.round(+x); return x > 0 ? '+' + x : x < 0 ? '−' + Math.abs(x) : '0';
  };

  /* Lee un número escrito a mano: «1,85», «1.85», «1500,5», «1.500,50». Con miles=true, «1.500» es mil quinientos.
     Devuelve NaN si no es un número. */
  function leerDecimal(txt, miles) {
    var s = String(txt == null ? '' : txt).trim().replace(/[\s  $@]/g, '');
    if (!s || !/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return NaN;
    var c = s.lastIndexOf(','), p = s.lastIndexOf('.');
    if (c >= 0 && p >= 0) {                                   // los dos: el último es el decimal
      var dec = c > p ? ',' : '.', mil = dec === ',' ? '.' : ',';
      var partes = s.split(dec); if (partes.length > 2) return NaN;
      if (!/^\d{1,3}([.,]\d{3})*$/.test(partes[0])) return NaN;
      s = partes[0].split(mil).join('') + '.' + partes[1];
    } else if (c >= 0) {
      if (s.split(',').length > 2) { if (miles && /^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); else return NaN; }
      else s = s.replace(',', '.');
    } else if (p >= 0) {
      if (miles && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else if (s.split('.').length > 2) return NaN;
    }
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }
  /* Cuota válida (1 < cuota < 1000) o null. */
  var leerCuota = function (txt) { var v = leerDecimal(txt, false); return v > 1 && v < 1000 ? Math.round(v * 1000) / 1000 : null; };
  /* Apuesta (≥ 0, dos decimales). */
  var leerMonto = function (txt) { var v = leerDecimal(txt, true); return v >= 0 ? Math.round(v * 100) / 100 : 0; };

  // ----------------------------------------------------------------- etiquetas (flags) cortas, sin duplicados, graves primero
  var CORTO = [
    [/^riesgo de blowout alto.*/, 'Blowout alto'],
    [/^riesgo de blowout medio.*/, 'Blowout medio'],
    [/^el modelo lo ve mucho más probable que la casa \((\d+%) vs (\d+%)\).*/, 'Modelo $1 vs casa $2'],
    [/^minutos inestables \((\d+) de (\d+).*/, 'Minutos inestables ($1/$2)'],
    [/^minutos justos \((.*)\)$/, 'Minutos justos ($1)'],
    [/^pocos minutos \((.*)\)$/, 'Pocos minutos ($1)'],
    [/^muestra chica \((\d+) partidos\)$/, 'Muestra chica ($1 PJ)'],
    [/^el sitio lo marca "no sugerir"$/, 'Sitio: no sugerir'],
    [/^cruce (\w+): el rival defiende bien.*/, 'Rival defiende bien ($1)'],
    [/^cruce (\w+): el rival defiende mal.*/, 'Rival defiende mal ($1)'],
    [/^modelo básico.*/, 'Modelo básico'],
    [/^sin cuota en Betano.*/, 'Sin cuota Betano'],
    [/^lesión: (.*)$/, '$1'],
    [/^back-to-back$/, 'Back-to-back'],
    [/^historial en contra$/, 'Historial en contra'],
    [/^los modelos discrepan$/, 'Modelos discrepan']
  ];
  var decimalAR = function (t) { return String(t).replace(/(\d)\.(\d)/g, '$1,$2'); };
  var corto = function (f) {
    for (var i = 0; i < CORTO.length; i++) if (CORTO[i][0].test(f)) return decimalAR(f.replace(CORTO[i][0], CORTO[i][1]));
    return decimalAR(f.charAt(0).toUpperCase() + f.slice(1));
  };
  var GRAVE = /blowout alto|back-to-back|pocos minutos|no sugerir|mucho más probable|^lesión: (?!Probable)/;
  /* g.est + banderas del grupo + banderas de la línea → [{txt, full, nivel: 'alerta'|'medio'}], graves primero, sin repetir. */
  function etiquetas(g, s) {
    var graves = [], leves = [], vistos = {};
    var poner = function (full, grave) {
      var txt = corto(full); if (vistos[txt]) return; vistos[txt] = 1;
      (grave ? graves : leves).push({ txt: txt, full: decimalAR(full), nivel: grave ? 'alerta' : 'medio' });
    };
    if (g.est) poner('lesión: ' + g.est, g.est !== 'Probable');          // «Questionable» y «lesión: Questionable» quedan en una sola
    (g.fl || []).concat((s && s.fl) || []).forEach(function (f) { if (typeof f === 'string') poner(f, GRAVE.test(f)); });
    return graves.concat(leves);
  }

  // ----------------------------------------------------------------- patas de la combinada
  var gkey = function (g) { return g.id + '|' + g.m + '|' + (g.per || ''); };
  var cuotaDe = function (s) { return s && s.cu != null ? s.cu : null; };
  function nuevaPata(g, s, lado) {
    var k = gkey(g);
    if (lado === 'menos') {
      var m = g.menos || {};
      return { key: k + '|' + g.L + '|menos', gkey: k, id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: g.L, lado: 'menos',
        cuota: m.cu || null, cuotaOrig: m.cu || null, fuente: m.cu ? 'Betano' : null, p: m.p, c: m.c || 'rojo', ju: m.ju, est: g.est, fl: (g.fl || []).slice() };
    }
    var cu = cuotaDe(s);
    return { key: k + '|' + s.L + '|mas', gkey: k, id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: s.L, lado: 'mas',
      cuota: cu, cuotaOrig: cu, fuente: 'Betano', p: s.p, c: s.c, ju: s.ju, est: g.est, fl: (g.fl || []).concat(s.fl || []) };
  }
  /* Vuelve a armar una pata guardada con los datos de hoy (misma jugador, mercado, línea y lado).
     Conserva la cuota si el usuario la editó a mano. Devuelve null si la línea ya no existe o la pata es ilegible. */
  function refrescarPata(l, porClave) {
    if (!l || typeof l !== 'object' || typeof l.gkey !== 'string' || !esNum(l.L)) return null;
    var g = porClave.get(l.gkey); if (!g) return null;
    var n;
    if (l.lado === 'menos') { if (!g.menos || g.menos.L !== +l.L || g.L !== +l.L) return null; n = nuevaPata(g, null, 'menos'); }
    else if (l.lado === 'mas') {
      var s = (g.pasos || []).find(function (x) { return x.L === +l.L; }); if (!s) return null;
      n = nuevaPata(g, s, 'mas');
    } else return null;
    if (esNum(l.cuota) && +l.cuota > 1 && +l.cuota !== l.cuotaOrig) n.cuota = +l.cuota;   // cuota editada a mano: se respeta
    return n;
  }
  /* Línea recomendada por el semáforo (g.rec) o, si no está, la de mejor color y más alta. */
  var RANGO = { verde: 2, amarillo: 1, rojo: 0 };
  function recPaso(g) {
    var p = g.pasos || []; if (!p.length) return null;
    var r = p.find(function (s) { return s.L === g.rec; }); if (r) return r;
    var mejor = Math.max.apply(null, p.map(function (s) { return RANGO[s.c] || 0; }));
    return p.filter(function (s) { return (RANGO[s.c] || 0) === mejor; }).reduce(function (a, b) { return b.L > a.L ? b : a; });
  }

  return { fL: fL, fC: fC, fP: fP, fMonto: fMonto, fmtML: fmtML, leerDecimal: leerDecimal, leerCuota: leerCuota, leerMonto: leerMonto,
    corto: corto, etiquetas: etiquetas, gkey: gkey, cuotaDe: cuotaDe, nuevaPata: nuevaPata, refrescarPata: refrescarPata, recPaso: recPaso, RANGO: RANGO };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NbaUtil;

(function (U) {
  'use strict';
  if (typeof document === 'undefined') return;                     // en Node solo se usan las funciones puras
  var $ = function (s, r) { return (r || document).querySelector(s); };
  // Si falta un elemento (por ejemplo, HTML de otra versión en caché) no se rompe la página.
  var NULO = { set innerHTML(v) {}, set textContent(v) {}, set hidden(v) {}, set value(v) {}, set open(v) {}, addEventListener: function () {}, setAttribute: function () {},
    removeAttribute: function () {}, querySelector: function () { return null; }, scrollIntoView: function () {}, focus: function () {},
    classList: { toggle: function () {}, contains: function () { return false; }, add: function () {}, remove: function () {} } };
  var $$ = function (s) { return $(s) || NULO; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fL = U.fL, fC = U.fC, fP = U.fP, gkey = U.gkey, cuotaDe = U.cuotaDe, RANGO = U.RANGO;
  var nfDin = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var COLORES = ['verde', 'amarillo', 'rojo'];
  var color = function (c) { return COLORES.indexOf(c) >= 0 ? c : 'rojo'; };
  var LADO = { mas: 'Más de', menos: 'Menos de' };
  var CLAVE_TICKET = 'nba_semaforo_ticket_v2', CLAVE_GUARDADAS = 'nba_semaforo_guardadas_v2';
  var PAGINA = 40;
  var GRUPOS = { pts: ['pts'], reb: ['reb'], ast: ['ast'], combos: ['pra', 'pr', 'pa', 'ra'] };
  var PRINCIPALES = ['pts', 'reb', 'ast', 'pra', 'pr', 'pa', 'ra'];
  var MERCADOS_FUERA = ['oreb', 'dreb'];          // Betano no los ofrece: no se listan aunque un hoy.json viejo los traiga
  var ESTADO = { 2: 'En juego', 3: 'Final' };

  var S = {
    data: null, grupos: [], porClave: new Map(), empezado: new Map(), partido: '', grupo: 'todos', colores: new Set(['verde', 'amarillo']),
    minP: 0.70, q: '', mercado: '', orden: 'cuota', soloCompleto: false, menos: false,
    mostrar: PAGINA, ticket: [], guardadas: [], stake: 1000, lista: [], pos: new Map(), pintadas: new Set(), abiertos: new Set(), notaTicket: '',
    // secciones: vista visible, última vista principal (no «combinada»), scroll por vista y qué falta pintar
    vista: '', ultimaPrincipal: 'partidos', scroll: {}, sucio: { filtro: true }, hecho: {}
  };

  // ----------------------------------------------------------------- almacenamiento (puede fallar: modo privado, datos corruptos)
  function leer(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ } }
  var lista = function (x) { return Array.isArray(x) ? x : []; };
  var guardarTicket = function () { guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake }); };

  // ----------------------------------------------------------------- utilidades
  function hora(utc) {
    try { return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(utc)); }
    catch (e) { return ''; }
  }
  function hace(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(m)) return '';
    if (m < 1) return 'recién'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60); return h < 24 ? 'hace ' + h + ' h' : 'hace ' + Math.floor(h / 24) + ' d';
  }
  var diaMes = function (f) { return String(f || '').split('-').reverse().slice(0, 2).join('/'); };
  var LECTURA = { pts: 'puntos', reb: 'rebotes', ast: 'asistencias', pra: 'pts + reb + asist', pr: 'pts + rebotes', pa: 'pts + asistencias',
    ra: 'reb + asistencias', fg3m: 'triples', stl: 'robos', blk: 'tapas' };
  var lectura = function (x) { return LECTURA[x.m] || String(x.mn || '').toLowerCase(); };
  var estadoDe = function (gid) { return S.empezado.get(gid) || 0; };
  var badgeEstado = function (e) { return e ? '<span class="estado-badge ' + (e === 3 ? 'final' : 'vivo') + '">' + (ESTADO[e] || 'Empezado') + '</span>' : ''; };
  var descPata = function (l) { return String(l.j || 'Pata') + ' ' + (LADO[l.lado] || 'más de').toLowerCase() + ' ' + fL(l.L) + ' ' + lectura(l); };
  var despues = function (f) { requestAnimationFrame(function () { setTimeout(f, 0); }); };

  // ----------------------------------------------------------------- carga
  function cargar() {
    enrutar({ inicial: true });              // muestra la sección del hash (vacía) mientras llegan los datos
    window.addEventListener('hashchange', function () { enrutar(); });
    var p = window.__hoy || fetch('data/hoy.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    p.then(function (d) {
      try { iniciar(d); }
      catch (e) {                            // un error al dibujar no es un error de red: decirlo distinto
        if (window.console) console.error(e);
        $$('#info-actualizado').textContent = 'Error';
        var a = $$('#aviso'); a.hidden = false;
        a.textContent = 'Los datos llegaron pero no pude mostrarlos (' + e.message + '). Probá recargar la página.';
      }
    }, function (e) {
      $$('#info-actualizado').textContent = 'Sin datos';
      var a = $$('#aviso'); a.hidden = false;
      a.textContent = 'No pude cargar data/hoy.json (' + e.message + '). Si abriste el archivo con doble clic, servilo con: python3 -m http.server -d docs';
    });
  }

  function iniciar(d) {
    if (!d || !Array.isArray(d.grupos) || !Array.isArray(d.partidos)) throw new Error('formato de datos inesperado');
    S.data = d;
    S.grupos = d.grupos.filter(function (g) { return g && Array.isArray(g.pasos) && g.pasos.length && MERCADOS_FUERA.indexOf(g.m) < 0; });
    S.grupos.forEach(function (g) { g._q = norm(g.j + ' ' + g.eq + ' ' + g.riv); });   // texto de búsqueda, una sola vez
    S.porClave = new Map(S.grupos.map(function (g) { return [gkey(g), g]; }));
    S.empezado = new Map();
    d.partidos.forEach(function (p) { var e = +p.estado; if (e && e !== 1) S.empezado.set(p.gid, e); });
    leerControles();

    S.guardadas = lista(leer(CLAVE_GUARDADAS, [])).filter(function (x) { return x && typeof x === 'object' && Array.isArray(x.legs); });
    var t = leer(CLAVE_TICKET, null);
    if (t && typeof t === 'object') {
      if (typeof t.stake === 'number' && isFinite(t.stake) && t.stake >= 0) S.stake = t.stake;
      if (t.fecha === d.fecha) {
        var r = reconstruir(lista(t.legs));
        S.ticket = r.legs;
        if (r.quitadas.length || r.cambiadas) {
          var txt = 'Actualicé tu combinada con los datos nuevos' + resumenCambios(r) + '.';
          S.notaTicket = txt; avisoGlobal(txt);
          guardarTicket();
        }
      }
    }
    cabecera(); partidos(); selectorPartidos(); selectorMercados();
    enlazar(); pintarTicket(); pintarGuardadas();
    if (!esMovil()) $$('#mas-filtros').open = true;
    enrutar({ inicial: true });              // pinta solo la sección visible (Líneas, Sugeridas y Método se pintan al entrar)
    // Las sugeridas no hacen falta para el primer pintado: se calculan en una tarea aparte, después del frame.
    despues(function () { prepararSugeridas(); });
  }

  /* Bug de «Atrás» desde otra página: el navegador restaura los controles pero S arranca con los valores por defecto. */
  function leerControles() {
    var fp = $('#f-prob'); if (fp) S.minP = fp.value === 'rec' ? 'rec' : (parseFloat(fp.value) || 0.7);
    var fc = $('#f-completo'); if (fc) S.soloCompleto = fc.checked;
    var fm = $('#f-menos'); if (fm) S.menos = fm.checked;
    var fo = $('#f-orden'); if (fo && fo.value) S.orden = fo.value;
    var fq = $('#f-q'); if (fq) S.q = fq.value;
  }

  function cabecera() {
    var d = S.data, f = String(d.fecha).split('-').reverse().join('/');
    var info = 'Datos del ' + f + ' · actualizado ' + hace(d.generado_en) +
      (d.reporte_lesiones ? ' · reporte de lesiones ' + String(d.reporte_lesiones).slice(11) + ' ET' : '');
    $$('#info-actualizado').textContent = info;
    $$('#info-hoy').textContent = info;      // en celulares .barra-info está oculta: se repite arriba de Partidos
    var avisos = lista(d.avisos).slice();
    var hoyET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    if (d.fecha !== hoyET) avisos.unshift('Estos datos son del ' + f + ', no de hoy. Corré el script o esperá la próxima actualización.');
    else if ((Date.now() - new Date(d.generado_en).getTime()) > 6 * 3600e3) avisos.unshift('Los datos tienen más de 6 horas: las lesiones pudieron cambiar. Verificá el reporte antes de apostar.');
    var a = $$('#aviso');
    if (avisos.length) { a.hidden = false; a.textContent = avisos.join(' · '); }
  }

  // ----------------------------------------------------------------- partidos
  function partidos() {
    var d = S.data, cont = $$('#partidos');
    if (!d.partidos.length) { cont.innerHTML = '<div class="vacio">Hoy no hay partidos.</div>'; return; }
    cont.innerHTML = d.partidos.map(function (p) {
      var desc = p.descanso || {}, tags = [], est = estadoDe(p.gid), sp = p.spread == null || !isFinite(+p.spread) ? null : +p.spread;
      if (sp != null) tags.push('<span class="tag">' + (sp === 0 ? 'Pick\'em' : p.fav ? esc(p.fav) + ' −' + fL(Math.abs(sp)) : 'Spread ' + fL(Math.abs(sp))) + '</span>');
      else tags.push('<span class="tag medio">Sin spread</span>');
      if (p.total != null) tags.push('<span class="tag">O/U ' + fL(p.total) + '</span>');
      if (p.ml && p.ml[p.visita] != null) tags.push('<span class="tag" title="Moneyline">ML ' + esc(p.visita) + ' ' + U.fmtML(p.ml[p.visita]) + ' · ' + esc(p.local) + ' ' + U.fmtML(p.ml[p.local]) + '</span>');
      [p.visita, p.local].forEach(function (t) {
        var x = desc[t] || {};
        if (x.b2b) tags.push('<span class="tag alerta" title="Jugó ayer">' + esc(t) + ' back-to-back</span>');
        else if (x.tres_en_cuatro) tags.push('<span class="tag medio" title="3er partido en 4 días">' + esc(t) + ' 3 en 4</span>');
      });
      var pb = p.p_blowout == null || !isFinite(+p.p_blowout) ? null : +p.p_blowout, nivel = pb == null ? '' : pb >= .45 ? 'alerta' : pb >= .38 ? 'medio' : 'ok';
      var pct = pb == null ? 0 : Math.max(0, Math.min(100, Math.round(pb * 100)));
      // zonas fijas (verde < 38 %, amarillo 38–45 %, rojo ≥ 45 %): el final del relleno tiene el color del nivel
      var med = pb == null ? '' : '<div class="blowout"><div class="medidor" aria-hidden="true"><i style="width:' + (100 - pct) + '%"></i></div>' +
        '<span class="tag ' + nivel + '" title="Probabilidad de que el margen final supere 14 puntos (titulares al banco)">Riesgo de blowout ' + pct + '%</span></div>';
      var rec1 = p.records && p.records[p.visita] ? ' <small>(' + esc(p.records[p.visita]) + ')</small>' : '';
      var rec2 = p.records && p.records[p.local] ? ' <small>(' + esc(p.records[p.local]) + ')</small>' : '';
      return '<div class="partido' + (p.gid === S.partido ? ' sel' : '') + (est ? ' empezado' : '') + '" data-gid="' + esc(p.gid) + '">' +
        '<div class="p-cab"><span>' + badgeEstado(est) + esc(hora(p.utc)) + ' ART · ' + esc(p.estado_texto) + '</span><span class="p-prov">' + (p.proveedor ? 'spread: ' + esc(p.proveedor) : '') + '</span></div>' +
        '<a class="p-sel" href="#/lineas?partido=' + esc(encodeURIComponent(p.gid)) + '"><span class="p-equipos">' + esc(p.visita) + rec1 + ' <small>@</small> ' + esc(p.local) + rec2 + '</span>' +
          '<span class="p-ver">Ver líneas <span aria-hidden="true">›</span></span></a>' +
        '<div class="p-datos">' + tags.join('') + '</div>' + med + lesiones(p) + '</div>';
    }).join('');
  }
  function lesiones(p) {
    var partes = [], n = 0;
    Object.keys(p.lesiones || {}).forEach(function (t) {
      var l = lista(p.lesiones[t]);
      var out = l.filter(function (i) { return /out|susp/i.test(i.estado || ''); }).map(function (i) { return i.jugador; });
      var dtd = l.filter(function (i) { return /day|quest|doubt/i.test(i.estado || ''); }).map(function (i) { return i.jugador; });
      if (!out.length && !dtd.length) return;
      n += out.length + dtd.length;
      partes.push('<div><b>' + esc(t) + '</b>' + (out.length ? ' · fuera: ' + esc(out.join(', ')) : '') + (dtd.length ? ' · dudosos: ' + esc(dtd.join(', ')) : '') + '</div>');
    });
    if (!n) return '<div class="p-les">Sin lesionados reportados.</div>';
    return '<details class="p-les"><summary>Lesiones (' + n + ')</summary>' + partes.join('') + '<div class="p-fuente">Fuente: ESPN. El estado oficial de la NBA se ve en la etiqueta de cada línea.</div></details>';
  }

  // ----------------------------------------------------------------- selección de la línea que se muestra
  /* Devuelve la línea «más de» a mostrar para el grupo, o null si no hay ninguna que cumpla. */
  function elegirPaso(g) {
    if (S.minP === 'rec') { var r = U.recPaso(g); return r && S.colores.has(r.c) ? r : null; }   // la recomendada, solo si su color está activo
    var ok = g.pasos.filter(function (s) { return S.colores.has(s.c) && s.p >= S.minP; });
    return ok.length ? ok.reduce(function (a, b) { return b.L > a.L ? b : a; }) : null;
  }

  function grupoPasa(g, q) {
    if (S.partido && g.gid !== S.partido) return false;
    if (S.mercado && g.m !== S.mercado) return false;
    if (S.grupo !== 'todos') {
      if (S.grupo === 'otros') { if (PRINCIPALES.indexOf(g.m) >= 0 && !g.per) return false; }
      else if (GRUPOS[S.grupo].indexOf(g.m) < 0 || g.per) return false;
    }
    if (S.soloCompleto && g.mod !== 'completo') return false;
    if (q && g._q.indexOf(q) < 0) return false;
    return true;
  }

  function selectorPartidos() {
    $$('#f-partido').innerHTML = '<option value="">Todos los partidos</option>' + S.data.partidos.map(function (p) {
      var e = estadoDe(p.gid);
      return '<option value="' + esc(p.gid) + '">' + esc(p.visita + ' @ ' + p.local + ' · ' + hora(p.utc) + (e ? ' · ' + (ESTADO[e] || 'Empezado') : '')) + '</option>';
    }).join('');
    $$('#f-partido').value = S.partido;
  }

  function selectorMercados() {
    var m = new Map();
    S.grupos.forEach(function (g) { m.set(g.m, g.mn); });
    var arr = Array.from(m.entries()).sort(function (a, b) { return String(a[1]).localeCompare(String(b[1]), 'es'); });
    $$('#f-mercado').innerHTML = '<option value="">Cualquier mercado</option>' + arr.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'; }).join('');
    $$('#f-mercado').value = S.mercado;
  }

  function aplicarFiltros() {
    var q = norm(S.q), cuentas = { verde: 0, amarillo: 0, rojo: 0 }, res = [];
    S.grupos.forEach(function (g) {
      if (!grupoPasa(g, q)) return;
      if (S.minP === 'rec') { var r = U.recPaso(g); if (r && cuentas[r.c] != null) cuentas[r.c]++; }   // cada grupo cuenta una vez, por el color de su recomendada
      else COLORES.forEach(function (c) {    // grupos con alguna línea de ese color que cumpla la probabilidad mínima
        if (g.pasos.some(function (s) { return s.c === c && s.p >= S.minP; })) cuentas[c]++;
      });
      var s = elegirPaso(g);
      if (s) res.push({ g: g, s: s });
    });
    COLORES.forEach(function (c) { $$('#n-' + c).textContent = cuentas[c]; });
    var key = {
      cuota: function (x) { return cuotaDe(x.s) != null ? cuotaDe(x.s) : x.s.ju; },
      p: function (x) { return x.s.p; },
      sem: function (x) { return RANGO[x.s.c] * 10 + x.s.p; },
      ev: function (x) { return cuotaDe(x.s) == null ? -9 : x.s.p * cuotaDe(x.s) - 1; },
      min: function (x) { return x.g.min; }
    }[S.orden] || function (x) { return x.s.p; };
    res.sort(function (a, b) { return key(b) - key(a); });
    S.lista = res; S.mostrar = PAGINA;
    S.pos = new Map(res.map(function (x, i) { return [gkey(x.g), i]; }));
    S.sucio.filtro = false;
    pintarLista();
    marcarMasFiltros();
  }
  function marcarMasFiltros() {
    var n = (S.mercado ? 1 : 0) + (S.orden !== 'cuota' ? 1 : 0) + (S.soloCompleto ? 1 : 0) + (S.menos ? 1 : 0);
    $$('#mas-filtros-n').textContent = n ? '(' + n + (n === 1 ? ' activo)' : ' activos)') : '(orden, mercado exacto…)';
  }

  // ----------------------------------------------------------------- tarjetas
  /* Gráfico de los últimos 10 (más reciente a la derecha) con la línea punteada, como en LudoProps.
     Sin <title> por barra: el aria-label del SVG ya trae los valores (≈ 10 nodos menos por fila). */
  function barras(g, s) {
    var ult = lista(g.ult).filter(function (v) { return typeof v === 'number' && isFinite(v); }), W = 120, H = 40, n = ult.length || 1, paso = W / n, ancho = paso - 2;
    var mx = Math.max.apply(null, ult.concat([s.L * 1.6, 1]));
    var yL = H - s.L / mx * H;
    var rects = ult.map(function (v, i) {
      var h = Math.max(2, v / mx * H);
      return '<rect x="' + (i * paso + 1).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + ancho.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" class="' + (v > s.L ? 'ok' : 'no') + '"/>';
    }).join('');
    return '<svg class="mini" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Últimos ' + ult.length + ' partidos (el más reciente a la derecha): ' + esc(ult.map(fL).join('; ')) + '. Línea ' + fL(s.L) + '">' +
      rects + '<line x1="0" x2="' + W + '" y1="' + yL.toFixed(1) + '" y2="' + yL.toFixed(1) + '" class="raya"/></svg>';
  }
  function etiquetas(g, s) {
    return U.etiquetas(g, s).map(function (t) { return '<span class="tag ' + t.nivel + '"' + (t.full !== t.txt ? ' title="' + esc(t.full) + '"' : '') + '>' + esc(t.txt) + '</span>'; }).join('');
  }
  var legDe = function (g) { var k = gkey(g); return S.ticket.find(function (l) { return l.gkey === k; }); };
  var claseP = function (p) { return p == null ? '' : p >= 0.6 ? 'p-alta' : p >= 0.5 ? 'p-media' : 'p-baja'; };
  var celda = function (cls, corto, largo, valor) {
    return '<div class="col-num ' + cls + '"><span class="col-lab"><span aria-hidden="true">' + corto + '</span><span class="sr-only">' + largo + ' </span></span><b>' + valor + '</b></div>';
  };

  function botonMas(L, activo, bloq, chico) {
    var etiqueta = activo ? (chico ? '✓' : '✓ En combinada') : bloq ? (chico ? '—' : 'Partido empezado') : (chico ? '+' : '+ Agregar');
    return '<button type="button" class="add' + (chico ? ' add-esc' : '') + (activo ? ' en-ticket' : '') + '" data-add="mas" data-l="' + L + '" aria-pressed="' + (activo ? 'true' : 'false') + '"' +
      (bloq ? ' disabled' : '') + (chico ? ' aria-label="' + (bloq ? 'Partido empezado: no se puede agregar' : 'Agregar más de ' + fL(L)) + '"' : '') + '>' + etiqueta + '</button>';
  }

  function escalera(g, sel) {
    var pasos = g.pasos.slice().sort(function (a, b) { return a.L - b.L; }), t = legDe(g), bloq = !!estadoDe(g.gid);
    var filas = pasos.map(function (s) {
      var activo = !!t && t.L === s.L && t.lado === 'mas';
      return '<tr class="paso c-' + color(s.c) + (s.L === sel.L ? ' sel' : '') + '">' +
        '<td><b>Más de ' + fL(s.L) + '</b><span class="sr-only"> · semáforo ' + color(s.c) + '</span>' + (s.L === g.L ? ' <small>principal</small>' : '') + '</td>' +
        '<td><span class="badge-cuota">' + fC(s.cu) + '</span></td>' +
        '<td class="' + claseP(s.p) + '"><b>' + fP(s.p) + '</b></td><td>' + fP(s.r10) + '</td><td>' + (s.rt != null ? fP(s.rt) : '—') + '</td>' +
        '<td title="1 / probabilidad: si tu casa paga más que esto, hay valor según el modelo">' + fC(s.ju) + '</td>' +
        '<td aria-hidden="true"><span class="punto-mini"></span></td>' +
        '<td>' + botonMas(s.L, activo, bloq && !activo, true) + '</td></tr>';
    }).join('');
    var menos = '';
    if (S.menos && g.menos) {
      var am = !!t && t.lado === 'menos', mc = color(g.menos.c);
      menos = '<tr class="paso c-' + mc + ' menos"><td><b>Menos de ' + fL(g.menos.L) + '</b><span class="sr-only"> · semáforo ' + mc + '</span></td><td><span class="badge-cuota">' + fC(g.menos.cu) + '</span></td><td class="' + claseP(g.menos.p) + '"><b>' + fP(g.menos.p) + '</b></td><td>—</td><td>—</td><td>' + fC(g.menos.ju) + '</td>' +
        '<td aria-hidden="true"><span class="punto-mini"></span></td><td><button type="button" class="add add-esc' + (am ? ' en-ticket' : '') + '" data-add="menos" data-l="' + g.L + '" aria-pressed="' + (am ? 'true' : 'false') + '"' + (bloq && !am ? ' disabled' : '') + ' aria-label="Agregar menos de ' + fL(g.L) + '">' + (am ? '✓' : bloq ? '—' : '+') + '</button></td></tr>';
    }
    var temp = g.temp && g.temp.length ? '<p class="nota">Partidos de la temporada (del más antiguo al más reciente): ' + esc(lista(g.temp).map(fL).join('; ')) + '</p>' : '';
    return '<div class="escalera"><table><thead><tr><th>Línea</th><th>Betano</th><th>Prob.</th><th>Últ. 10</th><th>Temp.</th><th>Justa</th><th><span class="sr-only">Semáforo</span></th><th><span class="sr-only">Agregar</span></th></tr></thead><tbody>' + filas + menos + '</tbody></table>' +
      '<p class="nota"><b>Justa</b> = cuota que haría el modelo (1 / probabilidad). Si tu casa (por ejemplo Stake) paga más que eso, hay valor según el modelo.</p>' + temp + '</div>';
  }

  function tarjeta(it) {
    var g = it.g, s = it.s, k = gkey(g), abierto = S.abiertos.has(k), t = legDe(g), est = estadoDe(g.gid), c = color(s.c);
    var activo = !!t && t.L === s.L && t.lado === 'mas', tags = etiquetas(g, s), varias = g.pasos.length > 1;
    return '<article class="linea c-' + c + (est ? ' empezado' : '') + '" data-k="' + esc(k) + '">' +
      '<div class="col-jug"><div class="jug-cab"><b class="nombre">' + esc(g.j) + '</b> <span class="mut">' + esc(g.eq) + (g.pos ? ', ' + esc(g.pos) : '') + '</span>' + badgeEstado(est) + '</div>' +
        '<div class="apuesta">Más de ' + fL(s.L) + ' ' + esc(lectura(g)) + (g.per ? ' (' + esc(g.per) + ')' : '') + '<span class="sr-only">. Semáforo ' + c + '.</span></div>' +
        '<div class="mut txt-chico">' + (g.loc ? 'vs ' : '@ ') + esc(g.riv) + ' · ' + Math.round(g.min || 0) + ' min' + (g.rol ? ', ' + esc(g.rol) : '') + '</div></div>' +
      '<div class="col-cuota"><span class="sr-only">Cuota Betano </span><span class="badge-cuota grande">' + fC(s.cu) + '</span><span class="mut txt-chico">justa ' + fC(s.ju) + '</span></div>' +
      '<div class="col-barras">' + barras(g, s) + '<span class="mut txt-chico">Temp ' + fL(g.pt) + ' · Últ. 10 ' + fL(g.p10) + ' · Proy ' + fL(g.mu) + '</span></div>' +
      '<div class="col-nums">' + celda('col-prob', 'Prob.', 'Probabilidad', fP(s.p)) + celda('col-r10', 'Últ. 10', 'Acierto en los últimos 10', fP(s.r10)) +
        celda('col-rt', 'Temp.', 'Acierto en la temporada', s.rt != null ? fP(s.rt) : '—') + '</div>' +
      (tags ? '<div class="col-flags">' + tags + '</div>' : '') +
      '<div class="col-acc">' + botonMas(s.L, activo, !!est && !activo, false) +
        (varias ? '<button type="button" class="desplegar" data-desplegar aria-expanded="' + (abierto ? 'true' : 'false') + '">' + (abierto ? 'Ocultar ▴' : g.pasos.length + ' líneas ▾') + '</button>' : '') + '</div>' +
      (abierto ? '<div class="l-escalera">' + escalera(g, s) + '</div>' : '') + '</article>';
  }

  function contador() {
    var l = S.lista, umbral = S.minP === 'rec' ? 'línea recomendada por el semáforo' : 'probabilidad ≥ ' + Math.round(S.minP * 100) + '%';
    $$('#contador').textContent = l.length + (l.length === 1 ? ' jugador · ' : ' jugadores · ') + umbral + (S.mostrar < l.length ? ' · mostrando ' + S.mostrar : '');
    $$('#ver-mas').hidden = S.mostrar >= l.length;
  }
  function pintarLista() {
    var cont = $$('#lineas'), vis = S.lista.slice(0, S.mostrar);
    cont.innerHTML = vis.length ? vis.map(tarjeta).join('') :
      '<div class="vacio">No hay líneas con estos filtros. Probá bajar la probabilidad mínima, activar el semáforo rojo o quitar filtros.</div>';
    S.pintadas = new Set(S.ticket.map(function (x) { return x.gkey; }));
    contador();
  }
  /* «Ver más»: agrega solo las filas nuevas al final, sin volver a armar las que ya están. */
  function agregarFilas(desde) {
    $$('#lineas').insertAdjacentHTML('beforeend', S.lista.slice(desde, S.mostrar).map(tarjeta).join(''));
    contador();
  }
  /* Vuelve a pintar solo las filas indicadas (por gkey), conservando el foco si estaba en una de ellas. */
  function repintarFilas(claves) {
    var cont = $('#lineas'); if (!cont) return;
    claves.forEach(function (k) {
      var i = S.pos.get(k); if (i == null || i >= S.mostrar) return;
      var el = cont.querySelector('.linea[data-k="' + CSS.escape(k) + '"]'); if (!el) return;
      var f = document.activeElement, sel = null;
      if (f && el.contains(f)) sel = f.hasAttribute('data-desplegar') ? '[data-desplegar]' : f.dataset.add ? '[data-add="' + f.dataset.add + '"][data-l="' + f.dataset.l + '"]' : null;
      var tmp = document.createElement('div'); tmp.innerHTML = tarjeta(S.lista[i]);
      var nuevo = tmp.firstChild; el.replaceWith(nuevo);
      if (sel) { var b = nuevo.querySelector(sel); if (b) b.focus({ preventScroll: true }); }
    });
  }

  // ----------------------------------------------------------------- ticket
  /* Rearma patas guardadas con los datos de hoy: {legs, quitadas:[texto], cambiadas: n}. */
  function reconstruir(legs) {
    var out = [], quitadas = [], cambiadas = 0, vistos = new Set();
    legs.forEach(function (l) {
      var n = U.refrescarPata(l, S.porClave);
      if (!n) { quitadas.push(l && typeof l === 'object' && l.j ? descPata(l) : 'una pata ilegible'); return; }
      if (vistos.has(n.gkey)) return;                                  // una pata por jugador y mercado
      vistos.add(n.gkey);
      if (l.c !== n.c || Math.round((+l.p || 0) * 100) !== Math.round(n.p * 100) || l.cuotaOrig !== n.cuotaOrig || l.gid !== n.gid) cambiadas++;
      out.push(n);
    });
    return { legs: out, quitadas: quitadas, cambiadas: cambiadas };
  }
  function resumenCambios(r) {
    var t = [];
    if (r.cambiadas) t.push(r.cambiadas + (r.cambiadas === 1 ? ' pata cambió' : ' patas cambiaron') + ' de probabilidad, color o cuota');
    if (r.quitadas.length) t.push('saqué ' + r.quitadas.join(', ') + ' (la línea ya no está publicada)');
    return t.length ? ': ' + t.join('; ') : '';
  }
  function avisoGlobal(txt) {
    $$('#aviso-ticket-txt').textContent = txt; $$('#aviso-ticket').hidden = false;
  }

  function alternar(g, L, lado) {
    var s = g.pasos.find(function (x) { return x.L === L; });
    if (lado === 'mas' && !s) return;
    var nueva = U.nuevaPata(g, s, lado), i = S.ticket.findIndex(function (l) { return l.gkey === nueva.gkey; }), quitada = false;
    if (i >= 0 && S.ticket[i].key === nueva.key) { S.ticket.splice(i, 1); quitada = true; }   // tocar de nuevo = quitar
    else if (estadoDe(g.gid)) { anunciar('El partido ya empezó: no se pueden sumar líneas nuevas.'); return; }
    else if (i >= 0) S.ticket[i] = nueva;                                  // otra línea del mismo jugador y mercado: reemplaza
    else S.ticket.push(nueva);
    S.notaTicket = '';
    cambioTicket();
    anunciar((quitada ? 'Quitada: ' : 'Agregada: ') + descPata(nueva) + '. Combinada: ' + S.ticket.length + (S.ticket.length === 1 ? ' pata.' : ' patas.'));
  }

  function cambioTicket() {
    guardarTicket();
    pintarTicket();
    // solo cambian las filas que estaban o están en la combinada (si Líneas no está pintada, no hay nada que tocar)
    var claves = new Set(S.pintadas);
    S.ticket.forEach(function (l) { claves.add(l.gkey); });
    S.pintadas = new Set(S.ticket.map(function (l) { return l.gkey; }));
    repintarFilas(claves);
  }

  function cuotaTotal() {
    var legs = S.ticket;
    return legs.length && legs.every(function (l) { return l.cuota && l.cuota > 1; }) ? legs.reduce(function (a, l) { return a * l.cuota; }, 1) : null;
  }
  function calcular() {
    var legs = S.ticket, patas = legs.map(function (l) { return { id: l.id, eq: l.eq, gid: l.gid, m: l.m, lado: l.lado, p: l.p }; });
    var cj = legs.length ? window.Correlacion.conjunta(patas) : { indep: 1, conj: 1, correlacionadas: 0 };
    var cuota = cuotaTotal();
    return { indep: cj.indep, conj: cj.conj, corr: cj.correlacionadas, cuota: cuota,
      impl: cuota ? 1 / cuota : null, ev: cuota ? cj.conj * cuota - 1 : null, justa: cj.conj > 0 ? 1 / cj.conj : null };
  }

  function veredicto(c) {
    var legs = S.ticket;
    if (!legs.length) return null;
    var col = legs.some(function (l) { return l.c === 'rojo'; }) ? 'rojo' : legs.some(function (l) { return l.c === 'amarillo'; }) ? 'amarillo' : 'verde', txt;
    if (c.conj < 0.10) { col = 'rojo'; txt = 'Muy improbable: la probabilidad conjunta es menor al 10%. Más patas = más cuota pero mucho más riesgo.'; }
    else if (c.conj < 0.20 && col === 'verde') col = 'amarillo';
    if (!txt) txt = col === 'verde' ? 'Todas las patas son verdes y la probabilidad conjunta es razonable.' :
      col === 'amarillo' ? 'Riesgo medio: hay patas amarillas o la probabilidad conjunta es baja.' : 'Riesgo alto: incluye patas rojas.';
    return { color: col, txt: txt };
  }

  function avisosTicket(c) {
    var legs = S.ticket, a = [], porJug = {}, porJuego = {};
    legs.forEach(function (l) { (porJug[l.id] = porJug[l.id] || []).push(l); (porJuego[l.gid] = porJuego[l.gid] || []).push(l); });
    Object.keys(porJug).forEach(function (k) { if (porJug[k].length > 1) a.push(porJug[k][0].j + ' aparece ' + porJug[k].length + ' veces: las patas están correlacionadas (la probabilidad ya lo considera) y la casa puede rechazarlas o cambiar la cuota.'); });
    Object.keys(porJuego).forEach(function (k) { var n = porJuego[k].length; if (n > 1) a.push(n + ' patas del mismo partido (' + porJuego[k][0].eq + ' vs ' + porJuego[k][0].riv + '): algunas casas solo las aceptan como combinada del mismo partido, con otra cuota.'); });
    if (legs.some(function (l) { return !l.cuota; })) a.push('Faltan cuotas: completá las que digan «sin cuota» (por ejemplo con la de Stake) para ver la cuota total.');
    legs.forEach(function (l) { if (l.est && l.est !== 'Probable') a.push(l.j + ' figura ' + l.est + ': confirmá si juega antes de apostar.'); });
    legs.forEach(function (l) { var e = estadoDe(l.gid); if (e) a.push(descPata(l) + ': el partido ' + (e === 3 ? 'ya terminó' : 'ya empezó') + '. La cuota y la probabilidad son de antes del inicio.'); });
    if (c.ev != null && c.ev > 0.5) a.push('La ventaja estimada es muy alta (+' + Math.round(c.ev * 100) + '%). Es casi seguro que el modelo se equivoca o que la cuota está mal cargada: revisá cada pata.');
    if (legs.length > 6) a.push('Con ' + legs.length + ' patas la probabilidad de acertar todo es baja aunque cada pata sea buena.');
    return a;
  }

  var etiquetaFuente = function (l) { return l.cuotaOrig != null ? (l.cuota !== l.cuotaOrig ? 'editada (' + l.fuente + ' ' + fC(l.cuotaOrig) + ')' : l.fuente) : 'sin cuota publicada · justa ' + fC(l.ju); };

  function pintarTicket() {
    var legs = S.ticket, cont = $$('#ticket-cuerpo'), n = legs.length;
    $$('#ticket-n').textContent = n;
    $$('#tab-ticket-n').textContent = n;
    $$('#tab-ticket-sr').textContent = n === 1 ? ' pata' : ' patas';
    $$('#tab-ticket').hidden = !n;
    var nota = S.notaTicket ? '<div class="nota-ticket" role="status"><span>' + esc(S.notaTicket) + '</span><button type="button" class="cerrar-aviso" data-cerrar-nota aria-label="Cerrar aviso">×</button></div>' : '';
    if (!n) {
      cont.innerHTML = nota + '<p class="nota">Todavía no sumaste patas. Tocá «+ Agregar» en <a href="#/lineas">Líneas</a> o cargá una de las <a href="#/sugeridas">combinadas sugeridas</a>. Vas a ver la cuota y la probabilidad de la combinada a medida que sumás patas.</p>';
      $$('#ticket-resumen').textContent = '—';
      $$('#abrir-ticket').setAttribute('aria-label', 'Mi combinada: vacía');
      return;
    }
    cont.innerHTML = nota + '<div id="t-patas">' + legs.map(function (l, i) {
      var c = color(l.c);
      return '<div class="pata c-' + c + '" data-i="' + i + '"><div class="pata-txt"><b>' + esc(l.j) + '</b> <span class="pata-linea">' + esc(LADO[l.lado] || 'Más de') + ' ' + fL(l.L) + ' ' + esc(lectura(l)) + '</span>' +
        '<small>' + esc(l.eq) + (l.loc ? ' vs ' : ' @ ') + esc(l.riv) + ' · prob. ' + fP(l.p) + ' · <span class="dot ' + c + '" aria-hidden="true"></span>' + c + ' ' + badgeEstado(estadoDe(l.gid)) + '</small></div>' +
        '<button type="button" class="quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(descPata(l)) + '">×</button>' +
        '<label class="pata-cuota">Cuota <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-cuota="' + i + '" value="' + (l.cuota ? fC(l.cuota) : '') + '" placeholder="ej. 1,85">' +
        '<span>' + esc(etiquetaFuente(l)) + '</span></label></div>';
    }).join('') + '</div><div id="t-totales"></div>';
    pintarTotales();
  }

  function pintarTotales() {
    var c = calcular(), v = veredicto(c), cont = $('#t-totales'); if (!cont) return;
    var gan = c.cuota ? S.stake * c.cuota : null, avs = avisosTicket(c);
    var corrTxt = c.corr ? ' <small>(independiente: ' + fP(c.indep) + ')</small>' : '';
    cont.innerHTML = '<div class="totales">' +
      '<div class="total"><span>Cuota total</span><b>' + (c.cuota ? fC(c.cuota) : '—') + '</b></div>' +
      '<div class="total"><span>Probabilidad</span><b>' + fP(c.conj) + '</b>' + corrTxt + '</div>' +
      '<div class="total"><span>Cuota justa</span><b>' + (c.justa ? fC(c.justa) : '—') + '</b></div>' +
      '<div class="total"><span>Ventaja estimada</span><b>' + (c.ev == null ? '—' : (c.ev > 0 ? '+' : '') + Math.round(c.ev * 100) + '%') + '</b></div>' +
      '</div>' +
      '<div class="stake"><label for="stake">Apuesta</label><input id="stake" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="' + U.fMonto(S.stake) + '">' +
      '<span>' + (gan ? 'cobrarías ' + nfDin.format(gan) : '') + '</span></div>' +
      (v ? '<div class="veredicto ' + v.color + '"><b>Semáforo de la combinada: ' + v.color + '.</b> ' + esc(v.txt) + '</div>' : '') +
      (avs.length ? '<ul class="avisos-ticket">' + avs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="nota">Si tu casa paga más que la cuota justa, el modelo ve valor. Pero el modelo no está validado contra resultados: desconfiá de las ventajas muy altas.</p>' +
      '<div class="acciones"><button type="button" class="btn primario" id="t-guardar">Guardar</button>' +
      '<button type="button" class="btn" id="t-copiar">Copiar texto</button><button type="button" class="btn btn-peligro" id="t-limpiar">Vaciar</button></div>';
    var res = (c.cuota ? '@' + fC(c.cuota) + ' · ' : '') + fP(c.conj);
    $$('#ticket-resumen').textContent = res;
    $$('#abrir-ticket').setAttribute('aria-label', 'Mi combinada: ' + S.ticket.length + (S.ticket.length === 1 ? ' pata' : ' patas') + (c.cuota ? ', cuota ' + fC(c.cuota) : '') + ', probabilidad ' + fP(c.conj));
  }

  function textoTicket() {
    var c = calcular();
    return 'Combinada (' + S.ticket.length + ' patas)' + (c.cuota ? ' — cuota ' + fC(c.cuota) : '') + ' — prob. ' + fP(c.conj) + '\n' +
      S.ticket.map(function (l) { return '• ' + descPata(l) + ' (' + l.eq + (l.loc ? ' vs ' : ' @ ') + l.riv + ')' + (l.cuota ? ' @' + fC(l.cuota) : ''); }).join('\n');
  }
  function copiar(txt, btn) {
    var ok = function () { btn.textContent = '¡Copiado!'; setTimeout(function () { btn.textContent = 'Copiar texto'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { window.prompt('Copiá el texto:', txt); });
    else window.prompt('Copiá el texto:', txt);
  }
  function pintarGuardadas() {
    var g = S.guardadas, cont = $$('#guardadas');
    if (!g.length) { cont.innerHTML = '<p class="nota">Todavía no guardaste combinadas.</p>'; return; }
    cont.innerHTML = g.map(function (x, i) {
      var otroDia = x.fecha && S.data && x.fecha !== S.data.fecha;
      return '<div class="guardada"><span><b>' + esc(x.nombre || 'Combinada') + '</b><br><small>' + x.legs.length + (x.legs.length === 1 ? ' pata' : ' patas') + ' · ' +
        (typeof x.cuota === 'number' ? '@' + fC(x.cuota) + ' · ' : '') + fP(x.p) + (otroDia ? ' · del ' + esc(diaMes(x.fecha)) : '') + '</small></span>' +
        '<span class="guardada-acc"><button type="button" class="btn" data-cargar="' + i + '">Cargar</button> <button type="button" class="btn btn-icono" data-borrar="' + i + '" aria-label="Borrar ' + esc(x.nombre || 'combinada') + '">×</button></span></div>';
    }).join('');
  }
  function cargarGuardada(i) {
    var gu = S.guardadas[i]; if (!gu) return;
    var r = reconstruir(lista(gu.legs)), nombre = String(gu.nombre || 'Combinada'), otroDia = gu.fecha !== S.data.fecha;
    if (!r.legs.length) {
      S.notaTicket = 'No cargué «' + nombre + '»: ninguna de sus patas está en los datos de hoy' + (otroDia ? ' (es del ' + diaMes(gu.fecha) + ')' : '') + '.';
      pintarTicket(); anunciar(S.notaTicket); enfocar($('#h-ticket'));
      return;
    }
    S.ticket = r.legs;
    S.notaTicket = otroDia ? '«' + nombre + '» es del ' + diaMes(gu.fecha) + ': la armé de nuevo con las cuotas y probabilidades de hoy' + (r.quitadas.length ? '; saqué ' + r.quitadas.join(', ') + ' (hoy no está publicada)' : '') + '.'
      : (r.quitadas.length || r.cambiadas ? 'Cargué «' + nombre + '» con los datos actuales' + resumenCambios(r) + '.' : '');
    cambioTicket();
    anunciar('Cargada: ' + nombre + '. ' + S.ticket.length + (S.ticket.length === 1 ? ' pata.' : ' patas.') + (S.notaTicket ? ' ' + S.notaTicket : ''));
    enfocar($('#h-ticket'));
  }

  // ----------------------------------------------------------------- combinadas sugeridas del día
  var COMBOS = [];
  function prepararSugeridas() { if (!S.data || S.hecho.sugeridas) return; S.hecho.sugeridas = true; sugeridasDia(); }
  function sugeridasDia() {
    var libres = S.grupos.filter(function (g) { return !estadoDe(g.gid); });   // sin partidos empezados
    COMBOS = window.Sugeridas.todas(libres).map(function (c) {
      var patas = c.legs.map(function (l) { return { id: l.g.id, eq: l.g.eq, gid: l.g.gid, m: l.g.m, lado: 'mas', p: l.s.p }; });
      var cj = window.Correlacion.conjunta(patas);
      c.cuota = c.legs.reduce(function (a, l) { return a * l.cu; }, 1);
      c.p = cj.conj; c.indep = cj.indep;
      return c;
    });
    var cont = $$('#sug-dia');
    if (!COMBOS.length) {
      cont.innerHTML = '<div class="vacio">' + (S.grupos.length && !libres.length ? 'Todos los partidos de hoy ya empezaron: no hay combinadas sugeridas.' : 'Hoy no hay suficientes líneas verdes o amarillas con cuota para armar combinadas sugeridas.') + '</div>';
      return;
    }
    cont.innerHTML = COMBOS.map(function (c, i) {
      var uno = c.p > 0 ? Math.round(1 / c.p) : null;
      return '<article class="comb comb-' + esc(c.id) + '" aria-labelledby="comb-t-' + i + '">' +
        '<div class="comb-cab"><h3 class="comb-tipo" id="comb-t-' + i + '"><span class="comb-punto" aria-hidden="true"></span>' + esc(c.nombre) + '</h3><span class="comb-meta">' + c.n + ' patas · cuota ≥ ' + fC(c.T) + '</span></div>' +
        '<div class="comb-nums"><div><b>@' + fC(c.cuota) + '</b><span>cuota total</span></div><div><b>' + fP(c.p) + '</b><span>probabilidad' + (uno ? ' (1 de ' + uno + ')' : '') + '</span></div><div><b>' + fC(1 / c.p) + '</b><span>cuota justa</span></div></div>' +
        '<ul class="comb-patas">' + c.legs.map(function (l) {
          var lc = color(l.s.c);
          return '<li><b>' + esc(l.g.j) + '</b> · Más de ' + fL(l.s.L) + ' ' + esc(lectura(l.g)) + '<small>' + esc(l.g.eq) + (l.g.loc ? ' vs ' : ' @ ') + esc(l.g.riv) + ' · ' + fP(l.s.p) + ' · @' + fC(l.cu) + ' Betano · <span class="dot ' + lc + '" aria-hidden="true"></span>' + lc + '</small></li>';
        }).join('') + '</ul>' +
        '<p class="nota">' + esc(c.resumen) + '</p>' +
        '<button type="button" class="btn secundario" data-comb="' + i + '">Cargar en mi combinada</button></article>';
    }).join('');
  }
  function cargarCombo(i) {
    var c = COMBOS[i]; if (!c) return;
    S.ticket = c.legs.map(function (l) { return U.nuevaPata(l.g, l.s, 'mas'); });
    S.notaTicket = '';
    cambioTicket();
    anunciar('Cargada la combinada ' + c.nombre + ' de ' + c.n + ' patas.');
    abrirTicket();
  }

  // ----------------------------------------------------------------- método
  function metodo() {
    var m = S.data.modelo || {};
    $$('#metodo').innerHTML =
      '<h4>De dónde salen los datos</h4><p>Líneas, promedios, minutos, lesiones y cuotas de Betano (con su escalera de líneas «más de»): <a href="https://ludoprops.com" rel="noopener">LudoProps</a>. Spread, total y moneyline: ESPN (DraftKings). Back-to-back: calendario de ESPN de los 3 días previos. <b>Stake no tiene API pública</b>: editá la cuota de cada pata en la combinada y compará con la <b>cuota justa</b>.</p>' +
      '<h4>Escalera de líneas</h4><p>Solo se muestran líneas con <b>cuota de Betano</b>. En puntos, rebotes y asistencias se baja la escalera completa que publica Betano (unas 6 líneas por jugador); en los demás mercados, solo la línea principal. Betano no publica líneas muy bajas, props de jugadores con pocos minutos ni algunos mercados (tiros, pérdidas, rebotes ofensivos y defensivos, primer cuarto). La <b>cuota justa</b> (1 / probabilidad) sirve para comparar con otra casa, como Stake.</p>' +
      '<h4>Probabilidad de cada línea</h4><p>El <b>modelo</b> promedia la estimación del sitio (proyección de minutos y rol) y una propia (proyección ± variabilidad de los últimos 10 partidos, con distribución binomial negativa para cifras bajas). Antes se ajusta por <b>riesgo de blowout</b> (spread → probabilidad de que el margen supere ' + fL(m.umbral_blowout || 14.5) + ' puntos → minutos que pierden los titulares) y por <b>back-to-back</b>. Cuando la línea tiene cuota, el resultado final es el <b>promedio entre el modelo y la probabilidad de la casa</b> sin su margen. Las líneas donde el modelo supera a la casa por más de 20 puntos se marcan.</p>' +
      '<h4>Semáforo (por línea)</h4><ul><li><b>Verde:</b> probabilidad ≥ 60%, promedios de temporada, últimos 10 y proyección por encima de la línea (≥ 4%), tasas de acierto a favor y ninguna en contra, ≥ 24 minutos, minutos estables, sin lesión y sin riesgo alto de blowout ni back-to-back (salvo que la línea sea muy segura).</li><li><b>Amarillo:</b> probabilidad ≥ 55% con casi todo a favor, pero con una alerta.</li><li><b>Rojo:</b> el resto. Automático si el jugador figura con cualquier estado de lesión que no sea Probable (Questionable, Doubtful, Out…), el sitio lo marca «no sugerir» o juega pocos minutos.</li></ul>' +
      '<h4>Combinadas sugeridas</h4><p><b>Segura</b> (3 y 4 patas, cuota ≥ 1,99), <b>Intermedia</b> (4 y 5 patas, cuota ≥ 5) y <b>Soñadora</b> (7 patas, cuota ≥ 20). Para cada una se resuelve un problema de mochila: elegir las patas «más de» que maximizan la probabilidad conjunta con la cuota mínima, con un jugador por pata y solo líneas con cuota publicada, modelo completo, sin jugadores dudosos y de partidos que no empezaron. La Segura usa solo líneas verdes de al menos 72%; la Intermedia, verdes y amarillas de al menos 60%; la Soñadora, de al menos 50%. Ninguna línea supera 96% porque siempre queda un riesgo que las estadísticas no ven.</p>' +
      '<h4>Combinadas</h4><p>La probabilidad conjunta usa una cópula gaussiana: patas del mismo jugador se tratan como correlacionadas y las del mismo partido con una correlación leve. Entre partidos distintos se asumen independientes. Dos patas del mismo partido se calculan de forma exacta (normal bivariada); tres o más, con una simulación de semilla fija. Una línea muy segura paga poco: la cuota total es el producto de las cuotas.</p>' +
      '<h4>Partidos empezados</h4><p>Cuando un partido ya empezó, su tarjeta y sus líneas dicen «En juego» o «Final». Sus líneas no se pueden sumar a la combinada y no entran en las sugeridas, porque las cuotas publicadas son de antes del inicio.</p>' +
      '<h4>Límites</h4><ul><li>Las probabilidades salen de un modelo <b>sin validar contra resultados</b>: no hay cuotas históricas para comprobarlo. Cada corrida guarda una foto del día en <code>docs/data/historial/</code> para poder hacerlo más adelante.</li><li>Muestra chica: estamos a pocos partidos del inicio de temporada.</li><li>El defensa-por-posición se muestra solo como contexto: hay poca evidencia de que prediga.</li><li>Las lesiones cambian hasta minutos antes del partido. Verificá antes de apostar.</li><li>Esto es análisis estadístico, no una garantía ni consejo financiero. Apostá solo lo que puedas perder.</li></ul>';
  }

  // ----------------------------------------------------------------- secciones y rutas  (#/vista  ·  #/lineas?partido=GID)
  var VISTAS = ['partidos', 'lineas', 'sugeridas', 'combinada', 'metodo'];
  var TITULOS = { partidos: 'Partidos', lineas: 'Líneas', sugeridas: 'Sugeridas', combinada: 'Mi combinada', metodo: 'Cómo se calcula' };
  var TITULO_ID = { partidos: 'h-partidos', lineas: 'h-lineas', sugeridas: 'h-sug', combinada: 'h-ticket', metodo: 'h-metodo' };
  var MQ = window.matchMedia('(max-width: 980px)');          // mismo corte que estilos.css
  var esMovil = function () { return MQ.matches; };
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* nada */ }

  /* «#/lineas?partido=X» → { vista, partido }. Un ancla que no es una vista (#algo) devuelve null y no se toca. */
  function leerRuta() {
    var h = location.hash;
    if (h && h.indexOf('#/') !== 0) { var v0 = h.slice(1); return VISTAS.indexOf(v0) >= 0 ? { vista: v0, partido: '' } : null; }
    h = h.slice(2);
    var i = h.indexOf('?'), v = (i < 0 ? h : h.slice(0, i)) || 'partidos';
    var q = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
    return { vista: VISTAS.indexOf(v) >= 0 ? v : 'partidos', partido: q.get('partido') || '' };
  }
  function hrefVista(v) { return '#/' + v + (v === 'lineas' && S.partido ? '?partido=' + encodeURIComponent(S.partido) : ''); }
  function ir(v) { var h = hrefVista(v); if (location.hash === h) enrutar(); else location.hash = h; }   // hashchange → enrutar()
  function enfocar(el) { if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } } }
  function anunciar(txt) { var a = $('#anuncio'); if (!a) return; a.textContent = ''; setTimeout(function () { a.textContent = txt; }, 60); }

  function enrutar(op) {
    op = op || {};
    var r = leerRuta(); if (!r) return;
    if (location.hash && location.hash.indexOf('#/') !== 0) history.replaceState(null, '', '#/' + r.vista);   // #lineas → #/lineas
    if (r.vista === 'combinada' && !esMovil()) {          // escritorio: la combinada es la columna lateral, no una vista
      var atras = S.ultimaPrincipal || 'partidos';
      history.replaceState(null, '', hrefVista(atras));
      if (atras !== S.vista) mostrar(atras, { inicial: true });
      if (!op.inicial) enfocar($('#h-ticket'));
      return;
    }
    if (r.vista === 'lineas' && S.data) {
      var gid = S.data.partidos.some(function (p) { return p.gid === r.partido; }) ? r.partido : '';
      if (gid !== S.partido) { S.partido = gid; S.sucio.filtro = true; S.scroll.lineas = 0; marcarPartido(); }
      if (gid !== r.partido) history.replaceState(null, '', hrefVista('lineas'));   // partido inexistente: limpiar URL
    }
    mostrar(r.vista, op);
  }

  function mostrar(v, op) {
    op = op || {};
    if (S.vista && S.vista !== v) S.scroll[S.vista] = window.scrollY;      // recordar dónde quedó la vista que se va
    S.vista = v; if (v !== 'combinada') S.ultimaPrincipal = v;
    document.body.setAttribute('data-seccion', v);
    document.querySelectorAll('.vista').forEach(function (el) { el.hidden = el.getAttribute('data-vista') !== v; });
    document.querySelectorAll('#nav-secciones a[data-vista]').forEach(function (a) {
      if (a.getAttribute('data-vista') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITULOS[v] + ' · NBA Semáforo';
    preparar(v);
    window.scrollTo(0, S.scroll[v] || 0);                                   // cada pestaña conserva su scroll
    if (!op.inicial) enfocar(document.getElementById(TITULO_ID[v]));        // al cargar la página no se roba el foco
  }

  /* Pinta lo que la vista necesita la primera vez que se muestra, o si quedó desactualizada mientras estaba oculta. */
  function preparar(v) {
    if (!S.data) return;
    if (v === 'lineas') { if (S.sucio.filtro) aplicarFiltros(); }           // recalcula y vuelve a la página 1
    else if (v === 'sugeridas') prepararSugeridas();
    else if (v === 'metodo' && !S.hecho.metodo) { S.hecho.metodo = true; metodo(); }
  }

  function abrirTicket() { if (esMovil()) ir('combinada'); else enfocar($('#h-ticket')); }

  function marcarPartido() {
    document.querySelectorAll('#partidos .partido').forEach(function (el) { el.classList.toggle('sel', el.dataset.gid === S.partido); });
    var f = $('#f-partido'); if (f) f.value = S.partido;
    var a = $('#nav-secciones a[data-vista="lineas"]'); if (a) a.setAttribute('href', hrefVista('lineas'));   // la pestaña recuerda el partido
  }

  // ----------------------------------------------------------------- eventos
  function enlazar() {
    $$('#f-color').addEventListener('click', function (e) {
      var b = e.target.closest('.sem'); if (!b) return;
      var c = b.dataset.c, on = !S.colores.has(c);
      if (on) S.colores.add(c); else S.colores.delete(c);
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); aplicarFiltros();
    });
    $$('#f-grupo').addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]'); if (!b) return;
      S.grupo = b.dataset.g;
      document.querySelectorAll('#f-grupo .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      aplicarFiltros();
    });
    var t; $$('#f-q').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { S.q = v; aplicarFiltros(); }, 120); });
    $$('#f-prob').addEventListener('change', function (e) { S.minP = e.target.value === 'rec' ? 'rec' : parseFloat(e.target.value); aplicarFiltros(); });
    $$('#f-mercado').addEventListener('change', function (e) { S.mercado = e.target.value; aplicarFiltros(); });
    $$('#f-orden').addEventListener('change', function (e) { S.orden = e.target.value; aplicarFiltros(); });
    $$('#f-completo').addEventListener('change', function (e) { S.soloCompleto = e.target.checked; aplicarFiltros(); });
    $$('#f-menos').addEventListener('change', function (e) { S.menos = e.target.checked; repintarFilas(S.abiertos); marcarMasFiltros(); });
    $$('#ver-mas').addEventListener('click', function () { var desde = S.mostrar; S.mostrar += PAGINA; agregarFilas(desde); });

    // Partido dentro de Líneas. replaceState: cambiar el filtro no crea una entrada nueva en el historial.
    $$('#f-partido').addEventListener('change', function (e) {
      S.partido = e.target.value; S.scroll.lineas = 0; marcarPartido();
      history.replaceState(null, '', hrefVista('lineas'));
      aplicarFiltros();
    });

    $$('#lineas').addEventListener('click', function (e) {
      var art = e.target.closest('.linea'); if (!art) return;
      var g = S.porClave.get(art.dataset.k); if (!g) return;
      if (e.target.closest('[data-desplegar]')) {
        if (S.abiertos.has(art.dataset.k)) S.abiertos.delete(art.dataset.k); else S.abiertos.add(art.dataset.k);
        repintarFilas([art.dataset.k]); return;
      }
      var b = e.target.closest('.add'); if (!b || b.disabled) return;
      alternar(g, parseFloat(b.dataset.l), b.dataset.add);
    });

    // Navegación: los enlaces cambian el hash solos; acá solo los casos especiales.
    $$('#abrir-ticket').addEventListener('click', function (e) {     // escritorio: la combinada ya está a la vista
      if (!esMovil()) { e.preventDefault(); enfocar($('#h-ticket')); }
    });
    $$('#aviso-ticket-ver').addEventListener('click', function (e) {
      $$('#aviso-ticket').hidden = true;
      if (!esMovil()) { e.preventDefault(); enfocar($('#h-ticket')); }
    });
    $$('#aviso-ticket-cerrar').addEventListener('click', function () { $$('#aviso-ticket').hidden = true; });
    $$('#nav-secciones').addEventListener('click', function (e) {     // tocar la pestaña activa = volver arriba
      var a = e.target.closest('a[data-vista]');
      if (!a || a.getAttribute('data-vista') !== S.vista) return;
      e.preventDefault(); S.scroll[S.vista] = 0;
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    var alCambiarAncho = function () { if (!esMovil() && S.vista === 'combinada') enrutar({ inicial: true }); };
    if (MQ.addEventListener) MQ.addEventListener('change', alCambiarAncho); else if (MQ.addListener) MQ.addListener(alCambiarAncho);   // Safari < 14

    $$('#ticket-cuerpo').addEventListener('click', function (e) {
      var q = e.target.closest('[data-quitar]');
      if (q) {
        var l = S.ticket[+q.dataset.quitar]; if (!l) return;
        S.ticket.splice(+q.dataset.quitar, 1); S.notaTicket = ''; cambioTicket();
        anunciar('Quitada: ' + descPata(l) + '. Combinada: ' + S.ticket.length + (S.ticket.length === 1 ? ' pata.' : ' patas.'));
        enfocar($('#ticket-cuerpo .quitar') || $('#h-ticket'));
        return;
      }
      if (e.target.closest('[data-cerrar-nota]')) { S.notaTicket = ''; pintarTicket(); enfocar($('#h-ticket')); return; }
      if (e.target.id === 't-limpiar') { S.ticket = []; S.notaTicket = ''; cambioTicket(); anunciar('Combinada vacía.'); enfocar($('#h-ticket')); return; }
      if (e.target.id === 't-copiar') { copiar(textoTicket(), e.target); return; }
      if (e.target.id === 't-guardar') {
        var c = calcular(), nombre = window.prompt('Nombre de la combinada:', 'Combinada ' + (S.guardadas.length + 1));
        if (nombre === null) return;
        S.guardadas.unshift({ nombre: nombre || 'Combinada', fecha: S.data.fecha, legs: JSON.parse(JSON.stringify(S.ticket)), cuota: c.cuota, p: c.conj });
        guardar(CLAVE_GUARDADAS, S.guardadas); pintarGuardadas();
        anunciar('Guardada: ' + (nombre || 'Combinada') + '.');
      }
    });
    $$('#ticket-cuerpo').addEventListener('input', function (e) {
      var inp = e.target;
      if (inp.dataset.cuota != null) {
        var l = S.ticket[+inp.dataset.cuota]; if (!l) return;
        var v = U.leerCuota(inp.value), malo = inp.value.trim() !== '' && v == null;
        l.cuota = v;
        inp.setAttribute('aria-invalid', malo ? 'true' : 'false');
        guardarTicket();
        var sp = inp.parentNode.querySelector('span'); if (sp) sp.textContent = malo ? 'cuota inválida: escribí, por ejemplo, 1,85' : etiquetaFuente(l);
        pintarTotales();
      } else if (inp.id === 'stake') {
        S.stake = U.leerMonto(inp.value);
        guardarTicket();
        var cu = cuotaTotal(), sp2 = inp.parentNode.querySelector('span:last-child');   // la cuota no depende de la probabilidad: sin Monte Carlo
        if (sp2) sp2.textContent = cu ? 'cobrarías ' + nfDin.format(S.stake * cu) : '';
      }
    });
    $$('#ticket-cuerpo').addEventListener('change', function (e) {      // al salir del campo, mostrar el número en formato es-AR
      var inp = e.target;
      if (inp.dataset.cuota != null) { var l = S.ticket[+inp.dataset.cuota]; if (l && l.cuota) inp.value = fC(l.cuota); }
      else if (inp.id === 'stake') inp.value = U.fMonto(S.stake);
    });

    $$('#sug-dia').addEventListener('click', function (e) {
      var b = e.target.closest('[data-comb]'); if (b) cargarCombo(+b.dataset.comb);
    });
    $$('#guardadas').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cargar]'), b = e.target.closest('[data-borrar]');
      if (c) cargarGuardada(+c.dataset.cargar);
      if (b) {
        var x = S.guardadas.splice(+b.dataset.borrar, 1)[0]; guardar(CLAVE_GUARDADAS, S.guardadas); pintarGuardadas();
        anunciar('Borrada: ' + (x && x.nombre || 'combinada') + '.'); enfocar($('#guardadas [data-cargar]') || $('#h-ticket'));
      }
    });
  }

  cargar();
})(NbaUtil);
