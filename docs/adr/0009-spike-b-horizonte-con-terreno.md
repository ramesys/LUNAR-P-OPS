# ADR 0009: Spike B, horizonte con terreno LOLA en CPU

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El brief (§11, Paso 4) pedía cuatro cosas: leer una ventana pequeña de un COG de LOLA, calcular la máscara de horizonte de un sitio en CPU, verificar la consistencia de marcos de referencia y medir el tiempo. La GPU está fuera del alcance (ADR 0004).

## Datos (verificados en PGDA, producto 90, el 2026-09-18)

| Archivo | Uso | Resolución / cobertura |
|---|---|---|
| `LDEM_80S_20MPP_ADJ.TIF` (2,7 GB) | Campo cercano | 20 m/px, ±304 km del polo |
| `LDEM_60S_240MPP_ADJ.TIF` (219 MB) | Campo lejano | 240 m/px, hasta 60°S |
| `LPSR_80S_20MPP_ADJ.TIF` | Validación: regiones en sombra permanente (1 = PSR) | 20 m/px |

Los tres archivos se sirven desde `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/`.

- **Formato y acceso:** COG con overviews, comprimidos con deflate. El servidor acepta lecturas parciales (HTTP 206) pero **no pedidos multi-rango**, así que GDAL se configura sin `GDAL_HTTP_MULTIRANGE` y con `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`. Sin esa opción, abrir un archivo tardaba minutos; con ella, menos de 1 s.
- **Referencia:** proyección polar estereográfica sur sobre una esfera de 1737,4 km, latitud planetocéntrica, alturas en metros sobre esa esfera y marco MOON_ME de DE421. Es **el mismo marco y el mismo radio** que usa la geometría SPICE (ADR 0005), así que la consistencia de marcos se da por construcción y no hace falta ninguna transformación entre ambos.

## Decisión

- **Algoritmo:** en `lunar_core/horizon.py`, basado en mapas anidados (Barker et al. 2023).
  - Rayos a lo largo de círculos máximos cada 0,5° de azimut (720 azimuts).
  - Campo cercano a 20 m hasta 8 km y campo lejano a 240 m hasta 200 km. A esa distancia ya queda oculto por la curvatura un pico de unos 7 km, el máximo del terreno polar.
  - La elevación de cada punto del terreno se calcula con la curvatura lunar exacta, y la máscara es la elevación máxima por azimut.
  - La visibilidad con terreno es `elevación + margen > máscara(azimut)`, donde el margen es el semidiámetro para el Sol (borde superior) y 0 para la Tierra, igual que en el ADR 0006.
- **Descarga:** `clps-fetch-terrain` (`make fetch-terrain`) descarga solo las ventanas necesarias por sitio: ±8,5 km a 20 m y ±210 km a 240 m. Las guarda en `data/terrain/*.npz`, que no se versiona.
- **La GPU no hace falta.**

## Resultados

- **Validación independiente contra la NASA:** 50 píxeles al azar del mapa PSR de LOLA, en una zona de 10×10 km alrededor de 89,5°S / 0°E, evaluados sobre un ciclo completo de precesión lunar (2026-01 a 2044-09, 13.636 instantes).
  - **25 de 25** píxeles PSR nunca reciben el borde superior del Sol en nuestro modelo.
  - **25 de 25** píxeles no-PSR sí lo reciben en algún momento.
  - La concordancia es del **100%**. Un error de marco, de proyección o de orientación del azimut rompería esta concordancia.
- **Tests sintéticos:**
  - Con terreno plano, la máscara coincide con la depresión geométrica del horizonte.
  - Una montaña aislada da el ángulo analítico con un error menor a 0,05°.
  - La proyección coincide con `pyproj` usando el CRS del propio DEM, con un error menor a 1 cm.
- **Rendimiento en CPU:**
  - Máscara de horizonte: **0,10 s por sitio** (720 × ~1.200 muestras, NumPy).
  - Descarga de las ventanas: 5 a 12 s por sitio, una sola vez.
  - Validación completa (50 píxeles × 18,6 años): menos de 1 minuto.
- **Impacto en los sitios de ejemplo** (2026, paso horario, observador a 2 m):

| Sitio | Sol plano → terreno | Tierra plano → terreno | Máscara máx. |
|---|---|---|---|
| Sample A | 57,5% → 12,7% | 48,2% → 38,3% | 9,5° |
| Sample B | 57,5% → 29,8% | 43,4% → 50,8% | 10,4° |
| Sample C | 60,2% → 3,6% | 42,3% → 0,0% | 14,0° |
| Sample D | 53,6% → 18,0% | 53,2% → 22,2% | 6,3° |
| Sample E | 53,6% → 28,9% | 55,4% → 43,1% | 8,7° |
| Sample F | 50,7% → 0,0% | 19,3% → 0,0% | 25,4° |

  - El terreno domina los resultados, tal como anticipaba el brief (§3). Con horizonte plano el ranking es engañoso.
  - En Sample B, la Tierra se ve **más** con terreno. No es un error: el sitio está 1.052 m sobre su entorno y en el 31% de los azimuts su horizonte cae por debajo de 0° (hasta −2,2°).

## Consecuencias

- **RF-11 (horizonte con terreno) es viable y pasa a ser la prioridad del Sprint 4:**
  - precalcular las máscaras del catálogo con un pipeline;
  - que la API las use cuando existan, con horizonte plano como alternativa explícita en el panel de supuestos;
  - dibujar la máscara en el diagrama de cielo.
- **El cambio de ranking entre plano y terreno es el hallazgo más valioso para el usuario final.** Conviene mostrar ambos resultados, o al menos avisar cuando se usa horizonte plano.
- **Limitaciones:**
  - La máscara se calcula para un punto. No modela sombras sobre el propio panel ni la variación dentro del área de aterrizaje.
  - El DEM tiene incertidumbre propia; LOLA publica `*_ERR.TIF`.
  - Los sitios fuera de la cobertura de 20 m (más allá de ~80°S) necesitarían otro producto para el campo cercano.
