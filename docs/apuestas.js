/* NBA Semáforo — «Mis apuestas» (#/apuestas) y el formulario «Registrar apuesta» de la combinada.
   Las apuestas viven en localStorage (este dispositivo): se validan al leer y se pueden exportar/importar como JSON.
   Cada apuesta se corrige con data/resultados/<fecha>.json (window.Calificar.calificarApuesta). */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var CLAVE = 'nba_semaforo_apuestas_v1', CLAVE_CASA = 'nba_semaforo_casa_v1';
  var A = null, C = null;
  var E = { lista: [], res: {}, pedidos: {}, msg: '' };
  var $ = function (s) { return document.querySelector(s); };
  var nfDin = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  var din = function (x) { return '$' + nfDin.format(x || 0); };
  var dinS = function (x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + din(Math.abs(x)); };
  var ETQ = { ganada: 'Ganada', perdida: 'Perdida', anulada: 'Anulada', pendiente: 'Pendiente' };

  function init(app) {
    A = app; C = root.Calificar;
    cargarLista();
    var reg = $('#registrar'), cont = $('#apuestas');
    if (reg) {
      reg.addEventListener('submit', function (e) { e.preventDefault(); registrar(); });
      reg.addEventListener('click', function (e) {
        if (e.target.closest('[data-reg-cancelar]')) { cerrarFormulario(); A.enfocar($('#t-registrar')); }
        if (e.target.closest('[data-reg-cerrar]')) cerrarFormulario();
      });
      reg.addEventListener('change', function (e) {
        if (e.target.id === 'reg-cuota') { var v = A.U.leerCuota(e.target.value); if (v) e.target.value = A.fC(v); }
        if (e.target.id === 'reg-monto') { var m = A.U.leerMonto(e.target.value); if (m) e.target.value = A.U.fMonto(m); }
      });
    }
    if (cont) {
      cont.addEventListener('click', function (e) {
        var b = e.target.closest('[data-borrar-apu]');
        if (b) { borrar(b.dataset.borrarApu); return; }
        if (e.target.closest('[data-exportar]')) exportar();
      });
      cont.addEventListener('change', function (e) {
        if (e.target.dataset.manual != null) marcar(e.target.dataset.manual, e.target.value);
        if (e.target.id === 'apu-archivo' && e.target.files && e.target.files[0]) importar(e.target.files[0], e.target);
      });
    }
  }

  // ------------------------------------------------------------------ almacenamiento
  function ordenar() {
    E.lista.sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creada < b.creada ? 1 : a.creada > b.creada ? -1 : 0; });
  }
  function cargarLista() { E.lista = C.leerApuestas(A.leer(CLAVE, [])).apuestas; ordenar(); }
  function guardarLista() { A.guardar(CLAVE, E.lista); }

  // ------------------------------------------------------------------ registrar (desde la combinada)
  function formulario() {
    var reg = $('#registrar'), legs = A.S.ticket; if (!reg || !legs.length) return;
    var total = A.cuotaTotal(), casa = A.leer(CLAVE_CASA, 'Betano');
    if (C.CASAS.indexOf(casa) < 0) casa = 'Betano';
    reg.hidden = false;
    reg.innerHTML = '<form class="reg-form" novalidate autocomplete="off" aria-labelledby="h-reg"><h3 id="h-reg" tabindex="-1">Registrar apuesta</h3>' +
      '<p class="nota">Guarda esta combinada (' + legs.length + (legs.length === 1 ? ' pata' : ' patas') + ') como apuesta del ' + A.esc(A.diaMes(A.S.data.fecha)) + ' en este navegador, para corregirla cuando terminen los partidos.</p>' +
      '<div class="reg-campos">' +
      '<label class="campo">Casa<select id="reg-casa">' + C.CASAS.map(function (c) { return '<option' + (c === casa ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label class="campo">Monto<input id="reg-monto" type="text" inputmode="decimal" enterkeyhint="next" value="' + A.U.fMonto(A.S.stake) + '"></label>' +
      '<label class="campo">Cuota real<input id="reg-cuota" type="text" inputmode="decimal" enterkeyhint="done" placeholder="ej. 1,85" value="' + (total ? A.fC(total) : '') + '"></label></div>' +
      '<p class="reg-error" id="reg-error" role="alert"></p>' +
      '<div class="acciones"><button type="submit" class="btn primario">Guardar apuesta</button><button type="button" class="btn" data-reg-cancelar>Cancelar</button></div></form>';
    A.enfocar($('#h-reg'));
    // celular: se trae el formulario a la vista; escritorio: solo se desplaza la columna (la lista de la izquierda no se mueve)
    var col = $('#ticket');
    if (A.esMovil() || !col) { try { reg.scrollIntoView({ block: 'start' }); } catch (e) { /* nada */ } }
    else col.scrollTop = Math.max(0, reg.offsetTop - 70);
  }
  function cerrarFormulario() { var reg = $('#registrar'); if (reg) { reg.hidden = true; reg.innerHTML = ''; } }

  function registrar() {
    var legs = A.S.ticket, err = $('#reg-error');
    var monto = A.U.leerMonto(($('#reg-monto') || {}).value), cuota = A.U.leerCuota(($('#reg-cuota') || {}).value), casa = ($('#reg-casa') || {}).value;
    var mal = [];
    if (!(monto > 0)) mal.push('escribí el monto (por ejemplo 1000)');
    if (!cuota) mal.push('escribí la cuota real con coma (por ejemplo 1,85)');
    ['reg-monto', 'reg-cuota'].forEach(function (id, i) { var el = $('#' + id); if (el) el.setAttribute('aria-invalid', (i ? !cuota : !(monto > 0)) ? 'true' : 'false'); });
    if (mal.length) { if (err) err.textContent = 'Revisá: ' + mal.join(' y ') + '.'; return; }
    var a = C.validarApuesta({
      id: 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), creada: new Date().toISOString(), fecha: A.S.data.fecha,
      casa: casa, monto: monto, cuota: cuota, manual: null,
      legs: legs.map(function (l) { return { id: l.id, j: l.j, m: l.m, mn: l.mn, per: l.per || null, L: l.L, lado: l.lado, gid: l.gid, eq: l.eq, riv: l.riv, cu: l.cuota, p: l.p, c: l.c }; })
    });
    if (!a) { if (err) err.textContent = 'No pude registrar la apuesta: alguna pata está incompleta.'; return; }
    cargarLista(); E.lista.unshift(a); ordenar(); guardarLista();
    A.guardar(CLAVE_CASA, casa);
    var reg = $('#registrar');
    reg.innerHTML = '<div class="reg-ok" role="status"><span>Apuesta registrada: ' + A.esc(casa) + ', ' + din(monto) + ' @' + A.fC(cuota) + '. <a href="#/apuestas">Ver en Mis apuestas ›</a></span>' +
      '<button type="button" class="cerrar-aviso" data-reg-cerrar aria-label="Cerrar aviso">×</button></div>';
    A.anunciar('Apuesta registrada: ' + casa + ', ' + din(monto) + ' a cuota ' + A.fC(cuota) + '.');
    if (root.NbaVivo) root.NbaVivo.refrescar();
  }

  // ------------------------------------------------------------------ sección
  function abrir() {
    cargarLista();
    // los días sin resultados o incompletos se vuelven a pedir (la caché de pedirJSON dura 5 minutos)
    Object.keys(E.res).forEach(function (f) { if (!E.res[f] || !E.res[f].completo) delete E.res[f]; });
    pintar(); pedirFaltantes();
  }
  function pedirFaltantes() {
    var fechas = {}; E.lista.forEach(function (a) { fechas[a.fecha] = 1; });
    Object.keys(fechas).forEach(function (f) {
      if (f in E.res || E.pedidos[f]) return;
      // el día de los datos (o uno posterior) todavía no tiene resultados: resultados.py solo corrige días terminados
      if (A.S.data && f >= A.S.data.fecha) { E.res[f] = null; return; }
      E.pedidos[f] = true;
      A.pedirJSON('data/resultados/' + f + '.json', 5 * 60e3).then(function (d) { E.res[f] = d && typeof d === 'object' ? d : null; },
        function () { E.res[f] = null; }).then(function () { delete E.pedidos[f]; if (A.S.vista === 'apuestas') pintar(); });
    });
  }
  function calificadas() { return E.lista.map(function (a) { return { a: a, c: C.calificarApuesta(a, E.res[a.fecha] || null) }; }); }

  function pintar() {
    var cont = $('#apuestas'); if (!cont) return;
    var items = calificadas(), cargando = Object.keys(E.pedidos).length > 0;
    var barra = '<div class="apu-barra"><button type="button" class="btn" data-exportar' + (E.lista.length ? '' : ' disabled') + '>Exportar</button>' +
      '<label class="btn apu-importar">Importar<input type="file" id="apu-archivo" accept="application/json,.json" class="sr-only"></label>' +
      '<span class="nota apu-barra-nota">Se guardan solo en este navegador: exportalas para pasarlas a otro dispositivo.</span></div>' +
      '<p class="apu-msg" id="apu-msg" role="status" tabindex="-1">' + A.esc(E.msg) + '</p>';
    if (!items.length) {
      cont.innerHTML = barra + '<div class="vacio">Todavía no registraste apuestas. Armá una combinada y, en <a href="#/combinada">Mi combinada</a>, tocá <b>«Registrar apuesta»</b>: queda guardada acá y se corrige sola cuando terminan los partidos.</div>';
      return;
    }
    var r = C.resumenApuestas(items), t = r.total;
    var html = barra + '<section class="apu-resumen" aria-label="Resumen">' +
      '<div class="totales apu-tot">' +
      '<div class="total"><span>Apostado</span><b>' + din(t.apostado) + '</b>' + (t.pendiente ? '<small>' + din(t.pendiente) + ' pendiente</small>' : '') + '</div>' +
      '<div class="total"><span>Cobrado</span><b>' + din(t.cobrado) + '</b></div>' +
      '<div class="total"><span>Neto</span><b class="' + (t.neto > 0 ? 'pos' : t.neto < 0 ? 'neg' : '') + '">' + dinS(t.neto) + '</b></div>' +
      '<div class="total"><span>ROI</span><b class="' + (t.roi > 0 ? 'pos' : t.roi < 0 ? 'neg' : '') + '">' + (t.roi == null ? '—' : (t.roi > 0 ? '+' : t.roi < 0 ? '−' : '') + A.fP(Math.abs(t.roi))) + '</b></div>' +
      '<div class="total"><span>Aciertos</span><b>' + t.ganadas + ' de ' + (t.ganadas + t.perdidas) + '</b>' + (t.anuladas ? '<small>' + t.anuladas + ' anulada' + (t.anuladas > 1 ? 's' : '') + '</small>' : '') + '</div>' +
      '<div class="total"><span>Pendientes</span><b>' + t.pendientes + '</b></div></div>';
    var casas = Object.keys(r.casas);
    html += '<div class="tabla-x"><table class="res-tabla apu-casas"><caption class="sr-only">Por casa</caption><thead><tr><th scope="col">Casa</th><th scope="col">Apuestas</th><th scope="col">Apostado</th><th scope="col">Neto</th><th scope="col">ROI</th></tr></thead><tbody>' +
      casas.map(function (k) {
        var x = r.casas[k];
        return '<tr><th scope="row">' + A.esc(k) + '</th><td>' + x.n + (x.pendientes ? ' <small>(' + x.pendientes + ' pend.)</small>' : '') + '</td><td>' + din(x.apostado) + '</td><td class="' + (x.neto > 0 ? 'pos' : x.neto < 0 ? 'neg' : '') + '">' + dinS(x.neto) + '</td>' +
          '<td>' + (x.roi == null ? '—' : (x.roi > 0 ? '+' : x.roi < 0 ? '−' : '') + A.fP(Math.abs(x.roi))) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="nota">Neto y ROI cuentan solo las apuestas ya resueltas; las anuladas devuelven el monto. ' + (cargando ? 'Buscando resultados…' : '') + '</p></section>';
    html += '<div class="apu-lista">' + items.map(tarjeta).join('') + '</div>';
    cont.innerHTML = html;
  }

  function tarjeta(it) {
    var a = it.a, c = it.c, est = c.estado || 'pendiente', res = E.res[a.fecha];
    var legs = a.legs.map(function (l, i) {
      var x = c.legs[i], r = x.r, ico = { ganada: '✓', perdida: '✗', anulada: '–' }[r] || '…';
      var hizo = r === 'anulada' ? (x.v != null ? 'hizo ' + A.fL(x.v) + ' · empate, anulada' : 'no jugó · anulada') : x.v != null ? 'hizo ' + A.fL(x.v) :
        l.per ? 'sin calificar (período)' : res === undefined ? '…' : 'pendiente';
      return '<li class="res-pata ' + (r || 'pendiente') + '"><span class="res-ico ' + (r || 'pendiente') + '" aria-hidden="true">' + ico + '</span><span class="sr-only">' + (ETQ[r] || 'Pendiente') + ': </span>' +
        '<span class="res-pata-txt"><b>' + A.esc(l.j) + '</b> <small>' + A.esc(l.eq) + '</small> · ' + A.esc(A.LADO[l.lado] || 'Más de') + ' ' + A.fL(l.L) + ' ' + A.esc(A.lectura(l)) + (l.per ? ' (' + A.esc(l.per) + ')' : '') + '</span>' +
        '<span class="res-hizo">' + A.esc(hizo) + '</span></li>';
    }).join('');
    var cobro = c.cobro == null ? 'Cobrarías ' + din(a.monto * a.cuota) + ' si gana' : est === 'ganada' ? 'Cobró ' + din(c.cobro) + ' (' + dinS(c.cobro - a.monto) + ')' :
      est === 'anulada' ? 'Se devolvió ' + din(c.cobro) : 'Perdió ' + din(a.monto);
    var opciones = [['', 'Automático'], ['ganada', 'Ganada'], ['perdida', 'Perdida'], ['anulada', 'Anulada']];
    var idSel = 'apu-man-' + a.id;
    return '<article class="apu apu-' + est + '" data-id="' + A.esc(a.id) + '" aria-labelledby="apu-t-' + A.esc(a.id) + '">' +
      '<div class="apu-cab"><h3 class="apu-tit" id="apu-t-' + A.esc(a.id) + '">' + A.esc(A.diaMes(a.fecha)) + ' · ' + A.esc(a.casa) + ' <span class="apu-monto">' + din(a.monto) + ' @' + A.fC(a.cuota) + '</span></h3>' +
      '<span class="estado-apu ' + est + '">' + ETQ[est] + (c.manual ? ' <small>(manual)</small>' : '') + '</span></div>' +
      '<ul class="res-patas">' + legs + '</ul>' +
      '<div class="apu-pie"><span class="apu-cobro">' + cobro + '</span>' +
      '<span class="apu-acc"><label class="apu-man" for="' + A.esc(idSel) + '">Marcar</label><select id="' + A.esc(idSel) + '" data-manual="' + A.esc(a.id) + '">' +
      opciones.map(function (o) { return '<option value="' + o[0] + '"' + ((a.manual || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn btn-icono btn-peligro" data-borrar-apu="' + A.esc(a.id) + '" aria-label="Borrar la apuesta del ' + A.esc(A.diaMes(a.fecha)) + ' en ' + A.esc(a.casa) + '">×</button></span></div></article>';
  }

  function buscar(id) { for (var i = 0; i < E.lista.length; i++) if (E.lista[i].id === id) return i; return -1; }
  function marcar(id, v) {
    var i = buscar(id); if (i < 0) return;
    E.lista[i].manual = ['ganada', 'perdida', 'anulada'].indexOf(v) >= 0 ? v : null;
    guardarLista(); pintar();
    var sel = document.getElementById('apu-man-' + id); if (sel) A.enfocar(sel);
    A.anunciar(v ? 'Apuesta marcada como ' + v + '.' : 'La apuesta vuelve a corregirse con los resultados.');
  }
  function borrar(id) {
    var i = buscar(id); if (i < 0) return;
    if (!window.confirm('¿Borrar esta apuesta? No se puede deshacer (salvo que la hayas exportado).')) return;
    E.lista.splice(i, 1); guardarLista(); E.msg = 'Apuesta borrada.'; pintar();
    A.enfocar($('#apuestas [data-borrar-apu]') || $('#h-apu'));
    A.anunciar('Apuesta borrada.');
  }

  // ------------------------------------------------------------------ exportar / importar
  function exportar() {
    var hoy = new Date().toISOString().slice(0, 10);
    var datos = JSON.stringify({ app: 'nba-semaforo', tipo: 'apuestas', version: 1, exportado: new Date().toISOString(), apuestas: E.lista }, null, 2);
    var url = URL.createObjectURL(new Blob([datos], { type: 'application/json' }));
    var a = document.createElement('a'); a.href = url; a.download = 'nba-semaforo-apuestas-' + hoy + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    E.msg = 'Exporté ' + E.lista.length + (E.lista.length === 1 ? ' apuesta.' : ' apuestas.'); var m = $('#apu-msg'); if (m) m.textContent = E.msg;
  }
  function importar(archivo, input) {
    var fin = function (txt) { E.msg = txt; input.value = ''; pintar(); pedirFaltantes(); A.enfocar($('#apu-msg')); A.anunciar(txt); };
    if (archivo.size > 5e6) { fin('El archivo es demasiado grande para ser una exportación de apuestas.'); return; }
    archivo.text().then(function (t) {
      var json; try { json = JSON.parse(t); } catch (e) { fin('Ese archivo no es un JSON válido.'); return; }
      var r = C.leerApuestas(json);
      cargarLista();
      var ids = {}, nuevas = 0, repetidas = 0;
      E.lista.forEach(function (a) { ids[a.id] = 1; });
      r.apuestas.forEach(function (a) { if (ids[a.id]) repetidas++; else { ids[a.id] = 1; E.lista.push(a); nuevas++; } });
      ordenar(); guardarLista();
      fin('Importé ' + nuevas + (nuevas === 1 ? ' apuesta' : ' apuestas') + (repetidas ? ' (' + repetidas + ' ya estaban)' : '') + (r.descartadas ? '; descarté ' + r.descartadas + ' inválida' + (r.descartadas > 1 ? 's' : '') : '') + '.');
    }, function () { fin('No pude leer el archivo.'); });
  }

  // ------------------------------------------------------------------ para otras secciones
  function resumenCorto() {
    cargarLista();
    if (!E.lista.length) return '';
    // solo lo que se sabe sin pedir resultados: cuántas hay y cuántas son de hoy (todavía abiertas)
    var hoy = A.S.data ? E.lista.filter(function (a) { return a.fecha === A.S.data.fecha && !a.manual; }).length : 0;
    return E.lista.length + (E.lista.length === 1 ? ' registrada' : ' registradas') + (hoy ? ' · ' + hoy + ' de hoy' : '') + '.';
  }
  /* Patas de las apuestas de esa fecha que siguen abiertas (para el panel «En vivo»). */
  function patasAbiertas(fecha) {
    var out = [];
    E.lista.forEach(function (a) {
      if (a.fecha !== fecha || a.manual) return;
      a.legs.forEach(function (l) { out.push(l); });
    });
    return out;
  }

  root.NbaApuestas = { init: init, abrir: abrir, formulario: formulario, cerrarFormulario: cerrarFormulario, resumenCorto: resumenCorto, patasAbiertas: patasAbiertas };
})(typeof window !== 'undefined' ? window : globalThis);
