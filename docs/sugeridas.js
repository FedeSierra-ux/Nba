/* Combinadas sugeridas del día: Segura / Intermedia / Soñadora.
   Para cada una se buscan las patas «más de» que MAXIMIZAN la probabilidad conjunta con una cuota total mínima.
   Se resuelve como una mochila: maximizar Σ ln(p) sujeto a Σ ln(cuota) ≥ ln(T), por relajación de Lagrange
   (se ordenan las candidatas por ln(p) + λ·ln(cuota) y se busca el λ mínimo que alcanza la cuota) y una mejora local por intercambios.
   Se usa en el navegador (window.Sugeridas) y en Node para pruebas (module.exports). */
(function (root) {
  'use strict';

  var NIVELES = [
    { id: 'segura', nombre: 'Segura', T: 1.99, variantes: [3, 4], colores: ['verde'], pmin: 0.72, cmin: 1.30, porJuego: 1, porMercado: 2,
      resumen: 'Solo líneas verdes de probabilidad alta, una pata por partido. Para revisar lo más seguro del día.' },
    { id: 'intermedia', nombre: 'Intermedia', T: 5, variantes: [4, 5], colores: ['verde', 'amarillo'], pmin: 0.60, cmin: 1.30, porJuego: 2, porMercado: 3,
      resumen: 'Verdes y amarillas con buen respaldo estadístico: más cuota, más riesgo.' },
    { id: 'sonadora', nombre: 'Soñadora', T: 20, variantes: [7], colores: ['verde', 'amarillo'], pmin: 0.50, cmin: 1.30, porJuego: 2, porMercado: 3,
      resumen: 'Poco probable, pero cada pata tiene respaldo en promedios, minutos y contexto. Para jugar un poco: apostá poco.' }
  ];

  var cuotaDe = function (s) { return s.cu != null ? s.cu : null; };   // solo cuotas de Betano

  function candidatas(grupos, nivel, excluidos) {
    var out = [];
    grupos.forEach(function (g) {
      if (excluidos && excluidos[g.id]) return;
      if (g.mod !== 'completo') return;                                  // solo con proyección del sitio
      if (g.est && g.est !== 'Probable') return;                         // cualquier estado de lesión salvo Probable queda fuera
      g.pasos.forEach(function (s) {
        var cu = cuotaDe(s);
        if (cu == null || cu < nivel.cmin) return;                       // sin patas de relleno: ninguna línea que pague menos de 1,30
        if (nivel.colores.indexOf(s.c) < 0 || s.p < nivel.pmin) return;
        out.push({ g: g, s: s, cu: cu, lp: Math.log(s.p), lc: Math.log(cu) });
      });
    });
    out.sort(function (a, b) { return a.g.id - b.g.id || a.g.m.localeCompare(b.g.m) || a.s.L - b.s.L; }); // orden estable
    return out;
  }

  function cabe(legs, x, nivel, ignorar) {
    var jug = 0, jue = 0, mer = 0;
    for (var i = 0; i < legs.length; i++) {
      if (i === ignorar) continue;
      var y = legs[i];
      if (y.g.id === x.g.id) return false;
      if (y.g.gid === x.g.gid) jue++;
      if (y.g.m === x.g.m) mer++;
    }
    return jue < nivel.porJuego && mer < nivel.porMercado && jug === 0;
  }

  function seleccionar(pool, n, lambda, nivel) {
    var orden = pool.map(function (x) { return { x: x, sc: x.lp + lambda * x.lc }; })
      .sort(function (a, b) { return b.sc - a.sc; });
    var legs = [];
    for (var i = 0; i < orden.length && legs.length < n; i++) {
      if (cabe(legs, orden[i].x, nivel, -1)) legs.push(orden[i].x);
    }
    return legs;
  }
  var suma = function (legs, k) { return legs.reduce(function (a, x) { return a + x[k]; }, 0); };

  /* Búsqueda exhaustiva con poda (ramificación y cota) para cuando la voraz no encuentra n patas que entren juntas.
     Pasa con pocas candidatas (por ejemplo, con la cuota mínima de 1,30): la voraz toma las de cuota más alta, las reglas por
     partido y por mercado dejan afuera al resto y no ve la combinación que sí existe. presupuesto = nodos máximos a visitar. */
  function exhaustiva(pool, n, nivel, T, presupuesto) {
    var orden = pool.slice().sort(function (a, b) { return b.lp - a.lp || b.lc - a.lc; });
    var lcs = pool.map(function (x) { return x.lc; }).sort(function (a, b) { return b - a; }), topLc = [0];
    for (var i = 0; i < n && i < lcs.length; i++) topLc.push(topLc[i] + lcs[i]);
    var mejor = null, mejorLp = -Infinity, nodos = 0, legs = [];
    (function dfs(desde, lp, lc) {
      if (++nodos > presupuesto) return;
      if (legs.length === n) { if (lc >= T - 1e-12 && lp > mejorLp + 1e-12) { mejorLp = lp; mejor = legs.slice(); } return; }
      var faltan = n - legs.length;
      if (orden.length - desde < faltan || lc + topLc[faltan] < T - 1e-12) return;   // ni con las cuotas más altas llega
      for (var k = desde; k <= orden.length - faltan; k++) {
        var cota = lp;                                                    // ordenadas por probabilidad: lo mejor posible desde k
        for (var j = 0; j < faltan; j++) cota += orden[k + j].lp;
        if (cota <= mejorLp + 1e-12) return;
        var x = orden[k];
        if (!cabe(legs, x, nivel, -1)) continue;
        legs.push(x); dfs(k + 1, lp + x.lp, lc + x.lc); legs.pop();
        if (nodos > presupuesto) return;
      }
    })(0, 0, 0);
    return mejor;
  }

  /* Mejor combinación de n patas con cuota total ≥ T. Devuelve null si no hay con los datos de hoy. */
  function optimizar(pool, n, nivel) {
    var T = Math.log(nivel.T), lo = 0, hi = 80;
    var mejor = seleccionar(pool, n, hi, nivel);
    if (mejor.length < n || suma(mejor, 'lc') < T) {
      mejor = exhaustiva(pool, n, nivel, T, 300000);
      if (!mejor) return null;
    } else {
      for (var it = 0; it < 50 && hi - lo > 1e-6; it++) {   // ~27 iteraciones en vez de 50: el resultado no cambia (verificado con datos reales y 800 escenarios perturbados)
        var mid = (lo + hi) / 2, legs = seleccionar(pool, n, mid, nivel);
        if (legs.length === n && suma(legs, 'lc') >= T) { mejor = legs; hi = mid; } else { lo = mid; }
      }
    }
    // mejora local: reemplazar una pata por otra candidata si sigue alcanzando la cuota y sube la probabilidad
    var mejora = true, pasadas = 0;
    while (mejora && pasadas++ < 8) {
      mejora = false;
      for (var i = 0; i < mejor.length; i++) {
        var base = suma(mejor, 'lp'), lcRest = suma(mejor, 'lc') - mejor[i].lc, elegido = null, mejorLp = base;
        for (var j = 0; j < pool.length; j++) {
          var c = pool[j];
          if (!cabe(mejor, c, nivel, i)) continue;
          if (lcRest + c.lc < T) continue;
          var lp = base - mejor[i].lp + c.lp;
          if (lp > mejorLp + 1e-9) { mejorLp = lp; elegido = c; }
        }
        if (elegido) { mejor = mejor.slice(); mejor[i] = elegido; mejora = true; }
      }
    }
    return mejor;
  }

  /* Devuelve [{id, nombre, resumen, T, n, legs:[{g, s, cu}]}] para todos los niveles y variantes. */
  function todas(grupos) {
    var res = [];
    NIVELES.forEach(function (nivel) {
      var usados = {};                                                   // cada variante del nivel usa jugadores distintos
      nivel.variantes.forEach(function (n) {
        var pool = candidatas(grupos, nivel, usados), legs = optimizar(pool, n, nivel);
        if (!legs) return;
        legs.forEach(function (x) { usados[x.g.id] = true; });
        res.push({ id: nivel.id, nombre: nivel.nombre, resumen: nivel.resumen, T: nivel.T, n: n,
          legs: legs.map(function (x) { return { g: x.g, s: x.s, cu: x.cu }; }) });
      });
    });
    return res;
  }

  var api = { NIVELES: NIVELES, todas: todas, optimizar: optimizar, candidatas: candidatas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sugeridas = api;
})(typeof window !== 'undefined' ? window : globalThis);
