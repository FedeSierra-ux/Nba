#!/usr/bin/env python3
"""Baja los datos del día y calcula el semáforo de riesgo.

Fuentes (todas públicas y sin clave):
  * LudoProps  (https://ludoprops.com/api/...)  -> líneas, promedios, minutos, lesiones, cuotas de Betano
  * ESPN       (site.api.espn.com)               -> spread, total, moneyline, partidos de días previos (back-to-back)

Uso:
  python3 scripts/actualizar.py [--fecha AAAA-MM-DD] [--salida docs/data]

Solo usa la librería estándar de Python (>= 3.9).
"""
import argparse, datetime as dt, json, math, os, statistics as st, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

LUDO = "https://ludoprops.com/api/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
UA = "NbaSemaforo/1.0 (uso personal; consultas espaciadas)"

# --------------------------------------------------------------------------- parámetros del modelo
SD_PARTIDO = 12.0        # desvío del margen final de un partido NBA (puntos)
UMBRAL_BLOWOUT = 14.5    # margen a partir del cual los titulares suelen sentarse
P_MAX = 0.96            # techo de probabilidad por línea (lesión en el partido, faltas, minutos de basura)
P_MAX_MODELO = 0.97
ESTADOS_ROJO = {"Questionable", "Doubtful", "Out", "Suspension", "Suspended", "Inactive", "Day-To-Day"}
R0 = 0.27                # probabilidad de blowout "típica" (ya incluida en los promedios de temporada)
CV = {  # coeficiente de variación a priori por mercado (heurístico)
    'pts': .38, 'reb': .50, 'ast': .55, 'pra': .30, 'pr': .32, 'pa': .33, 'ra': .42,
    'fga': .30, 'fgm': .38, 'fg3m': .75, 'fg3a': .50, 'fta': .55, 'ftm': .65,
    'tov': .60, 'pf': .55, 'stl': .85, 'blk': 1.0, 'dreb': .55, 'oreb': .80,
    'fg2a': .40, 'fg2m': .50, 'ast_prob': .55, 'reb_prob': .50,
    '1q_pts': .70, '1q_reb': .90, '1q_ast': 1.0,
}
NOMBRE = {
    'pts': 'Puntos', 'reb': 'Rebotes', 'ast': 'Asistencias', 'pra': 'Puntos + Reb + Asist', 'pr': 'Puntos + Rebotes',
    'pa': 'Puntos + Asistencias', 'ra': 'Rebotes + Asistencias', 'fga': 'Tiros de campo intentados',
    'fgm': 'Tiros de campo convertidos', 'fg3m': 'Triples convertidos', 'fg3a': 'Triples intentados',
    'fta': 'Libres intentados', 'ftm': 'Libres convertidos', 'tov': 'Pérdidas', 'pf': 'Faltas', 'stl': 'Robos',
    'blk': 'Tapas', 'dreb': 'Rebotes defensivos', 'oreb': 'Rebotes ofensivos', 'fg2a': 'Dobles intentados',
    'fg2m': 'Dobles convertidos', 'ast_prob': 'Asistencias (escalera)', 'reb_prob': 'Rebotes (escalera)',
    '1q_pts': '1er cuarto: puntos', '1q_reb': '1er cuarto: rebotes', '1q_ast': '1er cuarto: asistencias',
}
ESPN_A_TRI = {'NY': 'NYK', 'SA': 'SAS', 'GS': 'GSW', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS'}


# --------------------------------------------------------------------------- red
def pedir(url, intentos=3, espera=2.0, timeout=60):
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(espera * (i + 1))
    raise RuntimeError(f"No pude leer {url}: {ultimo}")


def tri(a):
    return ESPN_A_TRI.get(a, a)


# --------------------------------------------------------------------------- matemática
def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def sig(x):
    return 1 / (1 + math.exp(-x))


def logit(p):
    p = min(.995, max(.005, p))
    return math.log(p / (1 - p))


def nb_sf(linea, mu, var):
    """P(X > linea) con binomial negativa (o Poisson si no hay sobredispersión). Línea tipo x.5."""
    k = int(math.floor(linea))
    if k < 0:
        return 1.0
    if var <= mu * 1.02:
        pmf = math.exp(-mu); cdf = pmf
        for i in range(1, k + 1):
            pmf *= mu / i; cdf += pmf
        return 1 - cdf
    r = mu * mu / (var - mu); p = r / (r + mu)
    pmf = p ** r; cdf = pmf
    for i in range(1, k + 1):
        pmf *= (i - 1 + r) / i * (1 - p); cdf += pmf
    return 1 - cdf


def p_mas(linea, mu, sd):
    """P(X > linea). Binomial negativa para medias chicas, normal para grandes, y una mezcla entre 4 y 8
    para que la probabilidad no salte al cruzar un umbral."""
    if mu <= 0:
        return 0.0
    pn = 1 - phi((linea - mu) / sd)
    if mu >= 8:
        return pn
    pb = nb_sf(linea, mu, sd * sd)
    if mu <= 4:
        return pb
    w = (mu - 4) / 4
    return (1 - w) * pb + w * pn


def prob_blowout(spread):
    """P(|margen| >= 14.5) para un partido con spread dado (favorito por `spread` puntos)."""
    if spread is None:
        return None
    s = abs(spread)
    return (1 - phi((UMBRAL_BLOWOUT - s) / SD_PARTIDO)) + phi((-UMBRAL_BLOWOUT - s) / SD_PARTIDO)


def minutos_perdidos_blowout(min_proy):
    if min_proy >= 30:
        return 7.0
    if min_proy >= 24:
        return 5.0
    return 2.0


# --------------------------------------------------------------------------- contexto de partidos (ESPN)
def contexto_partidos(fecha, partidos_ludo, avisos):
    """Spread / total / moneyline / back-to-back por partido. Devuelve dict game_id -> info."""
    d0 = dt.date.fromisoformat(fecha)
    fechas = {i: (d0 - dt.timedelta(days=i)) for i in range(0, 4)}
    juegos = {}
    for i, dia in fechas.items():
        try:
            sb = pedir(ESPN + "scoreboard?dates=" + dia.strftime("%Y%m%d"))
        except Exception as e:  # noqa: BLE001
            avisos.append(f"ESPN scoreboard {dia}: {e}")
            juegos[i] = None
            continue
        juegos[i] = sb.get("events", [])
    jugaron = {i: set() for i in range(1, 4)}
    for i in range(1, 4):
        for ev in juegos.get(i) or []:
            estado_ev = (((ev.get("status") or {}).get("type") or {}).get("name") or "")
            if estado_ev in ("STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED"):
                continue
            for c in ev["competitions"][0]["competitors"]:
                jugaron[i].add(tri(c["team"]["abbreviation"]))

    por_equipos = {}
    for ev in juegos.get(0) or []:
        c = ev["competitions"][0]
        eq = {x["homeAway"]: tri(x["team"]["abbreviation"]) for x in c["competitors"]}
        por_equipos[(eq["home"], eq["away"])] = ev

    info = {}
    for p in partidos_ludo:
        loc, vis = p["local"], p["visita"]
        ev = por_equipos.get((loc, vis)) or por_equipos.get((vis, loc))
        r = {"spread": None, "fav": None, "total": None, "ml": {}, "proveedor": None, "espn_id": None,
             "records": {}, "lesiones": {}, "ultimos5": {}}
        if ev:
            r["espn_id"] = ev["id"]
            comp = ev["competitions"][0]
            for x in comp["competitors"]:
                rec = next((q["summary"] for q in x.get("records", []) if q.get("type") == "total"), None)
                r["records"][tri(x["team"]["abbreviation"])] = rec
            odds = (comp.get("odds") or [None])[0]
            if odds:
                r["proveedor"] = (odds.get("provider") or {}).get("name")
                r["total"] = odds.get("overUnder")
                sp = odds.get("spread")
                if sp is not None:
                    r["spread"] = abs(float(sp))
                    away_fav = (odds.get("awayTeamOdds") or {}).get("favorite")
                    home_fav = (odds.get("homeTeamOdds") or {}).get("favorite")
                    r["fav"] = vis if away_fav else loc if home_fav else None
                    if r["fav"] is None:
                        det = str(odds.get("details") or "").split()
                        if len(det) == 2 and det[1].startswith("-"):
                            cand = tri(det[0])
                            r["fav"] = cand if cand in (loc, vis) else None
                    if r["spread"] == 0:
                        r["fav"] = None
            # detalle: moneyline y lesiones
            try:
                s = pedir(ESPN + "summary?event=" + ev["id"])
                pc = (s.get("pickcenter") or [None])[0] or {}
                ml_a = (pc.get("awayTeamOdds") or {}).get("moneyLine")
                ml_h = (pc.get("homeTeamOdds") or {}).get("moneyLine")
                num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
                r["ml"] = {vis: num(ml_a), loc: num(ml_h)}
                for bloque in s.get("injuries") or []:
                    t = tri(((bloque.get("team") or {}).get("abbreviation")) or "")
                    r["lesiones"][t] = [
                        {"jugador": (i.get("athlete") or {}).get("displayName"),
                         "estado": i.get("status"),
                         "nota": ((i.get("details") if isinstance(i.get("details"), dict) else {}).get("type")
                                  or (i.get("type") if isinstance(i.get("type"), dict) else {}).get("description"))}
                        for i in bloque.get("injuries", [])
                    ]
                for bloque in s.get("lastFiveGames") or []:
                    t = tri(((bloque.get("team") or {}).get("abbreviation")) or "")
                    r["ultimos5"][t] = [{"rival": tri(((e.get("opponent") or {}).get("abbreviation")) or ""),
                                         "res": e.get("gameResult"), "marcador": e.get("score"),
                                         "fecha": e.get("gameDate")} for e in bloque.get("events", [])]
            except Exception as e:  # noqa: BLE001
                avisos.append(f"ESPN summary {ev['id']}: {e}")
        else:
            avisos.append(f"Sin datos de ESPN para {vis} @ {loc}")
        # back-to-back
        for t in (loc, vis):
            ayer = t in jugaron[1]
            en4 = sum(1 for i in (1, 2, 3) if t in jugaron[i]) + 1
            r.setdefault("descanso", {})[t] = {"b2b": ayer, "tres_en_cuatro": en4 >= 3,
                                              "dias": 0 if ayer else (1 if t in jugaron[2] else 2 if t in jugaron[3] else 3)}
        r["p_blowout"] = prob_blowout(r["spread"])
        info[p["game_id"]] = r
    return info


# --------------------------------------------------------------------------- modelo por línea
def evaluar(f, ctx):
    """Devuelve un dict liviano con el lado recomendado, probabilidad y semáforo."""
    merc = f["mercado"]
    ult = [x for x in (f.get("ult") or []) if isinstance(x, (int, float))]
    if merc not in CV or not ult or not f.get("linea") or f["linea"] <= 0:
        return None
    L = f["linea"]
    n_t = f.get("n_temp") or 0
    prom_t = f.get("prom_temp") if f.get("prom_temp") is not None else f.get("prom")
    m10 = st.mean(ult)
    completo = f.get("media") is not None
    mu0 = f["media"] if completo else (0.5 * (prom_t if prom_t is not None else m10) + 0.5 * m10)
    min_proy = f.get("min_proy") or f.get("min_prom") or 0

    # ---- contexto del partido: blowout y back-to-back
    g = ctx.get(f["game_id"], {})
    desc = (g.get("descanso") or {}).get(f["equipo"], {})
    r = g.get("p_blowout")
    dmin = 0.0
    notas = []
    if r is not None and min_proy >= 20:
        dmin += (r - R0) * minutos_perdidos_blowout(min_proy)
    if desc.get("b2b") and min_proy >= 28:
        dmin += 2.0
        notas.append("segundo día de back-to-back (-2 min estimados)")
    elif desc.get("tres_en_cuatro") and min_proy >= 28:
        dmin += 1.0
        notas.append("3er partido en 4 días (-1 min estimado)")
    factor = 1.0 - (dmin / min_proy) if min_proy else 1.0
    factor = min(1.04, max(0.85, factor))
    mu = mu0 * factor

    sd10 = st.pstdev(ult) if len(ult) > 1 else 0
    prior = max(CV[merc] * mu0, .6)
    sd = math.sqrt(.6 * sd10 ** 2 + .4 * prior ** 2)
    p_propio0 = p_mas(L, mu0, sd)
    p_propio = p_mas(L, mu, sd)
    p_sitio = None
    if f.get("prob") is not None:
        p_sitio = min(.97, max(.03, f["prob"] + (p_propio - p_propio0)))
    p_modelo = p_propio if p_sitio is None else .5 * p_sitio + .5 * p_propio
    casa = f.get("casa")
    p_mkt_over = casa["prob"] if (casa and casa.get("prob") is not None) else None
    # Al elegir siempre el lado donde el modelo más discrepa con la casa se sobreestima (maldición del ganador):
    # cuando hay cuota, se promedia el modelo con la probabilidad de la casa sin margen.
    # Sin cuota no hay con qué contrastar: se acerca el modelo a 50% en la misma proporción.
    p_over = (.5 * p_modelo + .5 * .5) if p_mkt_over is None else .5 * p_modelo + .5 * p_mkt_over
    lado = 'mas' if p_over >= .5 else 'menos'
    p = p_over if lado == 'mas' else 1 - p_over
    sg = 1 if lado == 'mas' else -1

    def tasa(x):
        return None if x is None else (x if lado == 'mas' else 1 - x)
    r10, rtemp = tasa(f.get("pct_ult")), tasa(f.get("pct_temp"))
    rh2h = tasa(f.get("pct_h2h")) if (f.get("n_h2h") or 0) >= 4 else None
    senales = [x for x in (r10, rtemp, rh2h) if x is not None]
    a_favor = sum(1 for x in senales if x >= .6)
    en_contra = sum(1 for x in senales if x <= .4)

    def margen(x):
        return sg * (x - L) / L if L else 0
    prom_ok = sum(1 for x in (prom_t if prom_t is not None else m10, m10, mu) if margen(x) >= .04)
    prom_mal = sum(1 for x in (prom_t if prom_t is not None else m10, m10, mu) if margen(x) <= -.04)

    # ---- banderas
    mins = f.get("min_ult") or []
    med = st.median(mins) if mins else 0
    bajos = sum(1 for m in mins if m < .7 * med)
    estado = f.get("estado")
    banderas, rojo, graves = [], False, 0
    if estado in ESTADOS_ROJO:
        rojo = True; banderas.append(f"lesión: {estado}")
    elif estado:
        banderas.append(f"lesión: {estado}")
    if f.get("no_sugerir"):
        rojo = True; banderas.append('el sitio lo marca "no sugerir"')
    if f.get("rol") == 'poco minuto' or min_proy < 20:
        rojo = True; banderas.append(f"pocos minutos ({min_proy:.0f})")
    if n_t < 6:
        graves += 1; banderas.append(f"muestra chica ({n_t} partidos)")
    if bajos >= 2:
        graves += 1; banderas.append(f"minutos inestables ({bajos} de {len(mins)} partidos <70% de lo típico)")
    if min_proy < 26 and lado == 'mas':
        graves += 1; banderas.append(f"minutos justos ({min_proy:.0f})")
    if en_contra >= 1:
        graves += 1; banderas.append("historial en contra")
    if (lado == 'mas' and f.get("cruce") == 'F') or (lado == 'menos' and f.get("cruce") == 'A'):
        banderas.append(f"cruce {f['cruce']}: el rival defiende {'bien' if f['cruce'] == 'F' else 'mal'} esta posición (poca evidencia)")
    if p_sitio is not None and abs(p_propio - p_sitio) > .15:
        graves += 1; banderas.append("los modelos discrepan")
    tope_amarillo = False
    sp = g.get('spread')
    texto_spread = f"spread {sp:g}" if sp is not None else "spread no disponible"
    if p_mkt_over is not None:
        gap = (p_modelo - p_mkt_over) if lado == 'mas' else (p_mkt_over - p_modelo)
        if gap > .20:
            graves += 2
            banderas.append(f"el modelo lo ve mucho más probable que la casa ({p_modelo if lado == 'mas' else 1 - p_modelo:.0%} vs {p_mkt_over if lado == 'mas' else 1 - p_mkt_over:.0%})")
    if r is not None and r >= .45 and min_proy >= 26 and lado == 'mas':
        tope_amarillo = True
        banderas.append(f"riesgo de blowout alto ({texto_spread}): titulares pueden sentarse")
    elif r is not None and r >= .38 and min_proy >= 26 and lado == 'mas':
        banderas.append(f"riesgo de blowout medio ({texto_spread})")
    if desc.get("b2b") and min_proy >= 28 and lado == 'mas':
        tope_amarillo = True; banderas.append("back-to-back")
    if not completo:
        tope_amarillo = True; banderas.append("modelo básico (sin proyección del sitio)")
    if casa is None:
        tope_amarillo = True
        banderas.append("sin cuota en Betano (no se puede contrastar con la casa)")

    if rojo:
        color = 'rojo'
    elif p >= .60 and prom_ok == 3 and a_favor >= 2 and en_contra == 0 and graves == 0 and min_proy >= 24 and estado is None:
        color = 'verde'
    elif p >= .55 and prom_mal == 0 and prom_ok >= 2 and graves <= 1 and en_contra == 0:
        color = 'amarillo'
    else:
        color = 'rojo'
    if tope_amarillo and color == 'verde':
        color = 'amarillo'

    cu_mas = casa["mas"] if casa else None
    cu_menos = casa["menos"] if casa else None
    cuota = (cu_mas if lado == 'mas' else cu_menos) if casa else None
    p_mkt = None
    if p_mkt_over is not None:
        p_mkt = p_mkt_over if lado == 'mas' else 1 - p_mkt_over
    ajuste = f.get("ajuste_texto")
    if notas:
        ajuste = (ajuste + " · " if ajuste else "") + " · ".join(notas)

    def r3(x):
        return None if x is None else round(x, 3)

    # parámetros que reutilizan las demás líneas (escalera) del mismo jugador y mercado
    p0_main = p_mas(L, mu, sd)
    k = {
        "mu": mu, "sd": sd, "prom_t": prom_t if prom_t is not None else m10, "m10": m10, "ult": ult,
        "min_proy": min_proy, "mins": mins, "bajos": bajos, "n_t": n_t, "est": estado, "completo": completo,
        "tiene_mercado": casa is not None,
        "d_modelo": max(-1.0, min(1.0, logit(p_modelo) - logit(p0_main))),
        "d_mkt": max(-1.0, min(1.0, logit(p_mkt_over) - logit(p0_main))) if p_mkt_over is not None else None,
        "overround": (1 / casa["mas"] + 1 / casa["menos"]) if (casa and casa.get("mas") and casa.get("menos")) else None,
        "p_over_main": p_over, "L": L, "pct_temp": f.get("pct_temp"), "pct_h2h": f.get("pct_h2h"), "n_h2h": f.get("n_h2h") or 0,
        "no_sugerir": bool(f.get("no_sugerir")), "rol": f.get("rol"), "cruce": f.get("cruce"),
        "blow": r, "texto_spread": texto_spread, "b2b": bool(desc.get("b2b")),
    }
    return {
        "_k": k,
        "id": f["id"], "j": f["nombre"], "eq": f["equipo"], "riv": f["rival"], "loc": bool(f["local"]),
        "gid": f["game_id"], "pos": f.get("posicion"), "m": merc, "mn": NOMBRE.get(merc, merc),
        "per": f.get("periodo"), "L": L, "lado": lado,
        "cu": cuota, "cu_mas": cu_mas, "cu_menos": cu_menos,
        "p": r3(p), "p_mkt": r3(p_mkt), "p_sitio": r3(None if p_sitio is None else (p_sitio if lado == 'mas' else 1 - p_sitio)),
        "p_propio": r3(p_propio if lado == 'mas' else 1 - p_propio),
        "p_modelo": r3(p_modelo if lado == 'mas' else 1 - p_modelo),
        "mu": round(mu, 2), "mu0": round(mu0, 2), "sd": round(sd, 2),
        "pt": None if prom_t is None else round(prom_t, 2), "p10": round(m10, 2), "n": n_t,
        "ult": ult, "r10": r3(r10), "rt": r3(rtemp), "rh": r3(rh2h),
        "min": round(min_proy, 1), "min_ult": mins, "rol": f.get("rol"), "est": estado,
        "cruce": f.get("cruce"), "dvp": f.get("dvp"), "aj": ajuste,
        "fl": banderas, "c": color, "mod": "completo" if completo else "basico",
    }


# --------------------------------------------------------------------------- escalera de líneas ("más de X")
def banderas_comunes(k):
    """Banderas que no dependen de la línea: lesión, minutos, muestra. Devuelve (rojo, avisos, graves)."""
    rojo, fl, graves = [], [], 0
    if k["est"] in ESTADOS_ROJO:
        rojo.append(f"lesión: {k['est']}")
    elif k["est"]:
        fl.append(f"lesión: {k['est']}")
    if k["no_sugerir"]:
        rojo.append('el sitio lo marca "no sugerir"')
    if k["rol"] == "poco minuto" or k["min_proy"] < 20:
        rojo.append(f"pocos minutos ({k['min_proy']:.0f})")
    if k["n_t"] < 6:
        graves += 1; fl.append(f"muestra chica ({k['n_t']} partidos)")
    if k["bajos"] >= 2:
        graves += 1; fl.append(f"minutos inestables ({k['bajos']} de {len(k['mins'])} partidos <70% de lo típico)")
    if k["min_proy"] < 26:
        graves += 1; fl.append(f"minutos justos ({k['min_proy']:.0f})")
    if k["cruce"] == "F":
        fl.append("cruce F: el rival defiende bien esta posición (poca evidencia)")
    return rojo, fl, graves


def r3(x):
    return None if x is None else round(x, 3)


def paso(k, L, cu, temp, principal, com):
    """Evalúa 'más de L' para un jugador y mercado. cu = cuota de Betano."""
    rojo, fl_com, graves = com
    p0 = p_mas(L, k["mu"], k["sd"])
    p_modelo = min(P_MAX_MODELO, sig(logit(p0) + k["d_modelo"]))
    real = bool(cu and k["overround"])
    if real:
        p_mkt = min(.99, (1 / cu) / k["overround"])
    elif k["d_mkt"] is not None:
        p_mkt = sig(logit(p0) + k["d_mkt"])
    else:
        p_mkt = None
    p = .5 * p_modelo + .5 * p_mkt if p_mkt is not None else .5 * p_modelo + .25
    # Siempre hay un riesgo que las estadísticas no ven (lesión en el partido, faltas, minutos de basura): ninguna línea es 100 % segura.
    p = min(p, P_MAX)

    ult = k["ult"]
    r10 = sum(1 for v in ult if v > L) / len(ult)
    if temp and len(temp) >= 6:
        rt = sum(1 for v in temp if v > L) / len(temp)
    elif principal and k["pct_temp"] is not None:
        rt = k["pct_temp"]
    else:
        rt = None
    rh = k["pct_h2h"] if (principal and k["n_h2h"] >= 4 and k["pct_h2h"] is not None) else None
    senales = [x for x in (r10, rt, rh) if x is not None]
    a_favor = sum(1 for x in senales if x >= .6)
    en_contra = sum(1 for x in senales if x <= .4)
    prom_ok = sum(1 for x in (k["prom_t"], k["m10"], k["mu"]) if (x - L) / L >= .04)
    prom_mal = sum(1 for x in (k["prom_t"], k["m10"], k["mu"]) if (x - L) / L <= -.04)

    fl, g = [], graves
    if en_contra >= 1:
        g += 1; fl.append("historial en contra")
    if real and p_modelo - p_mkt > .20:
        g += 2; fl.append(f"el modelo lo ve mucho más probable que la casa ({p_modelo:.0%} vs {p_mkt:.0%})")
    tope = False
    r = k["blow"]
    if p < .75 and r is not None and k["min_proy"] >= 26:
        if r >= .45:
            tope = True; fl.append(f"riesgo de blowout alto ({k['texto_spread']}): titulares pueden sentarse")
        elif r >= .38:
            fl.append(f"riesgo de blowout medio ({k['texto_spread']})")
    if p < .75 and k["b2b"] and k["min_proy"] >= 28:
        tope = True; fl.append("back-to-back")
    if not k["completo"] or not k["tiene_mercado"]:
        tope = True

    ok_senales = (a_favor >= 2 and en_contra == 0) if len(senales) >= 2 else (len(senales) == 1 and senales[0] >= .7)
    if rojo:
        color = "rojo"
    elif p >= .60 and prom_ok == 3 and ok_senales and g == 0 and k["min_proy"] >= 24 and k["est"] is None:
        color = "verde"
    elif p >= .55 and prom_mal == 0 and prom_ok >= 2 and g <= 1 and en_contra == 0:
        color = "amarillo"
    else:
        color = "rojo"
    if tope and color == "verde":
        color = "amarillo"
    out = {"L": L, "cu": cu, "p": r3(p), "pm": r3(p_modelo), "pk": r3(p_mkt), "ju": round(1 / max(p, .01), 2),
           "c": color, "r10": r3(r10), "rt": r3(rt)}
    if fl:
        out["fl"] = fl
    return out


def construir_grupo(f, e, ladder):
    """Un jugador + mercado con todas sus líneas «más de» que tienen cuota de Betano.
    Devuelve None si Betano no ofrece ese mercado para el jugador."""
    k = e.pop("_k")
    casa = f.get("casa")
    if not casa or not casa.get("mas"):
        return None
    rojo, fl_com, graves = banderas_comunes(k)
    extra = []
    if not k["completo"]:
        extra.append("modelo básico (sin proyección del sitio)")
    betano = dict(ladder["betano"]) if ladder else {}
    betano[f["linea"]] = casa["mas"]
    temp = ladder["temp"] if ladder else None
    pasos = []
    for L in sorted(betano):
        if L <= 0:
            continue
        pasos.append(paso(k, L, betano[L], temp, L == f["linea"], (rojo, fl_com, graves)))
    if not pasos:
        return None
    rec = None
    for color in ("verde", "amarillo"):
        cand = [s for s in pasos if s["c"] == color]
        if cand:
            rec = max(cand, key=lambda s: s["L"])["L"]
            break
    if rec is None:
        rec = max(pasos, key=lambda s: s["p"])["L"]
    g = {k2: e[k2] for k2 in ("id", "j", "eq", "riv", "loc", "gid", "pos", "m", "mn", "per", "mu", "sd", "pt", "p10", "n",
                                "ult", "min", "min_ult", "rol", "est", "cruce", "dvp", "aj", "mod") if k2 in e}
    g.update({"L": f["linea"], "temp": temp, "fl": rojo + fl_com + extra, "rec": rec, "pasos": pasos,
              "cu_mas": casa["mas"], "cu_menos": casa["menos"]})
    p_menos = min(P_MAX, 1 - k["p_over_main"])
    if not casa.get("menos"):
        return g
    g["menos"] = {"L": f["linea"], "cu": casa["menos"], "p": r3(p_menos),
                  "c": e["c"] if e["lado"] == "menos" else "rojo", "ju": round(1 / max(p_menos, .01), 2)}
    return g


def bajar_escaleras(filas, mercados, avisos, hilos=2, pausa=0.2, presupuesto_s=600):
    """Escalera de cuotas de Betano y partidos de la temporada, por jugador y mercado. ~1 s por consulta."""
    objetivo = sorted({(f["id"], f["mercado"]) for f in filas
                       if f["mercado"] in mercados and f.get("casa") and f.get("periodo") is None and f.get("ult")})
    res = {}
    limite = time.monotonic() + presupuesto_s   # si LudoProps está lento, se publica igual con la línea principal

    def uno(par):
        if time.monotonic() > limite:
            raise TimeoutError("sin tiempo: se usa solo la línea principal")
        time.sleep(pausa)
        d = pedir(f"{LUDO}ficha?id={par[0]}&prop={par[1]}&rango=temp", intentos=2, espera=1.5, timeout=20)
        betano = {float(x["linea"]): float(x["cuota"]) for x in d.get("betano_esc") or []}
        temp = [g["valor"] for g in d.get("grafico") or [] if g.get("valor") is not None]
        return {"betano": betano, "temp": temp}

    with ThreadPoolExecutor(hilos) as ex:
        futs = {par: ex.submit(uno, par) for par in objetivo}
        for par, fu in futs.items():
            try:
                res[par] = fu.result()
            except Exception as e:  # noqa: BLE001
                avisos.append(f"ficha {par}: {e}")
    return res


# --------------------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fecha", help="AAAA-MM-DD (hora ET). Por defecto, hoy en Nueva York.")
    ap.add_argument("--salida", default=os.path.join(os.path.dirname(__file__), "..", "docs", "data"))
    ap.add_argument("--mercados", default="pts,reb,ast",
                    help="Mercados para los que se baja la escalera real de cuotas (≈1 consulta por jugador y mercado). "
                         "'todos' baja todos los mercados que Betano ofrece. Los demás muestran solo su línea principal.")
    ap.add_argument("--hilos", type=int, default=2, help="Consultas simultáneas a LudoProps (se recomienda 1-2).")
    a = ap.parse_args()
    fecha = a.fecha or dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    avisos = []

    ver = pedir(LUDO + "version")
    tab = pedir(LUDO + "tablero?fecha=" + urllib.parse.quote(fecha))
    if not isinstance(tab, dict) or "partidos" not in tab:
        sys.exit(f"Tablero inválido de LudoProps para {fecha}: no se sobrescriben los datos.")
    if not tab.get("partidos"):
        ev = pedir(ESPN + "scoreboard?dates=" + fecha.replace("-", "")).get("events", [])
        if ev:
            sys.exit(f"LudoProps no tiene partidos el {fecha} pero ESPN tiene {len(ev)}: no se sobrescriben los datos.")
        print(f"No hay partidos NBA el {fecha}.")
    ctx = contexto_partidos(fecha, tab.get("partidos", []), avisos)

    mercados = set(CV) if a.mercados == "todos" else {m.strip() for m in a.mercados.split(",") if m.strip()}
    escaleras = bajar_escaleras(tab.get("filas", []), mercados, avisos, hilos=a.hilos)

    grupos = []
    for f in tab.get("filas", []):
        try:
            e = evaluar(f, ctx)
            if e:
                esc = escaleras.get((f["id"], f["mercado"])) if f.get("periodo") is None else None
                g = construir_grupo(f, e, esc)
                if g:
                    grupos.append(g)
        except Exception as ex:  # noqa: BLE001  una fila rara no debe tirar la corrida entera
            avisos.append(f"fila {f.get('nombre')} {f.get('mercado')}: {ex}")
    orden = {'verde': 0, 'amarillo': 1, 'rojo': 2}
    def color_rec(g):
        return next((x["c"] for x in g["pasos"] if x["L"] == g["rec"]), "rojo")
    grupos.sort(key=lambda g: orden[color_rec(g)])

    partidos = []
    for p in tab["partidos"]:
        c = ctx[p["game_id"]]
        partidos.append({
            "gid": p["game_id"], "local": p["local"], "visita": p["visita"],
            "local_nombre": p["local_eq"]["nombre"], "visita_nombre": p["visita_eq"]["nombre"],
            "local_id": p["local_eq"]["id"], "visita_id": p["visita_eq"]["id"],
            "utc": p["fecha_utc"], "estado": p["estado"], "estado_texto": p["estado_texto"],
            "spread": c["spread"], "fav": c["fav"], "total": c["total"], "ml": c["ml"], "proveedor": c["proveedor"],
            "p_blowout": None if c["p_blowout"] is None else round(c["p_blowout"], 3),
            "descanso": c["descanso"], "records": c["records"], "lesiones": c["lesiones"], "ultimos5": c["ultimos5"],
        })
    salida = {
        "fecha": fecha,
        "generado_en": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ludo_version": ver.get("v"), "reporte_lesiones": ver.get("reporte"),
        "avisos": avisos,
        "modelo": {"sd_partido": SD_PARTIDO, "umbral_blowout": UMBRAL_BLOWOUT, "r0": R0},
        "partidos": partidos, "grupos": grupos,
    }
    os.makedirs(a.salida, exist_ok=True)
    os.makedirs(os.path.join(a.salida, "historial"), exist_ok=True)
    txt = json.dumps(salida, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(a.salida, "hoy.json"), "w", encoding="utf-8") as fh:
        fh.write(txt)
    # Foto liviana del día (solo la línea principal de cada jugador) para medir la calibración más adelante.
    # Solo partidos que no empezaron: después del inicio las líneas ya no son pre-partido.
    # Se combina con la foto anterior del mismo día para no perder la de los partidos que ya arrancaron.
    no_empezados = {p["gid"] for p in partidos if p["estado"] == 1}
    nuevas = []
    for g in grupos:
        if g["gid"] not in no_empezados:
            continue
        principal = next((x for x in g["pasos"] if x["L"] == g["L"]), None)
        if principal:
            nuevas.append({"id": g["id"], "gid": g["gid"], "m": g["m"], "per": g["per"], "L": g["L"], "mu": g["mu"],
                           "sd": g["sd"], "cu_mas": g["cu_mas"], "cu_menos": g["cu_menos"],
                           "p": principal["p"], "c": principal["c"]})
    ruta_foto = os.path.join(a.salida, "historial", fecha + ".json")
    previas = []
    if os.path.exists(ruta_foto):
        try:
            with open(ruta_foto, encoding="utf-8") as fh:
                previas = json.load(fh).get("lineas", [])
        except (OSError, ValueError):
            previas = []
    claves = {(x["id"], x["m"], x["per"]) for x in nuevas}
    foto = {"fecha": fecha, "generado_en": salida["generado_en"],
            "lineas": nuevas + [x for x in previas if (x["id"], x["m"], x["per"]) not in claves]}
    with open(ruta_foto, "w", encoding="utf-8") as fh:
        json.dump(foto, fh, ensure_ascii=False, separators=(",", ":"))
    cuenta = {c: sum(1 for x in grupos if color_rec(x) == c) for c in orden}
    n_pasos = sum(len(g["pasos"]) for g in grupos)
    print(f"{fecha}: {len(partidos)} partidos, {len(grupos)} jugador-mercado ({n_pasos} líneas) {cuenta}, "
          f"{len(escaleras)} escaleras reales, {len(txt)/1e6:.1f} MB, avisos: {len(avisos)}")
    for av in avisos:
        print("  aviso:", av, file=sys.stderr)


if __name__ == "__main__":
    main()
