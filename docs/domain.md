# Modelo de dominio

> Estado: **validado con el usuario** (2026-09-18). Las reglas de visibilidad y métricas están en el [ADR 0006](adr/0006-reglas-de-visibilidad-y-metricas.md).

## Lenguaje ubicuo

| Término | Significado | Invariantes |
|---|---|---|
| **Site** | Sitio candidato: id, nombre, latitud y longitud (planetocéntricas, `MOON_ME`) y origen (`sample` u `official` si viene del catálogo, `custom` si lo define el usuario) | Latitud en [-90, 90]; longitud normalizada a [0, 360); un sitio `sample` nunca se muestra como dato oficial; un sitio `custom` tiene id canónico `custom:{lat}:{lon}`, latitud ≤ −60° y siempre horizonte plano (ADR 0014) |
| **Observer** | Un Site más la altura del observador sobre el terreno | Altura ≥ 0 m; la define el Scenario (por defecto 2 m) |
| **Body** | Cuerpo observado: `SUN` o `EARTH` | Conjunto cerrado |
| **Scenario** | Lo que el usuario pide comparar: 2 a 4 Sites, rango UTC [inicio, fin), paso, altura del observador, modelo de horizonte y despeje mínimo de la Tierra | 2 ≤ sitios ≤ 4, sin repetir; 0 < fin − inicio ≤ 1 año; paso fijo (por defecto 1 h); altura ≥ 0 (por defecto 2 m); horizonte `terrain` (por defecto) o `flat`; despeje DTE entre 0 y 10° (por defecto 0) |
| **HorizontalPosition** | Azimut (horario desde el norte), elevación y distancia de un Body visto desde un Observer en un instante | Azimut en [0, 360); elevación en [-90, 90] |
| **HorizonModel** | Cómo se decide qué está "sobre el horizonte": `flat` (Capa 1) o `terrain(HorizonMask)` (Capa 2) | Se muestra siempre en el panel de supuestos |
| **HorizonMask** | Elevación del terreno en función del azimut, para un Observer | Definida para todo azimut |
| **Visibility** | Regla por cuerpo, respecto del horizonte en la dirección del cuerpo (0° si es plano, la máscara si hay terreno). **Sol:** el borde superior está sobre el horizonte. **Tierra:** el centro está sobre el horizonte más el despeje mínimo | Evaluada muestra a muestra (ADR 0006, ADR 0010) |
| **VisibilityWindow** | Intervalo continuo de muestras en que un Body está visible (o no) desde un Site | inicio < fin; precisión de ±1 paso; `truncated` si toca el borde del rango |
| **SiteMetrics** | Métricas de un Site en un Scenario: % de tiempo con Sol, % con Tierra, ventanas de luz, oscuridad y DTE, oscuridad continua más larga (marcada "≥" si está truncada) | Los porcentajes son fracciones de las mismas muestras |
| **Ranking** | Orden de los Sites de un Scenario por % de tiempo con Sol, de mayor a menor | Los empates conservan el orden del catálogo |
| **PoleMap** | Mapa 2D del polo en proyección polar estereográfica LOLA: extensión calculada desde el catálogo, grilla de paralelos y meridianos, y posición de cada Site | Contiene todos los sitios del catálogo con margen; el meridiano 0° hacia arriba (ADR 0012) |
| **Assumption / DataSource** | Supuestos de cálculo y fuentes citadas en la UI (RF-09) | Todo cálculo referencia los suyos |

En el código (`libs/lunar_core`): `Site` (`sites.py`), `SurfacePoint` (la parte geométrica de Observer), `Body` y `HorizontalPosition` (`geometry.py`), las reglas de visibilidad (`visibility.py`), `VisibilityWindow` (`windows.py`), `Scenario`, `SiteMetrics` y el ranking (`analysis.py`), y `Assumption` y `DataSource` (`assumptions.py`), `HorizonModel` (`analysis.py`), `HorizonMask` (`horizon.py`) y `TerrainGrid` (`terrain.py`).
