/* NBA Semáforo — interfaz. Lee data/hoy.json (generado por scripts/actualizar.py). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nfLinea = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
  var nfCuota = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfDin = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  var fL = function (x) { return x == null ? '—' : nfLinea.format(x); };
  var fC = function (x) { return x == null ? '—' : nfCuota.format(x); };
  var fP = function (p) { return p == null ? '—' : (p < 0.1 ? (p * 100).toFixed(1) : Math.round(p * 100)) + '%'; };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var LADO = { mas: 'MÁS', menos: 'MENOS' };
  var CLAVE_TICKET = 'nba_semaforo_ticket_v1', CLAVE_GUARDADAS = 'nba_semaforo_guardadas_v1';
  var PAGINA = 60;

  var S = {
    data: null, filas: [], porClave: new Map(), partido: '', colores: new Set(['verde', 'amarillo']),
    q: '', mercado: '', lado: '', orden: 'p', soloCuota: false, soloCompleto: false, mostrar: PAGINA,
    ticket: [], guardadas: [], stake: 1000, lista: []
  };

  // ----------------------------------------------------------------- almacenamiento (puede fallar: modo privado, etc.)
  function leer(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ } }

  // ----------------------------------------------------------------- utilidades de filas
  function clave(r) { return [r.id, r.m, r.per || '', r.L].join('|'); }
  function pLado(r, lado) { return lado === r.lado ? r.p : (r.p == null ? null : 1 - r.p); }
  function cuotaLado(r, lado) { return lado === 'mas' ? r.cu_mas : r.cu_menos; }
  function hora(utc) {
    try { return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(utc)) ; }
    catch (e) { return ''; }
  }
  function hace(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(m)) return '';
    if (m < 1) return 'recién'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60); return h < 24 ? 'hace ' + h + ' h' : 'hace ' + Math.floor(h / 24) + ' d';
  }

  // ----------------------------------------------------------------- carga
  function cargar() {
    fetch('data/hoy.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(iniciar).catch(function (e) {
      $('#info-actualizado').textContent = 'Sin datos';
      var a = $('#aviso'); a.hidden = false;
      a.textContent = 'No pude cargar data/hoy.json (' + e.message + '). Si abriste el archivo con doble clic, servilo con: python3 -m http.server -d docs';
    });
  }

  function iniciar(d) {
    S.data = d; S.filas = d.filas;
    S.porClave = new Map(d.filas.map(function (r) { return [clave(r), r]; }));
    S.guardadas = leer(CLAVE_GUARDADAS, []);
    var t = leer(CLAVE_TICKET, null);
    if (t && t.fecha === d.fecha && Array.isArray(t.legs)) S.ticket = t.legs.filter(function (l) { return S.porClave.has(l.key); });
    if (t && typeof t.stake === 'number') S.stake = t.stake;
    cabecera(); partidos(); selectorMercados(); metodo(); sugeridas();
    enlazar(); aplicarFiltros(); pintarTicket();
  }

  function cabecera() {
    var d = S.data, f = d.fecha.split('-').reverse().join('/');
    $('#info-actualizado').textContent = 'Datos del ' + f + ' · actualizado ' + hace(d.generado_en) +
      (d.reporte_lesiones ? ' · reporte de lesiones ' + d.reporte_lesiones.slice(11) + ' ET' : '');
    var avisos = (d.avisos || []).slice();
    var hoyET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    if (d.fecha !== hoyET) avisos.unshift('Estos datos son del ' + f + ', no de hoy. Corré el script o esperá la próxima actualización.');
    else if ((Date.now() - new Date(d.generado_en).getTime()) > 6 * 3600e3) avisos.unshift('Los datos tienen más de 6 horas: las lesiones pudieron cambiar. Verificá el reporte antes de apostar.');
    var a = $('#aviso');
    if (avisos.length) { a.hidden = false; a.textContent = avisos.join(' · '); }
  }

  // ----------------------------------------------------------------- partidos
  function partidos() {
    var d = S.data, cont = $('#partidos');
    cont.innerHTML = d.partidos.map(function (p) {
      var desc = p.descanso || {}, tags = [];
      if (p.spread != null) tags.push('<span class="tag">' + esc(p.fav) + ' −' + fL(p.spread) + '</span>');
      else tags.push('<span class="tag medio">sin spread</span>');
      if (p.total != null) tags.push('<span class="tag">O/U ' + fL(p.total) + '</span>');
      if (p.ml && p.ml[p.visita] != null) tags.push('<span class="tag" title="Moneyline">ML ' + esc(p.visita) + ' ' + fmtML(p.ml[p.visita]) + ' · ' + esc(p.local) + ' ' + fmtML(p.ml[p.local]) + '</span>');
      [p.visita, p.local].forEach(function (t) {
        var x = desc[t] || {};
        if (x.b2b) tags.push('<span class="tag alerta" title="Jugó ayer">' + esc(t) + ' back-to-back</span>');
        else if (x.tres_en_cuatro) tags.push('<span class="tag medio" title="3er partido en 4 días">' + esc(t) + ' 3 en 4</span>');
      });
      var pb = p.p_blowout, nivel = pb == null ? '' : pb >= .45 ? 'alerta' : pb >= .38 ? 'medio' : 'ok';
      var med = pb == null ? '' : '<div><div class="medidor" aria-hidden="true"><i style="width:' + Math.round(pb * 100) + '%"></i></div>' +
        '<span class="tag ' + nivel + '" style="margin-top:6px;display:inline-block" title="Probabilidad de que el margen final supere 14 puntos (titulares al banco)">Riesgo de blowout ' + Math.round(pb * 100) + '%</span></div>';
      var rec1 = p.records && p.records[p.visita] ? ' <small>(' + esc(p.records[p.visita]) + ')</small>' : '';
      var rec2 = p.records && p.records[p.local] ? ' <small>(' + esc(p.records[p.local]) + ')</small>' : '';
      var les = lesiones(p);
      return '<div class="partido" data-gid="' + esc(p.gid) + '">' +
        '<div class="p-cab"><span>' + esc(hora(p.utc)) + ' ART · ' + esc(p.estado_texto) + '</span><span>' + (p.proveedor ? 'spread: ' + esc(p.proveedor) : '') + '</span></div>' +
        '<button type="button" class="p-sel" aria-pressed="false"><span class="p-equipos">' + esc(p.visita) + rec1 + ' <small>@</small> ' + esc(p.local) + rec2 + '</span></button>' +
        '<div class="p-datos">' + tags.join('') + '</div>' + med + les + '</div>';
    }).join('');
  }
  function fmtML(x) { return x == null ? '—' : (x > 0 ? '+' : '') + x; }
  function lesiones(p) {
    var partes = [], n = 0;
    Object.keys(p.lesiones || {}).forEach(function (t) {
      var l = p.lesiones[t] || [];
      var out = l.filter(function (i) { return /out|susp/i.test(i.estado || ''); }).map(function (i) { return i.jugador; });
      var dtd = l.filter(function (i) { return /day|quest|doubt/i.test(i.estado || ''); }).map(function (i) { return i.jugador; });
      if (!out.length && !dtd.length) return;
      n += out.length + dtd.length;
      partes.push('<div><b>' + esc(t) + '</b>' + (out.length ? ' · fuera: ' + esc(out.join(', ')) : '') + (dtd.length ? ' · dudosos: ' + esc(dtd.join(', ')) : '') + '</div>');
    });
    if (!n) return '<div class="p-les">Sin lesionados reportados.</div>';
    return '<details class="p-les"><summary>Lesiones (' + n + ')</summary>' + partes.join('') + '<div style="margin-top:4px">Fuente: ESPN. El estado oficial de la NBA se ve en la etiqueta de cada línea.</div></details>';
  }

  // ----------------------------------------------------------------- filtros y lista
  function selectorMercados() {
    var m = new Map();
    S.filas.forEach(function (r) { m.set(r.m, r.mn); });
    var arr = Array.from(m.entries()).sort(function (a, b) { return a[1].localeCompare(b[1], 'es'); });
    $('#f-mercado').innerHTML = '<option value="">Todos los mercados</option>' + arr.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'; }).join('');
  }

  function aplicarFiltros() {
    var q = norm(S.q), cuentas = { verde: 0, amarillo: 0, rojo: 0 };
    var base = S.filas.filter(function (r) {
      if (S.partido && r.gid !== S.partido) return false;
      if (S.mercado && r.m !== S.mercado) return false;
      if (S.lado && r.lado !== S.lado) return false;
      if (S.soloCuota && r.cu == null) return false;
      if (S.soloCompleto && r.mod !== 'completo') return false;
      if (q && norm(r.j + ' ' + r.eq + ' ' + r.riv).indexOf(q) < 0) return false;
      cuentas[r.c]++;
      return true;
    });
    ['verde', 'amarillo', 'rojo'].forEach(function (c) { $('#n-' + c).textContent = cuentas[c]; });
    var lista = base.filter(function (r) { return S.colores.has(r.c); });
    var rango = { verde: 2, amarillo: 1, rojo: 0 };
    var key = {
      p: function (r) { return rango[r.c] * 10 + r.p; },
      cuota: function (r) { return r.cu == null ? -1 : r.cu; },
      ev: function (r) { return r.cu == null ? -9 : r.p * r.cu - 1; },
      min: function (r) { return r.min; }
    }[S.orden];
    lista.sort(function (a, b) { return key(b) - key(a); });
    S.lista = lista;
    S.mostrar = PAGINA;
    pintarLista();
  }

  function barras(r) {
    var ult = r.ult || [], mx = Math.max.apply(null, ult.concat([r.L * 1.5, 1]));
    return '<span class="barras" role="img" aria-label="Últimos ' + ult.length + ' partidos, el más reciente a la derecha: ' + esc(ult.join(', ')) + '">' +
      ult.map(function (v) {
        var ok = r.lado === 'mas' ? v > r.L : v < r.L;
        return '<i class="' + (ok ? 'ok' : 'no') + '" style="height:' + Math.max(2, Math.round(v / mx * 16)) + 'px" title="' + v + '"></i>';
      }).join('') + '</span>';
  }

  function etiqueta(r) {
    var x = [];
    if (r.est) x.push('<span class="tag ' + (r.est === 'Probable' ? 'medio' : 'alerta') + '">' + esc(r.est) + '</span>');
    r.fl.forEach(function (f) {
      var grave = /blowout alto|back-to-back|lesión: (Questionable|Doubtful)|pocos minutos|no sugerir/.test(f);
      x.push('<span class="tag ' + (grave ? 'alerta' : 'medio') + '">' + esc(f) + '</span>');
    });
    return x.join('');
  }

  function enTicket(r) { var k = clave(r); return S.ticket.find(function (l) { return l.key === k; }); }

  function tarjeta(r) {
    var t = enTicket(r), tags = etiqueta(r);
    var fuentes = [];
    if (r.p_mkt != null) fuentes.push('Casa ' + fP(r.p_mkt));
    if (r.p_sitio != null) fuentes.push('Sitio ' + fP(r.p_sitio));
    if (r.p_propio != null) fuentes.push('Propio ' + fP(r.p_propio));
    var botones = ['mas', 'menos'].map(function (lado) {
      var cu = cuotaLado(r, lado), activo = t && t.lado === lado;
      var rec = lado === r.lado ? ' rec-lado' : '';
      return '<button type="button" class="add' + rec + (activo ? ' en-ticket' : '') + '" data-add="' + lado + '" aria-pressed="' + (activo ? 'true' : 'false') + '">' +
        (activo ? '✓ ' : '+ ') + LADO[lado] + ' ' + fL(r.L) + ' <small>' + (cu ? '@' + fC(cu) : 'sin cuota') + '</small></button>';
    }).join('');
    var h2h = r.rh != null ? ' · H2H <b>' + fP(r.rh) + '</b>' : '';
    return '<article class="linea c-' + r.c + '" data-key="' + esc(clave(r)) + '">' +
      '<span class="punto" role="img" aria-label="Semáforo ' + r.c + '"></span>' +
      '<div class="l-jug"><b>' + esc(r.j) + '</b><span>' + esc(r.eq) + (r.loc ? ' vs ' : ' @ ') + esc(r.riv) + ' · ' + esc(r.pos || '') + (r.rol ? ' · ' + esc(r.rol) : '') + '</span></div>' +
      '<div class="l-apuesta"><span class="rec ' + r.lado + '">' + LADO[r.lado] + ' ' + fL(r.L) + '</span><span>' + esc(r.mn) + (r.per ? ' (' + esc(r.per) + ')' : '') + '</span>' +
      '<span class="prob">' + fP(r.p) + ' <small>prob.' + (r.cu ? ' · @' + fC(r.cu) : '') + '</small></span></div>' +
      '<div class="l-stats"><span>Temporada <b>' + fL(r.pt) + '</b></span><span>Últ. 10 <b>' + fL(r.p10) + '</b></span><span>Proyección <b>' + fL(r.mu) + '</b></span>' +
      '<span>Min <b>' + Math.round(r.min) + '</b></span>' + barras(r) +
      '<span>Acierto: L10 <b>' + fP(r.r10) + '</b> · Temp <b>' + fP(r.rt) + '</b>' + h2h + '</span>' +
      (fuentes.length ? '<span title="Probabilidad según cada fuente (lado recomendado)">' + fuentes.join(' · ') + '</span>' : '') +
      (r.aj ? '<span title="' + esc(r.aj) + '">ⓘ ajuste</span>' : '') + '</div>' +
      (tags ? '<div class="l-flags">' + tags + '</div>' : '') +
      '<div class="l-botones">' + botones + '</div></article>';
  }

  function pintarLista() {
    var cont = $('#lineas'), l = S.lista, vis = l.slice(0, S.mostrar);
    $('#contador').textContent = l.length + ' líneas' + (S.mostrar < l.length ? ' · mostrando ' + S.mostrar : '');
    cont.innerHTML = vis.length ? vis.map(tarjeta).join('') : '<div class="vacio">No hay líneas con estos filtros. Probá activar el semáforo rojo o quitar filtros.</div>';
    $('#ver-mas').hidden = S.mostrar >= l.length;
  }

  // ----------------------------------------------------------------- ticket
  function nuevaPata(r, lado) {
    var cu = cuotaLado(r, lado);
    return { key: clave(r), id: r.id, j: r.j, eq: r.eq, riv: r.riv, loc: r.loc, gid: r.gid, m: r.m, mn: r.mn, L: r.L, lado: lado,
      cuota: cu || null, cuotaOrig: cu || null, p: pLado(r, lado), c: r.c, fl: r.fl.slice(), est: r.est };
  }

  function alternar(r, lado) {
    var k = clave(r), i = S.ticket.findIndex(function (l) { return l.key === k; });
    if (i >= 0 && S.ticket[i].lado === lado) { S.ticket.splice(i, 1); }
    else {
      var otro = S.ticket.find(function (l) { return l.id === r.id && l.m === r.m && l.key !== k; });
      if (otro) { alert('Ya tenés ' + r.j + ' en ' + r.mn + ' con otra línea. Quitala primero: dos líneas del mismo jugador y mercado no se pueden combinar.'); return; }
      var pata = nuevaPata(r, lado);
      if (i >= 0) S.ticket[i] = pata; else S.ticket.push(pata);
    }
    cambioTicket();
  }

  function cambioTicket() {
    guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake });
    pintarTicket();
    // refrescar los botones de las tarjetas visibles
    document.querySelectorAll('#lineas .linea').forEach(function (el) {
      var r = S.porClave.get(el.dataset.key); if (!r) return;
      var t = enTicket(r);
      el.querySelectorAll('.add').forEach(function (b) {
        var lado = b.dataset.add, activo = !!t && t.lado === lado, cu = cuotaLado(r, lado);
        b.classList.toggle('en-ticket', activo); b.setAttribute('aria-pressed', activo ? 'true' : 'false');
        b.innerHTML = (activo ? '✓ ' : '+ ') + LADO[lado] + ' ' + fL(r.L) + ' <small>' + (cu ? '@' + fC(cu) : 'sin cuota') + '</small>';
      });
    });
  }

  function calcular() {
    var legs = S.ticket, patas = legs.map(function (l) { return { id: l.id, eq: l.eq, gid: l.gid, m: l.m, lado: l.lado, p: l.p }; });
    var cj = legs.length ? window.Correlacion.conjunta(patas) : { indep: 1, conj: 1, correlacionadas: 0 };
    var completa = legs.length && legs.every(function (l) { return l.cuota && l.cuota > 1; });
    var cuota = completa ? legs.reduce(function (a, l) { return a * l.cuota; }, 1) : null;
    return { indep: cj.indep, conj: cj.conj, corr: cj.correlacionadas, cuota: cuota,
      impl: cuota ? 1 / cuota : null, ev: cuota ? cj.conj * cuota - 1 : null };
  }

  function veredicto(c) {
    var legs = S.ticket;
    if (!legs.length) return null;
    var peor = legs.some(function (l) { return l.c === 'rojo'; }) ? 'rojo' : legs.some(function (l) { return l.c === 'amarillo'; }) ? 'amarillo' : 'verde';
    var color = peor, txt;
    if (c.conj < 0.10) { color = 'rojo'; txt = 'Muy improbable: la probabilidad conjunta es menor al 10%. Más patas = más cuota pero mucho más riesgo.'; }
    else if (c.conj < 0.20 && color === 'verde') { color = 'amarillo'; }
    if (!txt) {
      txt = color === 'verde' ? 'Combinada de riesgo bajo dentro de lo que es una combinada: todas las patas verdes.' :
        color === 'amarillo' ? 'Riesgo medio: hay patas amarillas o la probabilidad conjunta es baja.' :
          'Riesgo alto: incluye patas rojas.';
    }
    return { color: color, txt: txt };
  }

  function avisosTicket(c) {
    var legs = S.ticket, a = [];
    var porJug = {}, porJuego = {};
    legs.forEach(function (l) { (porJug[l.id] = porJug[l.id] || []).push(l); (porJuego[l.gid] = porJuego[l.gid] || []).push(l); });
    Object.keys(porJug).forEach(function (k) { if (porJug[k].length > 1) a.push(porJug[k][0].j + ' aparece ' + porJug[k].length + ' veces: las patas están correlacionadas (la probabilidad ya lo considera) y la casa puede rechazarlas o cambiar la cuota.'); });
    Object.keys(porJuego).forEach(function (k) { var n = porJuego[k].length; if (n > 1) a.push(n + ' patas del mismo partido (' + porJuego[k][0].eq + ' vs ' + porJuego[k][0].riv + '): algunas casas solo las aceptan como combinada del mismo partido, con otra cuota.'); });
    if (legs.some(function (l) { return !l.cuota; })) a.push('Faltan cuotas: completá las que digan "sin cuota" (por ejemplo con la de Stake) para ver la cuota total.');
    legs.forEach(function (l) { if (l.est && /Questionable|Doubtful/.test(l.est)) a.push(l.j + ' figura ' + l.est + ': confirmá si juega antes de apostar.'); });
    if (c.ev != null && c.ev > 0.5) a.push('La ventaja estimada es muy alta (+' + Math.round(c.ev * 100) + '%). Es casi seguro que el modelo se equivoca o que la cuota está mal cargada: revisá cada pata.');
    if (legs.length > 6) a.push('Con ' + legs.length + ' patas la probabilidad de acertar todo es baja aunque cada pata sea buena.');
    return a;
  }

  function pintarTicket() {
    var legs = S.ticket, cont = $('#ticket-cuerpo');
    $('#ticket-n').textContent = legs.length;
    if (!legs.length) {
      cont.innerHTML = '<p class="nota">Tocá “+ Más” o “+ Menos” en cualquier línea. Vas a ver la cuota y la probabilidad de la combinada a medida que sumás patas.</p>';
      $('#ticket-resumen').textContent = '—';
      return;
    }
    cont.innerHTML = '<div id="t-patas">' + legs.map(function (l, i) {
      var edit = l.cuotaOrig != null && l.cuota !== l.cuotaOrig;
      return '<div class="pata" data-i="' + i + '"><div><b>' + esc(l.j) + ' · ' + LADO[l.lado] + ' ' + fL(l.L) + '</b>' +
        '<small>' + esc(l.mn) + ' · ' + esc(l.eq) + (l.loc ? ' vs ' : ' @ ') + esc(l.riv) + ' · prob. ' + fP(l.p) + ' · ' + l.c + '</small></div>' +
        '<button type="button" class="quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(l.j) + '">×</button>' +
        '<label>Cuota <input type="number" inputmode="decimal" step="0.01" min="1.01" data-cuota="' + i + '" value="' + (l.cuota || '') + '" placeholder="Stake/Betano">' +
        (l.cuotaOrig != null ? '<span>' + (edit ? 'editada (Betano ' + fC(l.cuotaOrig) + ')' : 'Betano') + '</span>' : '<span>sin cuota de Betano</span>') + '</label></div>';
    }).join('') + '</div><div id="t-totales"></div>';
    pintarTotales();
  }

  function pintarTotales() {
    var c = calcular(), v = veredicto(c), cont = $('#t-totales'); if (!cont) return;
    var gan = c.cuota ? S.stake * c.cuota : null, avs = avisosTicket(c);
    var corrTxt = c.corr ? ' <small>(independiente: ' + fP(c.indep) + ')</small>' : '';
    cont.innerHTML = '<div class="totales">' +
      '<div class="total"><span>Cuota total</span><b>' + (c.cuota ? fC(c.cuota) : '—') + '</b></div>' +
      '<div class="total"><span>Probabilidad (modelo + casa)</span><b>' + fP(c.conj) + '</b>' + corrTxt + '</div>' +
      '<div class="total"><span>Prob. que implica la cuota</span><b>' + (c.impl ? fP(c.impl) : '—') + '</b></div>' +
      '<div class="total"><span>Ventaja vs. cuota (estimada)</span><b>' + (c.ev == null ? '—' : (c.ev > 0 ? '+' : '') + Math.round(c.ev * 100) + '%') + '</b></div>' +
      '</div>' +
      '<div class="stake" style="margin:10px 0"><label for="stake">Apuesta</label><input id="stake" type="number" min="0" step="100" value="' + S.stake + '">' +
      '<span>' + (gan ? 'cobrarías ' + nfDin.format(gan) : '') + '</span></div>' +
      (v ? '<div class="veredicto ' + v.color + '"><b>Semáforo de la combinada: ' + v.color + '.</b> ' + esc(v.txt) + '</div>' : '') +
      (avs.length ? '<ul class="avisos-ticket">' + avs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="nota">La ventaja estimada sale de nuestro modelo, que no está validado contra resultados. Si es muy alta, desconfiá: lo más probable es que el mercado sepa algo que las estadísticas no muestran.</p>' +
      '<div class="acciones"><button type="button" class="btn primario" id="t-guardar">Guardar</button>' +
      '<button type="button" class="btn" id="t-copiar">Copiar texto</button><button type="button" class="btn" id="t-limpiar">Vaciar</button></div>';
    $('#ticket-resumen').textContent = (c.cuota ? '@' + fC(c.cuota) + ' · ' : '') + fP(c.conj);
  }

  function textoTicket() {
    var c = calcular();
    return 'Combinada (' + S.ticket.length + ' patas)' + (c.cuota ? ' — cuota ' + fC(c.cuota) : '') + ' — prob. ' + fP(c.conj) + '\n' +
      S.ticket.map(function (l) { return '• ' + l.j + ' ' + LADO[l.lado] + ' ' + fL(l.L) + ' ' + l.mn + ' (' + l.eq + (l.loc ? ' vs ' : ' @ ') + l.riv + ')' + (l.cuota ? ' @' + fC(l.cuota) : ''); }).join('\n');
  }

  function copiar(txt, btn) {
    var ok = function () { btn.textContent = '¡Copiado!'; setTimeout(function () { btn.textContent = 'Copiar texto'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { window.prompt('Copiá el texto:', txt); });
    else window.prompt('Copiá el texto:', txt);
  }

  function pintarGuardadas() {
    var g = S.guardadas, cont = $('#guardadas');
    if (!g.length) { cont.innerHTML = '<p class="nota">Todavía no guardaste combinadas.</p>'; return; }
    cont.innerHTML = g.map(function (x, i) {
      return '<div class="guardada"><span><b>' + esc(x.nombre) + '</b><br><small>' + x.legs.length + ' patas · ' + (x.cuota ? '@' + fC(x.cuota) + ' · ' : '') + fP(x.p) + '</small></span>' +
        '<span><button type="button" class="btn" data-cargar="' + i + '">Cargar</button> <button type="button" class="btn" data-borrar="' + i + '" aria-label="Borrar">×</button></span></div>';
    }).join('');
  }

  // ----------------------------------------------------------------- sugeridas
  function armarSugerida(n) {
    var pool = S.filas.filter(function (r) { return r.c === 'verde' && r.cu != null && r.mod === 'completo'; }).sort(function (a, b) { return b.p - a.p; });
    function intentar(porJuego, maxMercado) {
      var legs = [], jug = new Set(), jue = {}, mer = {};
      for (var i = 0; i < pool.length && legs.length < n; i++) {
        var r = pool[i];
        if (jug.has(r.id) || (jue[r.gid] || 0) >= porJuego || (mer[r.m] || 0) >= maxMercado) continue;
        legs.push(r); jug.add(r.id); jue[r.gid] = (jue[r.gid] || 0) + 1; mer[r.m] = (mer[r.m] || 0) + 1;
      }
      return legs;
    }
    var legs = intentar(1, 1);
    if (legs.length < n) legs = intentar(1, 2);
    if (legs.length < n) legs = intentar(2, 2);
    return legs;
  }
  function sugeridas() {
    $('#sugeridas').innerHTML = [3, 4, 5].map(function (n) { return '<button type="button" class="btn" data-sug="' + n + '">' + n + ' patas</button>'; }).join('');
  }

  // ----------------------------------------------------------------- método
  function metodo() {
    var m = S.data.modelo || {};
    $('#metodo').innerHTML =
      '<h4>De dónde salen los datos</h4><p>Líneas, promedios, minutos, lesiones y cuotas de Betano/bet365: <a href="https://ludoprops.com" rel="noopener">LudoProps</a>. Spread, total y moneyline: ESPN (DraftKings). Back-to-back: calendario de ESPN de los 3 días previos. <b>Stake no tiene API pública</b>: editá la cuota de cada pata en la combinada.</p>' +
      '<h4>Probabilidad de cada línea</h4><p>El <b>modelo</b> promedia dos estimaciones: la del sitio (proyección de minutos y rol) y una propia (proyección ± variabilidad de los últimos 10 partidos, con distribución binomial negativa para cifras bajas). Antes se ajusta por <b>riesgo de blowout</b> (spread → probabilidad de que el margen supere ' + (m.umbral_blowout || 14.5) + ' puntos → minutos que pierden los titulares) y por <b>back-to-back</b>. Cuando la línea tiene cuota, el resultado final es el <b>promedio entre el modelo y la probabilidad de la casa</b> sin su margen: si siempre se elige el lado donde el modelo más discrepa con la casa, se sobreestima la probabilidad. Las líneas donde el modelo supera a la casa por más de 20 puntos se marcan.</p>' +
      '<h4>Semáforo</h4><ul><li><b>Verde:</b> probabilidad ≥ 60%, los tres promedios (temporada, últimos 10 y proyección) del mismo lado de la línea por al menos 4%, al menos dos de tres tasas de acierto a favor y ninguna en contra, ≥ 24 minutos proyectados, minutos estables, sin lesión y sin riesgo alto de blowout ni back-to-back.</li><li><b>Amarillo:</b> probabilidad ≥ 55% con casi todo a favor, pero con una alerta (blowout, muestra chica, minutos irregulares, modelo básico).</li><li><b>Rojo:</b> el resto. Automático si el jugador es dudoso (Questionable/Doubtful), el sitio lo marca "no sugerir" o juega pocos minutos.</li></ul>' +
      '<h4>Combinadas</h4><p>La probabilidad conjunta usa una cópula gaussiana: patas del mismo jugador se tratan como correlacionadas (según estadísticas compartidas) y las del mismo partido con una correlación leve. Entre partidos distintos se asumen independientes.</p>' +
      '<h4>Límites</h4><ul><li>Las probabilidades salen de un modelo <b>sin validar contra resultados</b>: no hay cuotas históricas para comprobarlo. Esta página guarda una foto diaria en <code>docs/data/historial/</code> para poder hacerlo más adelante.</li><li>Muestra chica: estamos a pocos partidos del inicio de temporada.</li><li>El defensa-por-posición se muestra solo como contexto: hay poca evidencia de que prediga.</li><li>Las lesiones cambian hasta minutos antes del partido. Verificá antes de apostar.</li><li>Esto es análisis estadístico, no una garantía ni consejo financiero. Apostá solo lo que puedas perder.</li></ul>';
  }

  // ----------------------------------------------------------------- eventos
  function abrirTicket(abrir) {
    var t = $('#ticket'), movil = window.matchMedia('(max-width: 980px)').matches;
    t.classList.toggle('abierto', abrir);
    $('#fondo').hidden = !(abrir && movil);
    if (abrir && !movil) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function enlazar() {
    $('#f-color').addEventListener('click', function (e) {
      var b = e.target.closest('.sem'); if (!b) return;
      var c = b.dataset.c, on = !S.colores.has(c);
      if (on) S.colores.add(c); else S.colores.delete(c);
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); aplicarFiltros();
    });
    var t; $('#f-q').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { S.q = v; aplicarFiltros(); }, 150); });
    $('#f-mercado').addEventListener('change', function (e) { S.mercado = e.target.value; aplicarFiltros(); });
    $('#f-lado').addEventListener('change', function (e) { S.lado = e.target.value; aplicarFiltros(); });
    $('#f-orden').addEventListener('change', function (e) { S.orden = e.target.value; aplicarFiltros(); });
    $('#f-cuota').addEventListener('change', function (e) { S.soloCuota = e.target.checked; aplicarFiltros(); });
    $('#f-completo').addEventListener('change', function (e) { S.soloCompleto = e.target.checked; aplicarFiltros(); });
    $('#ver-mas').addEventListener('click', function () { S.mostrar += PAGINA; pintarLista(); });

    $('#partidos').addEventListener('click', function (e) {
      var b = e.target.closest('.p-sel'); if (!b) return;
      var gid = b.closest('.partido').dataset.gid;
      S.partido = S.partido === gid ? '' : gid; marcarPartido(); aplicarFiltros();
    });
    $('#todos-partidos').addEventListener('click', function () { S.partido = ''; marcarPartido(); aplicarFiltros(); });

    $('#lineas').addEventListener('click', function (e) {
      var b = e.target.closest('.add'); if (!b) return;
      var r = S.porClave.get(b.closest('.linea').dataset.key); if (r) alternar(r, b.dataset.add);
    });

    $('#abrir-ticket').addEventListener('click', function () { abrirTicket(!$('#ticket').classList.contains('abierto')); });
    $('#cerrar-ticket').addEventListener('click', function () { abrirTicket(false); });
    $('#fondo').addEventListener('click', function () { abrirTicket(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') abrirTicket(false); });

    $('#ticket-cuerpo').addEventListener('click', function (e) {
      var q = e.target.closest('[data-quitar]');
      if (q) { S.ticket.splice(+q.dataset.quitar, 1); cambioTicket(); return; }
      if (e.target.id === 't-limpiar') { S.ticket = []; cambioTicket(); return; }
      if (e.target.id === 't-copiar') { copiar(textoTicket(), e.target); return; }
      if (e.target.id === 't-guardar') {
        var c = calcular(), nombre = window.prompt('Nombre de la combinada:', 'Combinada ' + (S.guardadas.length + 1));
        if (nombre === null) return;
        S.guardadas.unshift({ nombre: nombre || 'Combinada', fecha: S.data.fecha, legs: JSON.parse(JSON.stringify(S.ticket)), cuota: c.cuota, p: c.conj });
        guardar(CLAVE_GUARDADAS, S.guardadas); pintarGuardadas();
      }
    });
    $('#ticket-cuerpo').addEventListener('input', function (e) {
      var inp = e.target;
      if (inp.dataset.cuota != null) {
        var v = parseFloat(String(inp.value).replace(',', '.')), l = S.ticket[+inp.dataset.cuota];
        l.cuota = v > 1 ? v : null;
        guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake });
        var sp = inp.parentNode.querySelector('span');
        if (sp) sp.textContent = l.cuotaOrig != null ? (l.cuota !== l.cuotaOrig ? 'editada (Betano ' + fC(l.cuotaOrig) + ')' : 'Betano') : 'sin cuota de Betano';
        pintarTotales();
      } else if (inp.id === 'stake') {
        S.stake = Math.max(0, parseFloat(inp.value) || 0);
        guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake });
        var c = calcular(), sp2 = inp.parentNode.querySelector('span:last-child');
        if (sp2) sp2.textContent = c.cuota ? 'cobrarías ' + nfDin.format(S.stake * c.cuota) : '';
      }
    });

    $('#sugeridas').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sug]'); if (!b) return;
      var n = +b.dataset.sug, legs = armarSugerida(n);
      if (legs.length < n) { alert('Hoy no hay suficientes líneas verdes con cuota para armar ' + n + ' patas (' + legs.length + ' disponibles).'); }
      if (!legs.length) return;
      S.ticket = legs.map(function (r) { return nuevaPata(r, r.lado); });
      cambioTicket(); abrirTicket(true);
    });
    $('#guardadas').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cargar]'), b = e.target.closest('[data-borrar]');
      if (c) { S.ticket = JSON.parse(JSON.stringify(S.guardadas[+c.dataset.cargar].legs)); cambioTicket(); }
      if (b) { S.guardadas.splice(+b.dataset.borrar, 1); guardar(CLAVE_GUARDADAS, S.guardadas); pintarGuardadas(); }
    });
    pintarGuardadas();
  }

  function marcarPartido() {
    document.querySelectorAll('#partidos .partido').forEach(function (el) {
      var on = el.dataset.gid === S.partido;
      el.classList.toggle('sel', on); el.querySelector('.p-sel').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('#todos-partidos').setAttribute('aria-pressed', S.partido ? 'false' : 'true');
  }

  cargar();
})();
