# ADR 0001: Registrar las decisiones de arquitectura

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El proyecto tiene un solo desarrollador, un plazo corto (15 de noviembre de 2026) y varias decisiones que dependen de spikes y del enunciado completo del 28 de octubre. Hace falta dejar constancia de qué se decidió y por qué, sin generar mucha burocracia.

## Decisión

Cada decisión relevante se registra como un archivo `docs/adr/NNNN-titulo.md` en español, con estas secciones: **Contexto**, **Decisión** y **Consecuencias**, más un estado (`propuesta`, `aceptada` o `reemplazada por NNNN`). Los ADR no se editan después de aceptarse: si una decisión cambia, se escribe uno nuevo que reemplaza al anterior.

## Consecuencias

- Las decisiones abiertas del brief (§10) se cierran con ADR.
- Cada spike (A: geometría, B: terreno) termina con su ADR.
