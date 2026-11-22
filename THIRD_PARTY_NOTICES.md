# Third-party notices

Four Hands Studio is MIT licensed ([LICENSE](LICENSE)), except the native audio engine in [`engine/`](engine), which is AGPLv3 ([engine/LICENSE](engine/LICENSE)) because it is built on JUCE. This file lists the third-party work the project uses and their licences.

## Audio engine (`engine/`)

| Component | Licence | Notes |
|---|---|---|
| [JUCE 8](https://juce.com) | AGPLv3 or the commercial JUCE licence | Fetched by CMake at build time (tag 8.0.12); not stored in this repository. Includes the Steinberg VST3 SDK (MIT since VST 3.8). "VST" is a trademark of Steinberg Media Technologies GmbH |
| [TinySoundFont](https://github.com/schellingb/TinySoundFont) | MIT | `engine/third_party/tinysoundfont`, with its licence |
| [stb_vorbis](https://github.com/nothings/stb) | MIT or public domain | `engine/third_party/stb` |
| [SpessaSynth](https://github.com/spessasus/spessasynth_core) | Apache-2.0 | The engine's built-in voices follow SpessaSynth's behaviour |

## App, bridge and core (`packages/`)

Runtime dependencies bundled with the app and the bridge. All are permissive.

| Package | Licence |
|---|---|
| [spessasynth_core](https://github.com/spessasus/spessasynth_core) | Apache-2.0 |
| [stb-vorbis](https://www.npmjs.com/package/stb-vorbis) | Apache-2.0 |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [react](https://react.dev), react-dom, scheduler | MIT |
| [midi-file](https://github.com/carter-thaxton/midi-file) | MIT |
| [zod](https://zod.dev) | MIT |
| [ws](https://github.com/websockets/ws) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
| [IBM Plex Sans and IBM Plex Mono](https://github.com/IBM/plex) (via @fontsource) | SIL Open Font License 1.1 |
| The MCP SDK's own dependencies (express, hono, ajv, jose and others) | MIT, ISC, BSD-2-Clause, BSD-3-Clause |

The full list, with versions, is in `package-lock.json`; `npm ls --omit=dev` shows it. The app's build writes each bundled package's licence comments to `*.LEGAL.txt` files next to the bundles.

Development tools (TypeScript, esbuild, Vitest, Electron, Playwright, `@anthropic-ai/mcpb`) are not part of the source distributed here; Electron ships with the installer under its MIT licence and Chromium's licences.

## Sound banks

The sound banks are **not** in this repository. The Windows installer includes them, and in a development checkout they go in `recursos/soundfonts/` next to the repository folder (see [BUILDING.md](BUILDING.md)).

| Bank | Licence | Credits |
|---|---|---|
| MuseScore_General (SF3) | MIT | FluidR3 by Frank Wen (2000–02); FluidR3Mono by Michael Cowgill (2014–17); MuseScore_General adaptation by S. Christian Collins (2018–19); Temple Blocks by Ethan Winer (2002); Drumline Cymbals by Michael Schorsch (2016) |
| [Sonatina Symphonic Orchestra](http://sso.mattiaswestlund.net) (SF2) | [Creative Commons Sampling Plus 1.0](https://creativecommons.org/licenses/sampling+/1.0/) | Mattias Westlund; SF2 conversion by "Symphony2" for MuseScore |
| YDP Grand Piano (SF2) | [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) | Built from the Zenph Studios Yamaha Disklavier Pro Piano Multisamples for OLPC; soundfont and sample modifications by roberto@zenvoid.org for the FreePats project |

## Demo and test songs

*Invasion* (the demo song) and *Dilatación* (`packages/core/test-data/Dilatacion.mid`) are original pieces made for this project and are released with it under the MIT licence.
