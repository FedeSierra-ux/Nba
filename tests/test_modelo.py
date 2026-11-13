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


if __name__ == "__main__":
    unittest.main()
