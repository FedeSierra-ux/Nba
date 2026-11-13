/* NBA Semáforo — panel «En vivo» de la combinada.
   Para las patas de la combinada (y de las apuestas abiertas de hoy) en partidos en juego, consulta el resumen de ESPN
   (site.api.espn.com/…/summary?event=<id>, CORS abierto): una consulta por partido en vivo cada 45 s, solo mientras la
   combinada está a la vista y la pestaña del navegador está visible.
   El primer bloque son funciones puras (nombres, lectura del resumen, avance de cada pata): se prueban en Node (tests/vivo.test.js). */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ funciones puras
  var SUFIJOS = /\b(jr|sr|ii|iii|iv|v)\b/g;
  /* «Nikola Jokić», «JOKIC, Nikola»… → «nikola jokic»; sin tildes, puntuación ni sufijos (Jr., Sr., II, III, IV). */
  function normNombre(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[.'’`´]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(SUFIJOS, ' ').replace(/\s+/g, ' ').trim();
  }
  var CLAVES = { minutes: 'min', points: 'pts', rebounds: 'reb', assists: 'ast', steals: 'stl', blocks: 'blk', turnovers: 'tov', fouls: 'pf',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted': 'fg3m', 'fieldGoalsMade-fieldGoalsAttempted': 'fgm', 'freeThrowsMade-freeThrowsAttempted': 'ftm' };
  var num = function (x) { var v = parseFloat(String(x).split('-')[0]); return isFinite(v) ? v : 0; };
  var lista = function (x) { return Array.isArray(x) ? x : []; };

  /* Respuesta de summary → {estado: 'pre'|'in'|'post', tipo, periodo, reloj, local:{abrev, pts}, visita:{…}, jugadores:[{nombre, n, lado, dnp, st}]}. */
  function leerResumen(d) {
    var comp = (((d || {}).header || {}).competitions || [])[0] || {};
    var st = comp.status || {}, t = st.type || {}, equipos = {}, out = { estado: t.state || 'pre', tipo: t.name || '', periodo: +st.period || 0, reloj: st.displayClock || '', local: null, visita: null, jugadores: [] };
    lista(comp.competitors).forEach(function (c) {
      var e = { abrev: (c.team || {}).abbreviation || '', pts: c.score != null && c.score !== '' ? +c.score : null, lado: c.homeAway };
      equipos[(c.team || {}).id] = e;
      if (c.homeAway === 'home') out.local = e; else out.visita = e;
    });
    lista(((d || {}).boxscore || {}).players).forEach(function (tp) {
      var lado = (equipos[(tp.team || {}).id] || {}).lado || null;
      lista(tp.statistics).forEach(function (s) {
        var keys = lista(s.keys);
        lista(s.athletes).forEach(function (a) {
          var nombre = (a.athlete || {}).displayName || '', vals = lista(a.stats), x = {};
          keys.forEach(function (k, i) {
            var c = CLAVES[k]; if (!c || vals[i] == null) return;
            x[c] = num(vals[i]);
            if (c === 'fgm') x.fga = num(String(vals[i]).split('-')[1]);
            if (c === 'ftm') x.fta = num(String(vals[i]).split('-')[1]);
          });
          out.jugadores.push({ nombre: nombre, n: normNombre(nombre), lado: lado, dnp: !!a.didNotPlay || !vals.length, st: x });
        });
      });
    });
    return out;
  }

  /* Jugador del resumen para una pata {j, eq} del partido p ({local, visita}). Nombre normalizado + equipo;
     si no hay igual exacto, mismo apellido e inicial (único en el equipo). null si no aparece. */
  function emparejar(pata, r, p) {
    var lado = p && pata.eq === p.local ? 'home' : p && pata.eq === p.visita ? 'away' : null;
    var cand = r.jugadores.filter(function (x) { return !lado || !x.lado || x.lado === lado; });
    var n = normNombre(pata.j);
    var ex = cand.filter(function (x) { return x.n === n; });
    if (ex.length === 1) return ex[0];
    var t = n.split(' '), ap = t[t.length - 1], ini = t[0] ? t[0].charAt(0) : '';
    var parecidos = cand.filter(function (x) { var u = x.n.split(' '); return u[u.length - 1] === ap && u[0] && u[0].charAt(0) === ini; });
    return parecidos.length === 1 ? parecidos[0] : null;
  }

  var COMBOS = { pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'] };
  var VIVOS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'pra', 'pr', 'pa', 'ra'];
  /* Avance de una pata: {v, r: 'ganada'|'perdida'|'anulada'|null, faltan, sobran, sinMercado}. Final = el partido terminó. */
  function avance(pata, jug, final) {
    if (VIVOS.indexOf(pata.m) < 0 || pata.per) return { sinMercado: true, v: null, r: null };
    var partes = COMBOS[pata.m] || [pata.m], v = 0;
    partes.forEach(function (k) { v += jug && jug.st && typeof jug.st[k] === 'number' ? jug.st[k] : 0; });
    var L = +pata.L, menos = pata.lado === 'menos', out = { v: v, r: null, faltan: null, sobran: null };
    if (final && (!jug || jug.dnp || !(jug.st.min > 0))) { out.r = 'anulada'; return out; }
    if (!menos) {
      out.faltan = Math.max(0, Math.floor(L) + 1 - v);
      if (v > L) out.r = 'ganada'; else if (final) out.r = v === L ? 'anulada' : 'perdida';
    } else {
      out.sobran = Math.max(0, Math.ceil(L) - 1 - v);
      if (v > L) out.r = 'perdida'; else if (final) out.r = v === L ? 'anulada' : 'ganada';
    }
    return out;
  }
  /* «3er cuarto · 5:32», «Entretiempo», «Final», «Alargue». */
  function reloj(r) {
    if (r.estado === 'post') return 'Final';
    if (r.estado === 'pre') return 'Por empezar';
    if (/HALFTIME/.test(r.tipo)) return 'Entretiempo';
    var p = r.periodo, nombre = p <= 4 ? ['1er', '2do', '3er', '4to'][p - 1] + ' cuarto' : 'Alargue' + (p > 5 ? ' ' + (p - 4) : '');
    if (/END_PERIOD/.test(r.tipo)) return 'Fin del ' + nombre;
    return nombre + (r.reloj ? ' · ' + r.reloj : '');
  }

  var api = { normNombre: normNombre, leerResumen: leerResumen, emparejar: emparejar, avance: avance, reloj: reloj };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ interfaz
  var URL_ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=';
  var CADA = 45e3;
  var A = null, E = { datos: {}, timer: null, cargando: false, ultimo: 0 };
  var $ = function (s) { return document.querySelector(s); };

  function init(app) {
    A = app;
    var cont = $('#vivo');
    if (cont) cont.addEventListener('click', function (e) { if (e.target.closest('[data-vivo-act]')) refrescar(true); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) parar(); else refrescar(); });
  }
  function parar() { clearTimeout(E.timer); E.timer = null; }

  /* Patas a seguir: la combinada y las apuestas abiertas de hoy (sin repetir). */
  function patas() {
    var out = [], vistos = {};
    var poner = function (l, origen) {
      var k = l.id + '|' + l.m + '|' + l.L + '|' + (l.lado || 'mas') + '|' + (l.per || '');
      if (vistos[k]) { if (vistos[k].origen.indexOf(origen) < 0) vistos[k].origen.push(origen); return; }
      var x = { id: l.id, j: l.j, eq: l.eq, gid: l.gid, m: l.m, mn: l.mn, per: l.per, L: l.L, lado: l.lado || 'mas', origen: [origen] };
      vistos[k] = x; out.push(x);
    };
    A.S.ticket.forEach(function (l) { poner(l, 'combinada'); });
    if (root.NbaApuestas && A.S.data) root.NbaApuestas.patasAbiertas(A.S.data.fecha).forEach(function (l) { poner(l, 'apuesta'); });
    return out;
  }
  /* Partidos de esas patas que pueden estar en juego: hoy.json dice «en juego» o «final», o ya pasó la hora de inicio. */
  function candidatos(ps) {
    var gids = {}, out = [];
    ps.forEach(function (l) { gids[l.gid] = 1; });
    Object.keys(gids).forEach(function (gid) {
      var p = A.partidoDe(gid); if (!p || !p.espn) return;
      var e = A.estadoDe(gid), empezo = Date.now() >= Date.parse(p.utc);
      if (e === 2 || e === 3 || empezo) out.push(p);
    });
    return out;
  }
  var terminado = function (p) { var d = E.datos[p.espn]; return !!(d && d.r && d.r.estado === 'post'); };

  function refrescar(forzar) {
    if (!A || !A.S.data) return;
    var cand = candidatos(patas());
    if (!cand.length || !A.combinadaVisible() || document.hidden) { parar(); pintar(); return; }
    var ahora = Date.now();
    var falta = cand.filter(function (p) {
      if (terminado(p)) return false;                                    // un partido terminado no se vuelve a pedir
      var d = E.datos[p.espn]; return forzar || !d || ahora - d.t > CADA - 5e3;
    });
    if (falta.length && !E.cargando) actualizar(falta); else { pintar(); programar(cand); }
  }
  function actualizar(ps) {
    E.cargando = true; pintar();
    Promise.all(ps.map(function (p) {
      return fetch(URL_ESPN + encodeURIComponent(p.espn), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
      }).then(function (d) { E.datos[p.espn] = { t: Date.now(), r: leerResumen(d) }; },
        function (e) { var v = E.datos[p.espn] || {}; v.t = Date.now(); v.error = e.message || 'sin conexión'; E.datos[p.espn] = v; });
    })).then(function () {
      E.cargando = false; E.ultimo = Date.now();
      pintar(); programar(candidatos(patas()));
    });
  }
  function programar(cand) {
    parar();
    if (!cand.some(function (p) { return !terminado(p); }) || !A.combinadaVisible() || document.hidden) return;
    E.timer = setTimeout(function () { refrescar(); }, CADA);
  }

  function pintar() {
    var cont = $('#vivo'); if (!cont) return;
    var ps = patas(), cand = candidatos(ps);
    var conDatos = cand.filter(function (p) { var d = E.datos[p.espn]; return d && d.r && d.r.estado !== 'pre'; });
    var errores = cand.filter(function (p) { var d = E.datos[p.espn]; return d && d.error && !d.r; });
    var vivosHoy = cand.filter(function (p) { return A.estadoDe(p.gid) === 2; });
    if (!conDatos.length && !(errores.length && vivosHoy.length)) { cont.hidden = true; cont.innerHTML = ''; return; }
    var algunoVivo = conDatos.some(function (p) { return E.datos[p.espn].r.estado === 'in'; });
    var hh = E.ultimo ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(E.ultimo)) : '';
    var html = '<div class="vivo-cab"><h3 id="h-vivo"><span class="vivo-punto' + (algunoVivo ? ' on' : '') + '" aria-hidden="true"></span>' + (algunoVivo ? 'En vivo' : 'Terminados') + '</h3>' +
      '<span class="vivo-act">' + (E.cargando ? 'Actualizando…' : hh ? 'act. ' + hh : '') + '</span>' +
      '<button type="button" class="btn vivo-btn" data-vivo-act' + (E.cargando ? ' disabled' : '') + '>Actualizar</button></div>';
    if (errores.length) html += '<p class="vivo-error" role="status">No pude traer los datos de ESPN de ' + errores.map(function (p) { return A.esc(p.visita + ' @ ' + p.local); }).join(', ') + '. Probá «Actualizar» en un rato.</p>';
    html += conDatos.map(function (p) {
      var r = E.datos[p.espn].r, fin = r.estado === 'post';
      var v = r.visita || { abrev: p.visita, pts: null }, l = r.local || { abrev: p.local, pts: null };
      var legs = ps.filter(function (x) { return x.gid === p.gid; });
      return '<div class="vivo-partido"><div class="vivo-marcador"><span><b>' + A.esc(p.visita) + '</b> ' + (v.pts == null ? '—' : v.pts) + ' <span class="mut">–</span> ' + (l.pts == null ? '—' : l.pts) + ' <b>' + A.esc(p.local) + '</b></span>' +
        '<span class="vivo-reloj' + (fin ? '' : ' en-juego') + '">' + A.esc(reloj(r)) + '</span></div>' +
        '<ul class="vivo-patas">' + legs.map(function (x) { return pataHtml(x, r, p, fin); }).join('') + '</ul></div>';
    }).join('');
    html += '<p class="nota">Datos de ESPN (pueden demorar un poco). ' + (algunoVivo ? 'Se actualiza solo cada 45 segundos mientras mirás la combinada.' : '') + '</p>';
    cont.hidden = false; cont.innerHTML = html;
  }
  function pataHtml(x, r, p, fin) {
    var jug = emparejar(x, r, p), desc = A.esc(A.LADO[x.lado] || 'Más de') + ' ' + A.fL(x.L) + ' ' + A.esc(A.lectura(x));
    var origen = x.origen.indexOf('combinada') >= 0 ? (x.origen.length > 1 ? 'combinada y apuesta' : '') : 'apuesta registrada';
    var cab = '<span class="vivo-jug"><b>' + A.esc(x.j) + '</b> · ' + desc + (origen ? ' <small class="mut">(' + origen + ')</small>' : '') + '</span>';
    if (!jug) return '<li class="vivo-pata sin">' + cab + '<span class="vivo-det">sin datos en vivo</span></li>';
    var a = avance(x, jug, fin);
    if (a.sinMercado) return '<li class="vivo-pata sin">' + cab + '<span class="vivo-det">mercado sin datos en vivo</span></li>';
    var ico = { ganada: '✓', perdida: '✗', anulada: '–' }[a.r] || '';
    var txt = 'lleva ' + A.fL(a.v);
    if (a.r === 'ganada') txt += x.lado === 'menos' ? ' · terminó abajo de la línea' : ' · ya pasó la línea';
    else if (a.r === 'perdida') txt += x.lado === 'menos' ? ' · se pasó de la línea' : ' · no llegó';
    else if (a.r === 'anulada') txt = jug.dnp || !(jug.st.min > 0) ? 'no jugó · anulada' : txt + ' · empate, anulada';
    else txt += x.lado === 'menos' ? ' · puede sumar ' + A.fL(a.sobran) + ' más' : ' · le faltan ' + A.fL(a.faltan);
    var det = (jug.dnp ? 'no jugó' : A.fL(jug.st.min || 0) + ' min · ' + (jug.st.pf || 0) + (jug.st.pf === 1 ? ' falta' : ' faltas'));
    var meta = x.lado === 'menos' ? null : Math.floor(+x.L) + 1, ancho = meta ? Math.min(100, Math.round(a.v / meta * 100)) : 0;
    return '<li class="vivo-pata ' + (a.r || 'abierta') + '">' + (ico ? '<span class="res-ico ' + a.r + '" aria-hidden="true">' + ico + '</span><span class="sr-only">' + a.r + ': </span>' : '') + cab +
      '<span class="vivo-det"><b>' + txt + '</b> · ' + det + (jug.st.pf >= 5 && !fin ? ' <span class="tag alerta">en problemas de faltas</span>' : '') + '</span>' +
      (meta ? '<span class="vivo-barra" aria-hidden="true"><i style="width:' + ancho + '%"></i></span>' : '') + '</li>';
  }

  root.NbaVivo = { init: init, refrescar: function (f) { if (A) refrescar(f); } };
})(typeof window !== 'undefined' ? window : globalThis);
