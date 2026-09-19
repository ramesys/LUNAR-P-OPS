# ADR 0016: Modo simple y modo experto (RF-16)

- Estado: aceptada. Extiende el ADR 0003 (punto 4: un solo flujo en el MVP).
- Fecha: 2026-09-18

## Contexto

El desafío apunta a tres públicos: planificadores de misión, educadores y público general (brief §2). El MVP tenía un solo flujo con todos los controles. RF-16 (Capa 3) pide un modo simple y otro experto, además de textos didácticos más extensos.

## Decisión

- **Dos presentaciones de los mismos datos:** no cambia ningún cálculo ni la API. Un selector **Simple / Expert** en el encabezado cambia qué se muestra. El modo viaja en la URL (`mode=`), así un enlace compartido abre en el mismo modo.
- **Simple es el modo por defecto** para quien llega sin parámetros: el primer contacto de un jurado, un docente o cualquier visitante debe ser comprensible sin saber qué es DTE. Cambiar el modo por defecto es una línea (`DEFAULT_MODE`).
- **Simple muestra:**
  - solo sitios (lista y mapa) y fechas;
  - un veredicto en una frase ("Sample B leads on both counts…" o "Most sunlight: X. Most time in contact with Earth: Y…");
  - una tarjeta por sitio en lenguaje llano:
    - días de Sol por mes, usando el mes sinódico de 29,53 días;
    - la noche más larga "que las baterías deben aguantar";
    - el % de contacto con la Tierra o la necesidad de un satélite relé;
  - la tabla reducida a puesto, Sol, Tierra y oscuridad más larga;
  - los gráficos con el control de tiempo;
  - los textos "How to read…" abiertos.
- **Simple oculta:** paso, horizonte, altura, elevación mínima de la Tierra, sitios por coordenadas, tabla de ventanas y exportaciones CSV/PNG.
- **Nada oculto cambia los resultados en silencio:** si hay ajustes de experto distintos de los valores por defecto (por ejemplo, un enlace con horizonte plano), el modo simple lo avisa ("Expert settings in use: …") y ofrece **Reset to defaults**.
- **Textos didácticos ampliados** (componente `Learn`), abiertos en Simple y plegados en Expert:
  - por qué se aterriza cerca del polo sur (inclinación de ~1,5°, hielo en cráteres en sombra, libración);
  - cómo leer el diagrama de cielo;
  - cómo leer la línea de tiempo;
  - por qué importa el terreno.
- **Las frases en lenguaje llano** se generan en `lib/plainLanguage.ts` a partir de las métricas de la API, sin reglas nuevas. Menos de 2 días se expresa en horas, y desde 10 días se redondea a días enteros.

## Consecuencias

- **Tests:**
  - unitarios de las frases, del modo en la URL y de los ajustes distintos de los valores por defecto;
  - de App para el modo simple, el cambio de modo y el reset;
  - e2e para el visitante nuevo en Simple y su paso a Expert, que persiste al recargar.
  - Las pruebas que usan controles de experto abren con `mode=expert`.
- **Guion de demo:** se actualizó. La escena del horizonte plano frente al terreno ocurre en modo Expert.
- **Limitación:** la línea de lectura bajo el control de tiempo sigue mostrando azimut y elevación numéricos también en Simple. Se podría reemplazar por una frase ("The Sun is up, 1.4° above the skyline").
