# NBA Semáforo

Página que toma las líneas de jugadores NBA del día, las cruza con spread, riesgo de blowout, back-to-back y lesiones, y les pone un **semáforo de riesgo**. Permite armar combinadas pata por pata viendo la cuota y la probabilidad en vivo.

**Versión 0.3.0**

## Qué trae

- **Partidos del día**: spread, total, moneyline, probabilidad de blowout, back-to-back / 3 en 4 y lesiones.
- **Líneas «más de» con toda su escalera** (≈3.400 jugador-mercado, ≈25.000 líneas): puntos, rebotes, asistencias, combos, triples, tiros, libres, robos, tapas, pérdidas, faltas y primer cuarto. Para cada jugador se muestra la **línea más alta que cumple la probabilidad mínima** que elijas (55 % a 90 %, o la recomendada por el semáforo) y un desplegable con **todas las líneas** (+3,5, +4,5, +5,5…) con cuota de Betano, cuota de bet365, probabilidad, **cuota justa** y semáforo.
- **Solo «más de» por defecto.** Los «menos» se pueden ver, solo para la línea principal, desde el desplegable.
- **Semáforo** 🟢🟡🔴 por línea, con filtros por partido, tipo de mercado (puntos, rebotes, asistencias, combos, otros), probabilidad mínima, cuota y búsqueda.
- **Armador de combinadas**: sumá patas desde cualquier línea de la escalera (elegir otra línea del mismo jugador y mercado reemplaza la anterior), editá la cuota de cada una (por ejemplo, con la de Stake), mirá cuota total, probabilidad con correlación, cuota justa de la combinada, ventaja estimada y el semáforo. Guarda combinadas en el navegador.
- **Combinadas sugeridas del día** (solo «más de», con cuota publicada y modelo completo): 🟢 **Segura** (3 y 4 patas, cuota ≥ 1,99; solo líneas verdes de ≥ 72 %, una pata por partido), 🟡 **Intermedia** (4 y 5 patas, cuota ≥ 5; verdes y amarillas de ≥ 60 %) y 🟣 **Soñadora** (7 patas, cuota ≥ 20; de ≥ 50 %). Cada una muestra cuota, probabilidad («1 de N») y cuota justa, y se carga con un botón en el armador para editarla. Se resuelven como una mochila: maximizar la probabilidad conjunta sujeta a la cuota mínima (relajación de Lagrange + mejora local, `docs/sugeridas.js`).

## Fuentes de datos

| Dato | Fuente | Clave |
|---|---|---|
| Líneas, promedios, minutos, lesiones, cuotas Betano y bet365 | [LudoProps](https://ludoprops.com) | no |
| Spread, total, moneyline, calendario (back-to-back), lesiones por partido | ESPN (`site.api.espn.com`, DraftKings) | no |

La escalera real de cuotas (Betano y bet365) se baja para **puntos, rebotes y asistencias** (≈ 1 consulta por jugador y mercado, unas 330 por corrida, cerca de 3 minutos). En los demás mercados las líneas faltantes se calculan con el modelo y se muestran sin cuota, con su cuota justa. Para bajar más mercados: `--mercados pts,reb,ast,pra,pr,pa,ra` (o `todos`, ≈1.600 consultas).

**Stake** no tiene API pública (el sitio bloquea consultas automáticas) y los proveedores que la ofrecen son de pago. Por eso la cuota de Stake se escribe a mano en cada pata de la combinada.

## Uso

```bash
python3 scripts/actualizar.py          # baja los datos de hoy (≈3 min) y escribe docs/data/hoy.json
python3 -m http.server -d docs 8000    # abrir http://localhost:8000
```

Solo usa la librería estándar de Python 3.9+. No hay dependencias que instalar.

El workflow `.github/workflows/actualizar.yml` regenera los datos varias veces por día (incluyendo después del reporte oficial de lesiones de las 17:00 ET) y los publica en el repositorio. Para ver la página en línea, activá GitHub Pages sobre la carpeta `/docs` de la rama principal.

### Pruebas

```bash
python3 -m unittest discover -s tests
node --test tests/correlacion.test.js tests/sugeridas.test.js
```

## Cómo funciona el semáforo

1. **Probabilidad del modelo**: promedio de la estimación del sitio (proyección con minutos y rol) y una propia (proyección ± variabilidad de los últimos 10 partidos; binomial negativa para cifras bajas).
2. **Ajustes de contexto** sobre los minutos proyectados:
   - *Blowout*: spread → probabilidad de que el margen final supere 14,5 puntos (margen ~ Normal(spread, 12)). Se resta la parte por encima de la probabilidad típica (27 %), porque los promedios de temporada ya incluyen paliza.
   - *Back-to-back*: −2 min a titulares en la segunda noche; −1 min en el tercer partido en 4 días.
3. **Contraste con la casa**: si hay cuota, la probabilidad final es el promedio entre el modelo y la probabilidad de la casa sin margen (se quita el margen con el sobreprecio de la línea principal). Elegir siempre el lado donde el modelo más discrepa sobreestima la probabilidad; la mezcla lo corrige. Las líneas sin cuota usan la misma corrección que la línea principal del jugador, y si el jugador no tiene cuota en Betano la línea no puede ser verde.
4. **Escalera**: la probabilidad de «más de X» para cualquier X sale de la misma distribución desplazada con la corrección de la línea principal. Las tasas de acierto se calculan sobre los últimos 10 partidos y, en puntos/rebotes/asistencias, sobre todos los partidos de la temporada.
5. **Colores** (para cada línea de la escalera):
   - 🟢 probabilidad ≥ 60 %, promedios de temporada / últimos 10 / proyección por encima de la línea (≥ 4 %), tasas de acierto a favor y ninguna en contra, ≥ 26 minutos proyectados, minutos estables, sin lesión, sin riesgo alto de blowout ni back-to-back (salvo que la línea tenga ≥ 75 % de probabilidad), y el modelo no supera a la casa por más de 20 puntos.
   - Ninguna línea supera 96 %: siempre queda un riesgo que las estadísticas no ven (lesión durante el partido, faltas, minutos de basura).
   - 🟡 probabilidad ≥ 55 % con casi todo a favor pero con alguna alerta.
   - 🔴 el resto; automático si es *Questionable/Doubtful*, "no sugerir" del sitio o pocos minutos.
6. **Combinadas**: la probabilidad conjunta usa una cópula gaussiana (Monte Carlo con semilla fija). Patas del mismo jugador se correlacionan según las estadísticas que comparten; las del mismo partido, levemente; entre partidos distintos se asumen independientes.

## Límites

- **Las probabilidades no están validadas contra resultados.** No hay cuotas históricas públicas para hacerlo. Cada corrida guarda una foto del día en `docs/data/historial/`, para poder medir la calibración cuando haya suficientes días.
- Muestra chica: estamos al comienzo de la temporada.
- El defensa-por-posición se muestra solo como contexto; hay poca evidencia de que prediga.
- Las lesiones cambian hasta minutos antes del partido.
- Los datos dependen de LudoProps y de endpoints no oficiales de ESPN, que pueden cambiar sin aviso. Los pedidos son pocos y espaciados (≈ 25 por corrida).
- Es análisis estadístico, no una garantía ni consejo financiero.
