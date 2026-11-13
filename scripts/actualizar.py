#!/usr/bin/env python3
"""Baja los datos del día y calcula el semáforo de riesgo.

Fuentes (todas públicas y sin clave):
  * LudoProps  (https://ludoprops.com/api/...)  -> líneas, promedios, minutos, lesiones, cuotas Betano/bet365
  * ESPN       (site.api.espn.com)               -> spread, total, moneyline, partidos de días previos (back-to-back)

Uso:
  python3 scripts/actualizar.py [--fecha AAAA-MM-DD] [--salida docs/data]

Solo usa la librería estándar de Python (>= 3.9).
"""
import argparse, datetime as dt, json, math, os, statistics as st, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

LUDO = "https://ludoprops.com/api/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
UA = "NbaSemaforo/1.0 (uso personal; consultas espaciadas)"

# --------------------------------------------------------------------------- parámetros del modelo
SD_PARTIDO = 12.0        # desvío del margen final de un partido NBA (puntos)
UMBRAL_BLOWOUT = 14.5    # margen a partir del cual los titulares suelen sentarse
R0 = 0.27                # probabilidad de blowout "típica" (ya incluida en los promedios de temporada)
CV = {  # coeficiente de variación a priori por mercado (heurístico)
    'pts': .38, 'reb': .50, 'ast': .55, 'pra': .30, 'pr': .32, 'pa': .33, 'ra': .42,
    'fga': .30, 'fgm': .38, 'fg3m': .75, 'fg3a': .50, 'fta': .55, 'ftm': .65,
    'tov': .60, 'pf': .55, 'stl': .85, 'blk': 1.0, 'dreb': .55, 'oreb': .80,
    'fg2a': .40, 'fg2m': .50, 'ast_prob': .55, 'reb_prob': .50,
}
NOMBRE = {
    'pts': 'Puntos', 'reb': 'Rebotes', 'ast': 'Asistencias', 'pra': 'Puntos + Reb + Asist', 'pr': 'Puntos + Rebotes',
    'pa': 'Puntos + Asistencias', 'ra': 'Rebotes + Asistencias', 'fga': 'Tiros de campo intentados',
    'fgm': 'Tiros de campo convertidos', 'fg3m': 'Triples convertidos', 'fg3a': 'Triples intentados',
    'fta': 'Libres intentados', 'ftm': 'Libres convertidos', 'tov': 'Pérdidas', 'pf': 'Faltas', 'stl': 'Robos',
    'blk': 'Tapas', 'dreb': 'Rebotes defensivos', 'oreb': 'Rebotes ofensivos', 'fg2a': 'Dobles intentados',
    'fg2m': 'Dobles convertidos', 'ast_prob': 'Asistencias (escalera)', 'reb_prob': 'Rebotes (escalera)',
}
ESPN_A_TRI = {'NY': 'NYK', 'SA': 'SAS', 'GS': 'GSW', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS'}


# --------------------------------------------------------------------------- red
def pedir(url, intentos=3, espera=2.0):
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
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
    if mu <= 0:
        return 0.0
    if mu < 6:
        return nb_sf(linea, mu, sd * sd)
    return 1 - phi((linea - mu) / sd)


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
        ev = por_equipos.get((loc, vis))
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
            # detalle: moneyline y lesiones
            try:
                s = pedir(ESPN + "summary?event=" + ev["id"])
                pc = (s.get("pickcenter") or [None])[0] or {}
                ml_a = (pc.get("awayTeamOdds") or {}).get("moneyLine")
                ml_h = (pc.get("homeTeamOdds") or {}).get("moneyLine")
                r["ml"] = {vis: ml_a, loc: ml_h}
                for bloque in s.get("injuries") or []:
                    t = tri(((bloque.get("team") or {}).get("abbreviation")) or "")
                    r["lesiones"][t] = [
                        {"jugador": (i.get("athlete") or {}).get("displayName"),
                         "estado": i.get("status"),
                         "nota": ((i.get("details") or {}).get("type") or i.get("type", {}).get("description") if isinstance(i.get("details"), dict) else None)}
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
    if merc not in CV or not f.get("ult"):
        return None
    L = f["linea"]
    ult = f["ult"]
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
    p_over = p_propio if p_sitio is None else .5 * p_sitio + .5 * p_propio
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
    if estado in ('Questionable', 'Doubtful'):
        rojo = True; banderas.append(f"lesión: {estado}")
    elif estado == 'Probable':
        banderas.append("lesión: Probable")
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
    if r is not None and r >= .45 and min_proy >= 26 and lado == 'mas':
        tope_amarillo = True
        banderas.append(f"riesgo de blowout alto (spread {g.get('spread'):g}): titulares pueden sentarse")
    elif r is not None and r >= .38 and min_proy >= 26 and lado == 'mas':
        banderas.append(f"riesgo de blowout medio (spread {g.get('spread'):g})")
    if desc.get("b2b") and min_proy >= 28 and lado == 'mas':
        tope_amarillo = True; banderas.append("back-to-back")
    if not completo:
        tope_amarillo = True; banderas.append("modelo básico (sin proyección del sitio)")
    if f.get("casa") is None:
        banderas.append("sin cuota en Betano")

    if rojo:
        color = 'rojo'
    elif p >= .62 and prom_ok == 3 and a_favor >= 2 and en_contra == 0 and graves == 0 and min_proy >= 24 and estado is None:
        color = 'verde'
    elif p >= .56 and prom_mal == 0 and prom_ok >= 2 and graves <= 1 and en_contra == 0:
        color = 'amarillo'
    else:
        color = 'rojo'
    if tope_amarillo and color == 'verde':
        color = 'amarillo'

    casa = f.get("casa")
    cu_mas = casa["mas"] if casa else None
    cu_menos = casa["menos"] if casa else None
    cuota = (cu_mas if lado == 'mas' else cu_menos) if casa else None
    p_mkt = None
    if casa and casa.get("prob") is not None:
        p_mkt = casa["prob"] if lado == 'mas' else 1 - casa["prob"]
    ajuste = f.get("ajuste_texto")
    if notas:
        ajuste = (ajuste + " · " if ajuste else "") + " · ".join(notas)

    def r3(x):
        return None if x is None else round(x, 3)
    return {
        "id": f["id"], "j": f["nombre"], "eq": f["equipo"], "riv": f["rival"], "loc": bool(f["local"]),
        "gid": f["game_id"], "pos": f.get("posicion"), "m": merc, "mn": NOMBRE.get(merc, merc),
        "per": f.get("periodo"), "L": L, "lado": lado,
        "cu": cuota, "cu_mas": cu_mas, "cu_menos": cu_menos, "b365": f.get("b365"),
        "p": r3(p), "p_mkt": r3(p_mkt), "p_sitio": r3(None if p_sitio is None else (p_sitio if lado == 'mas' else 1 - p_sitio)),
        "p_propio": r3(p_propio if lado == 'mas' else 1 - p_propio),
        "mu": round(mu, 2), "mu0": round(mu0, 2), "sd": round(sd, 2),
        "pt": None if prom_t is None else round(prom_t, 2), "p10": round(m10, 2), "n": n_t,
        "ult": ult, "r10": r3(r10), "rt": r3(rtemp), "rh": r3(rh2h),
        "min": round(min_proy, 1), "min_ult": mins, "rol": f.get("rol"), "est": estado,
        "cruce": f.get("cruce"), "dvp": f.get("dvp"), "aj": ajuste,
        "fl": banderas, "c": color, "mod": "completo" if completo else "basico",
    }


# --------------------------------------------------------------------------- principal
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fecha", help="AAAA-MM-DD (hora ET). Por defecto, hoy en Nueva York.")
    ap.add_argument("--salida", default=os.path.join(os.path.dirname(__file__), "..", "docs", "data"))
    a = ap.parse_args()
    fecha = a.fecha or dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    avisos = []

    ver = pedir(LUDO + "version")
    tab = pedir(LUDO + "tablero?fecha=" + urllib.parse.quote(fecha))
    if not tab.get("partidos"):
        print(f"No hay partidos NBA el {fecha}.")
    ctx = contexto_partidos(fecha, tab.get("partidos", []), avisos)

    filas = []
    for f in tab.get("filas", []):
        e = evaluar(f, ctx)
        if e:
            filas.append(e)
    orden = {'verde': 0, 'amarillo': 1, 'rojo': 2}
    filas.sort(key=lambda x: (orden[x['c']], -(x['p'] or 0)))

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
        "partidos": partidos, "filas": filas,
    }
    os.makedirs(a.salida, exist_ok=True)
    os.makedirs(os.path.join(a.salida, "historial"), exist_ok=True)
    txt = json.dumps(salida, ensure_ascii=False, separators=(",", ":"))
    for ruta in (os.path.join(a.salida, "hoy.json"), os.path.join(a.salida, "historial", fecha + ".json")):
        with open(ruta, "w", encoding="utf-8") as fh:
            fh.write(txt)
    cuenta = {c: sum(1 for x in filas if x['c'] == c) for c in orden}
    print(f"{fecha}: {len(partidos)} partidos, {len(filas)} líneas {cuenta}, {len(txt)/1e6:.1f} MB, avisos: {len(avisos)}")
    for av in avisos:
        print("  aviso:", av, file=sys.stderr)


if __name__ == "__main__":
    main()
