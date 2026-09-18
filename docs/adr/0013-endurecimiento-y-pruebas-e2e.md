# ADR 0013: Endurecimiento (Sprint 5), gráficos adaptables y pruebas end-to-end

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

Tras cerrar las Capas 1 y 2 quedaban tres cosas:

- **Texto chico en móvil:** los gráficos se veían con texto diminuto en pantallas angostas (ADR 0008).
- **Interacción sin probar a mano:** la animación, el hover y el mapa solo se habían revisado con capturas estáticas.
- **Clon limpio sin probar:** faltaba levantar el stack desde cero descargando todos los datos.

## Decisión

- **Gráficos al ancho real:** el diagrama de cielo y la línea de tiempo miden su contenedor (`useElementWidth`, con `ResizeObserver`) y lo usan como ancho de dibujo. Así, una unidad SVG equivale a un píxel CSS y el texto conserva su tamaño real.
  - En anchos menores a 600 px, la línea de tiempo usa un margen izquierdo más angosto y 3 fechas en lugar de 6.
  - Cuando no hay `ResizeObserver`, como en jsdom, se usa un ancho fijo de 960.
- **Pruebas end-to-end con Playwright** (`apps/web/e2e`, `make e2e`) contra el stack en ejecución y con datos reales:
  - usan el **Microsoft Edge instalado** (`channel: "msedge"`), sin descargar navegadores;
  - no corren en Docker: se ejecutan en el host;
  - cubren:
    - la comparación con terreno y las fuentes citadas;
    - reproducir y pausar;
    - la vista previa con hover y el clic que mueve el tiempo;
    - elegir sitios en el mapa y volver a comparar;
    - abrir un enlace compartido con horizonte plano;
    - un proyecto "phone" a 390 px que verifica que no haya scroll horizontal y que la escala del SVG sea 1:1.
- **Error real encontrado por las pruebas end-to-end:** la etiqueta de cada sitio en el mapa dejaba pasar los clics al relieve. Hacer clic sobre el nombre no seleccionaba nada. Ahora un área de clic transparente cubre el punto y la etiqueta, y el fondo del mapa tiene `pointer-events: none`.

## Resultados

- **Clon limpio:** `docker compose up --build` descarga kernels (34 MB), terreno (78 MB) y relieve (0,5 MB) en 18 descargas sin advertencias, y queda *healthy* en **113 s**, con la compilación incluida. Las 5 pruebas end-to-end pasan contra ese clon.
- **Suites:**
  - Python: 83 tests;
  - web: 23 tests unitarios y de componentes, más 5 end-to-end;
  - lint y tipos estrictos en verde, en el host y en Docker.

## Consecuencias

- **Material de entrega:** se agregaron `docs/demo-script.md` y `docs/submission-draft.md`, en inglés y con números reales de los sitios de ejemplo. Hay que actualizarlos con los sitios oficiales (28 de octubre) y ajustarlos a las guías de envío (13 de noviembre).
- **Nombre de imagen compartido:** el nombre de la imagen de la API está fijo en `docker-compose.yml`. Dos proyectos Compose en la misma máquina (por ejemplo, un clon de prueba) comparten esa imagen, así que conviene no usar `--rmi` al limpiar un clon.
