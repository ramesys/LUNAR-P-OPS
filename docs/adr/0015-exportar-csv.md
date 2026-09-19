# ADR 0015: Exportar la comparación a CSV (RF-18)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

RF-18 (Capa 3) pide exportar los resultados como CSV o como imagen. Los planificadores quieren llevarse los números a su propia planilla o herramienta. Esta decisión cubre el CSV; la imagen queda pendiente.

## Decisión

- **Generación en el navegador, sin endpoint nuevo:** los CSV se arman a partir de la respuesta de `/api/analysis` que ya está en pantalla (`apps/web/src/lib/csv.ts`). El archivo coincide exactamente con lo que el usuario ve, se descarga al instante y no recalcula nada. Las reglas de visibilidad siguen viviendo solo en el dominio: la columna de visibilidad de cada muestra sale de las ventanas que devuelve la API, recorridas en una sola pasada.
- **Tres archivos**, desde el grupo "Download CSV" bajo la tabla comparativa:
  - **Summary:** una fila por sitio, con su puesto, el origen, las coordenadas, el horizonte usado, el % de Sol y de Tierra, y la oscuridad y el corte de DTE más largos (horas y si están truncados). Repite los parámetros del escenario en cada fila, así el archivo se describe solo.
  - **Time series:** una fila por muestra y por sitio, con el azimut, la elevación y el horizonte de cada cuerpo, más `sun_visible` y `dte_available`.
  - **Windows:** cada período de `sunlight`, `darkness`, `dte` o `no_dte`, con inicio, fin, duración en horas y `truncated`.
- **Formato:**
  - RFC 4180: comas, comillas duplicadas y fin de línea CRLF.
  - Codificación UTF-8 **con BOM**, para que Excel lea bien el "°" de los nombres. El BOM se construye con `String.fromCharCode(0xfeff)`, porque un escape `﻿` en el código fuente terminaba convertido en un carácter invisible por las herramientas de edición.
  - Horas en UTC ISO 8601, ángulos en grados y duraciones en horas.
  - Nombre de archivo con el rango **inclusivo**, por ejemplo `clps-summary_2026-01-01_2026-12-31.csv`.

## Consecuencias

- **Tests:** unitarios de comillas, BOM, filas, visibilidad por muestra y nombres de archivo. El e2e descarga los tres archivos en Edge y verifica el encabezado y la cantidad de filas con datos reales (3 sitios × 744 muestras).
- **Tamaño:** el peor caso (4 sitios, 1 año, paso de 1 h) genera una serie temporal de ~35.000 filas, unos 3 MB, dentro del navegador.
- **Pendiente de RF-18:** exportar imagen (PNG del diagrama de cielo o de la línea de tiempo). El SVG ya está en el DOM, así que bastaría con serializarlo e inyectar los colores de CSS.
