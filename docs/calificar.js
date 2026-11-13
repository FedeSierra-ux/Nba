/* NBA Semáforo — calificación de patas, combinadas y apuestas propias (funciones puras).
   Mismas reglas que scripts/resultados.py:
     · «más de» gana si el valor supera la línea; con una línea entera el empate se anula.
     · combos: pra = pts+reb+ast, pr = pts+reb, pa = pts+ast, ra = reb+ast.
     · jugador con 0 minutos o que no figura en el box score de un partido terminado: pata ANULADA.
     · partido sin terminar (o sin box score todavía): la pata queda PENDIENTE (null).
     · líneas de un período (1er cuarto): no se califican (el box score es del partido entero).
     · combinada: pierde si pierde una pata; una anulada cuenta como ganada a cuota 1,00; si se anulan todas, se devuelve.
   Se usa en el navegador (window.Calificar) y en Node para pruebas (module.exports). */
(function (root) {
  'use strict';
  var GANADA = 'ganada', PERDIDA = 'perdida', ANULADA = 'anulada', FINAL = 3;
  var ESTADISTICAS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'tov', 'fgm', 'fga', 'fta', 'ftm', 'pf'];
  var COMBOS = { pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'] };
  var CASAS = ['Betano', 'Stake', 'Otra'];
  var esNum = function (x) { return typeof x === 'number' && isFinite(x); };

  /* Valor del mercado m en una línea de estadísticas ({pts, reb, …}). null si no se puede calcular. */
  function valorMercado(st, m) {
    if (!st || typeof st !== 'object') return null;
    var partes = COMBOS[m] || [m], v = 0;
    for (var i = 0; i < partes.length; i++) {
      if (ESTADISTICAS.indexOf(partes[i]) < 0 || !esNum(st[partes[i]])) return null;
      v += st[partes[i]];
    }
    return v;
  }

  /* Resultado de una pata contra un día de resultados.
     pata: {id, gid, m, per, L, lado ('mas' por defecto)} · res: contenido de resultados/<fecha>.json (o null)
     → {r: 'ganada'|'perdida'|'anulada'|null, v: valor del jugador o null, min} */
  function calificarPata(pata, res) {
    var out = { r: null, v: null, min: null };
    if (!pata || !res || typeof res !== 'object' || pata.per || !esNum(+pata.L)) return out;
    var partido = (res.partidos || {})[pata.gid];
    if (!partido || partido.estado !== FINAL) return out;                    // sin terminar, suspendido o desconocido
    var st = (res.jugadores || {})[String(pata.id)];
    if (!st) { if (partido.box) out.r = ANULADA; return out; }                // terminó y no figura: no jugó
    out.min = esNum(st.min) ? st.min : 0;
    if (out.min <= 0) { out.r = ANULADA; return out; }
    var v = valorMercado(st, pata.m); if (v == null) return out;
    var L = +pata.L; out.v = v;
    if (v === L) out.r = ANULADA;
    else if (pata.lado === 'menos') out.r = v < L ? GANADA : PERDIDA;
    else out.r = v > L ? GANADA : PERDIDA;
    return out;
  }

  /* (estado, pago por unidad). estado: 'ganada' | 'perdida' | 'anulada' | null (pendiente). */
  function calificarCombinada(rs, cuotas) {
    if (rs.indexOf(PERDIDA) >= 0) return { estado: PERDIDA, pago: 0 };
    if (rs.some(function (r) { return r == null; })) return { estado: null, pago: null };
    if (rs.every(function (r) { return r === ANULADA; })) return { estado: ANULADA, pago: 1 };
    var pago = 1;
    rs.forEach(function (r, i) { if (r === GANADA) pago *= cuotas[i] || 1; });
    return { estado: GANADA, pago: pago };
  }

  // ----------------------------------------------------------------- apuestas propias (localStorage)
  var FECHA = /^\d{4}-\d{2}-\d{2}$/;
  var ESTADOS = [GANADA, PERDIDA, ANULADA];
  var texto = function (x, max) { return typeof x === 'string' ? x.slice(0, max || 80) : ''; };
  /* Pata guardada → pata limpia o null. */
  function validarPata(l) {
    if (!l || typeof l !== 'object') return null;
    var id = typeof l.id === 'number' || (typeof l.id === 'string' && /^\d+$/.test(l.id)) ? +l.id : null;
    if (id == null || typeof l.m !== 'string' || !/^[a-z0-9_]{1,12}$/.test(l.m) || !esNum(+l.L) || l.L === '' || l.L == null) return null;
    return { id: id, j: texto(l.j) || 'Jugador ' + id, m: l.m, mn: texto(l.mn), per: typeof l.per === 'string' && l.per ? texto(l.per, 10) : null,
      L: +l.L, lado: l.lado === 'menos' ? 'menos' : 'mas', gid: texto(l.gid, 20), eq: texto(l.eq, 5), riv: texto(l.riv, 5),
      cu: esNum(l.cu) && l.cu > 1 ? l.cu : null, p: esNum(l.p) && l.p >= 0 && l.p <= 1 ? l.p : null,
      c: ['verde', 'amarillo', 'rojo'].indexOf(l.c) >= 0 ? l.c : null };
  }
  /* Apuesta guardada (o importada) → apuesta limpia o null si no se puede usar. */
  function validarApuesta(a) {
    if (!a || typeof a !== 'object' || typeof a.fecha !== 'string' || !FECHA.test(a.fecha)) return null;
    if (!esNum(a.monto) || a.monto < 0 || a.monto > 1e9 || !esNum(a.cuota) || a.cuota <= 1 || a.cuota >= 100000) return null;
    if (!Array.isArray(a.legs) || !a.legs.length || a.legs.length > 30) return null;
    var legs = a.legs.map(validarPata);
    if (legs.some(function (l) { return !l; })) return null;
    return { id: texto(a.id, 40) || ('a' + a.fecha.replace(/-/g, '') + Math.round(a.monto * 100) + legs.length + Math.round(a.cuota * 1000)),
      creada: texto(a.creada, 30), fecha: a.fecha, casa: CASAS.indexOf(a.casa) >= 0 ? a.casa : 'Otra',
      monto: Math.round(a.monto * 100) / 100, cuota: Math.round(a.cuota * 1000) / 1000, legs: legs,
      manual: ESTADOS.indexOf(a.manual) >= 0 ? a.manual : null };
  }
  /* Lista de localStorage o de un archivo importado → apuestas válidas (sin ids repetidos) y cuántas se descartaron. */
  function leerApuestas(x) {
    var arr = Array.isArray(x) ? x : x && typeof x === 'object' && Array.isArray(x.apuestas) ? x.apuestas : [];
    var out = [], vistos = {}, descartadas = 0;
    arr.forEach(function (a) {
      var v = validarApuesta(a);
      if (!v || vistos[v.id]) { descartadas++; return; }
      vistos[v.id] = 1; out.push(v);
    });
    return { apuestas: out, descartadas: descartadas };
  }

  /* Estado de una apuesta con el día de resultados de su fecha (res puede ser null = todavía no hay archivo).
     → {estado, manual, legs:[{r, v, min}], cobro (lo que devuelve la casa, null si pendiente), auto (estado calculado)}
     Con patas anuladas la cuota real se divide por la cuota de esas patas (si se conoce), como recalculan las casas. */
  function calificarApuesta(a, res) {
    var legs = a.legs.map(function (l) { return calificarPata(l, res); });
    var rs = legs.map(function (x) { return x.r; });
    var c = calificarCombinada(rs, a.legs.map(function () { return 1; }));
    var auto = c.estado, cobro = null;
    if (auto === GANADA) {
      var div = 1;
      rs.forEach(function (r, i) { if (r === ANULADA && a.legs[i].cu) div *= a.legs[i].cu; });
      cobro = a.monto * Math.max(1, a.cuota / div);
    } else if (auto === PERDIDA) cobro = 0;
    else if (auto === ANULADA) cobro = a.monto;
    var estado = a.manual || auto;
    if (a.manual) cobro = a.manual === GANADA ? (auto === GANADA ? cobro : a.monto * a.cuota) : a.manual === PERDIDA ? 0 : a.monto;
    return { estado: estado, manual: !!a.manual, auto: auto, legs: legs, cobro: cobro };
  }

  /* Resumen de apuestas ya calificadas: [{a, c: calificarApuesta(...)}] → totales y por casa.
     Neto y ROI solo cuentan apuestas resueltas; las anuladas devuelven el monto (no suman ni restan). */
  function resumenApuestas(items) {
    // base: lo apostado en apuestas ganadas o perdidas (las anuladas devuelven el monto y no cuentan para el ROI)
    var nuevo = function () { return { n: 0, apostado: 0, pendiente: 0, resuelto: 0, cobrado: 0, base: 0, ganadas: 0, perdidas: 0, anuladas: 0, pendientes: 0 }; };
    var tot = nuevo(), casas = {};
    items.forEach(function (it) {
      var a = it.a, c = it.c, cs = casas[a.casa] = casas[a.casa] || nuevo();
      [tot, cs].forEach(function (t) {
        t.n++; t.apostado += a.monto;
        if (c.estado == null) { t.pendientes++; t.pendiente += a.monto; return; }
        t.resuelto += a.monto; t.cobrado += c.cobro || 0;
        if (c.estado === GANADA) { t.ganadas++; t.base += a.monto; }
        else if (c.estado === PERDIDA) { t.perdidas++; t.base += a.monto; }
        else t.anuladas++;
      });
    });
    var cerrar = function (t) {
      t.neto = Math.round((t.cobrado - t.resuelto) * 100) / 100;
      t.roi = t.base > 0 ? t.neto / t.base : null;
      t.aciertos = t.ganadas + t.perdidas ? t.ganadas / (t.ganadas + t.perdidas) : null;
      return t;
    };
    cerrar(tot); Object.keys(casas).forEach(function (k) { cerrar(casas[k]); });
    return { total: tot, casas: casas };
  }

  var api = { GANADA: GANADA, PERDIDA: PERDIDA, ANULADA: ANULADA, CASAS: CASAS, valorMercado: valorMercado, calificarPata: calificarPata,
    calificarCombinada: calificarCombinada, validarPata: validarPata, validarApuesta: validarApuesta, leerApuestas: leerApuestas,
    calificarApuesta: calificarApuesta, resumenApuestas: resumenApuestas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calificar = api;
})(typeof window !== 'undefined' ? window : globalThis);
