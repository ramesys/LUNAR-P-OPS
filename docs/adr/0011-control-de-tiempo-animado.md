# ADR 0011: Control de tiempo animado (RF-12)

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

RF-12 pide un control de tiempo animado y sincronizado entre el diagrama de cielo y la línea de tiempo. Hasta ahora solo existía el hover compartido (ADR 0008), que es efímero: al sacar el cursor, se pierde el instante.

## Decisión

- **Un instante persistente:** play/pausa, paso ±1 muestra, ir al inicio, un deslizador y una velocidad de 6 h/s, 1 día/s, 5 días/s o 20 días/s.
  - El hover pasa a ser una **vista previa**: muestra otro instante sin mover el control, y la lectura lo marca como "(preview)".
  - Hacer **clic** en cualquiera de los dos gráficos mueve el instante ahí.
  - Si se reproduce desde el final, arranca de nuevo desde el principio; al llegar al final se detiene, sin ciclo infinito.
- **El estado de tiempo vive en `ChartsPanel`, no en `App`.** Así, durante la reproducción solo se vuelven a renderizar los gráficos. `App` monta el panel con una `key` nueva por cada resultado, lo que reinicia el tiempo al cambiar de escenario.
- **Reloj:** un `setInterval` de 50 ms (20 fps) acumula muestras fraccionarias. Se eligió en lugar de `requestAnimationFrame` porque es determinista y se puede probar con timers falsos. Al redondear se suma una tolerancia de 1e-9, porque 0,3 × 20 = 5,999… hacía perder una muestra (lo detectó un test).
- **Visual:**
  - Las trayectorias completas bajan a 45% de opacidad.
  - Se resaltan las **últimas 24 h** de cada cuerpo con un trazo grueso, y hay un marcador en el instante actual, tanto en el cielo como en la línea de tiempo.
  - El terreno se sigue dibujando encima, así que el marcador "se esconde" detrás de los cerros.
- **Accesibilidad:**
  - La lectura de texto dice en palabras si el Sol está visible u oculto y si hay DTE en el instante mostrado. Ese estado se lee de las ventanas que devuelve la API (`visibleAt`), así que la regla no se duplica en el cliente.
  - Todos los botones tienen `aria-label`, y el deslizador expone la fecha en `aria-valuetext`.

## Consecuencias

- Hay tests con timers falsos para:
  - la velocidad (6 h/s → 6 muestras en 1 s);
  - la detención al final;
  - los botones de paso y el deslizador;
  - el estado de visibilidad mostrado.
- Es la pieza central de la demo: al reproducir un mes se ve cómo el Sol recorre el horizonte y cómo la Tierra sube y baja por la libración.
