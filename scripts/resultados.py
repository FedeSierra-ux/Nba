#!/usr/bin/env python3
"""Baja los resultados de los días anteriores y mide la calibración del semáforo.

Para cada foto del historial (docs/data/historial/<fecha>.json) de un día ya terminado (hora de Nueva York)
que todavía no tenga resultados completos, baja de LudoProps:
  * dia?fecha=<fecha>   -> partidos del día, estado (3 = final) y marcador   (1 consulta por día)
  * box?id=<game_id>    -> box score de cada partido con líneas en la foto   (≈ 10 consultas por día)
y escribe docs/data/resultados/<fecha>.json. Revisa como mucho los últimos 7 días por corrida y reintenta
los días incompletos en las corridas siguientes.

Después recalcula docs/data/calibracion.json con todos los días calificados.

Reglas de calificación (todas las líneas son «más de»):
  * gana si el valor supera la línea; con líneas x,5 no hay empate. Con una línea entera, el empate se anula
    (se devuelve la apuesta), como hacen las casas.
  * jugador que no jugó (no figura en el box score de un partido terminado, o 0 minutos): pata ANULADA, no perdida.
  * combos: pra = pts+reb+ast, pr = pts+reb, pa = pts+ast, ra = reb+ast.
  * partido sin terminar (o suspendido): la pata queda sin calificar.
  * líneas de un período (1er cuarto): no se califican (el box score es del partido entero).
  * combinada: pierde si pierde alguna pata; una pata anulada cuenta como ganada a cuota 1,00
    (se recalcula la cuota con las demás, como las casas); si se anulan todas, se devuelve la apuesta.

Uso:
  python3 scripts/resultados.py [--datos docs/data] [--hoy AAAA-MM-DD] [--dias 7]

Solo usa la librería estándar de Python (>= 3.9).
"""
import argparse, datetime as dt, glob, json, math, os, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

LUDO = "https://ludoprops.com/api/"
UA = "NbaSemaforo/1.0 (uso personal; consultas espaciadas)"
PAUSA = 1.0                      # segundos entre consultas a LudoProps (servidor de un amigo: pocas y espaciadas)

ESTADISTICAS = ("min", "pts", "reb", "ast", "fg3m", "stl", "blk", "tov", "fgm", "fga", "fta", "ftm", "pf")
COMBOS = {"pra": ("pts", "reb", "ast"), "pr": ("pts", "reb"), "pa": ("pts", "ast"), "ra": ("reb", "ast")}
FINAL = 3                        # estado de partido terminado en LudoProps
COLORES = ("verde", "amarillo", "rojo")
NIVELES = ("segura", "intermedia", "sonadora")
TRAMOS = ((0.0, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0))

GANADA, PERDIDA, ANULADA = "ganada", "perdida", "anulada"


# =========================================================================== calificación (funciones puras)
def valor_mercado(st, m):
    """Valor del mercado `m` en la línea de estadísticas `st` del jugador. None si no se puede calcular."""
    if not st:
        return None
    partes = COMBOS.get(m, (m,))
    if any(p not in ESTADISTICAS or p == "min" for p in partes):
        return None
    vals = [st.get(p) for p in partes]
    if any(not isinstance(v, (int, float)) for v in vals):
        return None
    return sum(vals)


def calificar(st, m, L, per=None):
    """Resultado de «más de L» en el mercado m: 'ganada' | 'perdida' | 'anulada' | None (sin calificar)."""
    if per is not None or st is None or L is None:
        return None
    if (st.get("min") or 0) <= 0:
        return ANULADA                   # no jugó: la casa anula la pata
    v = valor_mercado(st, m)
    if v is None:
        return None
    if v > L:
        return GANADA
    if v == L:
        return ANULADA                   # empate: solo posible con líneas enteras
    return PERDIDA


def calificar_entrada(x, res, gid_de=None):
    """Califica una entrada del historial ({id, gid, m, per, L, ...}) contra un día de resultados."""
    gid = x.get("gid") or (gid_de or {}).get(x.get("id"))
    partido = (res.get("partidos") or {}).get(gid) if gid else None
    if gid and (partido is None or partido.get("estado") != FINAL):
        return None                      # partido sin terminar, suspendido o desconocido
    st = (res.get("jugadores") or {}).get(str(x.get("id")))
    return calificar(st, x.get("m"), x.get("L"), x.get("per"))


def calificar_combinada(resultados, cuotas):
    """(estado, pago por unidad apostada). estado: 'ganada' | 'perdida' | 'anulada' | None (pendiente).
    Una pata anulada cuenta como ganada a cuota 1,00; si se anulan todas, se devuelve la apuesta (pago 1)."""
    if PERDIDA in resultados:
        return PERDIDA, 0.0
    if any(r is None for r in resultados):
        return None, None
    if all(r == ANULADA for r in resultados):
        return ANULADA, 1.0
    pago = 1.0
    for r, cu in zip(resultados, cuotas):
        if r == GANADA:
            pago *= cu
    return GANADA, pago


def tramo(p):
    """Índice del tramo de probabilidad (el último incluye 1,0)."""
    for i, (a, b) in enumerate(TRAMOS):
        if a <= p < b:
            return i
    return len(TRAMOS) - 1 if p >= 1.0 else 0


def _r(x, d=4):
    return None if x is None else round(x, d)


class Cuenta:
    """Acumula aciertos de patas sueltas: n (ganadas + perdidas), aciertos, anuladas y probabilidad media."""

    def __init__(self):
        self.n = self.aciertos = self.anuladas = 0
        self.suma_p = 0.0

    def sumar(self, p, res):
        if res == ANULADA:
            self.anuladas += 1
        elif res in (GANADA, PERDIDA) and p is not None:
            self.n += 1
            self.suma_p += p
            self.aciertos += res == GANADA

    def dict(self):
        return {"n": self.n, "aciertos": self.aciertos, "anuladas": self.anuladas,
                "p_media": _r(self.suma_p / self.n) if self.n else None,
                "tasa": _r(self.aciertos / self.n) if self.n else None}


class Apuesta:
    """Resultado de apostar 1 unidad a cada una (ROI de apuesta plana)."""

    def __init__(self):
        self.n = self.ganadas = self.anuladas = 0
        self.unidades = 0.0              # ganancia neta

    def sumar(self, res, pago):
        if res == ANULADA:
            self.anuladas += 1
        elif res in (GANADA, PERDIDA):
            self.n += 1
            self.ganadas += res == GANADA
            self.unidades += (pago - 1.0) if res == GANADA else -1.0

    def dict(self):
        return {"n": self.n, "ganadas": self.ganadas, "anuladas": self.anuladas,
                "unidades": _r(self.unidades, 2), "roi": _r(self.unidades / self.n) if self.n else None}


def calibracion(dias, actualizado=None):
    """dias: [(fecha, foto_del_historial, resultados_del_dia)]. Devuelve el contenido de calibracion.json."""
    lin_color = {c: Cuenta() for c in COLORES}
    lin_tramo = [Cuenta() for _ in TRAMOS]
    esc_color = {c: Cuenta() for c in COLORES}
    esc_tramo = [Cuenta() for _ in TRAMOS]
    esc_roi = {c: Apuesta() for c in COLORES}
    brier_m = brier_k = 0.0
    n_brier = 0
    sug = {k: {"apuesta": Apuesta(), "perdidas": 0, "con_anuladas": 0, "suma_p": 0.0, "n_p": 0} for k in NIVELES}
    fechas = []
    for fecha, foto, res in sorted(dias, key=lambda d: d[0]):
        gid_de = {x["id"]: x["gid"] for k in ("escalera", "lineas") for x in foto.get(k) or [] if x.get("gid")}
        alguna = False
        for x in foto.get("lineas") or []:
            r = calificar_entrada(x, res, gid_de)
            if r is None or x.get("p") is None:
                continue
            alguna = True
            if x.get("c") in lin_color:
                lin_color[x["c"]].sumar(x["p"], r)
            lin_tramo[tramo(x["p"])].sumar(x["p"], r)
            if r != ANULADA and x.get("pk") is not None:
                y = 1.0 if r == GANADA else 0.0
                brier_m += (x["p"] - y) ** 2
                brier_k += (x["pk"] - y) ** 2
                n_brier += 1
        for x in foto.get("escalera") or []:
            r = calificar_entrada(x, res, gid_de)
            if r is None or x.get("p") is None:
                continue
            alguna = True
            if x.get("c") in esc_color:
                esc_color[x["c"]].sumar(x["p"], r)
                if x.get("cu"):
                    esc_roi[x["c"]].sumar(r, x["cu"])
            esc_tramo[tramo(x["p"])].sumar(x["p"], r)
        for c in foto.get("sugeridas") or []:
            if c.get("id") not in sug:
                continue
            legs = c.get("legs") or []
            rs = [calificar_entrada(l, res, gid_de) for l in legs]
            estado, pago = calificar_combinada(rs, [l.get("cu") or 1.0 for l in legs])
            if estado is None:
                continue
            alguna = True
            s = sug[c["id"]]
            s["apuesta"].sumar(estado, pago)
            if estado == PERDIDA:
                s["perdidas"] += 1
            if estado != ANULADA:
                s["con_anuladas"] += ANULADA in rs
                if c.get("p") is not None:
                    s["suma_p"] += c["p"]; s["n_p"] += 1
        if alguna:
            fechas.append(fecha)

    def tramos(cuentas):
        return [dict({"desde": a, "hasta": b}, **cu.dict()) for (a, b), cu in zip(TRAMOS, cuentas)]

    sugeridas = {}
    for k, s in sug.items():
        d = s["apuesta"].dict()
        d.update({"perdidas": s["perdidas"], "con_anuladas": s["con_anuladas"],
                  "p_media": _r(s["suma_p"] / s["n_p"]) if s["n_p"] else None,
                  "tasa": _r(d["ganadas"] / d["n"]) if d["n"] else None})
        sugeridas[k] = d
    return {
        "actualizado": actualizado or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dias": fechas,
        "lineas": {
            "por_color": {c: v.dict() for c, v in lin_color.items()},
            "por_tramo": tramos(lin_tramo),
            "brier": {"n": n_brier, "modelo": _r(brier_m / n_brier) if n_brier else None,
                      "casa": _r(brier_k / n_brier) if n_brier else None},
        },
        "escalera": {
            "por_color": {c: v.dict() for c, v in esc_color.items()},
            "por_tramo": tramos(esc_tramo),
            "roi": {c: v.dict() for c, v in esc_roi.items()},
        },
        "sugeridas": sugeridas,
    }


# =========================================================================== armado del día (sin red)
def gids_de_foto(foto):
    """Partidos que aparecen en la foto y los jugadores de cada uno."""
    jug = {}
    for k in ("lineas", "escalera"):
        for x in foto.get(k) or []:
            if x.get("gid"):
                jug.setdefault(x["gid"], set()).add(str(x["id"]))
    for c in foto.get("sugeridas") or []:
        for l in c.get("legs") or []:
            if l.get("gid"):
                jug.setdefault(l["gid"], set()).add(str(l["id"]))
    return jug


def linea_box(j):
    """Estadísticas de un jugador del box score de LudoProps (min 0 si no jugó)."""
    out = {}
    for k in ESTADISTICAS:
        v = j.get(k)
        out[k] = v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0
    out["min"] = round(float(out["min"]), 1)
    return out


def armar_dia(fecha, dia, cajas, foto, previo=None):
    """Arma resultados/<fecha>.json.
    dia: respuesta de LudoProps dia?fecha= ; cajas: {game_id: respuesta de box?id=} de los partidos bajados ahora;
    previo: resultados anteriores (incompletos) del mismo día."""
    previo = previo or {}
    jugadores = dict(previo.get("jugadores") or {})
    viejos = previo.get("partidos") or {}
    por_partido = gids_de_foto(foto)
    partidos = {}
    for p in (dia or {}).get("partidos") or []:
        gid = p.get("game_id")
        if not gid:
            continue
        e = {"estado": p.get("estado"), "local": p.get("local"), "visita": p.get("visita"),
             "pts_local": p.get("pts_local"), "pts_visita": p.get("pts_visita")}
        box = cajas.get(gid)
        if box is not None and p.get("estado") == FINAL:
            for lado in ("local", "visita"):
                for j in (box.get(lado) or {}).get("jugadores") or []:
                    if j.get("id") is not None:
                        jugadores[str(j["id"])] = linea_box(j)
            # quien estaba en la foto de este partido y no figura en el box score no jugó: 0 minutos (pata anulada)
            for pid in por_partido.get(gid, ()):
                jugadores.setdefault(pid, linea_box({}))
            e["box"] = True
        elif (viejos.get(gid) or {}).get("box"):
            e["box"] = True
        partidos[gid] = e
    necesarios = [g for g in partidos if g in por_partido]
    completo = bool(partidos) and all(x["estado"] == FINAL for x in partidos.values()) \
        and all(partidos[g].get("box") for g in necesarios)
    return {"fecha": fecha, "completo": completo, "partidos": partidos, "jugadores": jugadores}


def box_valido(box):
    return isinstance(box, dict) and all((box.get(l) or {}).get("jugadores") for l in ("local", "visita"))


# =========================================================================== red y archivos
def pedir(url, intentos=3, espera=2.0, timeout=40):
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


def leer(ruta):
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def escribir(ruta, datos):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(datos, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, ruta)


def procesar_dia(fecha, foto, previo, avisos):
    """Baja dia + box scores que falten y devuelve los resultados del día."""
    dia = pedir(LUDO + "dia?fecha=" + urllib.parse.quote(fecha))
    if not isinstance(dia, dict) or not isinstance(dia.get("partidos"), list):
        raise RuntimeError("respuesta inválida de dia")
    por_partido = gids_de_foto(foto)
    viejos = (previo or {}).get("partidos") or {}
    cajas = {}
    for p in dia["partidos"]:
        gid = p.get("game_id")
        if p.get("estado") != FINAL or gid not in por_partido or (viejos.get(gid) or {}).get("box"):
            continue
        time.sleep(PAUSA)
        try:
            box = pedir(LUDO + "box?id=" + urllib.parse.quote(gid), intentos=2)
            if box_valido(box):
                cajas[gid] = box
            else:
                avisos.append(f"{fecha} box {gid}: sin jugadores")
        except Exception as e:  # noqa: BLE001
            avisos.append(f"{fecha} box {gid}: {e}")
    return armar_dia(fecha, dia, cajas, foto, previo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "data"))
    ap.add_argument("--hoy", help="AAAA-MM-DD. Por defecto, hoy en Nueva York (solo se califican días anteriores).")
    ap.add_argument("--dias", type=int, default=7, help="Cuántos días hacia atrás revisar por corrida (máx. 7).")
    a = ap.parse_args()
    hoy = dt.date.fromisoformat(a.hoy) if a.hoy else dt.datetime.now(ZoneInfo("America/New_York")).date()
    desde = hoy - dt.timedelta(days=max(1, min(7, a.dias)))
    dir_hist = os.path.join(a.datos, "historial")
    dir_res = os.path.join(a.datos, "resultados")
    avisos = []

    fotos = {}
    for ruta in sorted(glob.glob(os.path.join(dir_hist, "*.json"))):
        fecha = os.path.basename(ruta)[:-5]
        try:
            d = dt.date.fromisoformat(fecha)
        except ValueError:
            continue
        if d < hoy:
            fotos[fecha] = ruta

    pedidos = 0
    for fecha, ruta in sorted(fotos.items()):
        if dt.date.fromisoformat(fecha) < desde:
            continue
        ruta_res = os.path.join(dir_res, fecha + ".json")
        previo = leer(ruta_res)
        if previo and previo.get("completo"):
            continue
        foto = leer(ruta)
        if not foto or not gids_de_foto(foto):
            continue
        if pedidos:
            time.sleep(PAUSA)
        try:
            res = procesar_dia(fecha, foto, previo, avisos)
        except Exception as e:  # noqa: BLE001  un día con problemas no frena a los demás
            avisos.append(f"{fecha}: {e}")
            continue
        pedidos += 1
        escribir(ruta_res, res)
        n_fin = sum(1 for x in res["partidos"].values() if x["estado"] == FINAL)
        print(f"{fecha}: {n_fin}/{len(res['partidos'])} partidos terminados, {len(res['jugadores'])} jugadores, "
              f"{'completo' if res['completo'] else 'incompleto (se reintenta en la próxima corrida)'}")

    dias = []
    for ruta in sorted(glob.glob(os.path.join(dir_res, "*.json"))):
        fecha = os.path.basename(ruta)[:-5]
        res, foto = leer(ruta), leer(fotos.get(fecha, os.path.join(dir_hist, fecha + ".json")))
        if res and foto:
            dias.append((fecha, foto, res))
    cal = calibracion(dias)
    escribir(os.path.join(a.datos, "calibracion.json"), cal)
    lc = cal["lineas"]["por_color"]
    print(f"calibración: {len(cal['dias'])} días; líneas principales " +
          ", ".join(f"{c} {v['aciertos']}/{v['n']}" for c, v in lc.items()) +
          f"; Brier modelo {cal['lineas']['brier']['modelo']} vs casa {cal['lineas']['brier']['casa']} (n={cal['lineas']['brier']['n']})")
    for av in avisos:
        print("  aviso:", av, file=sys.stderr)


if __name__ == "__main__":
    main()
