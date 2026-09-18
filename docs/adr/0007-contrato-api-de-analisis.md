# ADR 0007: Contrato de la API de análisis (Capa 1)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El Sprint 2 expone por HTTP el cálculo de `lunar_core` (ADR 0005, ADR 0006) para que el frontend del Sprint 3 pueda dibujar el diagrama de cielo, la línea de tiempo, la tabla comparativa y el panel de supuestos.

## Decisión

- **Endpoints:**
  - `GET /api/sites`: catálogo. Por ahora solo hay sitios `sample` con coordenadas arbitrarias, en `libs/lunar_core/src/lunar_core/catalog/sites.json`, un archivo que se reemplaza cuando se publique el enunciado del 28 de octubre.
  - `POST /api/analysis`: recibe `site_ids` (2-4), `start`/`end` (UTC con zona horaria, rango semiabierto [start, end)), `step_minutes` (por defecto 60) y `observer_height_m` (por defecto 2).
- **Respuesta:**
  - `times` se envía una sola vez y las series de azimut y elevación de cada cuerpo van **en columnas**, alineadas con `times`. Esto evita repetir claves en 8.760 muestras por sitio.
  - Cada sitio trae su posición en el ranking, sus métricas, las ventanas de Sol y Tierra (con `truncated`), y se agregan `assumptions` y `data_sources` para el panel RF-09.
  - Las bandas de luz y DTE se dibujan desde las ventanas, así la regla de visibilidad existe en un solo lugar: `lunar_core`.
- **Validación:** vive en el dominio (`Scenario`), y la API la traduce a HTTP 422. Pydantic usa las mismas constantes (`MIN_SITES`, `MAX_SITES`) para que OpenAPI documente los límites.
  - Límite técnico: **como máximo 10.000 muestras** por escenario. Un año a paso horario son 8.784 muestras; pasos más finos exigen rangos más cortos.
- **Rendimiento (peor caso: 4 sitios, 1 año, paso horario):**
  - 2,2-2,4 s en frío y ~15 ms desde la caché LRU en memoria (16 escenarios).
  - La respuesta pesa 1,35 MB, que con gzip quedan en 471 KB.
- **Concurrencia:** un `threading.Lock` global en `lunar_core.geometry` serializa las llamadas a SPICE.
- **Docker:** el servicio de una sola ejecución `kernels` descarga los kernels que falten antes de levantar `api` (`service_completed_successfully`), así que `docker compose up` funciona desde un clon limpio sin pasos manuales.
- **Métrica extra:** `longest_earth_outage` (el corte de DTE continuo más largo). Es el análogo de la oscuridad más larga para las comunicaciones.

## Consecuencias

- El frontend no recalcula ninguna regla: solo dibuja las series y las ventanas que recibe.
- Si el enunciado oficial exige rangos multianuales, habrá que reducir la resolución (paso mayor) o cambiar a un formato binario o de muestras agregadas.
