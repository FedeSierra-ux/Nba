/* Combinadas sugeridas del día: Segura / Intermedia / Soñadora.
   Para cada una se buscan las patas «más de» que MAXIMIZAN la probabilidad conjunta con una cuota total mínima.
   Se resuelve como una mochila: maximizar Σ ln(p) sujeto a Σ ln(cuota) ≥ ln(T), por relajación de Lagrange
   (se ordenan las candidatas por ln(p) + λ·ln(cuota) y se busca el λ mínimo que alcanza la cuota) y una mejora local por intercambios.
   Se usa en el navegador (window.Sugeridas) y en Node para pruebas (module.exports). */
(function (root) {
  'use strict';

  var NIVELES = [
    { id: 'segura', nombre: 'Segura', T: 1.99, variantes: [3, 4], colores: ['verde'], pmin: 0.72, cmin: 1.12, porJuego: 1, porMercado: 2,
      resumen: 'Solo líneas verdes de probabilidad alta, una pata por partido. Para revisar lo más seguro del día.' },
    { id: 'intermedia', nombre: 'Intermedia', T: 5, variantes: [4, 5], colores: ['verde', 'amarillo'], pmin: 0.60, cmin: 1.15, porJuego: 2, porMercado: 3,
      resumen: 'Verdes y amarillas con buen respaldo estadístico: más cuota, más riesgo.' },
    { id: 'sonadora', nombre: 'Soñadora', T: 20, variantes: [7], colores: ['verde', 'amarillo'], pmin: 0.50, cmin: 1.25, porJuego: 2, porMercado: 3,
      resumen: 'Poco probable, pero cada pata tiene respaldo en promedios, minutos y contexto. Para jugar un poco: apostá poco.' }
  ];

  var cuotaDe = function (s) { return s.cu != null ? s.cu : null; };   // solo cuotas de Betano

  function candidatas(grupos, nivel, excluidos) {
    var out = [];
    grupos.forEach(function (g) {
      if (excluidos && excluidos[g.id]) return;
      if (g.mod !== 'completo') return;                                  // solo con proyección del sitio
      if (g.est && /Questionable|Doubtful/.test(g.est)) return;          // dudosos fuera
      g.pasos.forEach(function (s) {
        var cu = cuotaDe(s);
        if (cu == null || cu < nivel.cmin) return;                       // sin patas de relleno que no aportan cuota
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

  /* Mejor combinación de n patas con cuota total ≥ T. Devuelve null si no hay con los datos de hoy. */
  function optimizar(pool, n, nivel) {
    var T = Math.log(nivel.T), lo = 0, hi = 80;
    var mejor = seleccionar(pool, n, hi, nivel);
    if (mejor.length < n || suma(mejor, 'lc') < T) return null;
    for (var it = 0; it < 50; it++) {
      var mid = (lo + hi) / 2, legs = seleccionar(pool, n, mid, nivel);
      if (legs.length === n && suma(legs, 'lc') >= T) { mejor = legs; hi = mid; } else { lo = mid; }
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
