/* Probabilidad conjunta de varias patas con correlación (cópula gaussiana, Monte Carlo con semilla fija).
   Se usa tanto en el navegador (window.Correlacion) como en Node para pruebas (module.exports). */
(function (root) {
  'use strict';

  // Componentes estadísticos de cada mercado, para saber cuánto comparten dos mercados del mismo jugador.
  var COMP = {
    pts: ['p'], reb: ['r'], ast: ['a'], pra: ['p', 'r', 'a'], pr: ['p', 'r'], pa: ['p', 'a'], ra: ['r', 'a'],
    fgm: ['p'], fga: ['p'], fg3m: ['p'], fg3a: ['p'], ftm: ['p'], fta: ['p'], fg2m: ['p'], fg2a: ['p'],
    dreb: ['r'], oreb: ['r'], ast_prob: ['a'], reb_prob: ['r']
  };

  function normInv(p) { // Acklam
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, ph = 1 - pl, q, r;
    if (p <= 0) return -8; if (p >= 1) return 8;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function gauss(rnd) {
    var u = 0, v = 0;
    while (u === 0) u = rnd();
    v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* Correlación entre dos patas {id, eq, gid, m, lado}. Devuelve un número en (-1, 1). */
  function rho(a, b) {
    var signo = a.lado === b.lado ? 1 : -1;
    if (a.id === b.id) {
      var ca = COMP[a.m] || [], cb = COMP[b.m] || [];
      var comun = ca.filter(function (x) { return cb.indexOf(x) >= 0; }).length;
      var base = comun > 0 ? (comun >= Math.min(ca.length, cb.length) ? 0.75 : 0.55) : 0.25;
      return signo * base;
    }
    if (a.gid === b.gid) return signo * 0.06; // mismo partido: ritmo / marcador compartido
    return 0;
  }

  function cholesky(R) {
    var n = R.length, L = [], i, j, k, s;
    for (i = 0; i < n; i++) L.push(new Array(n).fill(0));
    for (i = 0; i < n; i++) {
      for (j = 0; j <= i; j++) {
        s = R[i][j];
        for (k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (s <= 1e-9) return null; L[i][j] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }

  /* patas: [{id, eq, gid, m, lado, p}] -> {indep, conj, rhoMax} */
  function conjunta(patas, muestras) {
    var n = patas.length, indep = 1, i, j;
    patas.forEach(function (x) { indep *= x.p; });
    if (n < 2) return { indep: indep, conj: indep, correlacionadas: 0 };
    var R = [], corr = 0;
    for (i = 0; i < n; i++) { R.push(new Array(n).fill(0)); R[i][i] = 1; }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      R[i][j] = R[j][i] = rho(patas[i], patas[j]);
      if (R[i][j] !== 0) corr++;
    }
    if (!corr) return { indep: indep, conj: indep, correlacionadas: 0 };
    var L = cholesky(R), f = 1;
    while (!L && f > 0.05) { f *= 0.8; for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j) R[i][j] *= 0.8; L = cholesky(R); }
    if (!L) return { indep: indep, conj: indep, correlacionadas: corr };
    var umbral = patas.map(function (x) { return normInv(Math.min(.999, Math.max(.001, x.p))); });
    var rnd = mulberry32(20261113), N = muestras || 30000, ok = 0, e = new Array(n), z, h, k;
    for (var s = 0; s < N; s++) {
      for (i = 0; i < n; i++) e[i] = gauss(rnd);
      h = true;
      for (i = 0; i < n && h; i++) {
        z = 0; for (k = 0; k <= i; k++) z += L[i][k] * e[k];
        if (z > umbral[i]) h = false;
      }
      if (h) ok++;
    }
    return { indep: indep, conj: ok / N, correlacionadas: corr };
  }

  var api = { conjunta: conjunta, rho: rho, normInv: normInv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Correlacion = api;
})(typeof window !== 'undefined' ? window : globalThis);
