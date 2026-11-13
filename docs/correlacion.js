/* Probabilidad conjunta de varias patas con correlación (cópula gaussiana).
   La matriz de correlación es diagonal por bloques (partidos distintos = independientes), así que
   P(todas) = Π P(bloque de cada partido). Bloque de 1 pata: p. Bloque de 2: normal bivariada exacta (Genz).
   Bloque de 3 o más: Monte Carlo con semilla fija solo sobre ese bloque. Resultados memorizados.
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

  // Φ(x) con erfc de Numerical Recipes (error relativo < 1,2e-7)
  function phi(x) {
    var z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - r / 2 : r / 2;
  }

  // P(X > dh, Y > dk) para normales estándar con correlación r (Genz 2004, «bvnu»).
  var GL = [
    { w: [0.1713244923791705, 0.3607615730481384, 0.4679139345726904], x: [0.9324695142031522, 0.6612093864662647, 0.2386191860831970] },
    { w: [0.04717533638651177, 0.1069393259953183, 0.1600783285433464, 0.2031674267230659, 0.2334925365383547, 0.2491470458134029],
      x: [0.9815606342467191, 0.9041172563704750, 0.7699026741943050, 0.5873179542866171, 0.3678314989981802, 0.1252334085114692] },
    { w: [0.01761400713915212, 0.04060142980038694, 0.06267204833410906, 0.08327674157670475, 0.1019301198172404, 0.1181945319615184, 0.1316886384491766, 0.1420961093183821, 0.1491729864726037, 0.1527533871307259],
      x: [0.9931285991850949, 0.9639719272779138, 0.9122344282513259, 0.8391169718222188, 0.7463319064601508, 0.6360536807265150, 0.5108670019508271, 0.3737060887154196, 0.2277858511416451, 0.07652652113349733] }
  ];
  function bvnu(dh, dk, r) {
    if (r === 0) return phi(-dh) * phi(-dk);
    var tp = 2 * Math.PI, h = dh, k = dk, hk = h * k, bvn = 0, ar = Math.abs(r);
    var g = ar < 0.3 ? GL[0] : ar < 0.75 ? GL[1] : GL[2], n = g.w.length, i, s, xi;
    if (ar < 0.925) {
      var hs = (h * h + k * k) / 2, asr = Math.asin(r) / 2;
      for (i = 0; i < n; i++) for (s = -1; s <= 1; s += 2) {
        var sn = Math.sin(asr * (1 + s * g.x[i]));
        bvn += g.w[i] * Math.exp((sn * hk - hs) / (1 - sn * sn));
      }
      return Math.max(0, Math.min(1, bvn * asr / tp + phi(-h) * phi(-k)));
    }
    if (r < 0) { k = -k; hk = -hk; }
    if (ar < 1) {
      var as = 1 - r * r, a = Math.sqrt(as), bs = (h - k) * (h - k), c = (4 - hk) / 8, d = (12 - hk) / 80, asr2 = -(bs / as + hk) / 2;
      if (asr2 > -100) bvn = a * Math.exp(asr2) * (1 - c * (bs - as) * (1 - d * bs) / 3 + c * d * as * as);
      if (hk > -100) { var b = Math.sqrt(bs), sp = Math.sqrt(tp) * phi(-b / a); bvn -= Math.exp(-hk / 2) * sp * b * (1 - c * bs * (1 - d * bs) / 3); }
      a /= 2;
      var acc = 0;
      for (i = 0; i < n; i++) for (s = -1; s <= 1; s += 2) {
        xi = a * (1 + s * g.x[i]); var xs = xi * xi, as3 = -(bs / xs + hk) / 2;
        if (as3 > -100) {
          var sp2 = 1 + c * xs * (1 + 5 * d * xs), rs = Math.sqrt(1 - xs), ep = Math.exp(-(hk / 2) * xs / ((1 + rs) * (1 + rs))) / rs;
          acc += g.w[i] * Math.exp(as3) * (sp2 - ep);
        }
      }
      bvn = (a * acc - bvn) / tp;
    }
    if (r > 0) bvn += phi(-Math.max(h, k));
    else if (h >= k) bvn = -bvn;
    else bvn = (h < 0 ? phi(k) - phi(h) : phi(-h) - phi(-k)) - bvn;
    return Math.max(0, Math.min(1, bvn));
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
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

  /* Monte Carlo de un bloque correlacionado: normales generadas solo cuando hacen falta
     (la mayoría de las muestras falla en las primeras patas) y Box-Muller aprovechando el seno y el coseno. */
  function monteCarlo(R, umbral, N) {
    var n = R.length, L = cholesky(R), f = 1, i, j;
    while (!L && f > 0.05) { f *= 0.8; for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (i !== j) R[i][j] *= 0.8; L = cholesky(R); }
    if (!L) return null;
    var rnd = mulberry32(20261113), ok = 0, e = new Float64Array(n), extra = NaN, z, k, s, u, v, m;
    var gauss = function () {
      if (extra === extra) { var y = extra; extra = NaN; return y; }
      do { u = rnd(); } while (u === 0);
      v = 2 * Math.PI * rnd(); m = Math.sqrt(-2 * Math.log(u));
      extra = m * Math.sin(v); return m * Math.cos(v);
    };
    for (s = 0; s < N; s++) {
      for (i = 0; i < n; i++) {
        e[i] = gauss();
        z = 0; for (k = 0; k <= i; k++) z += L[i][k] * e[k];
        if (z > umbral[i]) break;
      }
      if (i === n) ok++;
    }
    return ok / N;
  }

  var memo = new Map();

  /* patas: [{id, eq, gid, m, lado, p}] -> {indep, conj, correlacionadas} */
  function conjunta(patas, muestras) {
    var n = patas.length, indep = 1, i, j;
    patas.forEach(function (x) { indep *= x.p; });
    if (n < 2) return { indep: indep, conj: indep, correlacionadas: 0 };
    var N = muestras || 30000;
    var clave = N + '#' + patas.map(function (x) { return x.id + '|' + x.gid + '|' + x.m + '|' + x.lado + '|' + x.p; }).join(';');
    var hit = memo.get(clave);
    if (hit) return { indep: hit.indep, conj: hit.conj, correlacionadas: hit.correlacionadas };

    // bloques conectados por correlación no nula (en la práctica, uno por partido)
    var corr = 0, padre = patas.map(function (_, k) { return k; });
    var raiz = function (k) { while (padre[k] !== k) k = padre[k] = padre[padre[k]]; return k; };
    var Rfull = [];
    for (i = 0; i < n; i++) Rfull.push(new Array(n).fill(0));
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var r = rho(patas[i], patas[j]);
      if (r !== 0) { Rfull[i][j] = Rfull[j][i] = r; corr++; padre[raiz(i)] = raiz(j); }
    }
    var res;
    if (!corr) res = { indep: indep, conj: indep, correlacionadas: 0 };
    else {
      var bloques = new Map();
      for (i = 0; i < n; i++) { var b = raiz(i); if (!bloques.has(b)) bloques.set(b, []); bloques.get(b).push(i); }
      var conj = 1, fallo = false;
      bloques.forEach(function (idx) {
        if (fallo) return;
        var t = idx.map(function (k) { return normInv(Math.min(.999, Math.max(.001, patas[k].p))); });
        if (idx.length === 1) { conj *= patas[idx[0]].p; return; }
        if (idx.length === 2) { conj *= bvnu(-t[0], -t[1], Rfull[idx[0]][idx[1]]); return; }
        var R = idx.map(function (a) { return idx.map(function (b2) { return a === b2 ? 1 : Rfull[a][b2]; }); });
        var pb = monteCarlo(R, t, N);
        if (pb == null) { fallo = true; return; }
        conj *= pb;
      });
      res = { indep: indep, conj: fallo ? indep : conj, correlacionadas: corr };
    }
    if (memo.size > 500) memo.clear();
    memo.set(clave, res);
    return { indep: res.indep, conj: res.conj, correlacionadas: res.correlacionadas };
  }

  var api = { conjunta: conjunta, rho: rho, normInv: normInv, bvnu: bvnu, phi: phi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Correlacion = api;
})(typeof window !== 'undefined' ? window : globalThis);
