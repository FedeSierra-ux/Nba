# NBA Semáforo

Página que toma las líneas de jugadores NBA del día, las cruza con spread, riesgo de blowout, back-to-back y lesiones, y les pone un **semáforo de riesgo**. Permite armar combinadas pata por pata viendo la cuota y la probabilidad en vivo.

**Versión 0.6.0**

## Novedades de la 0.6

- **Resultados y calibración** (`#/resultados`, en «Más»): cuánto acertó cada color del semáforo frente a lo que prometía, un gráfico de calibración por tramo de probabilidad (los tramos con menos de 30 casos se marcan como poco confiables), Brier del modelo contra la casa, ROI de la escalera a cuota de Betano y el récord de las combinadas sugeridas. Elegí un día para ver sus sugeridas pata por pata (✓, ✗, anulada o pendiente, con lo que hizo cada jugador) y las líneas verdes con su resultado. Con pocos días corregidos la página lo dice: todavía no hay conclusiones.
- **Mis apuestas** (`#/apuestas`): en la combinada, «Registrar apuesta» guarda la casa (Betano, Stake u otra), el monto y la cuota real (se escribe con coma, «1,85»). La sección corrige cada apuesta y cada pata con los box scores (ganada, perdida, anulada o pendiente), resume apostado, cobrado, neto, ROI y aciertos, también por casa, y permite marcar una apuesta a mano o borrarla. Las apuestas viven en el navegador: **Exportar / Importar** las pasa a otro dispositivo como archivo JSON.
- **Combinada en vivo**: si una pata de tu combinada (o de una apuesta de hoy) está en un partido en juego, arriba de la combinada aparece el panel «En vivo» con lo que lleva cada jugador frente a su línea («lleva 7 · le faltan 4»), minutos, faltas, marcador y reloj; ✓ cuando pasa la línea y ✗ si el partido termina sin pasarla. Usa el resumen público de ESPN: una consulta por partido en juego cada 45 segundos, solo mientras la combinada está a la vista (botón «Actualizar» para pedirlo ya).
- **Armá tu combinada** (arriba de las sugeridas): elegí cuota objetivo, cantidad de patas, probabilidad mínima por pata, colores, máximo de patas por partido y mercados, y el optimizador de las sugeridas arma la de mayor probabilidad que llega a esa cuota. «Otra opción» busca otra con jugadores distintos; si no se puede, explica por qué y qué aflojar.
- **Contexto** en la escalera de puntos, rebotes y asistencias: cómo le fue al jugador en la temporada con la línea que estás mirando como local, visitante, en palizas, en partidos parejos, en back-to-back y con sus minutos normales (partidos, promedio y % que la superó). Las situaciones de hoy van resaltadas y las muestras de menos de 5 partidos, atenuadas. Es contexto, no una predicción.
- **Cinco pestañas**: la nueva **Más** reúne Resultados, Mis apuestas y Cómo se calcula.

## Qué trae

- **Cinco secciones**: **Partidos** (inicio), **Líneas**, **Sugeridas**, **Combinada** y **Más**. En el celular se cambian con la barra de pestañas de abajo; en escritorio las pestañas van arriba y «Mi combinada» queda siempre a la derecha. Cada sección tiene su dirección (`#/partidos`, `#/lineas?partido=…`, `#/sugeridas`, `#/combinada`, `#/mas`, `#/resultados`, `#/apuestas`, `#/metodo`), así que el botón «Atrás» y los marcadores funcionan, y cada sección conserva su scroll.
- **Partidos del día**: spread, total, moneyline, probabilidad de blowout (medidor con zonas fijas), back-to-back / 3 en 4 y lesiones. «Ver líneas ›» abre las líneas de ese partido. Los partidos que ya empezaron dicen **En juego** o **Final**: sus líneas no se pueden sumar y no entran en las sugeridas.
- **Solo líneas con cuota de Betano**, en una tabla tipo LudoProps: jugador, cuota de Betano, gráfico de los últimos 10 con la línea punteada, probabilidad y tasas de acierto (últimos 10 y temporada). Hoy son ≈850 jugador-mercado y ≈2.500 líneas. Para cada jugador se muestra la **línea más alta que cumple la probabilidad mínima** que elijas (55 % a 90 %, o la recomendada por el semáforo) y un desplegable con **todas las líneas de Betano** (+4,5, +5,5…) con cuota, probabilidad, **cuota justa** y semáforo.
- **Solo «más de» por defecto.** Los «menos» se pueden ver, solo para la línea principal, desde el desplegable.
- **Semáforo** 🟢🟡🔴 por línea, con filtros por partido, tipo de mercado (puntos, rebotes, asistencias, combos, otros), probabilidad mínima, semáforo y búsqueda (sin importar tildes); mercado exacto, orden, «solo modelo completo» y «menos» están en «Más filtros». El % de probabilidad lleva el color del semáforo de su línea, y el color también se anuncia como texto para lectores de pantalla.
- **Armador de combinadas**: sumá patas desde cualquier línea de la escalera (elegir otra línea del mismo jugador y mercado reemplaza la anterior), editá la cuota de cada una (por ejemplo, con la de Stake; se escribe con coma: «1,85»), mirá cuota total, probabilidad con correlación, cuota justa de la combinada, ventaja estimada y el semáforo. Guarda combinadas en el navegador. Al llegar datos nuevos, las patas se **actualizan** (probabilidad, color y cuota de Betano, salvo la cuota que editaste a mano) y se avisa si alguna línea ya no está. Una combinada guardada otro día se rearma con los datos de hoy.
- **Combinadas sugeridas del día** (solo «más de», con cuota publicada y modelo completo): 🟢 **Segura** (3 y 4 patas, cuota ≥ 1,99; solo líneas verdes de ≥ 72 %, una pata por partido), 🟡 **Intermedia** (4 y 5 patas, cuota ≥ 5; verdes y amarillas de ≥ 60 %) y 🟣 **Soñadora** (7 patas, cuota ≥ 20; de ≥ 50 %). Cada una muestra cuota, probabilidad («1 de N») y cuota justa, y se carga con un botón en el armador para editarla. Se resuelven como una mochila: maximizar la probabilidad conjunta sujeta a la cuota mínima (relajación de Lagrange + mejora local, `docs/sugeridas.js`).

## Fuentes de datos

| Dato | Fuente | Clave |
|---|---|---|
| Líneas, promedios, minutos, lesiones y cuotas de Betano | [LudoProps](https://ludoprops.com) | no |
| Spread, total, moneyline, calendario (back-to-back), lesiones por partido | ESPN (`site.api.espn.com`, DraftKings) | no |
| Estadísticas en vivo de la combinada (desde el navegador) | ESPN (`site.api.espn.com/…/summary?event=`) | no |

La escalera de cuotas de Betano se baja para **puntos, rebotes y asistencias** (≈ 1 consulta por jugador y mercado, unas 330 por corrida, cerca de 3 minutos). En los demás mercados se muestra solo la línea principal. Para bajar más mercados: `--mercados pts,reb,ast,pra,pr,pa,ra` (o `todos`).

### Por qué hay jugadores o líneas sin cuota de Betano

- **Mercados que Betano no ofrece:** tiros intentados o convertidos, pérdidas, faltas, rebotes ofensivos y defensivos, dobles y primer cuarto. No se muestran.
- **Jugadores con pocos minutos:** Betano publica props sobre todo para titulares y rotación fija (≈ 28 min de promedio). Los que no tienen cuota juegan ≈ 21 min. En puntos hay 118 de 153 jugadores con cuota.
- **Líneas muy bajas:** Betano publica unas 6 líneas por jugador alrededor de la principal. Una línea muy segura (por ejemplo +2,5 rebotes cuando el promedio es 6) suele no estar porque pagaría menos de ~1,15.

**Stake** no tiene API pública (el sitio bloquea consultas automáticas) y los proveedores que la ofrecen son de pago. Por eso la cuota de Stake se escribe a mano en cada pata de la combinada.

## Uso

```bash
python3 scripts/resultados.py          # califica los días anteriores y recalcula docs/data/calibracion.json
python3 scripts/actualizar.py          # baja los datos de hoy (≈3 min) y escribe docs/data/hoy.json
node scripts/foto_sugeridas.js         # guarda las combinadas sugeridas pre-partido en el historial del día
python3 -m http.server -d docs 8000    # abrir http://localhost:8000
```

Solo usa la librería estándar de Python 3.9+. No hay dependencias que instalar.

El workflow `.github/workflows/actualizar.yml` regenera los datos varias veces por día (incluyendo después del reporte oficial de lesiones de las 17:00 ET) y los publica en el repositorio. Para ver la página en línea, activá GitHub Pages sobre la carpeta `/docs` de la rama principal.

### Archivos de datos (`docs/data/`)

| Archivo | Qué guarda |
|---|---|
| `hoy.json` | Partidos (`partidos[]`, con `espn`: id del partido en ESPN) y jugador-mercado (`grupos[]`) con su escalera de líneas (`pasos[]`). En puntos, rebotes y asistencias cada grupo trae `temp` (valores de la temporada) y `tg`: un partido por fila, del más viejo al más nuevo, `[valor, minutos, local (1/0), margen, b2b (1/0)]`; margen = puntos del equipo − puntos del rival; b2b = 1 si jugó el día anterior. |
| `historial/<fecha>.json` | Foto pre-partido del día (solo partidos que no empezaron; las corridas tardías no pisan lo anterior): `lineas` (línea principal, con `p` del modelo y `pk` de la casa sin margen), `escalera` (todas las líneas `{id, gid, m, per, L, cu, p, c}`) y `sugeridas` (las combinadas del día, la primera foto pre-partido gana). |
| `resultados/<fecha>.json` | Box score de los días terminados: `partidos` (estado y marcador) y `jugadores` (minutos y estadísticas; 0 minutos = no jugó). `completo` es falso hasta que terminan todos los partidos; se reintenta (últimos 7 días). |
| `calibracion.json` | Acierto esperado vs. observado por color y por tramo de probabilidad (líneas principales y escalera), Brier del modelo vs. la casa, ROI de apuesta plana por color y récord de las combinadas sugeridas por nivel. |

**Cómo se califica** (todas las líneas son «más de»): gana si el valor supera la línea (con líneas x,5 no hay empate; con una línea entera el empate se anula). Si el jugador no jugó (0 minutos o no figura en el box score), la pata se **anula**, no se pierde. Combos: PRA = puntos + rebotes + asistencias; PR, PA y RA igual. Una **combinada** pierde si pierde una pata; una pata anulada cuenta como ganada a cuota 1,00 (se paga con las demás, como hacen las casas) y si se anulan todas se devuelve la apuesta. Las patas de partidos suspendidos o sin terminar y las de un período (1er cuarto) no se califican. El ROI es de apuesta plana (1 unidad por línea) a la cuota de Betano; las anuladas no cuentan.

`resultados.py` hace 1 consulta a LudoProps por día (`dia`) y 1 por partido con líneas (`box`), espaciadas, solo para días sin resultados completos.

### Pruebas

```bash
python3 -m unittest discover -s tests
node --test tests/correlacion.test.js tests/sugeridas.test.js tests/app.test.js tests/calificar.test.js tests/vivo.test.js
```

Prueba de punta a punta de la página (Playwright + Chromium, en 390×844 y 1360×900; no consulta nada externo: calibración, historial, resultados, apuestas para importar y el resumen de ESPN salen de `tests/fixtures/`):

```bash
python3 -m http.server 8776 -d docs &
PORT=8776 NODE_PATH=$(npm root -g) node tests/e2e.js     # SHOTS=carpeta guarda capturas de cada sección
```

### Datos del navegador (`localStorage`)

| Clave | Qué guarda |
|---|---|
| `nba_semaforo_ticket_v2`, `nba_semaforo_guardadas_v2` | La combinada actual y las guardadas. |
| `nba_semaforo_apuestas_v1` | Mis apuestas (se validan al leer; exportalas para no perderlas al borrar los datos del navegador). |
| `nba_semaforo_nombres_v1` | Nombres de jugadores por id: el historial y los resultados solo guardan ids, y no todos los jugadores juegan hoy. |

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
6. **Combinadas**: la probabilidad conjunta usa una cópula gaussiana. Como partidos distintos son independientes, se calcula por partido: dos patas del mismo partido con la normal bivariada exacta (algoritmo de Genz) y tres o más con Monte Carlo de semilla fija (`docs/correlacion.js`). Patas del mismo jugador se correlacionan según las estadísticas que comparten; las del mismo partido, levemente; entre partidos distintos se asumen independientes.

## Límites

- **La calibración recién empieza.** No hay cuotas históricas públicas: cada corrida guarda una foto pre-partido en `docs/data/historial/` y `scripts/resultados.py` la contrasta con los box scores en `docs/data/calibracion.json` (se ve en «Resultados y calibración»). Con pocos días la muestra es chica.
- El panel «En vivo» depende del resumen no oficial de ESPN: puede demorar, y si un nombre no coincide con el de LudoProps la pata dice «sin datos en vivo».
- Muestra chica: estamos al comienzo de la temporada.
- El defensa-por-posición se muestra solo como contexto; hay poca evidencia de que prediga.
- Las lesiones cambian hasta minutos antes del partido.
- Los datos dependen de LudoProps y de endpoints no oficiales de ESPN, que pueden cambiar sin aviso. Los pedidos son pocos y espaciados (≈ 25 por corrida).
- Es análisis estadístico, no una garantía ni consejo financiero.
