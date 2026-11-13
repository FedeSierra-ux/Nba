# NBA Semáforo

Página que toma las líneas de jugadores NBA del día, las cruza con spread, riesgo de blowout, back-to-back y lesiones, y les pone un **semáforo de riesgo**. Permite armar combinadas pata por pata viendo la cuota y la probabilidad en vivo.

**Versión 0.4.0**

## Qué trae

- **Partidos del día**: spread, total, moneyline, probabilidad de blowout, back-to-back / 3 en 4 y lesiones.
- **Solo líneas con cuota de Betano**, en una tabla tipo LudoProps: jugador, cuota de Betano, gráfico de los últimos 10 con la línea punteada, probabilidad y tasas de acierto (últimos 10 y temporada). Hoy son ≈850 jugador-mercado y ≈2.500 líneas. Para cada jugador se muestra la **línea más alta que cumple la probabilidad mínima** que elijas (55 % a 90 %, o la recomendada por el semáforo) y un desplegable con **todas las líneas de Betano** (+4,5, +5,5…) con cuota, probabilidad, **cuota justa** y semáforo.
- **Solo «más de» por defecto.** Los «menos» se pueden ver, solo para la línea principal, desde el desplegable.
- **Semáforo** 🟢🟡🔴 por línea, con filtros por partido, tipo de mercado (puntos, rebotes, asistencias, combos, otros), probabilidad mínima, cuota y búsqueda.
- **Armador de combinadas**: sumá patas desde cualquier línea de la escalera (elegir otra línea del mismo jugador y mercado reemplaza la anterior), editá la cuota de cada una (por ejemplo, con la de Stake), mirá cuota total, probabilidad con correlación, cuota justa de la combinada, ventaja estimada y el semáforo. Guarda combinadas en el navegador.
- **Combinadas sugeridas del día** (solo «más de», con cuota publicada y modelo completo): 🟢 **Segura** (3 y 4 patas, cuota ≥ 1,99; solo líneas verdes de ≥ 72 %, una pata por partido), 🟡 **Intermedia** (4 y 5 patas, cuota ≥ 5; verdes y amarillas de ≥ 60 %) y 🟣 **Soñadora** (7 patas, cuota ≥ 20; de ≥ 50 %). Cada una muestra cuota, probabilidad («1 de N») y cuota justa, y se carga con un botón en el armador para editarla. Se resuelven como una mochila: maximizar la probabilidad conjunta sujeta a la cuota mínima (relajación de Lagrange + mejora local, `docs/sugeridas.js`).

## Fuentes de datos

| Dato | Fuente | Clave |
|---|---|---|
| Líneas, promedios, minutos, lesiones y cuotas de Betano | [LudoProps](https://ludoprops.com) | no |
| Spread, total, moneyline, calendario (back-to-back), lesiones por partido | ESPN (`site.api.espn.com`, DraftKings) | no |

La escalera de cuotas de Betano se baja para **puntos, rebotes y asistencias** (≈ 1 consulta por jugador y mercado, unas 330 por corrida, cerca de 3 minutos). En los demás mercados se muestra solo la línea principal. Para bajar más mercados: `--mercados pts,reb,ast,pra,pr,pa,ra` (o `todos`).

### Por qué hay jugadores o líneas sin cuota de Betano

- **Mercados que Betano no ofrece:** tiros intentados o convertidos, pérdidas, faltas, rebotes ofensivos y defensivos, dobles y primer cuarto. No se muestran.
- **Jugadores con pocos minutos:** Betano publica props sobre todo para titulares y rotación fija (≈ 28 min de promedio). Los que no tienen cuota juegan ≈ 21 min. En puntos hay 118 de 153 jugadores con cuota.
- **Líneas muy bajas:** Betano publica unas 6 líneas por jugador alrededor de la principal. Una línea muy segura (por ejemplo +2,5 rebotes cuando el promedio es 6) suele no estar porque pagaría menos de ~1,15.

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
3. **Contraste con la casa**: la probabilidad final es el promedio entre el modelo y la probabilidad de Betano sin margen (se quita el margen con el sobreprecio de la línea principal). Elegir siempre el lado donde el modelo más discrepa sobreestima la probabilidad; la mezcla lo corrige.
4. **Escalera**: el modelo de cada línea de Betano usa la misma distribución que la línea principal, desplazada con su corrección. Las tasas de acierto se calculan sobre los últimos 10 partidos y, en puntos/rebotes/asistencias, sobre todos los partidos de la temporada.
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
