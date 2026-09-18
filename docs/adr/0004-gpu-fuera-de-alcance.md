# ADR 0004: La GPU queda fuera del alcance

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El brief (§7.1, §7.5, §11 Paso 5) contemplaba usar una GPU RTX 5070 para acelerar el precálculo de máscaras de horizonte o un mapa regional de iluminación, con un perfil de Compose `gpu` y un smoke test de CUDA.

## Decisión

Por decisión del usuario, **se ignora todo lo relacionado con la GPU**: no habrá perfil `gpu`, ni imágenes CUDA, ni dependencias de librerías GPU, ni smoke test. Todo el cálculo se hace en CPU (NumPy y, si hiciera falta, Numba).

## Consecuencias

- Se simplifican Docker y las dependencias, y desaparece el riesgo de compatibilidad con Blackwell (brief §9).
- Si el Spike B muestra que el precálculo de horizontes es demasiado lento en CPU, se reduce el alcance (menos sitios, menor resolución o precálculo único offline) antes de reconsiderar la GPU, y eso requeriría un ADR nuevo.
