# ADR 0006: Reglas de visibilidad, ventanas y ranking

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El borrador de dominio ([domain.md](../domain.md)) dejaba cinco preguntas abiertas, que el usuario respondió el 2026-09-18. Esta decisión reemplaza la regla "centro del disco > 0°" del brief (§5).

## Decisión

1. **Sol visible** cuando su **borde superior** está sobre el horizonte, es decir, cuando la elevación del centro supera −*s*, donde *s* = asin(R☉ / distancia) es el semidiámetro aparente (≈ 0,27°), calculado en cada instante con la distancia que devuelve SPICE y R☉ = 695.700 km. Es el mismo criterio que usa Horizons para "daylight".
   - **Tierra (DTE):** no cambia. Hay comunicación cuando el centro de la Tierra está a más de 0° (umbral configurable en la Capa 2, RF-13).
   - Con terreno (Capa 2), la condición se evalúa contra la máscara en el azimut del cuerpo.
2. **La altura del observador es configurable por escenario**, con 2 m por defecto (la altura usada en el estudio de JPL, brief §5). Con horizonte plano su efecto es despreciable (la depresión del horizonte a 2 m es ≈ 0,09°). Solo tiene efecto real con la máscara de terreno. La UI debe decirlo.
3. **Resolución de las ventanas: ±1 paso.** Los bordes de cada ventana caen en las muestras, y los porcentajes son la fracción de muestras. No se refina con búsqueda de raíces. La precisión (± el paso) se muestra en el panel de supuestos.
4. **Ranking por % de tiempo con Sol** (descendente). Los empates conservan el orden del catálogo.
5. **Las ventanas que tocan el inicio o el fin del rango se marcan como truncadas** y cuentan en las métricas. Si la oscuridad continua más larga está truncada, la UI la muestra como "≥ X h".

## Consecuencias

- `lunar_core` debe exponer la distancia al cuerpo (ya la da `azlcpo`) para calcular el semidiámetro.
- `Scenario` suma `observer_height_m` (≥ 0, por defecto 2).
- `VisibilityWindow` suma el indicador `truncated`.
- Todas estas reglas se listan en el panel de supuestos (RF-09).
