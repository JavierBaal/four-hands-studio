# Prueba de instalación del puente (13/10/2026)

Código fuente de la app de prueba usada en la prueba de instalación del puente `.mcpb` con Claude Desktop. Resultados en `PRUEBA_MCPB.md` (carpeta de documentos del proyecto).

- `app.mjs`: hace de "Four Hands abierto": WebSocket en 127.0.0.1 con token, botón "Conectar con Claude" (asociación → alias `claude-desktop.exe` → Ajustes) y registro de la prueba.
- `song.mjs`: *Dilatación* como datos de prueba (forma, pistas y armonía extraídas del MIDI real).
- `page.html`: la página que muestra las marcas de `point_to` y la actividad.

Se conserva como referencia. El puente de verdad está en `packages/bridge`; la lógica del botón pasará a `packages/desktop`.
