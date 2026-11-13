"""Pruebas de la calificación de resultados y la calibración (sin red).
Ejecutar: python3 -m unittest discover -s tests -v"""
import importlib.util, os, unittest

RUTA = os.path.join(os.path.dirname(__file__), "..", "scripts", "resultados.py")
spec = importlib.util.spec_from_file_location("resultados", RUTA)
res = importlib.util.module_from_spec(spec)
spec.loader.exec_module(res)


def st(**kw):
    base = {"min": 32.0, "pts": 20, "reb": 8, "ast": 5, "fg3m": 2, "stl": 1, "blk": 0, "tov": 3,
            "fgm": 8, "fga": 16, "fta": 4, "ftm": 2, "pf": 2}
    base.update(kw)
    return base


class Calificar(unittest.TestCase):
    def test_mas_de_gana_y_pierde(self):
        self.assertEqual(res.calificar(st(pts=20), "pts", 19.5), "ganada")
        self.assertEqual(res.calificar(st(pts=19), "pts", 19.5), "perdida")
        self.assertEqual(res.calificar(st(stl=1), "stl", 0.5), "ganada")
        self.assertEqual(res.calificar(st(blk=0), "blk", 0.5), "perdida")

    def test_sin_empate_con_lineas_x5(self):
        for v in range(0, 40):
            for L in (0.5, 9.5, 19.5, 30.5):
                self.assertIn(res.calificar(st(pts=v), "pts", L), ("ganada", "perdida"))

    def test_empate_con_linea_entera_se_anula(self):
        self.assertEqual(res.calificar(st(pts=20), "pts", 20), "anulada")

    def test_cero_minutos_es_anulada(self):
        self.assertEqual(res.calificar(st(min=0, pts=0), "pts", 10.5), "anulada")
        self.assertEqual(res.calificar(st(min=0, pts=0), "pra", 25.5), "anulada")

    def test_combos(self):
        s = st(pts=20, reb=8, ast=5)
        self.assertEqual(res.valor_mercado(s, "pra"), 33)
        self.assertEqual(res.valor_mercado(s, "pr"), 28)
        self.assertEqual(res.valor_mercado(s, "pa"), 25)
        self.assertEqual(res.valor_mercado(s, "ra"), 13)
        self.assertEqual(res.calificar(s, "pra", 32.5), "ganada")
        self.assertEqual(res.calificar(s, "pra", 33.5), "perdida")
        self.assertEqual(res.calificar(s, "ra", 12.5), "ganada")

    def test_mercado_desconocido_o_periodo_no_se_califica(self):
        self.assertIsNone(res.calificar(st(), "fg2a", 3.5))
        self.assertIsNone(res.calificar(st(), "pts", 5.5, per="1q"))
        self.assertIsNone(res.calificar(None, "pts", 5.5))

    def test_entrada_partido_sin_terminar_queda_pendiente(self):
        dia = {"partidos": {"g1": {"estado": 2}}, "jugadores": {"7": st()}}
        self.assertIsNone(res.calificar_entrada({"id": 7, "gid": "g1", "m": "pts", "per": None, "L": 9.5}, dia))
        dia["partidos"]["g1"]["estado"] = 3
        self.assertEqual(res.calificar_entrada({"id": 7, "gid": "g1", "m": "pts", "per": None, "L": 9.5}, dia), "ganada")

    def test_entrada_sin_gid_usa_el_mapa(self):
        dia = {"partidos": {"g1": {"estado": 2}}, "jugadores": {"7": st()}}
        x = {"id": 7, "m": "pts", "per": None, "L": 9.5}
        self.assertIsNone(res.calificar_entrada(x, dia, {7: "g1"}))
        self.assertEqual(res.calificar_entrada(x, dia), "ganada")


class Combinadas(unittest.TestCase):
    def test_gana_todas(self):
        e, pago = res.calificar_combinada(["ganada", "ganada", "ganada"], [1.5, 2.0, 1.2])
        self.assertEqual(e, "ganada")
        self.assertAlmostEqual(pago, 3.6)

    def test_pata_anulada_cuenta_a_cuota_uno(self):
        e, pago = res.calificar_combinada(["ganada", "anulada", "ganada"], [1.5, 2.0, 1.2])
        self.assertEqual(e, "ganada")
        self.assertAlmostEqual(pago, 1.8)

    def test_pierde_si_pierde_una_aunque_haya_pendientes(self):
        self.assertEqual(res.calificar_combinada(["perdida", None, "anulada"], [1.5, 2, 2]), ("perdida", 0.0))

    def test_pendiente(self):
        self.assertEqual(res.calificar_combinada(["ganada", None], [1.5, 2]), (None, None))

    def test_todas_anuladas_devuelve_la_apuesta(self):
        self.assertEqual(res.calificar_combinada(["anulada", "anulada"], [1.5, 2]), ("anulada", 1.0))


class Tramos(unittest.TestCase):
    def test_bordes(self):
        self.assertEqual(res.TRAMOS[res.tramo(0.5)], (0.5, 0.6))
        self.assertEqual(res.TRAMOS[res.tramo(0.599)], (0.5, 0.6))
        self.assertEqual(res.TRAMOS[res.tramo(0.6)], (0.6, 0.7))
        self.assertEqual(res.TRAMOS[res.tramo(0.96)], (0.9, 1.0))
        self.assertEqual(res.TRAMOS[res.tramo(1.0)], (0.9, 1.0))
        self.assertEqual(res.TRAMOS[res.tramo(0.3)], (0.0, 0.5))


def dia_sintetico():
    """Un día con 2 partidos terminados y 4 jugadores (uno no jugó)."""
    foto = {
        "fecha": "2026-11-12",
        "lineas": [
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 19.5, "p": 0.70, "pk": 0.60, "c": "verde"},   # 20 -> gana
            {"id": 2, "gid": "g1", "m": "reb", "per": None, "L": 9.5, "p": 0.65, "pk": 0.55, "c": "verde"},    # 7 -> pierde
            {"id": 3, "gid": "g2", "m": "pra", "per": None, "L": 30.5, "p": 0.55, "pk": 0.50, "c": "amarillo"},  # 33 -> gana
            {"id": 4, "gid": "g2", "m": "ast", "per": None, "L": 4.5, "p": 0.80, "pk": None, "c": "rojo"},      # no jugó
        ],
        "escalera": [
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 15.5, "cu": 1.30, "p": 0.85, "c": "verde"},   # gana
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 19.5, "cu": 1.80, "p": 0.70, "c": "verde"},   # gana
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 24.5, "cu": 3.00, "p": 0.35, "c": "rojo"},    # pierde
            {"id": 2, "gid": "g1", "m": "reb", "per": None, "L": 9.5, "cu": 1.90, "p": 0.65, "c": "verde"},    # pierde
            {"id": 4, "gid": "g2", "m": "ast", "per": None, "L": 4.5, "cu": 1.50, "p": 0.80, "c": "rojo"},     # anulada
        ],
        "sugeridas": [
            {"id": "segura", "n": 2, "T": 1.99, "cuota": 2.7, "p": 0.6, "legs": [
                {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 15.5, "cu": 1.5, "p": 0.85},
                {"id": 4, "gid": "g2", "m": "ast", "per": None, "L": 4.5, "cu": 1.8, "p": 0.8}]},     # gana a 1,5
            {"id": "intermedia", "n": 2, "T": 5, "cuota": 5.7, "p": 0.3, "legs": [
                {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 19.5, "cu": 1.9, "p": 0.7},
                {"id": 2, "gid": "g1", "m": "reb", "per": None, "L": 9.5, "cu": 3.0, "p": 0.6}]},     # pierde
        ],
    }
    dia = {"partidos": [
        {"game_id": "g1", "estado": 3, "local": "AAA", "visita": "BBB", "pts_local": 110, "pts_visita": 100},
        {"game_id": "g2", "estado": 3, "local": "CCC", "visita": "DDD", "pts_local": 99, "pts_visita": 101},
        {"game_id": "g3", "estado": 3, "local": "EEE", "visita": "FFF", "pts_local": 90, "pts_visita": 80},
    ]}
    cajas = {
        "g1": {"local": {"jugadores": [{"id": 1, "min": 34.0, "pts": 20, "reb": 4, "ast": 3}]},
               "visita": {"jugadores": [{"id": 2, "min": 30.0, "pts": 10, "reb": 7, "ast": 1}]}},
        "g2": {"local": {"jugadores": [{"id": 3, "min": 36.0, "pts": 20, "reb": 8, "ast": 5}]},
               "visita": {"jugadores": [{"id": 9, "min": 12.0, "pts": 2, "reb": 1, "ast": 0}]}},
    }
    return foto, dia, cajas


class ArmarDia(unittest.TestCase):
    def test_box_y_no_jugo(self):
        foto, dia, cajas = dia_sintetico()
        r = res.armar_dia("2026-11-12", dia, cajas, foto)
        self.assertTrue(r["completo"])            # g3 no tiene líneas: no hace falta su box
        self.assertEqual(r["jugadores"]["1"]["pts"], 20)
        self.assertEqual(r["jugadores"]["4"]["min"], 0)   # estaba en la foto y no figura en el box
        self.assertEqual(r["partidos"]["g1"], {"estado": 3, "local": "AAA", "visita": "BBB",
                                               "pts_local": 110, "pts_visita": 100, "box": True})

    def test_incompleto_y_reintento(self):
        foto, dia, cajas = dia_sintetico()
        dia["partidos"][1]["estado"] = 2
        r = res.armar_dia("2026-11-12", dia, {"g1": cajas["g1"]}, foto)
        self.assertFalse(r["completo"])
        self.assertNotIn("4", r["jugadores"])
        dia["partidos"][1]["estado"] = 3
        r2 = res.armar_dia("2026-11-12", dia, {"g2": cajas["g2"]}, foto, previo=r)   # g1 ya estaba
        self.assertTrue(r2["completo"])
        self.assertEqual(r2["jugadores"]["1"]["pts"], 20)

    def test_falta_un_box_necesario(self):
        foto, dia, cajas = dia_sintetico()
        r = res.armar_dia("2026-11-12", dia, {"g1": cajas["g1"]}, foto)
        self.assertFalse(r["completo"])


class Calibracion(unittest.TestCase):
    def setUp(self):
        foto, dia, cajas = dia_sintetico()
        self.cal = res.calibracion([("2026-11-12", foto, res.armar_dia("2026-11-12", dia, cajas, foto))], "x")

    def test_lineas_por_color(self):
        v = self.cal["lineas"]["por_color"]["verde"]
        self.assertEqual((v["n"], v["aciertos"], v["anuladas"]), (2, 1, 0))
        self.assertAlmostEqual(v["p_media"], 0.675)
        self.assertAlmostEqual(v["tasa"], 0.5)
        r = self.cal["lineas"]["por_color"]["rojo"]
        self.assertEqual((r["n"], r["anuladas"]), (0, 1))
        self.assertIsNone(r["tasa"])

    def test_lineas_por_tramo(self):
        t = {(x["desde"], x["hasta"]): x for x in self.cal["lineas"]["por_tramo"]}
        self.assertEqual(t[(0.7, 0.8)]["aciertos"], 1)
        self.assertEqual(t[(0.6, 0.7)]["n"], 1)
        self.assertEqual(t[(0.5, 0.6)]["aciertos"], 1)
        self.assertEqual(t[(0.8, 0.9)]["anuladas"], 1)
        self.assertEqual(sum(x["n"] for x in self.cal["lineas"]["por_tramo"]), 3)

    def test_brier(self):
        b = self.cal["lineas"]["brier"]
        self.assertEqual(b["n"], 3)              # la anulada y la sin pk no cuentan
        self.assertAlmostEqual(b["modelo"], ((0.3) ** 2 + (0.65) ** 2 + (0.45) ** 2) / 3, places=4)
        self.assertAlmostEqual(b["casa"], ((0.4) ** 2 + (0.55) ** 2 + (0.5) ** 2) / 3, places=4)

    def test_roi_escalera(self):
        verde = self.cal["escalera"]["roi"]["verde"]
        self.assertEqual((verde["n"], verde["ganadas"]), (3, 2))
        self.assertAlmostEqual(verde["unidades"], 0.3 + 0.8 - 1, places=2)
        self.assertAlmostEqual(verde["roi"], (0.3 + 0.8 - 1) / 3, places=4)
        rojo = self.cal["escalera"]["roi"]["rojo"]
        self.assertEqual((rojo["n"], rojo["anuladas"], rojo["roi"]), (1, 1, -1.0))

    def test_sugeridas(self):
        s = self.cal["sugeridas"]["segura"]
        self.assertEqual((s["n"], s["ganadas"], s["con_anuladas"]), (1, 1, 1))
        self.assertAlmostEqual(s["roi"], 0.5)     # pata anulada a cuota 1,00: paga 1,5
        i = self.cal["sugeridas"]["intermedia"]
        self.assertEqual((i["n"], i["ganadas"], i["perdidas"], i["roi"]), (1, 0, 1, -1.0))
        self.assertEqual(self.cal["sugeridas"]["sonadora"]["n"], 0)
        self.assertEqual(self.cal["dias"], ["2026-11-12"])


if __name__ == "__main__":
    unittest.main()
