# ADR 0012: Mapa 2D del polo sur (RF-15)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

RF-15 pide un mapa 2D del polo sur con los sitios candidatos. El enunciado oficial del 28 de octubre puede traer sitios distintos, así que el mapa debe adaptarse al catálogo sin tocar código.

## Decisión

- **Fondo:** el relieve sombreado (*hillshade*) oficial de LOLA, `LDEM_80S_80MPP_ADJ_HILL.TIF` (NASA GSFC PGDA, 80 m/px, ±304 km). Está en la misma proyección polar estereográfica que los DEM del horizonte (ADR 0009), así que no hace falta reproyectar.
  - `clps-fetch-basemap` (`make fetch-basemap`) lee una versión reducida de 1024×1024 px usando los overviews del COG (~22 s, una sola vez) y la guarda como PNG en escala de grises (552 KB).
  - Junto a la imagen guarda un JSON con su extensión.
  - Se descarga en el servicio `data`, de forma opcional: sin imagen, el mapa se muestra igual pero sin relieve, y lo avisa.
- **Extensión calculada desde el catálogo** (`lunar_core.pole_map.map_half_width_m`): la distancia del sitio más lejano al polo, más 30 km de margen, redondeada a 50 km y acotada entre 100 y 300 km. Con los sitios de ejemplo da ±200 km.
  - La API solo sirve la imagen si su JSON coincide con la extensión actual. Si el catálogo cambia, una imagen vieja no queda desalineada; se vuelve a descargar.
- **Toda la proyección vive en `lunar_core`**, ya validada contra `pyproj` en el Spike B:
  - la API entrega la posición de cada sitio en el mapa (`map_x_m`, `map_y_m` en `/api/sites`);
  - también entrega la grilla de coordenadas (`/api/map`: paralelos cada 1° y meridianos cada 30°);
  - el cliente solo escala metros a píxeles.
- **Orientación:** la misma de los mapas LOLA, con el meridiano 0° hacia arriba y 90°E a la derecha.
- **Interacción:**
  - Hacer clic en un sitio lo agrega o quita de la comparación, igual que los checkboxes. También funciona con el teclado (Tab y Enter/Espacio).
  - Al llegar al máximo de 4, los demás sitios quedan deshabilitados.
  - Después de comparar, cada sitio muestra su puesto en el ranking (`#1 Sample B`).
- **Diseño:** el mapa va al lado del formulario en pantallas anchas y debajo en las angostas. Las etiquetas llevan un halo oscuro para leerse sobre el relieve, y el mapa incluye una barra de escala de 50 km y el crédito con enlace a la fuente.

## Consecuencias

- **Tests:**
  - dominio: extensión, grilla y orientación de la proyección;
  - API: sin imagen, con imagen válida, con imagen de otra extensión y posiciones de los sitios;
  - web: selección por clic y por teclado, límite de sitios, rankings y fallback sin imagen.
- **Limitación:** con ±200 km, los sitios a menos de ~40 km del polo quedan cerca entre sí y sus etiquetas se apretujan. Un zoom o un recuadro ampliado del polo sería la mejora natural si los sitios oficiales están muy juntos.
- Con esto la Capa 2 queda completa (RF-11 a RF-15).
