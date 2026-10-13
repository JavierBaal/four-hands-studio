# Four Hands Studio

Herramienta de composición MIDI multipista en la que compones de forma visual y tu propia IA compone contigo vía MCP, sobre la misma partitura y viendo en directo los cambios del otro.

**Estado:** prototipo en construcción (fase 1). Hechos el núcleo (H1) y la edición (H2): la app abre *Dilatación*, se edita con los gestos de `ESPEC_PIANO_ROLL.md`, suena, graba y guarda sola. Falta la mano de la IA (H3). Repositorio privado.

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
| `packages/desktop` | La app Electron: la canción en el proceso principal (`src/main`), la ventana en React y canvas (`src/renderer`), el sonido (`src/audio`, `src/worklet`), la prueba de sonido S0 (`src/s0`) y la escucha a ciegas (`src/escucha`) |
| `tools/prueba-mcpb` | Fuente de la app de la prueba de instalación del 13/10/2026 (referencia) |

## Comandos

Requiere Node 24 o superior (trae npm 11; npm 10 falla al instalar este repositorio).

```bash
npm install
npm run check          # tipos y pruebas
npm run app            # abre la app
npm run s0             # solo la prueba de sonido y latencia
npm run escucha        # solo la escucha a ciegas de SoundFonts
npm run build:bridge   # genera packages/bridge/dist/fourhands-mcp-<versión>.mcpb
```

El SoundFont se busca en `recursos/soundfonts/MuseScore_General.sf3` junto a la carpeta del repositorio, o en la ruta de la variable `FH_SOUNDFONT`. Sin él, la app funciona sin sonido.

### Pruebas de la interfaz (necesitan Chromium o Electron)

```bash
npm run capturas -- <chromium>     # capturas para comparar con bocetos/capturas (carpeta capturas/)
npm run interaccion -- <chromium>  # gestos del piano roll, transporte y grabación, en un navegador real
npm run arranque                   # la app Electron de verdad: primera vez, guardado, cierre y reapertura
```

La ventana también funciona en un navegador normal (`npm run build -w @fourhands/desktop -- --harness`, carpeta `packages/desktop/dist/harness`): sin Electron, con la canción en memoria. `?song=boceto` carga los datos del boceto aprobado; `?sf=<archivo>` carga un SoundFont servido al lado.

## Pruebas automáticas

`npm run check` se ejecuta antes de cada subida. La configuración de GitHub Actions (`.github/workflows/ci.yml`) está lista para Windows, Mac y Linux, pero de momento solo se lanza a mano: Actions no está disponible en esta cuenta.

## Copia en el ordenador de Fran

La carpeta `codigo/` dentro de `H:\SALA_CREATIVA\Four Hands Studio` es una copia de trabajo de este repositorio. Solo se actualiza con git (`git pull` o GitHub Desktop), nunca copiando archivos a mano.
