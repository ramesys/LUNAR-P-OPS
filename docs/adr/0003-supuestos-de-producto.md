# ADR 0003: Supuestos de producto del MVP

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El brief (§4.3) proponía cuatro supuestos por defecto que el usuario no había vetado. El 2026-09-18 el usuario los confirmó explícitamente.

## Decisión

1. La interfaz está en **inglés**, porque los jueces son globales. La documentación sigue en español.
2. El **rango máximo de fechas es de un año** en el MVP. Los rangos multianuales quedan para después.
3. Se comparan **hasta 4 sitios** (mínimo 2).
4. Hay **un solo flujo** para planificadores, educadores y público, sin modo experto en el MVP.

## Consecuencias

- La API debe validar el rango (≤ 1 año) y el número de sitios (2 a 4) y devolver errores claros.
- Estos límites deben aparecer en el panel de supuestos (RF-09).
