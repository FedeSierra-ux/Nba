/* NBA Semáforo — interfaz. Lee data/hoy.json (generado por scripts/actualizar.py).
   Cada «grupo» es un jugador + mercado con todas sus líneas «más de» (escalera). */
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
  var RANGO = { verde: 2, amarillo: 1, rojo: 0 };
  var CLAVE_TICKET = 'nba_semaforo_ticket_v2', CLAVE_GUARDADAS = 'nba_semaforo_guardadas_v2';
  var PAGINA = 40;
  var GRUPOS = { pts: ['pts'], reb: ['reb'], ast: ['ast'], combos: ['pra', 'pr', 'pa', 'ra'] };
  var PRINCIPALES = ['pts', 'reb', 'ast', 'pra', 'pr', 'pa', 'ra'];

  var S = {
    data: null, grupos: [], porClave: new Map(), partido: '', grupo: 'todos', colores: new Set(['verde', 'amarillo']),
    minP: 0.70, q: '', mercado: '', orden: 'cuota', soloCuota: false, soloCompleto: false, menos: false,
    mostrar: PAGINA, ticket: [], guardadas: [], stake: 1000, lista: [], abiertos: new Set()
  };

  // ----------------------------------------------------------------- almacenamiento (puede fallar: modo privado, etc.)
  function leer(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ } }

  // ----------------------------------------------------------------- utilidades
  var gkey = function (g) { return g.id + '|' + g.m + '|' + (g.per || ''); };
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
  var fmtML = function (x) { return x == null ? '—' : (x > 0 ? '+' : '') + x; };
  var cuotaDe = function (s) { return s.cu != null ? s.cu : (s.cb != null ? s.cb : null); };
  var fuenteDe = function (s) { return s.cu != null ? 'Betano' : (s.cb != null ? 'bet365' : null); };

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
    S.data = d; S.grupos = d.grupos;
    S.porClave = new Map(d.grupos.map(function (g) { return [gkey(g), g]; }));
    S.guardadas = leer(CLAVE_GUARDADAS, []);
    var t = leer(CLAVE_TICKET, null);
    if (t && t.fecha === d.fecha && Array.isArray(t.legs)) S.ticket = t.legs.filter(function (l) { return S.porClave.has(l.gkey); });
    if (t && typeof t.stake === 'number') S.stake = t.stake;
    cabecera(); partidos(); selectorMercados(); metodo(); sugeridasDia();
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
      return '<div class="partido" data-gid="' + esc(p.gid) + '">' +
        '<div class="p-cab"><span>' + esc(hora(p.utc)) + ' ART · ' + esc(p.estado_texto) + '</span><span>' + (p.proveedor ? 'spread: ' + esc(p.proveedor) : '') + '</span></div>' +
        '<button type="button" class="p-sel" aria-pressed="false"><span class="p-equipos">' + esc(p.visita) + rec1 + ' <small>@</small> ' + esc(p.local) + rec2 + '</span></button>' +
        '<div class="p-datos">' + tags.join('') + '</div>' + med + lesiones(p) + '</div>';
    }).join('');
  }
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

  // ----------------------------------------------------------------- selección de la línea que se muestra
  function pasosValidos(g) {
    return S.soloCuota ? g.pasos.filter(function (s) { return cuotaDe(s) != null; }) : g.pasos;
  }
  /* Devuelve la línea «más de» a mostrar para el grupo, o null si no hay ninguna que cumpla. */
  function elegirPaso(g) {
    var base = pasosValidos(g).filter(function (s) { return S.colores.has(s.c); });
    if (!base.length) return null;
    if (S.minP === 'rec') {
      var rec = base.find(function (s) { return s.L === g.rec; });
      if (rec) return rec;
      var mejor = Math.max.apply(null, base.map(function (s) { return RANGO[s.c]; }));
      return base.filter(function (s) { return RANGO[s.c] === mejor; }).reduce(function (a, b) { return b.L > a.L ? b : a; });
    }
    var ok = base.filter(function (s) { return s.p >= S.minP; });
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
    if (q && norm(g.j + ' ' + g.eq + ' ' + g.riv).indexOf(q) < 0) return false;
    return true;
  }

  function selectorMercados() {
    var m = new Map();
    S.grupos.forEach(function (g) { m.set(g.m, g.mn); });
    var arr = Array.from(m.entries()).sort(function (a, b) { return a[1].localeCompare(b[1], 'es'); });
    $('#f-mercado').innerHTML = '<option value="">Cualquier mercado</option>' + arr.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'; }).join('');
  }

  function aplicarFiltros() {
    var q = norm(S.q), cuentas = { verde: 0, amarillo: 0, rojo: 0 }, lista = [];
    S.grupos.forEach(function (g) {
      if (!grupoPasa(g, q)) return;
      // contadores del semáforo: grupos con alguna línea de ese color que cumpla la probabilidad mínima
      var pv = pasosValidos(g);
      ['verde', 'amarillo', 'rojo'].forEach(function (c) {
        if (pv.some(function (s) { return s.c === c && (S.minP === 'rec' || s.p >= S.minP); })) cuentas[c]++;
      });
      var s = elegirPaso(g);
      if (s) lista.push({ g: g, s: s });
    });
    ['verde', 'amarillo', 'rojo'].forEach(function (c) { $('#n-' + c).textContent = cuentas[c]; });
    var key = {
      cuota: function (x) { return cuotaDe(x.s) != null ? cuotaDe(x.s) : x.s.ju; },
      p: function (x) { return x.s.p; },
      sem: function (x) { return RANGO[x.s.c] * 10 + x.s.p; },
      ev: function (x) { return cuotaDe(x.s) == null ? -9 : x.s.p * cuotaDe(x.s) - 1; },
      min: function (x) { return x.g.min; }
    }[S.orden];
    lista.sort(function (a, b) { return key(b) - key(a); });
    S.lista = lista; S.mostrar = PAGINA;
    pintarLista();
  }

  // ----------------------------------------------------------------- tarjetas
  function barras(g, s) {
    var ult = g.ult || [], mx = Math.max.apply(null, ult.concat([s.L * 1.5, 1]));
    return '<span class="barras" role="img" aria-label="Últimos ' + ult.length + ' partidos, el más reciente a la derecha: ' + esc(ult.join(', ')) + '">' +
      ult.map(function (v) {
        return '<i class="' + (v > s.L ? 'ok' : 'no') + '" style="height:' + Math.max(2, Math.round(v / mx * 16)) + 'px" title="' + v + '"></i>';
      }).join('') + '</span>';
  }
  function etiquetas(g, s) {
    var x = [];
    if (g.est) x.push('<span class="tag ' + (g.est === 'Probable' ? 'medio' : 'alerta') + '">' + esc(g.est) + '</span>');
    (g.fl || []).concat(s.fl || []).forEach(function (f) {
      var grave = /blowout alto|back-to-back|lesión: (Questionable|Doubtful)|pocos minutos|no sugerir|mucho más probable/.test(f);
      x.push('<span class="tag ' + (grave ? 'alerta' : 'medio') + '">' + esc(f) + '</span>');
    });
    return x.join('');
  }
  var legDe = function (g, s) { var k = gkey(g); return S.ticket.find(function (l) { return l.gkey === k; }); };

  function botonPaso(g, s, lado) {
    var t = legDe(g, s), activo = !!t && t.L === (lado === 'mas' ? s.L : g.L) && t.lado === lado;
    var cu = lado === 'mas' ? cuotaDe(s) : (g.menos && g.menos.cu);
    return '<button type="button" class="add' + (activo ? ' en-ticket' : '') + '" data-add="' + lado + '" data-l="' + (lado === 'mas' ? s.L : g.L) + '" aria-pressed="' + (activo ? 'true' : 'false') + '">' +
      (activo ? '✓ ' : '+ ') + LADO[lado] + ' ' + fL(lado === 'mas' ? s.L : g.L) + ' <small>' + (cu ? '@' + fC(cu) : 'sin cuota') + '</small></button>';
  }

  function escalera(g, sel) {
    var pasos = g.pasos.slice().sort(function (a, b) { return a.L - b.L; });
    var filas = pasos.map(function (s) {
      var t = legDe(g, s), activo = !!t && t.L === s.L && t.lado === 'mas';
      return '<tr class="paso c-' + s.c + (s.L === sel.L ? ' sel' : '') + '" title="' + esc((s.fl || []).join(' · ')) + '">' +
        '<td><b>+' + fL(s.L) + '</b>' + (s.L === g.L ? ' <small>principal</small>' : '') + '</td>' +
        '<td>' + (s.cu != null ? fC(s.cu) : '—') + '</td><td>' + (s.cb != null ? fC(s.cb) : '—') + '</td>' +
        '<td><b>' + fP(s.p) + '</b></td><td title="1 / probabilidad: si tu casa paga más que esto, hay valor según el modelo">' + fC(s.ju) + '</td>' +
        '<td><span class="punto-mini" aria-label="' + s.c + '"></span></td>' +
        '<td><button type="button" class="add chico' + (activo ? ' en-ticket' : '') + '" data-add="mas" data-l="' + s.L + '" aria-pressed="' + (activo ? 'true' : 'false') + '" aria-label="Agregar más de ' + fL(s.L) + '">' + (activo ? '✓' : '+') + '</button></td></tr>';
    }).join('');
    var menos = '';
    if (S.menos && g.menos) {
      var tm = legDe(g, null), am = !!tm && tm.lado === 'menos';
      menos = '<tr class="paso c-' + g.menos.c + ' menos"><td><b>−' + fL(g.menos.L) + '</b> <small>menos</small></td><td>' + fC(g.menos.cu) + '</td><td>—</td><td><b>' + fP(g.menos.p) + '</b></td><td>' + fC(g.menos.ju) + '</td>' +
        '<td><span class="punto-mini" aria-label="' + g.menos.c + '"></span></td><td><button type="button" class="add chico' + (am ? ' en-ticket' : '') + '" data-add="menos" data-l="' + g.L + '" aria-label="Agregar menos de ' + fL(g.L) + '">' + (am ? '✓' : '+') + '</button></td></tr>';
    }
    var temp = g.temp && g.temp.length ? '<p class="nota">Partidos de la temporada (del más antiguo al más reciente): ' + esc(g.temp.join(', ')) + '</p>' : '';
    return '<div class="escalera"><table><thead><tr><th>Línea</th><th>Betano</th><th>bet365</th><th>Prob.</th><th>Justa</th><th></th><th></th></tr></thead><tbody>' + filas + menos + '</tbody></table>' +
      '<p class="nota"><b>Justa</b> = cuota que haría el modelo (1 / probabilidad). Si tu casa (por ejemplo Stake) paga más que eso, hay valor según el modelo. Pasá el cursor sobre una fila para ver sus alertas.</p>' + temp + '</div>';
  }

  function tarjeta(it) {
    var g = it.g, s = it.s, k = gkey(g), abierto = S.abiertos.has(k);
    var tags = etiquetas(g, s), cu = cuotaDe(s);
    var fuentes = [];
    if (s.pm != null) fuentes.push('Modelo ' + fP(s.pm));
    if (s.pk != null) fuentes.push('Casa ' + fP(s.pk));
    var precio = cu != null ? '@' + fC(cu) + ' <small>' + fuenteDe(s) + '</small> · justa ' + fC(s.ju) : 'sin cuota · <b>justa ' + fC(s.ju) + '</b>';
    return '<article class="linea c-' + s.c + '" data-k="' + esc(k) + '">' +
      '<span class="punto" role="img" aria-label="Semáforo ' + s.c + '"></span>' +
      '<div class="l-jug"><b>' + esc(g.j) + '</b><span>' + esc(g.eq) + (g.loc ? ' vs ' : ' @ ') + esc(g.riv) + ' · ' + esc(g.pos || '') + (g.rol ? ' · ' + esc(g.rol) : '') + '</span></div>' +
      '<div class="l-apuesta"><span class="rec mas">MÁS ' + fL(s.L) + '</span><span>' + esc(g.mn) + (g.per ? ' (' + esc(g.per) + ')' : '') + '</span>' +
      '<span class="prob">' + fP(s.p) + ' <small>prob.</small></span><span class="precio">' + precio + '</span></div>' +
      '<div class="l-stats"><span>Temporada <b>' + fL(g.pt) + '</b></span><span>Últ. 10 <b>' + fL(g.p10) + '</b></span><span>Proyección <b>' + fL(g.mu) + '</b></span>' +
      '<span>Min <b>' + Math.round(g.min) + '</b></span>' + barras(g, s) +
      '<span>Superó +' + fL(s.L) + ': últ. 10 <b>' + fP(s.r10) + '</b>' + (s.rt != null ? ' · temporada <b>' + fP(s.rt) + '</b>' : '') + '</span>' +
      (fuentes.length ? '<span>' + fuentes.join(' · ') + '</span>' : '') +
      (g.aj ? '<span title="' + esc(g.aj) + '">ⓘ ajuste</span>' : '') + '</div>' +
      (tags ? '<div class="l-flags">' + tags + '</div>' : '') +
      '<div class="l-botones">' + botonPaso(g, s, 'mas') +
      '<button type="button" class="desplegar" data-desplegar aria-expanded="' + (abierto ? 'true' : 'false') + '">' + (abierto ? 'Ocultar' : 'Ver todas las líneas (' + g.pasos.length + ')') + ' ' + (abierto ? '▴' : '▾') + '</button></div>' +
      (abierto ? '<div class="l-escalera">' + escalera(g, s) + '</div>' : '') + '</article>';
  }

  function pintarLista() {
    var cont = $('#lineas'), l = S.lista, vis = l.slice(0, S.mostrar);
    var umbral = S.minP === 'rec' ? 'línea recomendada por el semáforo' : 'probabilidad ≥ ' + Math.round(S.minP * 100) + '%';
    $('#contador').textContent = l.length + (l.length === 1 ? ' jugador · ' : ' jugadores · ') + umbral + (S.mostrar < l.length ? ' · mostrando ' + S.mostrar : '');
    cont.innerHTML = vis.length ? vis.map(tarjeta).join('') :
      '<div class="vacio">No hay líneas con estos filtros. Probá bajar la probabilidad mínima, activar el semáforo rojo o quitar filtros.</div>';
    $('#ver-mas').hidden = S.mostrar >= l.length;
  }

  // ----------------------------------------------------------------- ticket
  function nuevaPata(g, s, lado) {
    var k = gkey(g);
    if (lado === 'menos') {
      var m = g.menos || {};
      return { key: k + '|' + g.L + '|menos', gkey: k, id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: g.L, lado: 'menos',
        cuota: m.cu || null, cuotaOrig: m.cu || null, fuente: m.cu ? 'Betano' : null, p: m.p, c: m.c || 'rojo', ju: m.ju, est: g.est, fl: (g.fl || []).slice() };
    }
    var cu = cuotaDe(s);
    return { key: k + '|' + s.L + '|mas', gkey: k, id: g.id, j: g.j, eq: g.eq, riv: g.riv, loc: g.loc, gid: g.gid, m: g.m, mn: g.mn, L: s.L, lado: 'mas',
      cuota: cu, cuotaOrig: cu, fuente: fuenteDe(s), p: s.p, c: s.c, ju: s.ju, est: g.est, fl: (g.fl || []).concat(s.fl || []) };
  }

  function alternar(g, L, lado) {
    var s = g.pasos.find(function (x) { return x.L === L; });
    if (lado === 'mas' && !s) return;
    var nueva = nuevaPata(g, s, lado), i = S.ticket.findIndex(function (l) { return l.gkey === nueva.gkey; });
    if (i >= 0 && S.ticket[i].key === nueva.key) S.ticket.splice(i, 1);   // tocar de nuevo = quitar
    else if (i >= 0) S.ticket[i] = nueva;                                  // otra línea del mismo jugador y mercado: reemplaza
    else S.ticket.push(nueva);
    cambioTicket();
  }

  function cambioTicket() {
    guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake });
    pintarTicket(); pintarLista();
  }

  function calcular() {
    var legs = S.ticket, patas = legs.map(function (l) { return { id: l.id, eq: l.eq, gid: l.gid, m: l.m, lado: l.lado, p: l.p }; });
    var cj = legs.length ? window.Correlacion.conjunta(patas) : { indep: 1, conj: 1, correlacionadas: 0 };
    var completa = legs.length && legs.every(function (l) { return l.cuota && l.cuota > 1; });
    var cuota = completa ? legs.reduce(function (a, l) { return a * l.cuota; }, 1) : null;
    return { indep: cj.indep, conj: cj.conj, corr: cj.correlacionadas, cuota: cuota,
      impl: cuota ? 1 / cuota : null, ev: cuota ? cj.conj * cuota - 1 : null, justa: cj.conj > 0 ? 1 / cj.conj : null };
  }

  function veredicto(c) {
    var legs = S.ticket;
    if (!legs.length) return null;
    var color = legs.some(function (l) { return l.c === 'rojo'; }) ? 'rojo' : legs.some(function (l) { return l.c === 'amarillo'; }) ? 'amarillo' : 'verde', txt;
    if (c.conj < 0.10) { color = 'rojo'; txt = 'Muy improbable: la probabilidad conjunta es menor al 10%. Más patas = más cuota pero mucho más riesgo.'; }
    else if (c.conj < 0.20 && color === 'verde') color = 'amarillo';
    if (!txt) txt = color === 'verde' ? 'Todas las patas son verdes y la probabilidad conjunta es razonable.' :
      color === 'amarillo' ? 'Riesgo medio: hay patas amarillas o la probabilidad conjunta es baja.' : 'Riesgo alto: incluye patas rojas.';
    return { color: color, txt: txt };
  }

  function avisosTicket(c) {
    var legs = S.ticket, a = [], porJug = {}, porJuego = {};
    legs.forEach(function (l) { (porJug[l.id] = porJug[l.id] || []).push(l); (porJuego[l.gid] = porJuego[l.gid] || []).push(l); });
    Object.keys(porJug).forEach(function (k) { if (porJug[k].length > 1) a.push(porJug[k][0].j + ' aparece ' + porJug[k].length + ' veces: las patas están correlacionadas (la probabilidad ya lo considera) y la casa puede rechazarlas o cambiar la cuota.'); });
    Object.keys(porJuego).forEach(function (k) { var n = porJuego[k].length; if (n > 1) a.push(n + ' patas del mismo partido (' + porJuego[k][0].eq + ' vs ' + porJuego[k][0].riv + '): algunas casas solo las aceptan como combinada del mismo partido, con otra cuota.'); });
    if (legs.some(function (l) { return !l.cuota; })) a.push('Faltan cuotas: completá las que digan "sin cuota" (por ejemplo con la de Stake) para ver la cuota total.');
    legs.forEach(function (l) { if (l.est && /Questionable|Doubtful/.test(l.est)) a.push(l.j + ' figura ' + l.est + ': confirmá si juega antes de apostar.'); });
    if (c.ev != null && c.ev > 0.5) a.push('La ventaja estimada es muy alta (+' + Math.round(c.ev * 100) + '%). Es casi seguro que el modelo se equivoca o que la cuota está mal cargada: revisá cada pata.');
    if (legs.length > 6) a.push('Con ' + legs.length + ' patas la probabilidad de acertar todo es baja aunque cada pata sea buena.');
    return a;
  }

  var etiquetaFuente = function (l) { return l.cuotaOrig != null ? (l.cuota !== l.cuotaOrig ? 'editada (' + l.fuente + ' ' + fC(l.cuotaOrig) + ')' : l.fuente) : 'sin cuota publicada · justa ' + fC(l.ju); };

  function pintarTicket() {
    var legs = S.ticket, cont = $('#ticket-cuerpo');
    $('#ticket-n').textContent = legs.length;
    if (!legs.length) {
      cont.innerHTML = '<p class="nota">Tocá “+ MÁS” en una línea, o abrí «Ver todas las líneas» y elegí la que te convenga. Vas a ver la cuota y la probabilidad de la combinada a medida que sumás patas.</p>';
      $('#ticket-resumen').textContent = '—';
      return;
    }
    cont.innerHTML = '<div id="t-patas">' + legs.map(function (l, i) {
      return '<div class="pata" data-i="' + i + '"><div><b>' + esc(l.j) + ' · ' + LADO[l.lado] + ' ' + fL(l.L) + '</b>' +
        '<small>' + esc(l.mn) + ' · ' + esc(l.eq) + (l.loc ? ' vs ' : ' @ ') + esc(l.riv) + ' · prob. ' + fP(l.p) + ' · ' + l.c + '</small></div>' +
        '<button type="button" class="quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(l.j) + '">×</button>' +
        '<label>Cuota <input type="number" inputmode="decimal" step="0.01" min="1.01" data-cuota="' + i + '" value="' + (l.cuota || '') + '" placeholder="ej. Stake">' +
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
      '<div class="total"><span>Probabilidad (modelo + casa)</span><b>' + fP(c.conj) + '</b>' + corrTxt + '</div>' +
      '<div class="total"><span>Cuota justa de la combinada</span><b>' + (c.justa ? fC(c.justa) : '—') + '</b></div>' +
      '<div class="total"><span>Ventaja vs. cuota (estimada)</span><b>' + (c.ev == null ? '—' : (c.ev > 0 ? '+' : '') + Math.round(c.ev * 100) + '%') + '</b></div>' +
      '</div>' +
      '<div class="stake" style="margin:10px 0"><label for="stake">Apuesta</label><input id="stake" type="number" min="0" step="100" value="' + S.stake + '">' +
      '<span>' + (gan ? 'cobrarías ' + nfDin.format(gan) : '') + '</span></div>' +
      (v ? '<div class="veredicto ' + v.color + '"><b>Semáforo de la combinada: ' + v.color + '.</b> ' + esc(v.txt) + '</div>' : '') +
      (avs.length ? '<ul class="avisos-ticket">' + avs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="nota">Si tu casa paga más que la cuota justa, el modelo ve valor. Pero el modelo no está validado contra resultados: desconfiá de las ventajas muy altas.</p>' +
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

  // ----------------------------------------------------------------- combinadas sugeridas del día
  var COMBOS = [];
  function sugeridasDia() {
    COMBOS = window.Sugeridas.todas(S.grupos).map(function (c) {
      var patas = c.legs.map(function (l) { return { id: l.g.id, eq: l.g.eq, gid: l.g.gid, m: l.g.m, lado: 'mas', p: l.s.p }; });
      var cj = window.Correlacion.conjunta(patas);
      c.cuota = c.legs.reduce(function (a, l) { return a * l.cu; }, 1);
      c.p = cj.conj; c.indep = cj.indep;
      return c;
    });
    var cont = $('#sug-dia');
    if (!COMBOS.length) { cont.innerHTML = '<div class="vacio">Hoy no hay suficientes líneas verdes o amarillas con cuota para armar combinadas sugeridas.</div>'; return; }
    cont.innerHTML = COMBOS.map(function (c, i) {
      var uno = c.p > 0 ? Math.round(1 / c.p) : null;
      return '<article class="comb comb-' + c.id + '">' +
        '<div class="comb-cab"><span class="comb-tipo"><span class="comb-punto"></span>' + esc(c.nombre) + '</span><span class="comb-meta">' + c.n + ' patas · cuota ≥ ' + fC(c.T) + '</span></div>' +
        '<div class="comb-nums"><div><b>@' + fC(c.cuota) + '</b><span>cuota total</span></div><div><b>' + fP(c.p) + '</b><span>probabilidad' + (uno ? ' (1 de ' + uno + ')' : '') + '</span></div><div><b>' + fC(1 / c.p) + '</b><span>cuota justa</span></div></div>' +
        '<ul class="comb-patas">' + c.legs.map(function (l) {
          return '<li><b>' + esc(l.g.j) + '</b> MÁS ' + fL(l.s.L) + ' ' + esc(l.g.mn) + '<small>' + esc(l.g.eq) + (l.g.loc ? ' vs ' : ' @ ') + esc(l.g.riv) + ' · ' + fP(l.s.p) + ' · @' + fC(l.cu) + ' ' + esc(fuenteDe(l.s)) + ' · <span class="dot ' + l.s.c + '"></span>' + l.s.c + '</small></li>';
        }).join('') + '</ul>' +
        '<p class="nota">' + esc(c.resumen) + '</p>' +
        '<button type="button" class="btn primario" data-comb="' + i + '">Cargar en mi combinada</button></article>';
    }).join('');
  }
  function cargarCombo(i) {
    var c = COMBOS[i]; if (!c) return;
    S.ticket = c.legs.map(function (l) { return nuevaPata(l.g, l.s, 'mas'); });
    cambioTicket(); abrirTicket(true);
  }

  // ----------------------------------------------------------------- método
  function metodo() {
    var m = S.data.modelo || {};
    $('#metodo').innerHTML =
      '<h4>De dónde salen los datos</h4><p>Líneas, promedios, minutos, lesiones y cuotas de Betano/bet365 (con su escalera de líneas «más de»): <a href="https://ludoprops.com" rel="noopener">LudoProps</a>. Spread, total y moneyline: ESPN (DraftKings). Back-to-back: calendario de ESPN de los 3 días previos. <b>Stake no tiene API pública</b>: editá la cuota de cada pata en la combinada y compará con la <b>cuota justa</b>.</p>' +
      '<h4>Escalera de líneas</h4><p>Para puntos, rebotes y asistencias se bajan las cuotas reales de Betano y bet365 de cada línea. Donde la casa no publica una línea (por ejemplo un +3,5 muy bajo) o en los demás mercados, la línea se calcula con el modelo y aparece sin cuota, con su <b>cuota justa</b> (1 / probabilidad). El modelo de cada línea se ajusta con la misma corrección que la línea principal.</p>' +
      '<h4>Probabilidad de cada línea</h4><p>El <b>modelo</b> promedia la estimación del sitio (proyección de minutos y rol) y una propia (proyección ± variabilidad de los últimos 10 partidos, con distribución binomial negativa para cifras bajas). Antes se ajusta por <b>riesgo de blowout</b> (spread → probabilidad de que el margen supere ' + (m.umbral_blowout || 14.5) + ' puntos → minutos que pierden los titulares) y por <b>back-to-back</b>. Cuando la línea tiene cuota, el resultado final es el <b>promedio entre el modelo y la probabilidad de la casa</b> sin su margen. Las líneas donde el modelo supera a la casa por más de 20 puntos se marcan.</p>' +
      '<h4>Semáforo (por línea)</h4><ul><li><b>Verde:</b> probabilidad ≥ 60%, promedios de temporada, últimos 10 y proyección por encima de la línea (≥ 4%), tasas de acierto a favor y ninguna en contra, ≥ 24 minutos, minutos estables, sin lesión y sin riesgo alto de blowout ni back-to-back (salvo que la línea sea muy segura).</li><li><b>Amarillo:</b> probabilidad ≥ 55% con casi todo a favor, pero con una alerta.</li><li><b>Rojo:</b> el resto. Automático si el jugador es dudoso (Questionable/Doubtful), el sitio lo marca "no sugerir" o juega pocos minutos.</li></ul>' +
      '<h4>Combinadas sugeridas</h4><p><b>Segura</b> (3 y 4 patas, cuota ≥ 1,99), <b>Intermedia</b> (4 y 5 patas, cuota ≥ 5) y <b>Soñadora</b> (7 patas, cuota ≥ 20). Para cada una se resuelve un problema de mochila: elegir las patas «más de» que maximizan la probabilidad conjunta con la cuota mínima, con un jugador por pata y solo líneas con cuota publicada, modelo completo y sin jugadores dudosos. La Segura usa solo líneas verdes de al menos 72%; la Intermedia, verdes y amarillas de al menos 60%; la Soñadora, de al menos 50%. Ninguna línea supera 96% porque siempre queda un riesgo que las estadísticas no ven.</p>' +
      '<h4>Combinadas</h4><p>La probabilidad conjunta usa una cópula gaussiana: patas del mismo jugador se tratan como correlacionadas y las del mismo partido con una correlación leve. Entre partidos distintos se asumen independientes. Una línea muy segura paga poco: la cuota total es el producto de las cuotas.</p>' +
      '<h4>Límites</h4><ul><li>Las probabilidades salen de un modelo <b>sin validar contra resultados</b>: no hay cuotas históricas para comprobarlo. Cada corrida guarda una foto del día en <code>docs/data/historial/</code> para poder hacerlo más adelante.</li><li>Muestra chica: estamos a pocos partidos del inicio de temporada.</li><li>El defensa-por-posición se muestra solo como contexto: hay poca evidencia de que prediga.</li><li>Las lesiones cambian hasta minutos antes del partido. Verificá antes de apostar.</li><li>Esto es análisis estadístico, no una garantía ni consejo financiero. Apostá solo lo que puedas perder.</li></ul>';
  }

  // ----------------------------------------------------------------- eventos
  function abrirTicket(abrir) {
    var t = $('#ticket'), movil = window.matchMedia('(max-width: 980px)').matches;
    t.classList.toggle('abierto', abrir);
    $('#fondo').hidden = !(abrir && movil);
    if (abrir && !movil) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function marcarPartido() {
    document.querySelectorAll('#partidos .partido').forEach(function (el) {
      var on = el.dataset.gid === S.partido;
      el.classList.toggle('sel', on); el.querySelector('.p-sel').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('#todos-partidos').setAttribute('aria-pressed', S.partido ? 'false' : 'true');
  }

  function enlazar() {
    $('#f-color').addEventListener('click', function (e) {
      var b = e.target.closest('.sem'); if (!b) return;
      var c = b.dataset.c, on = !S.colores.has(c);
      if (on) S.colores.add(c); else S.colores.delete(c);
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); aplicarFiltros();
    });
    $('#f-grupo').addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]'); if (!b) return;
      S.grupo = b.dataset.g;
      document.querySelectorAll('#f-grupo .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      aplicarFiltros();
    });
    var t; $('#f-q').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { S.q = v; aplicarFiltros(); }, 150); });
    $('#f-prob').addEventListener('change', function (e) { S.minP = e.target.value === 'rec' ? 'rec' : parseFloat(e.target.value); aplicarFiltros(); });
    $('#f-mercado').addEventListener('change', function (e) { S.mercado = e.target.value; aplicarFiltros(); });
    $('#f-orden').addEventListener('change', function (e) { S.orden = e.target.value; aplicarFiltros(); });
    $('#f-cuota').addEventListener('change', function (e) { S.soloCuota = e.target.checked; aplicarFiltros(); });
    $('#f-completo').addEventListener('change', function (e) { S.soloCompleto = e.target.checked; aplicarFiltros(); });
    $('#f-menos').addEventListener('change', function (e) { S.menos = e.target.checked; pintarLista(); });
    $('#ver-mas').addEventListener('click', function () { S.mostrar += PAGINA; pintarLista(); });

    $('#partidos').addEventListener('click', function (e) {
      var b = e.target.closest('.p-sel'); if (!b) return;
      var gid = b.closest('.partido').dataset.gid;
      S.partido = S.partido === gid ? '' : gid; marcarPartido(); aplicarFiltros();
    });
    $('#todos-partidos').addEventListener('click', function () { S.partido = ''; marcarPartido(); aplicarFiltros(); });

    $('#lineas').addEventListener('click', function (e) {
      var art = e.target.closest('.linea'); if (!art) return;
      var g = S.porClave.get(art.dataset.k); if (!g) return;
      if (e.target.closest('[data-desplegar]')) {
        if (S.abiertos.has(art.dataset.k)) S.abiertos.delete(art.dataset.k); else S.abiertos.add(art.dataset.k);
        pintarLista(); return;
      }
      var b = e.target.closest('.add'); if (!b) return;
      alternar(g, parseFloat(b.dataset.l), b.dataset.add);
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
        var sp = inp.parentNode.querySelector('span'); if (sp) sp.textContent = etiquetaFuente(l);
        pintarTotales();
      } else if (inp.id === 'stake') {
        S.stake = Math.max(0, parseFloat(inp.value) || 0);
        guardar(CLAVE_TICKET, { fecha: S.data.fecha, legs: S.ticket, stake: S.stake });
        var c = calcular(), sp2 = inp.parentNode.querySelector('span:last-child');
        if (sp2) sp2.textContent = c.cuota ? 'cobrarías ' + nfDin.format(S.stake * c.cuota) : '';
      }
    });

    $('#sug-dia').addEventListener('click', function (e) {
      var b = e.target.closest('[data-comb]'); if (b) cargarCombo(+b.dataset.comb);
    });
    $('#guardadas').addEventListener('click', function (e) {
      var c = e.target.closest('[data-cargar]'), b = e.target.closest('[data-borrar]');
      if (c) { S.ticket = JSON.parse(JSON.stringify(S.guardadas[+c.dataset.cargar].legs)).filter(function (l) { return S.porClave.has(l.gkey); }); cambioTicket(); }
      if (b) { S.guardadas.splice(+b.dataset.borrar, 1); guardar(CLAVE_GUARDADAS, S.guardadas); pintarGuardadas(); }
    });
    pintarGuardadas();
  }

  cargar();
})();
