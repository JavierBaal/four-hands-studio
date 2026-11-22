# @fourhands/desktop

The Electron app: the main process that holds the song, the window, the sound and the connection with the AI. How the pieces fit: [docs/architecture.md](../../docs/architecture.md).

## Structure

| Folder | Contents |
|---|---|
| `src/main` | Main process: the song session and autosave, the AI server for the bridges (`ai/`), the audio engine host (`engine/`), sound banks, settings, menus |
| `src/renderer` | The window: React interface, canvas piano roll and arrangement (`roll/`), mixing console, shortcuts |
| `src/audio` | Playback scheduling and routing (to the engine, the window's synthesizer or MIDI output) |
| `src/worklet` | The fallback synthesizer (SpessaSynth) on the audio thread, with its event queue |
| `src/shared` | Types and texts shared by the main process and the window (`i18n.ts` has every interface text in Spanish and English) |
| `src/s0`, `src/escucha` | Development tools: the sound and latency test, and a blind listening test of SoundFonts |
| `demo` | The demo song the app opens the first time |
| `scripts` | End-to-end tests that drive the real app with Playwright |

## Running

From the repository root (see [BUILDING.md](../../BUILDING.md)):

```bash
npm install
npm run app        # build and open the app
npm run s0         # only the sound and latency test
npm run escucha    # only the blind listening test of SoundFonts
```

The app looks for the built-in SoundFont in `recursos/soundfonts/MuseScore_General.sf3` next to the repository folder, or at the path in `FH_SOUNDFONT`. Without it, the app works without the built-in sound. The native engine (`engine/`) is looked for at the path in `FH_ENGINE`, then in `engine/build/FourHandsEngine_artefacts/Release`; without it, the window's synthesizer plays the built-in sounds and plugins are unavailable.

## Tests in a real window

```bash
npm run arranque                   # the real Electron app: first run, editing, saving, closing and reopening
npm run puente                     # the app with the packed bridge and a real MCP client (Linux: uses xvfb-run)
npm run interaccion -- <chromium>  # piano roll gestures, transport and recording in a real browser
npm run capturas -- <chromium>     # screenshots of the main states
```

The window also runs in a plain browser (`npm run build -w @fourhands/desktop -- --harness`, folder `dist/harness`), without Electron and with the song in memory: `?song=boceto` loads the sketch data, `?sf=<file>` a SoundFont served next to it.
