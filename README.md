# NBA Semáforo

Página que toma las líneas de jugadores NBA del día, las cruza con spread, riesgo de blowout, back-to-back y lesiones, y les pone un **semáforo de riesgo**. Permite armar combinadas pata por pata viendo la cuota y la probabilidad en vivo.

**Versión 0.1.0**

## Qué trae

- **Partidos del día**: spread, total, moneyline, probabilidad de blowout, back-to-back / 3 en 4 y lesiones.
- **Todas las líneas** (≈3.100): mercados de puntos, rebotes, asistencias, combos, triples, tiros, libres, robos, tapas, pérdidas, faltas, etc. Con cuota de Betano cuando existe, promedios de temporada y últimos 10, historial contra el rival, minutos proyectados y las razones del semáforo.
- **Semáforo** 🟢🟡🔴 por línea, con filtros por partido, mercado, lado, cuota y búsqueda.
- **Armador de combinadas**: sumá patas, editá la cuota de cada una (por ejemplo, con la de Stake), mirá cuota total, probabilidad con correlación, ventaja estimada y el semáforo de la combinada. Guarda combinadas en el navegador y arma sugeridas de 3, 4 o 5 patas.

## Fuentes de datos

| Dato | Fuente | Clave |
|---|---|---|
| Líneas, promedios, minutos, lesiones, cuotas Betano y bet365 | [LudoProps](https://ludoprops.com) | no |
| Spread, total, moneyline, calendario (back-to-back), lesiones por partido | ESPN (`site.api.espn.com`, DraftKings) | no |

**Stake** no tiene API pública (el sitio bloquea consultas automáticas) y los proveedores que la ofrecen son de pago. Por eso la cuota de Stake se escribe a mano en cada pata de la combinada.

## Uso

```bash
python3 scripts/actualizar.py          # baja los datos de hoy y escribe docs/data/hoy.json
python3 -m http.server -d docs 8000    # abrir http://localhost:8000
```

Solo usa la librería estándar de Python 3.9+. No hay dependencias que instalar.

El workflow `.github/workflows/actualizar.yml` regenera los datos varias veces por día (incluyendo después del reporte oficial de lesiones de las 17:00 ET) y los publica en el repositorio. Para ver la página en línea, activá GitHub Pages sobre la carpeta `/docs` de la rama principal.

### Pruebas

```bash
python3 -m unittest discover -s tests
node --test tests/correlacion.test.js
```

## Cómo funciona el semáforo

1. **Probabilidad del modelo**: promedio de la estimación del sitio (proyección con minutos y rol) y una propia (proyección ± variabilidad de los últimos 10 partidos; binomial negativa para cifras bajas).
2. **Ajustes de contexto** sobre los minutos proyectados:
   - *Blowout*: spread → probabilidad de que el margen final supere 14,5 puntos (margen ~ Normal(spread, 12)). Se resta la parte por encima de la probabilidad típica (27 %), porque los promedios de temporada ya incluyen paliza.
   - *Back-to-back*: −2 min a titulares en la segunda noche; −1 min en el tercer partido en 4 días.
3. **Contraste con la casa**: si hay cuota, la probabilidad final es el promedio entre el modelo y la probabilidad de la casa sin margen. Elegir siempre el lado donde el modelo más discrepa sobreestima la probabilidad; la mezcla lo corrige. Sin cuota, el modelo se acerca a 50 % en la misma proporción y la línea no puede ser verde.
4. **Colores**:
   - 🟢 probabilidad ≥ 60 %, promedios de temporada / últimos 10 / proyección del mismo lado de la línea (≥ 4 %), al menos dos de tres tasas de acierto a favor y ninguna en contra, ≥ 24 minutos, minutos estables, sin lesión, sin riesgo alto de blowout ni back-to-back, y el modelo no supera a la casa por más de 20 puntos.
   - 🟡 probabilidad ≥ 55 % con casi todo a favor pero con alguna alerta.
   - 🔴 el resto; automático si es *Questionable/Doubtful*, "no sugerir" del sitio o pocos minutos.
5. **Combinadas**: la probabilidad conjunta usa una cópula gaussiana (Monte Carlo con semilla fija). Patas del mismo jugador se correlacionan según las estadísticas que comparten; las del mismo partido, levemente; entre partidos distintos se asumen independientes.

## Límites

- **Las probabilidades no están validadas contra resultados.** No hay cuotas históricas públicas para hacerlo. Cada corrida guarda una foto del día en `docs/data/historial/`, para poder medir la calibración cuando haya suficientes días.
- Muestra chica: estamos al comienzo de la temporada.
- El defensa-por-posición se muestra solo como contexto; hay poca evidencia de que prediga.
- Las lesiones cambian hasta minutos antes del partido.
- Los datos dependen de LudoProps y de endpoints no oficiales de ESPN, que pueden cambiar sin aviso. Los pedidos son pocos y espaciados (≈ 25 por corrida).
- Es análisis estadístico, no una garantía ni consejo financiero.
