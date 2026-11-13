"""Pruebas de los datos nuevos de actualizar.py: partidos de la temporada (tg) y foto del historial (sin red)."""
import importlib.util, os, unittest

RUTA = os.path.join(os.path.dirname(__file__), "..", "scripts", "actualizar.py")
spec = importlib.util.spec_from_file_location("actualizar_datos", RUTA)
act = importlib.util.module_from_spec(spec)
spec.loader.exec_module(act)


class SerieTemporada(unittest.TestCase):
    GRAF = [   # formato de la ficha de LudoProps: marcador = [propio, rival]
        {"fecha": "2026-11-06", "local": 0, "marcador": [118, 124], "min": 31.0, "valor": 12},
        {"fecha": "2026-11-07", "local": 1, "marcador": [103, 125], "min": 20.0, "valor": 11},
        {"fecha": "2026-11-10", "local": 1, "marcador": [123, 103], "min": 25.0, "valor": 11},
        {"fecha": "2026-11-11", "local": 1, "marcador": None, "min": None, "valor": 19},
        {"fecha": "2026-11-12", "local": 1, "marcador": [100, 90], "min": 30.0, "valor": None},
    ]

    def test_formato(self):
        temp, tg = act.serie_temporada(self.GRAF)
        self.assertEqual(temp, [12, 11, 11, 19])
        self.assertEqual(tg, [[12, 31.0, 0, -6, 0], [11, 20.0, 1, -22, 1], [11, 25.0, 1, 20, 0], [19, None, 1, None, 1]])

    def test_vacio(self):
        self.assertEqual(act.serie_temporada(None), ([], []))


class Mercados(unittest.TestCase):
    def test_sin_rebotes_ofensivos_ni_defensivos(self):
        for m in ("oreb", "dreb"):
            self.assertNotIn(m, act.CV)
            self.assertNotIn(m, act.NOMBRE)


class Foto(unittest.TestCase):
    def grupo(self, id_, gid, L=10.5):
        return {"id": id_, "gid": gid, "m": "pts", "per": None, "L": L, "mu": 12.0, "sd": 4.0, "cu_mas": 1.8,
                "cu_menos": 1.9, "pasos": [{"L": L - 2, "cu": 1.3, "p": 0.8, "pk": 0.7, "c": "verde"},
                                           {"L": L, "cu": 1.8, "p": 0.6, "pk": 0.52, "c": "amarillo"}]}

    def test_solo_no_empezados_con_pk_y_escalera(self):
        partidos = [{"gid": "g1", "estado": 1}, {"gid": "g2", "estado": 2}]
        f = act.foto_del_dia("2026-11-12", "t", partidos, [self.grupo(1, "g1"), self.grupo(2, "g2")])
        self.assertEqual([x["id"] for x in f["lineas"]], [1])
        self.assertEqual(f["lineas"][0]["pk"], 0.52)
        self.assertEqual(f["escalera"], [
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 8.5, "cu": 1.3, "p": 0.8, "c": "verde"},
            {"id": 1, "gid": "g1", "m": "pts", "per": None, "L": 10.5, "cu": 1.8, "p": 0.6, "c": "amarillo"}])
        self.assertNotIn("sugeridas", f)

    def test_combina_con_la_foto_previa_y_conserva_sugeridas(self):
        partidos = [{"gid": "g1", "estado": 1}, {"gid": "g2", "estado": 2}]
        previa = act.foto_del_dia("2026-11-12", "t0", [{"gid": "g1", "estado": 1}, {"gid": "g2", "estado": 1}],
                                  [self.grupo(1, "g1", 9.5), self.grupo(2, "g2")])
        previa["sugeridas"] = [{"id": "segura"}]
        f = act.foto_del_dia("2026-11-12", "t1", partidos, [self.grupo(1, "g1"), self.grupo(2, "g2", 30.5)], previa)
        # el jugador 1 se actualiza; el 2 (partido ya empezado) conserva su foto pre-partido
        self.assertEqual(sorted((x["id"], x["L"]) for x in f["lineas"]), [(1, 10.5), (2, 10.5)])
        self.assertEqual(sorted((x["id"], x["L"]) for x in f["escalera"]), [(1, 8.5), (1, 10.5), (2, 8.5), (2, 10.5)])
        self.assertEqual(f["sugeridas"], [{"id": "segura"}])


if __name__ == "__main__":
    unittest.main()
