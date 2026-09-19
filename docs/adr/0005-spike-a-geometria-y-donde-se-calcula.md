# ADR 0005: Spike A (geometría con SPICE) y dónde se calcula

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El brief (§11, Paso 2) pedía validar que `lunar_core` calcule el azimut y la elevación del Sol y de la Tierra desde el polo sur lunar, con un test dorado contra JPL Horizons (tolerancia inicial propuesta ≤ 0,5°), y decidir con ese resultado si el cálculo se hace bajo demanda o se precalcula (§7.4).

## Decisión

### Kernels (verificados en el repositorio de NAIF el 2026-09-18)

| Archivo | Uso |
|---|---|
| `naif0012.tls` | Segundos intercalares (UTC ↔ TDB) |
| `pck00011.tpc` | Constantes (radio lunar 1737,4 km) |
| `moon_pa_de421_1900-2050.bpc` | Orientación lunar DE421 (ejes principales) |
| `moon_080317.tf` | Marcos `MOON_PA` / `MOON_ME` de DE421 |
| `de440s.bsp` | Efemérides planetarias DE440 (MD5 verificado) |

Se usa el marco **`MOON_ME` de DE421** porque es el mismo al que están referidos los DEM de LOLA (brief §5). Así, la máscara de horizonte de la Capa 2 y la posición del Sol y la Tierra comparten el mismo marco. La orientación DE421 cubre hasta 2050.

### Método

Se usa `azlcpo` de SPICE (toolkit N0067), con el observador fijo en la superficie (radio de referencia 1737,4 km), corrección `LT+S` (tiempo de luz + aberración estelar), azimut medido en sentido horario desde el norte local y sin refracción. Es la misma convención que usa Horizons con `APPARENT=AIRLESS`.

### Resultado del test dorado

Los datos de referencia son un año (2026) a paso diario, Sol y Tierra, en 4 puntos de prueba: 89,5°S; 85°S/45°E; 88°S/222°E; y el ecuador como control del marco. Son coordenadas arbitrarias, **no sitios CLPS**. Horizons usa DE441 y el marco `MEAN_ME`.

- **Error máximo medido: 0,05″ (≈ 0,000014°)** en los 8 casos (2.928 muestras).
- La tolerancia del test queda en **1″**, con 20× de margen. Un error de marco o de escala de tiempo produciría desviaciones de minutos de arco o más, así que el test lo detectaría.
- El archivo de referencia (`backend/lunar-core/tests/golden/horizons_2026.json`) se versiona para que el test corra sin red. Se regenera con `make golden`.

### Dónde se calcula (§7.4)

- **Rendimiento medido:** 0,2 s para un año a paso horario de un cuerpo en un sitio, en CPU. El peor caso del MVP (4 sitios × 2 cuerpos × 1 año horario) cuesta ≈ 1,6 s.
- **Decisión: cálculo bajo demanda en la API**, con caché en memoria por escenario. No hace falta precalcular.

## Consecuencias

- La precisión geométrica deja de ser un riesgo. La incertidumbre real estará en el terreno (Capa 2) y en los umbrales de visibilidad.
- SPICE no es seguro para hilos (*thread-safe*): la API debe serializar las llamadas con un lock o usar un único worker. Se resuelve en el Sprint 2.
- Los tests de `lunar_core` requieren los kernels. `make test` ejecuta `make fetch-data` antes, y esa descarga es idempotente.
