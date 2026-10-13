# Four Hands Studio

Herramienta de composición MIDI multipista en la que compones de forma visual y tu propia IA compone contigo vía MCP, sobre la misma partitura y viendo en directo los cambios del otro.

**Estado:** prototipo en construcción (fase 1). Repositorio privado.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Código | Este repositorio. Es la única fuente de verdad del código |
| Documentos del proyecto (PRD, arquitectura, especificaciones, dirección artística) | Carpeta `H:\SALA_CREATIVA\Four Hands Studio` de Fran, con copia en el proyecto "Four Hands Studio" de claude.ai. El punto de entrada es `INICIO.md` |
| Arquitectura del prototipo | `ARQUITECTURA.md` en esa carpeta |

## Paquetes

| Paquete | Contenido |
|---|---|
| `packages/core` | Núcleo: modelo de la canción, comandos, deshacer, autoría, propuestas, formato compacto, MIDI y análisis. TypeScript puro, sin interfaz ni E/S |
| `packages/mcp-tools` | Definiciones de las herramientas MCP, compartidas por el puente y la app |
| `packages/bridge` | El puente `.mcpb` para Claude Desktop |
| `packages/desktop` | La app Electron |
| `tools/prueba-mcpb` | Fuente de la app de la prueba de instalación del 13/10/2026 (referencia) |

## Comandos

Requiere Node 24 o superior (trae npm 11; npm 10 falla al instalar este repositorio).

```bash
npm install
npm run check          # tipos y pruebas
npm run build:bridge   # genera packages/bridge/dist/fourhands-mcp-<versión>.mcpb
```

## Copia en el ordenador de Fran

La carpeta `codigo/` dentro de `H:\SALA_CREATIVA\Four Hands Studio` es una copia de trabajo de este repositorio. Solo se actualiza con git (`git pull` o GitHub Desktop), nunca copiando archivos a mano.
