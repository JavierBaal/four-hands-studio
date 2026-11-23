# Building Four Hands Studio

Four Hands has three parts you build: the TypeScript packages (the app, the bridge and the core), the native audio engine, and nothing else. The sound banks are downloaded separately.

## 1. The app and the bridge

**Requirements:** [Node.js 24](https://nodejs.org) or newer, which ships with npm 11. With npm 10 the install fails because of an npm bug.

```bash
npm install
npm run check          # type checks and tests
npm run app            # build and open the app
npm run build:bridge   # packages/bridge/dist/fourhands-mcp-<version>.mcpb, the extension for Claude Desktop
```

The app runs without the engine and without sound banks: the built-in sound then plays in the window, and plugins and the mixer's measurements are unavailable.

## 2. Sound banks

The app looks for sound banks in `recursos/soundfonts/`, **next to** the repository folder (not inside it):

```
some-folder/
├── four-hands-studio/      ← this repository
└── recursos/
    └── soundfonts/
        ├── MuseScore_General.sf3
        ├── Sonatina_Symphonic_Orchestra.sf2
        └── YDP-GrandPiano-20160804.sf2
```

| Bank | What for | Where to get it |
|---|---|---|
| `MuseScore_General.sf3` | The built-in sound (required for sound) | [MuseScore handbook: SoundFonts](https://musescore.org/en/handbook/soundfonts) |
| `Sonatina_Symphonic_Orchestra.sf2` | Orchestral sounds of the demo song | The SF2 version, from the [MuseScore handbook's list](https://musescore.org/en/handbook/soundfonts) (original library: [sso.mattiaswestlund.net](http://sso.mattiaswestlund.net)) |
| `YDP-GrandPiano-20160804.sf2` | The demo's piano | [FreePats: acoustic grand piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) |

The three files, exactly as the installer ships them, are also assets of this repository's [`sound-banks-v1` release](https://github.com/JavierBaal/four-hands-studio/releases/tag/sound-banks-v1). You can also point to the built-in bank with the `FH_SOUNDFONT` environment variable. Any other SF2 or SF3 you put in `Documents/Four Hands/Sonidos` appears in the app's sound browser. Licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 3. The audio engine (Windows)

**Requirements:**
- [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 2022 or newer, with **Desktop development with C++** (it includes CMake). Or CMake 3.22+ and any C++20 compiler.
- An internet connection the first time: CMake downloads [JUCE](https://github.com/juce-framework/JUCE) 8.

**The easy way** (PowerShell, from the repository root):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-engine.ps1
```

It finds Visual Studio and CMake, builds in `%LOCALAPPDATA%\FourHandsEngine\build` (JUCE has long paths), copies `Four Hands Engine.exe` to `engine\build\FourHandsEngine_artefacts\Release\`, where the app looks for it, and runs a self test that loads a test instrument and plays a note. The first build takes 5 to 15 minutes.

**By hand:**

```bash
cmake -S engine -B engine/build -A x64 -DFH_TEST_PLUGIN=ON
cmake --build engine/build --config Release --parallel
```

Options:
- `-DFH_JUCE_DIR=<path>` uses a local copy of JUCE instead of downloading it.
- `-DFH_TEST_PLUGIN=ON` also builds *Four Hands Test Synth*, a tiny sine-wave VST3 instrument for testing plugin hosting without third-party plugins.

The app finds the engine at the path in the `FH_ENGINE` environment variable, or in `engine/build/FourHandsEngine_artefacts/Release/`. If it is not there, the app tells you so in the sound settings.

The engine also builds on Linux (used for its automated tests); macOS is planned.

**Licence:** the engine is AGPLv3 and JUCE is used under its AGPLv3 option ([docs/audio-engine.md](docs/audio-engine.md), 4).

## 4. The Windows installer

```powershell
npm run package -- --engine <folder with "Four Hands Engine.exe"> --soundfonts <folder with the three banks>
```

It builds the app and the bridge and writes `packages/desktop/out/installer/Four-Hands-Studio-Setup-<version>.exe`: a per-user installer (no administrator rights) with the engine, the three sound banks, the bridge, the demo song, the skills and the licences, which also opens `.fourhands` files. `--dir` makes the unpacked app instead (on any system, to check what goes inside).

The [Windows installer workflow](.github/workflows/installer.yml) does all of it on GitHub: it builds the engine, downloads the sound banks from this repository's `sound-banks-v1` release and checks their SHA-256, and packages. Run it from *Actions > Windows installer > Run workflow*; pushing a version tag (`v0.1.0`) also creates a draft release with the installer.

## 5. Tests

```bash
npm run check        # type checks and unit tests (core, MCP tools, app)
npm run arranque     # the real Electron app: first run, editing, saving, reopening
npm run puente       # the app with the packed bridge and a real MCP client
```

`arranque` and `puente` need a display; on Linux run them under `xvfb-run` (`npm run puente` already does). More in [packages/desktop/README.md](packages/desktop/README.md).
