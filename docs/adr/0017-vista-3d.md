# ADR 0017: Vista 3D del terreno iluminado (RF-19)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

RF-19 (Capa 3) pide una vista 3D. Entre las opciones posibles (un globo, una cúpula de cielo o el terreno local), la más útil para entender el problema es ver **por qué** un sitio tiene luz o sombra: el relieve real iluminado por el Sol, que roza el horizonte, en el instante mostrado.

## Decisión

- **Qué muestra:** el terreno LOLA de ±6 km alrededor del sitio, a 129×129 puntos (~94 m), iluminado por una luz direccional con sombras que sigue la dirección real del Sol en el instante del control de tiempo (RF-12).
  - Una esfera marca el Sol y otra la Tierra, en sus direcciones reales.
  - Un pin en el sitio es naranja cuando la API dice que hay Sol y gris cuando no.
  - La exageración vertical se puede ajustar (1×, 2× por defecto, 3× o 5×); se puede rotar arrastrando y hacer zoom.
- **Geodesia en el servidor:** `lunar_core.terrain_patch` remuestrea el DEM de 20 m sobre una grilla este/norte local centrada en el sitio. Resta la caída por curvatura, d²/2R (−21 m en las esquinas), para que la malla sea coherente con el cálculo del horizonte.
  - El test de orientación coloca relieves con la función de círculo máximo del módulo de horizonte, validada contra el mapa PSR de la NASA. Así se comprueba la convención de azimut de forma independiente de los propios vectores del parche.
  - ±6 km (y no ±8,5 km) garantiza que el cuadrado rotado quepa en la ventana cercana para cualquier longitud.
- **API:** `GET /api/sites/{id}/terrain` devuelve las alturas relativas al suelo del sitio, en orden por filas desde el borde norte (unos 39 KB comprimidos), con caché por sitio. Responde 404 para sitios sin terreno, lo que incluye siempre a los personalizados.
- **Cliente:**
  - `three` (WebGL), cargado **de forma diferida** al abrir "3D view": el bundle inicial sigue en 87 KB gzip y el chunk 3D pesa 139 KB gzip.
  - Renderiza a demanda (al cambiar el instante, la exageración, el ancho o la cámara), sin un bucle continuo.
  - Hay un componente por sitio (`key`) y se detecta WebGL al montarlo. Sin WebGL muestra un mensaje en lugar de fallar.
- **Honestidad del modelo:** la malla es local. Los picos lejanos (hasta 200 km) que también bloquean el Sol entran en los resultados pero no se dibujan, y la vista lo dice. Por eso el estado "Sun up / hidden" del pin viene de la API, no de la iluminación de la malla. La luz se enciende mientras el borde superior del Sol está sobre el horizonte astronómico.

## Consecuencias

- **Tests:**
  - dominio: caída por curvatura, orientación en los 4 puntos cardinales y rechazo de un parche fuera de la grilla;
  - API: parche servido, y 404 para sitios sin terreno, personalizados o desconocidos;
  - e2e en Edge: abre la vista, comprueba que el lienzo tiene relieve real (más de 40 tonos distintos) y que la imagen **cambia** al mover el tiempo.
- **Verificación visual:** Sample B el 2026-01-01 00:00 muestra el Sol al oeste (272,5°), las laderas occidentales iluminadas y el pin naranja. Doce días después el sitio queda en sombra y una cresta proyecta una sombra larga, en coherencia con la línea de tiempo.
- Con esto **la Capa 3 queda completa** (RF-16 a RF-19).
