# ADR 0010: Horizonte con terreno en la app, umbral DTE y URL compartible

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El Spike B (ADR 0009) demostró que la máscara de horizonte LOLA es correcta (100% de concordancia con el mapa PSR de la NASA) y barata (0,1 s por sitio). También mostró que el terreno invierte el ranking obtenido con horizonte plano. El Sprint 4 la integra en la app (RF-11) y suma RF-13 (elevación mínima de la Tierra) y RF-14 (URL compartible).

## Decisión

- **La máscara se calcula bajo demanda en la API, no se precalcula como archivo.** Depende de la altura del observador, que es configurable por escenario (ADR 0006). Por eso la API guarda en caché la máscara por (sitio, altura), calculada desde las ventanas de terreno ya descargadas (`data/terrain/*.npz`). Lo único que se precalcula es la descarga.
- **Modelo de horizonte por escenario:** `horizon = "terrain"` (por defecto) o `"flat"`. Con `terrain`, un sitio sin datos de terreno usa horizonte plano y lo declara: `horizon_model` en cada sitio, el panel de supuestos ("terrain for N of M sites") y un chip `flat only` en el selector. La opción `flat` sigue disponible a propósito, para ver cuánto pesa el terreno.
- **Reglas de visibilidad** (extienden el ADR 0006):
  - Sol: `elevación + semidiámetro > horizonte(azimut)`.
  - Tierra: `elevación > horizonte(azimut) + despeje mínimo`.
  - El horizonte vale 0 en el modelo plano y la máscara LOLA con terreno.
  - **RF-13:** el despeje mínimo de la Tierra (`earth_min_clearance_deg`, de 0 a 10°) se mide **sobre el horizonte real**, no sobre 0°, porque eso es lo que importa para una antena.
- **API:**
  - Cada sitio devuelve su `horizon_mask` (720 azimuts) para el diagrama de cielo.
  - Cada serie trae `horizon_deg`: el horizonte en la dirección del cuerpo en cada instante.
  - `GET /api/sites` informa `terrain_available`.
  - La caché del análisis incluye en su clave la disponibilidad de terreno, así que una descarga nueva invalida los resultados viejos.
- **Docker:** el servicio de una sola ejecución `kernels` pasa a llamarse `data`. Descarga los kernels (obligatorios) y luego el terreno (opcional: si falla, la API arranca con horizonte plano y lo avisa). Desde un clon limpio, la primera vez tarda ~1 minuto más. Se agregó `libexpat1` a la imagen, porque el GDAL que trae `rasterio` lo necesita.
- **Interfaz:**
  - **Diagrama de cielo:** la silueta del terreno se dibuja semitransparente sobre las trayectorias, así el tramo en que el Sol o la Tierra pasan detrás de un cerro se ve oculto.
  - **Línea de tiempo:** grafica la **altura sobre el horizonte local** (elevación − horizonte), así la línea de 0° es el horizonte real y se mantiene un solo eje.
  - La tabla muestra qué horizonte usó cada sitio, y la lectura del cursor muestra el horizonte en la dirección de cada cuerpo.
- **URL compartible (RF-14):** la URL guarda los sitios, las fechas, el paso, la altura, el horizonte y el despeje DTE, y se actualiza en cada consulta. Al abrir un enlace se descartan los sitios desconocidos y los valores mal formados, sin romper la página.

## Consecuencias

- **Resultados con terreno** (2026, paso horario, 4 sitios de ejemplo): **B** 29,8% de Sol y 50,8% de Tierra; **D** 18,0% / 22,2%; **A** 12,7% / 38,3%; **C** 3,6% / 0,0%. Coinciden exactamente con el Spike B.
- **Tiempo de respuesta:** el peor caso en frío pasa de ~2,3 s a ~3,2 s, por la carga de las ventanas y el cálculo de las máscaras.
- **Pendiente del Sprint 4:** cargar los sitios y datasets oficiales cuando se publiquen (28 de octubre). Basta con reemplazar `catalog/sites.json` y ejecutar `make fetch-terrain`.
