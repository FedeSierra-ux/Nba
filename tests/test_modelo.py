"""Pruebas del modelo (sin red). Ejecutar: python3 -m unittest discover -s tests -v"""
import importlib.util, os, unittest

RUTA = os.path.join(os.path.dirname(__file__), "..", "scripts", "actualizar.py")
spec = importlib.util.spec_from_file_location("actualizar", RUTA)
act = importlib.util.module_from_spec(spec)
spec.loader.exec_module(act)


def fila(**kw):
    base = {
        "id": 1, "nombre": "Jugador Uno", "equipo": "AAA", "posicion": "G", "rival": "BBB", "local": True,
        "game_id": "g1", "mercado": "pts", "prop": "pts", "periodo": None, "linea": 20.5,
        "prom": 25.0, "prom_temp": 25.0, "ult": [24, 26, 25, 27, 23, 25, 26, 24, 28, 22],
        "pct_ult": 0.9, "pct_temp": 0.85, "pct_h2h": 0.8, "n_h2h": 6, "n_temp": 12, "cruce": "C", "dvp": 15,
        "min_prom": 34.0, "min_ult": [34, 35, 33, 34, 36, 33, 34, 35, 34, 33], "min_proy": 34.0, "rol": "titular probable",
        "estado": None, "no_sugerir": False, "media": 25.5, "prob": 0.80,
        "casa": {"nombre": "Betano", "mas": 1.5, "menos": 2.6, "prob": 0.62},
    }
    base.update(kw)
    return base


class Matematica(unittest.TestCase):
    def test_blowout_crece_con_el_spread(self):
        self.assertLess(act.prob_blowout(2), act.prob_blowout(10))
        self.assertLess(act.prob_blowout(10), act.prob_blowout(16))
        self.assertIsNone(act.prob_blowout(None))

    def test_blowout_valores_razonables(self):
        self.assertAlmostEqual(act.prob_blowout(0), 0.226, delta=0.01)
        self.assertGreater(act.prob_blowout(15.5), 0.5)

    def test_binomial_negativa_suma_uno(self):
        # P(X > 1.5) + P(X <= 1.5) = 1 y es monótona en la media
        self.assertLess(act.nb_sf(1.5, 1.0, 1.5), act.nb_sf(1.5, 2.0, 3.0))
        self.assertAlmostEqual(act.nb_sf(-1, 1.0, 1.5), 1.0)

    def test_p_mas_normal(self):
        self.assertAlmostEqual(act.p_mas(20.5, 20.5, 5), 0.5, delta=0.001)
        self.assertGreater(act.p_mas(15.5, 25, 5), 0.95)


class Semaforo(unittest.TestCase):
    CTX = {"g1": {"p_blowout": 0.25, "spread": 3.0, "descanso": {"AAA": {"b2b": False, "tres_en_cuatro": False}}}}

    def test_over_solido_es_verde(self):
        e = act.evaluar(fila(), self.CTX)
        self.assertEqual(e["lado"], "mas")
        self.assertEqual(e["c"], "verde", e["fl"])

    def test_lesionado_es_rojo(self):
        e = act.evaluar(fila(estado="Questionable"), self.CTX)
        self.assertEqual(e["c"], "rojo")

    def test_blowout_alto_limita_a_amarillo(self):
        ctx = {"g1": {"p_blowout": 0.55, "spread": 15.5, "descanso": {"AAA": {}}}}
        e = act.evaluar(fila(), ctx)
        self.assertNotEqual(e["c"], "verde")
        self.assertTrue(any("blowout" in f for f in e["fl"]))

    def test_blowout_reduce_la_proyeccion(self):
        normal = act.evaluar(fila(), self.CTX)["mu"]
        paliza = act.evaluar(fila(), {"g1": {"p_blowout": 0.6, "descanso": {"AAA": {}}}})["mu"]
        self.assertLess(paliza, normal)

    def test_back_to_back_baja_la_proyeccion_y_limita(self):
        ctx = {"g1": {"p_blowout": 0.27, "descanso": {"AAA": {"b2b": True}}}}
        e = act.evaluar(fila(), ctx)
        self.assertLess(e["mu"], 25.5)
        self.assertNotEqual(e["c"], "verde")

    def test_pocos_minutos_es_rojo(self):
        e = act.evaluar(fila(min_proy=15.0, rol="poco minuto"), self.CTX)
        self.assertEqual(e["c"], "rojo")

    def test_sin_cuota_nunca_es_verde(self):
        e = act.evaluar(fila(casa=None), self.CTX)
        self.assertNotEqual(e["c"], "verde")
        self.assertIsNone(e["cu"])

    def test_modelo_muy_por_encima_de_la_casa_no_es_verde(self):
        e = act.evaluar(fila(casa={"nombre": "Betano", "mas": 2.4, "menos": 1.55, "prob": 0.38}), self.CTX)
        self.assertNotEqual(e["c"], "verde")

    def test_under_cuando_el_promedio_esta_abajo(self):
        e = act.evaluar(fila(linea=30.5, media=25.5, prob=0.2, pct_ult=0.0, pct_temp=0.1, pct_h2h=0.1,
                             casa={"nombre": "Betano", "mas": 2.2, "menos": 1.65, "prob": 0.4}), self.CTX)
        self.assertEqual(e["lado"], "menos")
        self.assertGreater(e["p"], 0.5)




class Escalera(unittest.TestCase):
    CTX = {"g1": {"p_blowout": 0.25, "spread": 3.0, "descanso": {"AAA": {"b2b": False, "tres_en_cuatro": False}}}}

    def grupo(self, **kw):
        f = fila(**kw)
        e = act.evaluar(f, self.CTX)
        ladder = {"betano": {18.5: 1.20, 20.5: 1.50, 22.5: 1.95, 25.5: 3.00},
                  "temp": [24, 26, 25, 27, 23, 25, 26, 24, 28, 22, 25, 26]}
        return act.construir_grupo(f, e, ladder)

    def test_la_probabilidad_baja_al_subir_la_linea(self):
        ps = [s["p"] for s in self.grupo()["pasos"]]
        self.assertEqual(ps, sorted(ps, reverse=True))

    def test_lineas_bajas_son_mas_seguras_y_la_recomendada_es_verde(self):
        g = self.grupo()
        bajo = next(s for s in g["pasos"] if s["L"] == 18.5)
        alto = next(s for s in g["pasos"] if s["L"] == 25.5)
        self.assertGreater(bajo["p"], alto["p"])
        rec = next(s for s in g["pasos"] if s["L"] == g["rec"])
        self.assertEqual(rec["c"], "verde")

    def test_cuota_justa_es_la_inversa_de_la_probabilidad(self):
        for s in self.grupo()["pasos"]:
            self.assertAlmostEqual(s["ju"], 1 / s["p"], delta=0.02)

    def test_solo_hay_lineas_con_cuota_de_betano_y_nada_de_bet365(self):
        g = self.grupo()
        self.assertEqual([s["L"] for s in g["pasos"]], [18.5, 20.5, 22.5, 25.5])
        self.assertTrue(all(s["cu"] is not None and "cb" not in s for s in g["pasos"]))

    def test_sin_cuota_en_betano_no_hay_grupo(self):
        f = fila(casa=None)
        self.assertIsNone(act.construir_grupo(f, act.evaluar(f, self.CTX), None))

    def test_sin_escalera_queda_solo_la_linea_principal(self):
        f = fila()
        g = act.construir_grupo(f, act.evaluar(f, self.CTX), None)
        self.assertEqual([s["L"] for s in g["pasos"]], [20.5])

    def test_incluye_la_linea_menos_de_la_principal(self):
        g = self.grupo()
        self.assertEqual(g["menos"]["L"], 20.5)
        self.assertAlmostEqual(g["menos"]["p"] + next(s for s in g["pasos"] if s["L"] == 20.5)["p"], 1.0, delta=0.01)

    def test_lesionado_deja_toda_la_escalera_en_rojo(self):
        self.assertTrue(all(s["c"] == "rojo" for s in self.grupo(estado="Questionable")["pasos"]))

    def test_ninguna_linea_supera_el_techo_de_probabilidad(self):
        g = self.grupo()
        self.assertTrue(all(s["p"] <= act.P_MAX + 1e-9 for s in g["pasos"]))
        self.assertTrue(all(s["ju"] >= 1 / act.P_MAX - 0.02 for s in g["pasos"]))


class Regresiones(unittest.TestCase):
    """Bugs encontrados en la revisión: cada prueba reproduce uno."""
    CTX = {"g1": {"p_blowout": 0.25, "spread": 3.0, "descanso": {"AAA": {}}}}

    def test_jugador_out_o_suspendido_va_a_rojo(self):
        for est in ("Out", "Suspension", "Day-To-Day"):
            f = fila(estado=est)
            g = act.construir_grupo(f, act.evaluar(f, self.CTX), None)
            self.assertTrue(all(s["c"] == "rojo" for s in g["pasos"]), est)

    def test_menos_respeta_el_techo(self):
        f = fila(linea=40.5, media=20.0, prob=0.01, pct_ult=0.0, pct_temp=0.0, pct_h2h=0.0,
                 casa={"nombre": "Betano", "mas": 15.0, "menos": 1.01, "prob": 0.06})
        g = act.construir_grupo(f, act.evaluar(f, self.CTX), None)
        self.assertLessEqual(g["menos"]["p"], act.P_MAX + 1e-9)

    def test_casa_sin_menos_no_rompe(self):
        f = fila(casa={"nombre": "Betano", "mas": 1.5, "menos": None, "prob": 0.6})
        g = act.construir_grupo(f, act.evaluar(f, self.CTX), None)
        self.assertIsNotNone(g)
        self.assertNotIn("menos", g)

    def test_casa_sin_mas_no_hay_grupo(self):
        f = fila(casa={"nombre": "Betano", "mas": None, "menos": 1.8, "prob": 0.4})
        self.assertIsNone(act.construir_grupo(f, act.evaluar(f, self.CTX), None))

    def test_ult_con_nulos_y_linea_cero(self):
        self.assertIsNotNone(act.evaluar(fila(ult=[25, None, 24, 26, 23, 25]), self.CTX))
        self.assertIsNone(act.evaluar(fila(linea=0.0), self.CTX))

    def test_probabilidad_continua_al_cruzar_6(self):
        for L, sd in ((5.5, 2.6), (6.5, 2.6), (7.5, 3.0)):
            self.assertLess(abs(act.p_mas(L, 5.999, sd) - act.p_mas(L, 6.0, sd)), 0.005)
            self.assertLess(abs(act.p_mas(L, 3.999, sd) - act.p_mas(L, 4.0, sd)), 0.005)
            self.assertLess(abs(act.p_mas(L, 7.999, sd) - act.p_mas(L, 8.0, sd)), 0.005)

    def test_corrimiento_de_escalera_acotado(self):
        f = fila(linea=35.5, media=20.0, prob=0.05, pct_ult=0.0, pct_temp=0.0, pct_h2h=0.0,
                 casa={"nombre": "Betano", "mas": 9.0, "menos": 1.05, "prob": 0.1})
        e = act.evaluar(f, self.CTX)
        self.assertLessEqual(abs(e["_k"]["d_modelo"]), 1.0)
        g = act.construir_grupo(f, e, {"betano": {20.5: 1.9, 35.5: 9.0}, "temp": None})
        p205 = next(s for s in g["pasos"] if s["L"] == 20.5)
        self.assertLess(p205["pm"], 0.8)   # sin acotar daba 0,968 para una línea por encima de la media


if __name__ == "__main__":
    unittest.main()
