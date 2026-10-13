# Four Hands Studio: instrucciones para Claude

## Antes de tocar código

1. **Los documentos del proyecto mandan.** Están en la carpeta de Fran `H:\SALA_CREATIVA\Four Hands Studio` (fuente de verdad) y en el proyecto "Four Hands Studio" de claude.ai. Empieza por `INICIO.md` y `HANDOFF.md`. Para código, lee también `ARQUITECTURA.md`.
2. **Interfaz:** todo lo visual cumple `DIRECCION_ARTISTICA.md` y se compara con `bocetos/capturas/`. Nada visual cambia sin aprobación de Fran.
3. **Comportamiento:** gestos y atajos en `ESPEC_PIANO_ROLL.md`; colaboración e IA en `ESTUDIO_INTERFAZ.md` y `ESQUEMA_MCP.md`; alcance en `PRD_MVP.md`.

## Reglas del código

- **TypeScript estricto.** Identificadores y comentarios en inglés; textos de la interfaz en archivos de idioma (español e inglés). Documentos y README en español de España.
- **El núcleo (`packages/core`) es puro:** sin interfaz, archivos, red ni Electron. Todo cambio de la canción es un comando con sus inversas; una transacción es un paso de deshacer.
- **Los ticks no salen nunca del núcleo** (960 por negra). La desviación respecto a la rejilla se calcula al leer, no se guarda.
- **Las herramientas MCP se definen solo en `packages/mcp-tools`.** Ninguna herramienta compone: leen, escriben, analizan y transforman de forma mecánica.
- **Respuestas MCP: solo texto compacto**, sin `structuredContent` (`ARQUITECTURA.md`, 6.2).
- **Cada regla de producto lleva su test** (autoría, desviación al mover, conflictos, propuestas). `npm run check` tiene que pasar antes de subir nada.
- **Licencias:** solo dependencias MIT, Apache, BSD u OFL. Nada GPL en la app (es de código cerrado).

## Con Fran

- Dicta por voz: ante palabras raras, interpreta la intención más lógica.
- Trabaja **solo en Windows**, sin Mac y **sin teclado MIDI**: lo que necesite Mac o teclado de verdad lo prueba otra persona (`ARQUITECTURA.md`, 1.1).
- Decisiones de calado: el consejo de Four Hands (skill `consejo-four-hands`), cuando él lo convoque.
