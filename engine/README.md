# Four Hands Engine

The native audio engine of Four Hands Studio: it hosts VST3 instruments and effects and opens their windows, plays the built-in SoundFont sounds, mixes, applies effects, measures what it plays and sends it to the audio output (WASAPI on Windows). The app starts it as a separate process and talks to it over a local TCP connection with a token.

How it fits with the app: [docs/audio-engine.md](../docs/audio-engine.md). How to build it: [BUILDING.md](../BUILDING.md).

| File | Contents |
|---|---|
| `src/Main.cpp` | Entry point: normal use (`--port 0 --token <t> --cache <file>`), `--selftest`, `--render` and `--bench` |
| `src/Link.*` | The connection with the app |
| `src/Engine.*` | Tracks, plugins, buses, master, transport and the audio callback |
| `src/Effects.*`, `src/GsEffects.h` | Four Hands' own EQ, compressor, limiter, reverb and delay; the GS reverb and chorus of the built-in sounds |
| `src/SoundFontSynth.*`, `src/SoundBank.*` | The built-in sounds (TinySoundFont, with voices modelled on SpessaSynth) |
| `src/Analyzer.*` | The AI's ears: loudness (BS.1770), true peak, bands and stereo per track, bus and master |
| `src/CrashDump.*` | A dump on Windows if the engine crashes |
| `test-synth/` | Four Hands Test Synth, a tiny sine-wave VST3 instrument for testing hosting |
| `third_party/` | TinySoundFont and stb_vorbis, single files with their licences |

## Licence

The engine is licensed under the **GNU Affero General Public License v3** ([LICENSE](LICENSE)), because it is built on [JUCE](https://juce.com), which is available under the AGPLv3 or a commercial licence. The rest of Four Hands Studio is MIT and only talks to the engine over its local connection.

Copyright (c) 2026 Fran Barbero and the Four Hands Studio contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
