# ADR 0008: Interfaz del MVP (Capa 1)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El Sprint 3 cierra la Capa 1 con los requisitos RF-02, RF-03 y RF-06 a RF-10: elegir sitios y fechas, diagrama de cielo, línea de tiempo, tabla comparativa y ranking, panel de supuestos y ayuda. Todo en inglés (ADR 0003) y con tipado estricto sin `any` (ADR 0002).

## Decisión

- **Gráficos en SVG propio, sin librería de charts.** Son dos gráficos con pocas series. Así se mantiene el tipado estricto sin tipos de terceros laxos, no se agregan dependencias y se controla la accesibilidad. Las escalas y los *ticks* están en `frontend/web/src/lib/scale.ts` y tienen tests.
- **Diagrama de cielo rectangular** (azimut 0–360° × elevación), no polar. En el polo todo ocurre a pocos grados del horizonte, y en un gráfico polar quedaría apretado contra el borde. Las trayectorias se cortan donde el azimut cruza el norte (360°→0°) para no dibujar líneas falsas. La zona bajo el horizonte va sombreada.
- **Línea de tiempo:** elevación del Sol y la Tierra para el sitio seleccionado, en **un solo eje** (grados), más bandas de luz y DTE para **todos** los sitios, que son la comparación visual directa. Las bandas salen de las ventanas que calcula la API, así la regla de visibilidad no se duplica en el cliente.
- **Colores:** Tierra = azul (ranura 1) y Sol = naranja (ranura 2) de la paleta de referencia de la guía de visualización. El validador de daltonismo pasó en modo claro y oscuro (ΔE CVD 24,7 / 26,8). Los sitios no llevan color: se identifican por nombre.
- **Hover compartido:** pasar el cursor por un gráfico marca el mismo instante en el otro. Una línea de texto (`HoverReadout`) muestra los valores exactos, así que ningún dato depende solo del color ni solo del tooltip. La tabla de ventanas (`WindowsTable`) es el equivalente en texto de las bandas.
- **Formulario:** fechas UTC con fin inclusivo (se envía [inicio, fin+1 día)). La validación en el cliente es solo para dar respuesta inmediata; la fuente de verdad sigue siendo la API, cuyos errores 422 se muestran tal cual.
- **Al abrir la app** se cargan el catálogo y una comparación por defecto: los 3 primeros sitios, 30 días desde hoy, paso de 1 h y 2 m de altura. Así se ve contenido desde el primer momento.
- **Avisos visibles:** un banner y un chip `SAMPLE` indican que los sitios son de ejemplo, y los supuestos y las fuentes se listan desde la respuesta de la API.

## Consecuencias

- **Verificado en navegador** (Edge headless, en modo claro y oscuro): renderiza de punta a punta. A ~490 px de ancho no hay scroll horizontal de página; la tabla se desplaza dentro de su caja.
- **Limitación conocida:** en pantallas angostas el texto de los gráficos se achica, porque el SVG escala proporcionalmente. Queda como mejora para el Sprint 5.
- Con esto se cumple la *definición de terminado del MVP* del brief (§11).
