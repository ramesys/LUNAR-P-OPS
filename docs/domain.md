# Modelo de dominio: BORRADOR para validar

> Estado: **propuesta**, no cerrada (brief §6). Se valida con el usuario antes de construir el backend de la Capa 1 (Sprint 2).

## Lenguaje ubicuo propuesto

| Término | Significado | Invariantes |
|---|---|---|
| **Site** | Sitio candidato del catálogo: id, nombre, latitud y longitud (planetocéntricas, `MOON_ME`), origen (`sample` u `official`) | Latitud en [-90, 90]; longitud normalizada a [0, 360); un sitio `sample` nunca se muestra como dato oficial |
| **Observer** | Un Site más la altura del observador sobre el terreno (p. ej. 2 m) | Altura ≥ 0; relevante sobre todo cuando hay terreno (Capa 2) |
| **Body** | Cuerpo observado: `SUN` o `EARTH` | Conjunto cerrado |
| **Scenario** | Lo que el usuario pide comparar: 2 a 4 Sites, rango UTC [inicio, fin) y paso | 2 ≤ sitios ≤ 4, sin repetir; 0 < fin − inicio ≤ 1 año; paso fijo (por defecto 1 h) |
| **HorizontalPosition** | Azimut (horario desde el norte) y elevación de un Body visto desde un Observer en un instante | Azimut en [0, 360); elevación en [-90, 90] |
| **HorizonModel** | Cómo se decide qué está "sobre el horizonte": `flat` (Capa 1) o `terrain(HorizonMask)` (Capa 2) | Se muestra siempre en el panel de supuestos |
| **HorizonMask** | Elevación del terreno en función del azimut, para un Observer | Definida para todo azimut |
| **VisibilityWindow** | Intervalo continuo en que un Body está visible (o no) desde un Site | inicio < fin; se marca si está *truncada* por el borde del rango |
| **SiteMetrics** | Métricas de un Site en un Scenario: % de tiempo con Sol, % con Tierra, ventanas de luz, oscuridad y DTE, oscuridad continua más larga | Los porcentajes se calculan sobre las mismas muestras |
| **Assumption / DataSource** | Supuestos de cálculo y fuentes citadas en la UI (RF-09) | Todo cálculo referencia los suyos |

En el código actual (Sprint 1) ya existen `Body`, `SurfacePoint` (la parte geométrica de Observer) y `HorizontalPosition`.

## Preguntas abiertas para el usuario

1. **Criterio de "Sol visible":** el brief dice *centro del disco* > 0°, pero Horizons marca "daylight" cuando el **borde superior** del Sol está sobre el horizonte. El disco solar mide ~0,5°, y en el polo, donde el Sol roza el horizonte, esa diferencia pesa. ¿Centro, borde superior, o mostrar la fracción visible del disco?
2. **Altura del observador:** ¿es propiedad del Site o del Scenario (configurable por el usuario)?
3. **Resolución de las ventanas:** ¿basta con precisión de ±1 paso (p. ej. ±1 h), o refinamos los bordes con búsqueda de raíces (SPICE GF)?
4. **Ranking:** ¿qué métrica ordena por defecto? Por ejemplo, % de Sol, luego la oscuridad más larga (menor es mejor), luego % de DTE. ¿O pesos configurables?
5. **Ventanas en los bordes del rango:** ¿se muestran marcadas como "truncadas" o se excluyen de las métricas de duración?
