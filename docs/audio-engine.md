# The audio engine

Four Hands Engine is the native program that makes the sound: it hosts VST3 instruments and effects and opens their windows, plays the built-in sounds, mixes, applies effects, measures what it plays and sends it to the audio output. Code comments cite this document by section (`docs/audio-engine.md, 3`), so the numbering is stable.

Source: [`engine/`](../engine). Licence: AGPLv3 ([engine/LICENSE](../engine/LICENSE)), because it is built on JUCE (section 4).

---

## 1. Scope: a DAW for composing

The goal is to finish a piece without leaving Four Hands: your own instruments (Kontakt, Vital, Serum…), a decent mix and, next, export to audio, composing with your AI. Recording and editing audio are out of scope for now.

| In | Out (for now) |
|---|---|
| Piano roll, arrangement, form, harmony, tempo and key, the AI | Recording audio, editing audio, comping, time-stretch |
| VST3 instruments per track | Video |
| Mixing: a strip per track, insert effects, buses and sends, master, meters | AAX plugins |
| The AI's ears: loudness and spectrum measured per track, bus and master | |
| Next: automation, export to WAV (mix and stems) | |

## 2. Why a separate engine, and not a rewrite

- **What matters most already works in Electron:** the core (song, commands, undo, authorship, proposals, tempo, analysis) with hundreds of tests, the interface and the AI connection.
- **The one thing Electron cannot do is host plugins.** A browser does not load VST3. That piece is solved by a native engine in its own process, without touching the rest.
- **A crash stays in the engine.** If a plugin brings the engine down, the song, the interface and the AI connections stay alive, and the app starts the engine again.
- **The boundary is clear,** so the engine could later be rewritten (for example in Rust) without touching the app.

## 3. How the app and the engine fit together

```
┌──────────────────────── Four Hands (Electron) ────────────────────────┐
│  Song and commands · undo · authorship · proposals · AI (MCP)         │
│  Window: piano roll, arrangement, mixing console (the interface)      │
└───────────────┬──────────────────────────────────────▲────────────────┘
                │ MIDI events ahead of time, transport, │ meters, measurements,
                │ mix and effect chains, plugin loads   │ load, plugin list, errors
┌───────────────▼──────────────────────────────────────┴────────────────┐
│               Four Hands Engine (native program, C++ with JUCE)       │
│  VST3 plugins and their windows · built-in sounds · mixing            │
│  effects · buses · master · analysis · audio output (WASAPI)          │
└────────────────────────────────────────────────────────────────────────┘
```

- **The app starts the engine** when it opens and starts it again if it falls, saying which plugin brought it down. On Windows a crash leaves a dump that the app keeps and logs.
- **They talk over a local connection:** one TCP connection on 127.0.0.1 with JSON messages framed the JUCE way (a 4-byte magic number, a 4-byte size, then the message). The first message must be `hello` with the token the app passed on the command line. Orders and state travel over it, never audio.
- **Plugin windows** (Kontakt's interface, for example) are opened by the engine as the system's own windows.
- **Each plugin's state** (preset, loaded library) is returned by the engine and saved inside the `.fourhands` file, so the song opens with the same sound.
- **Timing:** the window's player sends the notes ahead of time, as it does for MIDI output, and the engine plays them at the exact sample on its own clock. Notes, transport, mixing and panic are handled on the connection's thread, never waiting for a plugin window.
- **The built-in sounds also play in the engine** (SoundFont banks read by TinySoundFont, with voices modelled on SpessaSynth and the GS reverb and chorus), so everything leaves through the same output. Without the engine, the window's own synthesizer plays them ([architecture.md](architecture.md), 7.1).
- **Measuring:** the engine measures every track, bus and the master on a separate thread (LUFS following BS.1770, true peak, range, seven bands and stereo width, second by second with their position in the song). The app reads that with the score for the AI (`analyze_mix`, [mcp.md](mcp.md), 4).

## 4. Why JUCE

| Option | For | Against |
|---|---|---|
| **JUCE (C++)**, chosen | The most used framework for hosting plugins: VST3 on Windows and macOS (and AU on macOS), plugin windows, plugin scanning, audio drivers and mixing pieces. Plenty of documentation and examples | C++: the compiler catches fewer mistakes. Compensated with a small engine, tests, and the engine in its own process |
| **Rust** | Memory safety; the VST3 SDK is MIT since version 3.8 | Plugin hosting libraries were not mature: no VST3 windows yet |
| **Tracktion Engine (on JUCE)** | A whole DAW engine | It brings its own song model, when ours already exists and is what makes Four Hands different |

**Licensing.** JUCE is dual-licensed under the AGPLv3 and a commercial licence. The engine's source in this repository is published under the **AGPLv3**, so anyone can build it with JUCE under the AGPLv3. The rest of Four Hands (the core, the app, the bridge, the MCP tools and the skills) is MIT, and talks to the engine only over its local connection. VST3 hosting uses the VST3 SDK that JUCE includes (MIT). ASIO is off (`JUCE_ASIO=0`); the engine uses WASAPI on Windows.

## 5. Stages

| Stage | What | State |
|---|---|---|
| **S2. Engine test** | A minimal JUCE program: finds the installed VST3 plugins, loads Kontakt, opens its window and plays notes sent by Four Hands | Done |
| **F2.1 Instruments** | Each track chooses a built-in sound or a plugin. Plugin list (the scan keeps a "dead man's pedal" file, so a plugin that crashes the scan is skipped the next time), "Open the instrument's window", state saved in `.fourhands`. Notes, pedal, expression, modulation and tempo. Built-in sounds in the engine too | Done |
| **F2.2 Mixing** | Mixing console: a strip per track (volume, pan, mute, solo, meter), insert effects (VST3 and Four Hands' own EQ, compressor, limiter, reverb and delay), latency compensation, buses and sends, master. The AI's tools for all of it | Done |
| **F2.3 The AI's ears** | Measurement per track, bus and master; `analyze_mix` reads it with the score; a mixing skill | Done |
| **Load** | Measuring where the audio time goes, spreading tracks across cores, never letting audio wait for the app | In progress |
| **F2.4 Automation and export** | Automating plugin and mix parameters; exporting the mix and stems to WAV; freezing tracks | Next |
| Later | macOS (VST3 and AU), audio tracks | — |

## 6. What the AI gains

### 6.1 Plugin parameters

VST3 plugins publish a list of parameters, the same list any DAW automates, each with its name ("Filter 1 Cutoff"), its value and its readable text ("1.2 kHz", "−6 dB"). The engine reads it and the AI gets it through `list_effect_parameters` and changes it with `set_effect`. Every change is an undo step signed by the AI, like the notes.

| Kind of plugin | What it publishes | What the AI can do |
|---|---|---|
| **Synths** (Vital, Serum) | Hundreds of named parameters | Sound design in conversation: "darker", "breathing slower" |
| **Effects** (EQs, compressors, reverbs, limiters) | Nearly everything in their window | Mixing and mastering |
| **Kontakt** | Generic automation slots each instrument may connect | Little through parameters. In orchestral libraries the MIDI rules: dynamics on CC1, expression on CC11, keyswitches for articulations; the library card records which ones a library uses |

**What it cannot touch:** what a plugin keeps inside without publishing it as a parameter (which samples it loads, most modulation routings). That goes in an opaque block the engine saves and restores with the song, but does not read.

**What it cannot do:** hear. That is what the measurements are for.

### 6.2 Mixing four-handed

The AI does not mix with a button that applies a preset. It works the way it composes: it measures, proposes with the data in front of it ("the strings mask the melody between 1 and 3 kHz in bars 17–24; lower them 2 dB?"), changes one thing at a time, lets the user compare with and without, and discusses what the user does not agree with. Because it composed the piece with the user and reads the song's concept, it can also fix the mix from the score: move a part an octave, thin a chord, change who carries the melody.

It works without paid plugins, with Four Hands' own EQ, compressor, limiter, reverb and delay; well-known plugins are the next level.

## 7. What does not change

- The song still lives in the app, and every change is still a command with its undo, its author and its history.
- The interface follows [design.md](design.md).
- MIDI output to another DAW stays: anyone who prefers their DAW can keep using it.
- The `.fourhands` format grows with optional fields: older songs open the same.

## 8. Risks

| Risk | How it shows | Response |
|---|---|---|
| Real-time audio | Dropouts, clicks, latency | The engine does nothing but audio on its audio thread; load is measured per track and stage (`engine_cost` in the log; `--bench`) |
| Plugins that crash or load slowly | The engine falls or freezes | Separate process, automatic restart, a scan that skips the plugin that crashed it, crash dumps on Windows |
| C++ written mostly by an AI | Memory errors that are hard to find | A small engine, automated tests, memory-checking tools |
| Windows only so far | Untested on macOS | Windows first; macOS with testers |

## 9. Building

See [BUILDING.md](../BUILDING.md). In short: CMake 3.22+, a C++20 compiler (Visual Studio Build Tools on Windows) and JUCE 8, fetched by CMake or taken from a local copy (`-DFH_JUCE_DIR=…`). `-DFH_TEST_PLUGIN=ON` also builds a tiny sine-wave VST3 instrument for testing hosting without third-party plugins.
