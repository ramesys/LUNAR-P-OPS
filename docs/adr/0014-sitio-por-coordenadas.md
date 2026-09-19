# ADR 0014: Sitio personalizado por coordenadas (RF-17)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

RF-17 (Capa 3) permite comparar un punto elegido por el usuario. El brief lo limita a **horizonte plano**. Hoy podríamos descargar terreno LOLA para cualquier punto (5–12 s por sitio, ADR 0009), pero eso haría que cada consulta dependa en vivo del servidor de PGDA.

## Decisión

- **Horizonte plano siempre** para los sitios personalizados, como pide el brief. El terreno sigue siendo solo para los sitios del catálogo, que se descargan por anticipado. Cuando se usan, lo informan:
  - `terrain_available: false` y el chip `flat only`;
  - la columna Horizon de la tabla dice "Flat";
  - el panel de supuestos agrega una línea "Custom sites".
- **Identidad canónica:** `custom:{lat}:{lon}`, con la latitud y la longitud Este normalizada a [0, 360) redondeadas a 4 decimales (~3 m).
  - Con esa identidad, el sitio personalizado recorre sin casos especiales el escenario, la caché, el ranking y la URL compartible.
  - Dos coordenadas que redondean al mismo punto son el mismo sitio, y la validación de "sin repetidos" lo rechaza.
  - **El separador es `:` y no `,`**, porque la URL lista los ids separados por comas. Un test del cliente detectó que la primera versión (`custom:lat,lon`) rompía los enlaces compartidos.
- **Alcance:** latitud entre −90° y −60° (la región polar sur que cubre LOLA y que es el foco del desafío). La longitud se acepta entre −180° y 360°.
- **API:**
  - `GET /api/sites/custom?latitude=&longitude=` valida y devuelve el sitio canónico, con su posición en el mapa.
  - `GET /api/sites/{id}` resuelve un id del catálogo o uno personalizado; se usa al abrir un enlace compartido.
  - `/api/sites` sigue devolviendo solo el catálogo.
  - El store de terreno no construye rutas de archivo para los sitios personalizados, porque `:` no es válido en rutas de Windows.
- **Web:**
  - Campos de latitud y longitud con un botón "Add site", dentro del formulario pero sin enviarlo (Enter agrega).
  - El sitio se suma a la lista, al mapa (si cae dentro de su extensión) y a la selección, si hay lugar.
  - Al abrir un enlace, los ids personalizados se resuelven contra la API, y los inválidos se descartan sin romper la página.
  - Un chip `custom` distingue estos sitios de los de ejemplo y de los oficiales.

## Consecuencias

- **Tests:**
  - dominio: normalización, ida y vuelta del id, rechazo de coordenadas fuera de la región;
  - API: endpoints nuevos, horizonte plano, supuesto visible y duplicados equivalentes;
  - web: agregar un sitio, error de región y restauración desde la URL;
  - e2e: agregar un sitio, comparar, ver "Flat", recargar y conservarlo.
- **Posible extensión:** si hiciera falta, se podría ofrecer terreno "a pedido" para sitios personalizados con un botón explícito. Descargaría las ventanas LOLA de ese punto (~10 s), con el mismo mecanismo que `clps-fetch-terrain`.
