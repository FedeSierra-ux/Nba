/* NBA Semáforo — sección «Resultados y calibración» (#/resultados).
   Lee data/calibracion.json (al abrir la sección) y, para el día elegido, data/historial/<fecha>.json + data/resultados/<fecha>.json.
   Califica en el navegador con window.Calificar (mismas reglas que scripts/resultados.py). */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var A = null, C = null;
  var E = { cal: null, error: '', conjunto: 'lineas', dia: '', diaDatos: null, diaError: '', todasVerdes: false };
  var COLORES = ['verde', 'amarillo', 'rojo'];
  var NIVELES = [['segura', 'Segura'], ['intermedia', 'Intermedia'], ['sonadora', 'Soñadora']];
  var CHICA = 30;                                     // por debajo de 30 casos el tramo se marca como poco confiable
  var $ = function (s) { return document.querySelector(s); };

  function init(app) {
    A = app; C = root.Calificar;
    var cont = $('#resultados'); if (!cont) return;
    cont.addEventListener('click', function (e) {
      var b = e.target.closest('[data-conjunto]');
      if (b) { E.conjunto = b.dataset.conjunto; pintar(); var nb = $('#resultados [data-conjunto="' + E.conjunto + '"]'); if (nb) nb.focus(); return; }
      if (e.target.closest('[data-verdes]')) { E.todasVerdes = true; pintarDia(); return; }
      if (e.target.closest('[data-reintentar]')) { E.error = ''; abrir(); }
    });
    cont.addEventListener('change', function (e) { if (e.target.id === 'r-dia') { E.dia = e.target.value; E.todasVerdes = false; cargarDia(); } });
  }

  function abrir() {
    if (!A) return;
    A.pedirJSON('data/calibracion.json', 10 * 60e3).then(function (d) {
      E.cal = d && typeof d === 'object' ? d : null; E.error = d ? '' : 'Todavía no hay archivo de calibración.';
      pintar();
      var dias = diasDe();
      if (dias.length && dias.indexOf(E.dia) < 0) { E.dia = dias[0]; cargarDia(); } else if (E.dia) pintarDia();
    }, function (e) { E.error = 'No pude cargar data/calibracion.json (' + e.message + ').'; pintar(); });
  }
  var diasDe = function () { return A.lista(E.cal && E.cal.dias).filter(function (f) { return typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f); }).slice().sort().reverse(); };

  // ------------------------------------------------------------------ formato
  var esNum = function (x) { return typeof x === 'number' && isFinite(x); };
  var signo = function (x, f) { return !esNum(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x)); };
  var pct = function (x) { return signo(x, function (v) { return A.fP(v); }); };
  var unid = function (x) { return signo(x, function (v) { return A.fC(v); }) + ' u'; };
  var dot = function (c) { return '<span class="dot ' + c + '" aria-hidden="true"></span>'; };
  var nombreColor = { verde: 'Verde', amarillo: 'Amarillo', rojo: 'Rojo' };
  var cuenta = function (n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); };

  function pintar() {
    var cont = $('#resultados'); if (!cont) return;
    if (E.error) {
      cont.innerHTML = '<div class="vacio">' + A.esc(E.error) + ' <button type="button" class="btn" data-reintentar>Reintentar</button></div>';
      return;
    }
    if (!E.cal) { cont.innerHTML = '<p class="nota">Cargando…</p>'; return; }
    var cal = E.cal, dias = diasDe();
    if (!dias.length) {
      cont.innerHTML = '<div class="vacio res-vacio"><p><b>Todavía no hay días corregidos:</b> el primero aparece mañana, cuando terminen los partidos de hoy.</p>' +
        '<p class="nota">Cada día se guarda una foto de las líneas y de las combinadas sugeridas antes de los partidos. Cuando terminan, se comparan con los box scores: ' +
        'acá vas a ver cuánto acertó cada color del semáforo, si las probabilidades están bien calibradas, el ROI a la cuota de Betano y el récord de las sugeridas.</p></div>';
      return;
    }
    var primero = dias[dias.length - 1], ultimo = dias[0];
    var poca = dias.length < 30;
    var html = '<p class="res-intro">' + cuenta(dias.length, 'día corregido', 'días corregidos') + (dias.length > 1 ? ' (del ' + A.diaMes(primero) + ' al ' + A.diaMes(ultimo) + ')' : ' (' + A.diaMes(ultimo) + ')') +
      (cal.actualizado ? ' · actualizado ' + A.esc(A.hace(cal.actualizado)) : '') + '</p>' +
      (poca ? '<p class="res-honesto" role="note"><b>Muestra chica.</b> Con ' + cuenta(dias.length, 'día', 'días') + ' los porcentajes cambian mucho de un día a otro: sirven para ir mirando, no para sacar conclusiones. Hacen falta varias semanas.</p>' : '');
    var conj = E.conjunto === 'escalera' ? cal.escalera || {} : cal.lineas || {};
    html += '<div class="seg" role="group" aria-label="Qué líneas medir">' +
      '<button type="button" class="chip" data-conjunto="lineas" aria-pressed="' + (E.conjunto === 'lineas') + '">Líneas principales</button>' +
      '<button type="button" class="chip" data-conjunto="escalera" aria-pressed="' + (E.conjunto === 'escalera') + '">Toda la escalera</button></div>';
    html += '<div class="res-grid">' + tarjetaColores(conj) + tarjetaGrafico(conj) + (E.conjunto === 'lineas' ? tarjetaBrier(cal.lineas && cal.lineas.brier) : '') +
      tarjetaRoi(cal.escalera && cal.escalera.roi) + tarjetaSugeridas(cal.sugeridas) + '</div>';
    html += '<section class="res-card res-dia" aria-labelledby="h-res-dia"><h3 id="h-res-dia">Día por día</h3>' +
      '<label class="campo res-sel">Día<select id="r-dia">' + dias.map(function (f) { return '<option value="' + f + '"' + (f === E.dia ? ' selected' : '') + '>' + A.diaMes(f) + ' · ' + diaSemana(f) + '</option>'; }).join('') + '</select></label>' +
      '<div id="r-dia-cuerpo" aria-live="polite"></div></section>';
    cont.innerHTML = html;
    pintarDia();
  }
  function diaSemana(f) {
    try { return new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(f + 'T12:00:00Z')); } catch (e) { return ''; }
  }

  // ------------------------------------------------------------------ tarjetas
  function tarjetaColores(conj) {
    var pc = conj.por_color || {};
    var filas = COLORES.map(function (c) {
      var x = pc[c] || {}, n = x.n || 0, dif = esNum(x.tasa) && esNum(x.p_media) ? x.tasa - x.p_media : null;
      return '<tr class="' + (n < CHICA ? 'chica' : '') + '"><th scope="row">' + dot(c) + nombreColor[c] + '</th><td>' + A.fP(x.p_media) + '</td><td><b>' + A.fP(x.tasa) + '</b>' +
        '<small class="sub">' + (x.aciertos || 0) + '/' + n + (n < CHICA ? ' · <span class="chica-tag">muestra chica</span>' : '') + '</small></td>' +
        '<td class="' + (dif == null ? '' : Math.abs(dif) < 0.03 ? '' : dif > 0 ? 'pos' : 'neg') + '">' + (dif == null ? '—' : signo(Math.round(dif * 100), String) + ' pts') + '</td>' +
        '<td>' + (x.anuladas || 0) + '</td></tr>';
    }).join('');
    return '<section class="res-card" aria-labelledby="h-res-col"><h3 id="h-res-col">Por color: esperado vs. acertado</h3>' +
      '<div class="tabla-x"><table class="res-tabla"><thead><tr><th scope="col">Color</th><th scope="col">Esperado</th><th scope="col">Acertado <small>(de n)</small></th><th scope="col">Dif.</th><th scope="col"><abbr title="Anuladas">Anul.</abbr></th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p class="nota"><b>Esperado</b> = probabilidad media que dio el modelo; <b>acertado</b> = cuántas superaron la línea. Si el modelo está bien calibrado, se parecen. n = líneas calificadas (sin anuladas).</p></section>';
  }

  /* Gráfico de calibración: cada tramo de probabilidad es un punto (x = esperado, y = acertado). La diagonal es la calibración perfecta. */
  function tarjetaGrafico(conj) {
    var tramos = A.lista(conj.por_tramo).filter(function (t) { return t && esNum(t.desde) && esNum(t.hasta); });
    var W = 320, H = 250, m = { l: 40, r: 14, t: 12, b: 38 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var X = function (p) { return m.l + p * iw; }, Y = function (p) { return m.t + (1 - p) * ih; };
    var ejes = '', ticks = [0, 0.25, 0.5, 0.75, 1];
    ticks.forEach(function (t) {
      ejes += '<line class="cal-grid" x1="' + X(0) + '" x2="' + X(1) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '"/>' +
        '<text class="cal-tick" x="' + (m.l - 6) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(t * 100) + '%</text>' +
        '<text class="cal-tick" x="' + X(t).toFixed(1) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + Math.round(t * 100) + '%</text>';
    });
    ejes += '<line class="cal-diag" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '"/>' +
      '<text class="cal-eje" x="' + (m.l + iw / 2) + '" y="' + (H - 4) + '" text-anchor="middle">Probabilidad esperada</text>' +
      '<text class="cal-eje" transform="translate(11 ' + (m.t + ih / 2) + ') rotate(-90)" text-anchor="middle">Acertado</text>' +
      // rótulo de la diagonal abajo a la izquierda, sobre la línea (ahí casi nunca hay puntos)
      '<text class="cal-diag-txt" transform="translate(' + X(0.06).toFixed(1) + ' ' + (Y(0.06) - 5).toFixed(1) + ') rotate(' + (-Math.atan(ih / iw) * 180 / Math.PI).toFixed(1) + ')">calibración perfecta</text>';
    var con = tramos.filter(function (t) { return t.n > 0 && esNum(t.p_media) && esNum(t.tasa); });
    var nMax = Math.max.apply(null, con.map(function (t) { return t.n; }).concat([1]));
    var pts = con.map(function (t) { return { t: t, chica: t.n < CHICA, r: 4 + 6 * Math.sqrt(t.n / nMax), x: X(t.p_media), y: Y(t.tasa) }; });
    // rótulos «n=…» sin pisarse: se prueba a la derecha, izquierda, arriba y abajo de cada punto y se elige el primer lugar libre
    var cajas = pts.map(function (p) { return { x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r }; });
    var choca = function (b) {
      if (b.x0 < m.l || b.x1 > W - 2 || b.y0 < 0 || b.y1 > m.t + ih) return true;
      return cajas.some(function (c) { return b.x0 < c.x1 && b.x1 > c.x0 && b.y0 < c.y1 && b.y1 > c.y0; });
    };
    var puntos = pts.map(function (p) {
      var t = p.t, txt = 'n=' + t.n + (p.chica ? '?' : ''), w = txt.length * 6.3, h = 12, lab = null;
      [[p.x + p.r + 3, p.y + 4, 'start'], [p.x - p.r - 3, p.y + 4, 'end'], [p.x, p.y - p.r - 4, 'middle'], [p.x, p.y + p.r + 12, 'middle']].some(function (c) {
        var x0 = c[2] === 'start' ? c[0] : c[2] === 'end' ? c[0] - w : c[0] - w / 2, b = { x0: x0, x1: x0 + w, y0: c[1] - h + 2, y1: c[1] + 2 };
        if (choca(b)) return false;
        lab = c; cajas.push(b); return true;
      });
      if (!lab) lab = [p.x + p.r + 3, p.y + 4, 'start'];
      var tit = 'Tramo ' + rango(t) + ': esperado ' + A.fP(t.p_media) + ', acertado ' + A.fP(t.tasa) + ' (' + t.aciertos + ' de ' + t.n + ')' + (p.chica ? ', muestra chica: poco confiable' : '');
      return '<g class="cal-pt' + (p.chica ? ' chica' : '') + '"><title>' + A.esc(tit) + '</title>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + Math.max(p.r, 12).toFixed(1) + '" class="cal-hit"/>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + p.r.toFixed(1) + '" class="cal-dot"/>' +
        '<text class="cal-n" x="' + lab[0].toFixed(1) + '" y="' + lab[1].toFixed(1) + '" text-anchor="' + lab[2] + '">' + txt + '</text></g>';
    }).join('');
    var resumen = con.length ? con.map(function (t) { return rango(t) + ': esperado ' + A.fP(t.p_media) + ', acertado ' + A.fP(t.tasa) + ', n=' + t.n; }).join('; ') : 'sin datos';
    var filas = tramos.map(function (t) {
      var chica = t.n < CHICA;
      return '<tr class="' + (chica ? 'chica' : '') + '"><th scope="row">' + rango(t) + '</th><td>' + t.n + (t.n && chica ? ' <small>chica</small>' : '') + '</td><td>' + A.fP(t.p_media) + '</td><td>' + A.fP(t.tasa) + '</td><td>' + (t.anuladas || 0) + '</td></tr>';
    }).join('');
    return '<section class="res-card" aria-labelledby="h-res-cal"><h3 id="h-res-cal">Calibración por tramo</h3>' +
      '<svg class="cal" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico de calibración. ' + A.esc(resumen) + '">' + ejes + puntos + '</svg>' +
      '<p class="cal-ley"><span class="cal-ley-pt"></span> n ≥ ' + CHICA + ' <span class="cal-ley-pt chica"></span> n &lt; ' + CHICA + ': muestra chica, <b>poco confiable</b> (marcado con «?»). Puntos sobre la diagonal = el modelo acierta lo que promete; debajo = promete de más.</p>' +
      '<details class="res-det"><summary>Ver como tabla</summary><div class="tabla-x"><table class="res-tabla"><thead><tr><th scope="col">Tramo</th><th scope="col">n</th><th scope="col">Esperado</th><th scope="col">Acertado</th><th scope="col">Anuladas</th></tr></thead><tbody>' + filas + '</tbody></table></div></details></section>';
  }
  var rango = function (t) { return Math.round(t.desde * 100) + '–' + Math.round(t.hasta * 100) + '%'; };

  function tarjetaBrier(b) {
    b = b || {};
    var hay = esNum(b.modelo) && esNum(b.casa), txt = '';
    if (hay) {
      var d = b.casa - b.modelo;
      txt = Math.abs(d) < 0.005 ? 'Prácticamente iguales: con esta muestra no se puede decir que uno sea mejor.' :
        d > 0 ? 'El modelo va un poco mejor que la casa' + (b.n < 300 ? ', pero con ' + b.n + ' líneas puede ser azar.' : '.') :
          'La casa va mejor que el modelo' + (b.n < 300 ? ' (con ' + b.n + ' líneas puede ser azar).' : '.');
    }
    var f = function (x) { return esNum(x) ? x.toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : '—'; };
    return '<section class="res-card" aria-labelledby="h-res-brier"><h3 id="h-res-brier">Brier: modelo vs. casa</h3>' +
      '<div class="res-nums"><div><b>' + f(b.modelo) + '</b><span>modelo</span></div><div><b>' + f(b.casa) + '</b><span title="Probabilidad de Betano sin su margen">casa</span></div><div><b>' + (b.n || 0) + '</b><span>líneas</span></div></div>' +
      '<p class="nota">Error cuadrático entre la probabilidad y lo que pasó: <b>más bajo es mejor</b> (0 = perfecto; 0,25 = tirar una moneda). Casa = probabilidad de Betano sin su margen. ' + A.esc(txt) + '</p></section>';
  }

  function tarjetaRoi(roi) {
    roi = roi || {};
    var filas = COLORES.map(function (c) {
      var x = roi[c] || {}, n = x.n || 0;
      return '<tr class="' + (n < CHICA ? 'chica' : '') + '"><th scope="row">' + dot(c) + nombreColor[c] + '</th><td>' + n + '<small class="sub">' + (x.ganadas || 0) + ' ganadas</small></td><td>' + (x.anuladas || 0) + '</td>' +
        '<td>' + (n ? unid(x.unidades) : '—') + '</td><td class="' + (esNum(x.roi) ? (x.roi >= 0 ? 'pos' : 'neg') : '') + '"><b>' + pct(x.roi) + '</b></td></tr>';
    }).join('');
    return '<section class="res-card" aria-labelledby="h-res-roi"><h3 id="h-res-roi">ROI de la escalera a cuota Betano</h3>' +
      '<div class="tabla-x"><table class="res-tabla"><thead><tr><th scope="col">Color</th><th scope="col">Líneas</th><th scope="col"><abbr title="Anuladas">Anul.</abbr></th><th scope="col">Unidades</th><th scope="col">ROI</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p class="nota">Si se hubiera apostado 1 unidad a cada línea «más de» de ese color a la cuota de Betano. Las anuladas no cuentan. Un ROI positivo con pocos días suele ser suerte.</p></section>';
  }

  function tarjetaSugeridas(sug) {
    sug = sug || {};
    var filas = NIVELES.map(function (nv) {
      var x = sug[nv[0]] || {}, n = x.n || 0;
      return '<tr><th scope="row"><span class="comb-punto niv-' + nv[0] + '" aria-hidden="true"></span>' + nv[1] + '</th>' +
        '<td><b>' + (x.ganadas || 0) + '</b>–' + (x.perdidas || 0) + (x.anuladas ? '–' + x.anuladas : '') + '</td>' +
        '<td>' + A.fP(x.p_media) + '</td><td>' + A.fP(x.tasa) + '</td>' +
        '<td class="' + (esNum(x.roi) ? (x.roi >= 0 ? 'pos' : 'neg') : '') + '"><b>' + pct(x.roi) + '</b>' + (n ? '<small class="sub">' + unid(x.unidades) + '</small>' : '') + '</td></tr>';
    }).join('');
    return '<section class="res-card" aria-labelledby="h-res-sug"><h3 id="h-res-sug">Combinadas sugeridas</h3>' +
      '<div class="tabla-x"><table class="res-tabla"><thead><tr><th scope="col">Nivel</th><th scope="col"><abbr title="Ganadas–perdidas–anuladas">G–P–A</abbr></th><th scope="col">Esperado</th><th scope="col">Ganó</th><th scope="col">ROI</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p class="nota">1 unidad a cada combinada sugerida (la primera foto antes de los partidos). Una pata anulada se paga a 1,00; si se anulan todas, se devuelve.</p></section>';
  }

  // ------------------------------------------------------------------ detalle de un día
  function cargarDia() {
    var f = E.dia; if (!f) return;
    E.diaDatos = null; E.diaError = ''; pintarDia();
    Promise.all([A.pedirJSON('data/historial/' + f + '.json'), A.pedirJSON('data/resultados/' + f + '.json', 5 * 60e3)]).then(function (r) {
      if (E.dia !== f) return;
      if (!r[0]) { E.diaError = 'No está la foto pre-partido de ese día.'; pintarDia(); return; }
      E.diaDatos = { foto: r[0], res: r[1] }; pintarDia();
    }, function (e) { if (E.dia === f) { E.diaError = 'No pude cargar el día (' + e.message + ').'; pintarDia(); } });
  }

  var ICONO = { ganada: ['✓', 'ganada'], perdida: ['✗', 'perdida'], anulada: ['–', 'anulada'] };
  function icono(r) {
    var x = ICONO[r] || ['…', 'pendiente'];
    return '<span class="res-ico ' + (r || 'pendiente') + '" aria-hidden="true">' + x[0] + '</span><span class="sr-only">' + x[1] + ': </span>';
  }
  /* Texto de lo que hizo el jugador: «hizo 14», «no jugó», «empate», «pendiente». */
  function hizo(c, r) {
    if (r === 'anulada') return c.v != null ? 'hizo ' + A.fL(c.v) + ' · empate, anulada' : 'no jugó · anulada';
    if (c.v != null) return 'hizo ' + A.fL(c.v);
    return 'pendiente';
  }
  function pata(x, res, gidDe, nombres) {
    var l = { id: x.id, gid: x.gid || gidDe[x.id], m: x.m, per: x.per, L: x.L, lado: 'mas' };
    var c = C.calificarPata(l, res), n = A.nombreDe(x.id, x.j ? x : nombres[x.id]);
    return { c: c, html: '<li class="res-pata ' + (c.r || 'pendiente') + '">' + icono(c.r) + '<span class="res-pata-txt"><b>' + A.esc(n.j) + '</b>' + (n.eq ? ' <small>' + A.esc(n.eq) + '</small>' : '') +
      ' · Más de ' + A.fL(x.L) + ' ' + A.esc(A.lectura({ m: x.m, mn: x.mn })) + '</span><span class="res-hizo">' + A.esc(hizo(c, c.r)) + '</span></li>' };
  }
  function pintarDia() {
    var cont = $('#r-dia-cuerpo'); if (!cont) return;
    if (E.diaError) { cont.innerHTML = '<p class="nota">' + A.esc(E.diaError) + '</p>'; return; }
    if (!E.diaDatos) { cont.innerHTML = '<p class="nota">Cargando el ' + A.esc(A.diaMes(E.dia)) + '…</p>'; return; }
    var foto = E.diaDatos.foto, res = E.diaDatos.res, gidDe = {}, nombres = {};
    ['lineas', 'escalera'].forEach(function (k) { A.lista(foto[k]).forEach(function (x) { if (x && x.gid) gidDe[x.id] = x.gid; if (x && x.j) nombres[x.id] = x; }); });
    var html = res ? (res.completo ? '' : '<p class="nota">Ese día todavía no terminó de corregirse: algunas patas siguen pendientes.</p>') :
      '<p class="nota">Todavía no hay resultados de ese día: todo figura como pendiente.</p>';
    // combinadas sugeridas
    var sug = A.lista(foto.sugeridas).filter(function (c) { return c && Array.isArray(c.legs); });
    html += '<h4>Combinadas sugeridas</h4>';
    if (!sug.length) html += '<p class="nota">Ese día no se guardaron combinadas sugeridas.</p>';
    else html += '<div class="res-combs">' + sug.map(function (c) {
      var ps = c.legs.map(function (x) { return pata(x, res, gidDe, nombres); });
      var cc = C.calificarCombinada(ps.map(function (p) { return p.c.r; }), c.legs.map(function (x) { return x.cu || 1; }));
      var est = cc.estado || 'pendiente';
      return '<article class="res-comb comb-' + A.esc(c.id) + '"><div class="res-comb-cab"><b>' + A.esc(c.nombre || c.id) + '</b> <small>' + (c.n || c.legs.length) + ' patas · @' + A.fC(c.cuota) + ' · ' + A.fP(c.p) + '</small>' +
        '<span class="estado-apu ' + est + '">' + etiqueta(est) + (cc.estado === 'ganada' && cc.pago && Math.abs(cc.pago - c.cuota) > 0.01 ? ' @' + A.fC(cc.pago) : '') + '</span></div>' +
        '<ul class="res-patas">' + ps.map(function (p) { return p.html; }).join('') + '</ul></article>';
    }).join('') + '</div>';
    // líneas verdes (línea principal)
    var verdes = A.lista(foto.lineas).filter(function (x) { return x && x.c === 'verde' && !x.per; }).sort(function (a, b) { return (b.p || 0) - (a.p || 0); });
    var ps = verdes.map(function (x) { return pata(x, res, gidDe, nombres); });
    var k = { ganada: 0, perdida: 0, anulada: 0, pendiente: 0 };
    ps.forEach(function (p) { k[p.c.r || 'pendiente']++; });
    html += '<h4>Líneas verdes del día <small class="mut">(línea principal)</small></h4>';
    if (!ps.length) html += '<p class="nota">Ese día no hubo líneas principales verdes.</p>';
    else {
      var vis = E.todasVerdes ? ps : ps.slice(0, 15);
      html += '<p class="res-resumen"><b>' + k.ganada + ' de ' + (k.ganada + k.perdida) + '</b> superaron la línea' + (k.ganada + k.perdida ? ' (' + A.fP(k.ganada / (k.ganada + k.perdida)) + ')' : '') +
        (k.anulada ? ' · ' + cuenta(k.anulada, 'anulada', 'anuladas') : '') + (k.pendiente ? ' · ' + cuenta(k.pendiente, 'pendiente', 'pendientes') : '') + '</p>' +
        '<ul class="res-patas">' + vis.map(function (p, i) { return p.html.replace('</span><span class="res-hizo">', ' <small>' + A.fP(verdes[i].p) + '</small></span><span class="res-hizo">'); }).join('') + '</ul>' +
        (vis.length < ps.length ? '<button type="button" class="mas-btn" data-verdes>Ver las ' + ps.length + ' líneas verdes</button>' : '');
    }
    cont.innerHTML = html;
  }
  var etiqueta = function (e) { return { ganada: 'Ganada', perdida: 'Perdida', anulada: 'Anulada', pendiente: 'Pendiente' }[e] || 'Pendiente'; };

  root.NbaResultados = { init: init, abrir: abrir };
})(typeof window !== 'undefined' ? window : globalThis);
