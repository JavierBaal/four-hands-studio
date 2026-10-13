# App de prueba del puente

Hace de "Four Hands abierto" para probar el puente `.mcpb` con Claude Desktop antes de tener el prototipo. Responde con datos de prueba y no compone ni guarda nada.

- **Prueba de instalación (13/10/2026):** `get_song_overview` y `point_to`. Resultados en `PRUEBA_MCPB.md` (carpeta de documentos del proyecto).
- **Prueba de permisos S1:** ocho herramientas del esquema real, de solo lectura (`get_song_overview`, `get_user_context`, `read_notes`, `point_to`), de escritura (`begin_intervention`, `add_notes`, `end_intervention`) y una destructiva (`delete_notes`). Resultados en `PRUEBA_S1.md`.

## Archivos

- `app.mjs`: WebSocket en 127.0.0.1 con token, botón "Conectar con Claude" (asociación → alias `claude-desktop.exe` → Ajustes) y registro (`registro-prueba.jsonl`). Instala el `.mcpb` más reciente de la carpeta de arriba.
- `s1.mjs`: las herramientas de la prueba S1 (contexto, notas, intervenciones) con datos de prueba.
- `song.mjs`: *Dilatación* como datos de prueba (forma, pistas y armonía extraídas del MIDI real).
- `page.html`: la página con las herramientas usadas, las marcas de `point_to` y la actividad.

## Cómo se genera lo que se entrega

```
npm run build:bridge   # packages/bridge/dist/fourhands-mcp-<versión>.mcpb
npm run build:prueba   # tools/prueba-mcpb/dist/app-prueba.mjs (un solo archivo, se abre con Node)
```

En la carpeta de Fran: `prueba-s1/app/app-prueba.mjs`, `prueba-s1/fourhands-mcp-<versión>.mcpb` y un lanzador de doble clic.

El puente de verdad está en `packages/bridge`; la lógica del botón pasará a `packages/desktop`.
