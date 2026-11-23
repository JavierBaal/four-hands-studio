# Architecture

How Four Hands Studio is built, and why. Code comments cite this document by section (`docs/architecture.md, 6.2`), so the numbering is stable.

Related documents: [mcp.md](mcp.md) (what the AI can see and do), [piano-roll.md](piano-roll.md) (gestures and shortcuts), [design.md](design.md) (visual design), [audio-engine.md](audio-engine.md) (the native audio engine).

---

## Summary

1. **A desktop app built with Electron.** One installer, one window, its own Chromium (Web MIDI and Web Audio behave the same on Windows and macOS) and its own Node. Nothing else to install.
2. **The song lives in the main process, not in the window.** It is the single source of truth: the interface and every AI send it commands through the same command layer, and the window receives the changes and draws them.
3. **A pure TypeScript core** (model, commands, undo, authorship, proposals, compact text format, MIDI and analysis) with no interface, files, network or Electron inside, covered by automated tests. It is the most valuable piece of the code.
4. **Time in ticks at 960 per quarter note.** The deviation from the grid is never stored; it is computed when reading. That is what makes "moving keeps the played feel" free.
5. **Sound from a native audio engine** (C++ with JUCE, in its own process) that hosts VST3 instruments and effects, mixes and measures. The window keeps a SoundFont synthesizer (SpessaSynth in an AudioWorklet) as a fallback.
6. **The AI connects through a local bridge:** a small MCP server (`.mcpb` desktop extension) that Claude Desktop, or any stdio MCP client, starts and that talks to the open app over a local WebSocket with a token. Several AI clients can be connected at once. Answers are compact text only.
7. **No tool composes.** The tools read, write, analyze and transform mechanically. Composing is done by the user and by the user's own AI.

---

## 1. What shapes the architecture

| Requirement | What it forces |
|---|---|
| One source of truth for the interface and the AI | One place where the song lives and one command layer |
| The app works without any AI | The AI is one more client; nothing depends on it being connected |
| Recording from a MIDI keyboard, and playing always sounds | MIDI input on Windows **and** macOS, and low latency to the sound |
| macOS from the start | Nothing that only works on Windows or in one browser |
| An installed app, not a browser tab | Its own window, with no shortcuts taken by a browser |
| The AI's notes appear in under 200 ms | Changes pushed to the interface, not polled |
| Smooth with 16+ tracks and about 5,000 notes | Piano roll and arrangement drawn on canvas, not one element per note |
| No lost work: a few seconds at most | Frequent autosave and atomic file writes |
| A MIDI file goes in and comes out identical | Lossless MIDI import and export, markers included |
| Several AI clients at the same time | The app accepts several bridges and knows who each one is |
| An interface identical to the approved design | Tokens, type (IBM Plex, bundled) and measurements from [design.md](design.md) |
| Code written mostly by an AI | A typed language, a core without side effects and tests that catch mistakes |

### 1.1 Working conditions

The project has been developed and tested **on Windows only**, and without a hardware MIDI keyboard. That shaped several choices:

- **Electron**, which ships the same Chromium on both systems, so what works on Windows has far fewer surprises on macOS than a native web view would. The CI configuration runs the checks on Windows, macOS and Linux.
- **The computer keyboard as a piano** (7.4), so playing and recording work without MIDI hardware.
- **A virtual MIDI keyboard** (for example VMPK with loopMIDI on Windows) reaches the app exactly like a physical one, so the real MIDI path can be tested without hardware; automated tests inject MIDI messages.
- **macOS and hardware MIDI keyboards still need testers.** Reports are very welcome.

## 2. The container: Electron

### 2.1 Options considered

| Option | For | Against |
|---|---|---|
| **A. Browser + a local Node process** | The lightest to program | Users install Node, run a script and install the page as an app. On macOS it requires Chrome, because Safari has no Web MIDI. The browser keeps some shortcuts for itself |
| **B. Electron** | One installer and one window. Same Chromium on Windows and macOS. Node for the song, saving and the bridge connection. Full control of shortcuts, menus and files | A heavy installer (over 100 MB) |
| **C. Tauri** | Lighter | On macOS it uses WebKit, without Web MIDI: MIDI input would have to be read natively from day one |

### 2.2 Choice

**B, Electron.** It removes the browser question on macOS, removes installation steps and gives a window with no stolen shortcuts. The installer size matters less than those. The core (section 4), the interface and the bridge do not depend on Electron, so a move to another shell later remains possible.

## 3. Pieces and processes

```
┌───────────────────────── Four Hands (Electron) ──────────────────────────┐
│                                                                           │
│  Main process (Node)                      Window (Chromium)               │
│  ┌──────────────────────────────┐  IPC   ┌────────────────────────────┐   │
│  │ Core: song + commands        │◄──────►│ Interface (React + canvas) │   │
│  │  · revisions and undo        │commands│  · replica of the song     │   │
│  │  · authorship and history    │changes │  · arrangement, piano roll │   │
│  │  · interventions/proposals   │        │  · mixing console          │   │
│  │  · analysis                  │        │ Fallback synth (AudioWorklet│  │
│  │ Autosave                     │        │  · SpessaSynth + SoundFont)│   │
│  │ WebSocket server 127.0.0.1   │        │ Web MIDI (keyboard)        │   │
│  │  + token, several clients    │        └────────────────────────────┘   │
│  └──────┬───────────────┬───────┘                                          │
└─────────┼───────────────┼──────────────────────────────────────────────────┘
          │ local WebSocket + token          │ local TCP + token
 ┌────────┴─────────────┐          ┌─────────┴──────────────────────────────┐
 │ Bridge (.mcpb, stdio)│          │ Four Hands Engine (C++, JUCE)          │
 │ one per AI client    │          │ VST3 hosting · built-in sounds · mixing │
 └──────────────────────┘          │ effects · buses · meters · audio out    │
                                   └────────────────────────────────────────┘
```

| Piece | Does | Does not |
|---|---|---|
| **Core** (`packages/core`) | Holds the song, applies commands, numbers revisions, undoes, records authorship and history, manages interventions and proposals, translates to the compact format, imports and exports MIDI, analyzes | Any interface, audio, files or network. It can be tested entirely without opening the app |
| **Main process** (`packages/desktop/src/main`) | Hosts the core, saves to disk, serves the window over IPC and the bridges over WebSocket, starts and restarts the audio engine, opens file dialogs, runs "Connect with Claude" | Draw or make sound |
| **Window** (`packages/desktop/src/renderer`) | Draws, takes gestures, reads the MIDI keyboard, schedules playback | Change the song on its own: every change is a command to the main process |
| **Audio engine** (`engine/`) | Hosts VST3 plugins and their windows, plays the built-in sounds, mixes, applies effects, measures | Hold the song or make decisions about it ([audio-engine.md](audio-engine.md)) |
| **Bridge** (`packages/bridge`) | Translates MCP calls into messages for the app | Keep any musical state |

**Why the song lives in the main process:** the AI and the interface reach it as equals, through the same door; if the window reloads or hangs, the song and the AI connections stay alive. The cost is that the interface works with a replica: during a drag it draws a local preview and, on release, sends a single command. The IPC round trip inside the same computer takes well under a millisecond.

## 4. The song model

### 4.1 Data

| Element | Main fields |
|---|---|
| **Song** | title, concept, tempo and tempo changes, meter, key and key changes, current revision, view preferences |
| **Track** | id (`t3`), name, instrument (General MIDI program), sound (built-in bank, user bank or plugin), volume, pan, mute, solo, colour, output bus, sends, insert effects |
| **Note** | id (`n482`), track, pitch (MIDI number), start and duration in ticks, velocity, **author** (`user` or `ai`, and which AI client) |
| **Pedal and curves** | sustain pedal spans; expression (CC11) and modulation (CC1) curves per track |
| **Section** | id (`s2`), name, first and last bar |
| **Harmony** | a chord per bar or per beat (`Am`, `F/A`) |
| **Annotation** | id (`a4`), range, text, author |
| **Buses and master** | buses with their effects, output and colour; the master's effects |
| **Shared context** | selection, loop, cursor, active track, visible bars: they live in the model, not only in the interface, so the AI can read them |
| **History** | signed transactions, user decisions included |
| **Proposals** | pending operations, their state (pending, accepted, discarded, out of date) and the intervention they came from |

### 4.2 Time and deviation

- **960 ticks per quarter note.** It divides exactly into sixteenths (240), eighth-note triplets (320) and sixteenth triplets (160), and MIDI files at 480 per quarter come in without rounding.
- **Ticks never leave the core:** the AI sees `17.3+1/2` and `1/8`; the interface works in pixels.
- **Deviation is not stored.** It is computed when reading, against the nearest nominal grid line (sixteenth or eighth-note triplet, [mcp.md](mcp.md), 3.1). So moving a note by a whole number of grid steps keeps its deviation without doing anything special: the "relative grid" of [piano-roll.md](piano-roll.md), 5.3, for the mouse and the AI alike.

### 4.3 Identifiers

Short and stable, with one counter per kind (`n`, `t`, `s`, `a`, `p`, `i`, `x`, `b`, and `r` for revisions). They are never reused within a song, so "n482 changed" always means the same note.

## 5. The command layer

### 5.1 Commands and transactions

- **Every change is a command:** a function that takes the song and some arguments and returns a list of small operations (create a note, change a field, delete…) and their inverses.
- **A transaction** groups the commands of one user gesture (a drag, a whole recorded take) or one AI intervention. **A transaction is one undo step.**
- **Every transaction raises the revision** (`r1533`) and is sent as a patch to the window and to the bridges that need it.
- **One queue:** commands are applied one at a time, from the interface or from any AI. There are never two writes to the song at once.
- **Undo is linear:** it undoes the last transaction, whoever made it. The history panel can also step back to any point of the session.

### 5.2 Interventions and proposals

- `begin_intervention` opens a transaction on behalf of one AI client, with its base revision.
- **By default, what the AI writes goes straight into the song**, live, and is grouped into one transaction when the intervention ends. The user can listen with and without the last intervention (the With / Without bar, key B) and undo it in one step.
- **In proposal mode** (a setting, off by default), when the intervention ends its changes are lifted out of the song and kept as a proposal, drawn with a dashed outline. Accepting applies it as one step; discarding leaves the song as it was.
- **Conflicts** ([mcp.md](mcp.md), 5.2): every AI operation checks that the notes it touches have not changed since the revision it read. A proposal whose notes the user edits becomes out of date.
- **Automatic close after 5 minutes** without activity, with one timer per intervention in the main process.

### 5.3 Authorship

The authorship rule is applied inside the commands, not in the interface: every command knows who sends it and marks the author accordingly. Changing only the velocity does not change a note's author, and neither does accepting a proposal. The rule is therefore the same for the mouse, the MIDI keyboard and the AI, and it is covered by tests.

## 6. The AI connection

### 6.1 The bridge

The bridge is a stdio process packaged as a `.mcpb` desktop extension. It runs on the Node that Claude Desktop ships, reads the port and token from `bridge.json` in the user's configuration folder, reconnects by itself every few seconds and answers "Four Hands is not open" when the app is closed.

The app's "Connect with Claude" button installs the bridge in Claude Desktop. On Windows it tries, in order: the file association, the `claude-desktop.exe` execution alias, and, as a last resort, copying the path and guiding the user to *Settings > Extensions > Advanced settings > Install extension…*. It never opens a file without an association (that brings up the Windows app picker), and it never writes to Claude Desktop's configuration.

### 6.2 Rules of the connection

| Topic | Rule | Why |
|---|---|---|
| **Several clients** | The app accepts any number of bridges. Each is identified by its MCP `clientInfo` and a readable name; the history signs with that name | Claude Desktop and a linked claude.ai session each start their own bridge |
| **AI status in the interface** | **Connected** (there is a bridge) is shown apart from **working** (an open intervention or a recent call) | Claude Desktop starts its bridge when it opens, even if it is not used |
| **Compact text only** | Answers carry only the compact text, without `structuredContent` | Some clients read the JSON instead of the text: about 2.5 times longer. The compact text is the contract |
| **Version** | The bridge sends its version when it connects; if the app needs another one, every tool answers "Update the connection with Claude from Four Hands" and the app shows the button | The bridge declares its tools when it starts, before it knows which app is on the other side |
| **Shared definitions** | Tool names, descriptions and parameters live in one package (`packages/mcp-tools`) used by the bridge and the app | One description per tool, with the mandatory rules inside it ([mcp.md](mcp.md), 9) |
| **The window does not use the WebSocket** | The window talks to the main process over IPC; the token-protected WebSocket is only for bridges | No other program on the computer can pose as the interface |

### 6.3 Permissions

Claude Desktop asks for permission the first time each tool is used. "Allow always" is remembered per tool, and Claude Desktop groups the tools into **read-only** and **write/delete** according to their `readOnlyHint` annotation, with one "Allow always" per group. So the tools are not merged into fewer, bigger ones; instead:

- The annotations are the permission interface the user sees, and a test checks which tools are read-only.
- Each tool's `title` is short and clear, because the user sees it in Claude's settings.

## 7. Sound and MIDI input

### 7.1 Engine

- **The native audio engine** ([audio-engine.md](audio-engine.md)) plays everything when it is available: VST3 instruments, the built-in SoundFont sounds (TinySoundFont, with voices modelled on SpessaSynth), effects, buses and the master, on WASAPI on Windows.
- **The window keeps a SoundFont synthesizer** (SpessaSynth, Apache-2.0) inside its own AudioWorklet, with a queue of events stamped in samples. It is the fallback when the engine is not there.
- **Scheduling:** the window's player sends the notes of the next ~200 ms ahead; the worklet or the engine plays them at the exact sample. The tempo does not depend on the window being busy drawing.
- **What the AI writes sounds when playback reaches it:** the player reads the song replica at every window, so a new note ahead of the cursor plays by itself.
- **The MIDI keyboard always sounds**, recording or not, playing or stopped. When recording, the main process also receives the take.
- **MIDI output:** any track can send its notes out through a MIDI port instead (for example to a DAW through a virtual port).

### 7.2 Sound banks

| Bank | Licence | Role |
|---|---|---|
| **MuseScore_General** (SF3, ~39 MB) | MIT | The built-in bank: the whole General MIDI palette with one permissive licence |
| **Sonatina Symphonic Orchestra** (SF2) | Creative Commons Sampling Plus 1.0 | Orchestral sections and solo instruments; used by the demo song |
| **YDP Grand Piano** (SF2) | CC-BY 3.0 | Grand piano; used by the demo song |

**User banks:** besides the built-in one, the app plays any SF2 or SF3 the user puts in `Documents/Four Hands/Sonidos`. Each track can use an instrument from any of them (`Track.sound` in the core; the General MIDI program is kept for MIDI export). Banks are loaded only when a track uses them, at their own bank offset; their instruments are read from the file header without loading the samples.

**Plugins:** a track can instead play through a VST3 instrument hosted by the engine (Kontakt, Vital…). Its state is saved inside the `.fourhands` file, so the song opens with the same sound.

### 7.3 Latency

Two measurements: the latency the audio system declares (`baseLatency` + `outputLatency` in the window; the engine's buffer on WASAPI), and the physical one, recording the key press and the sound together and measuring the gap. As a reference: up to about 20 ms is good for playing; 20–30 ms is fine for an editor but noticeable when playing.

### 7.4 The computer keyboard as a piano

- **Turned on and off with a button** in the transport bar (and Ctrl/Cmd + K), with a visible indicator while it is on.
- **Layout:** A S D F G H J K L for the white keys (C to the next D), W E T Y U O P for the black keys; Z and X move an octave down and up, C and V lower and raise the velocity.
- **Physical keys, not letters:** they are read by position (`KeyA`, `KeyW`…), so it works the same on Spanish, English or French keyboards.
- **While it is on,** those letters play notes and their shortcuts pause: G and H stop zooming (zoom still works with Ctrl/Cmd + wheel). Space, R, Q, the arrows, the number keys and every Ctrl/Cmd shortcut keep working.
- **It records exactly like a MIDI keyboard:** same take, same author (the user), not quantized. The velocity is the one chosen with C and V.
- **Technique:** `keydown` and `keyup` by physical code (`event.code`), ignoring key repeat; the notes take the same path as the MIDI keyboard.

## 8. Interface

- **React and TypeScript** for panels, bars, track headers, history and cards.
- **Piano roll, arrangement and rulers drawn on 2D canvas**, in layers (grid, ghost notes, notes, proposal, cursor).
- **A replica of the song** in the window, kept up to date by the main process's patches. New AI notes fade in briefly ([design.md](design.md), 9).
- **The tokens of [design.md](design.md) as CSS variables,** with the same values in the canvas code, from a single file. IBM Plex Sans and Mono are bundled.
- **Shortcuts from one table** ([piano-roll.md](piano-roll.md), 6.4), with Ctrl on Windows and Cmd on macOS resolved in one place.
- **Interface in Spanish and English,** with the texts in language files (`packages/desktop/src/shared/i18n.ts`).
- **No stolen shortcuts:** in Electron the app controls every key, page zoom included.

## 9. Files

- **The `.fourhands` format:** readable JSON with the song, the signed history, the pending proposals and the plugin states. It carries a format version number; newer versions only add optional fields, so older songs keep opening.
- **Autosave** one second after the last change, writing to a temporary file and renaming it, so a crash never leaves a half-written file. Recent backups are kept.
- **Unsaved songs** go to `Documents/Four Hands/` under a provisional name: nothing is lost for not pressing Save.
- **MIDI** with `midi-file` (MIT), which reads and writes events without interpreting them, markers and meta events included. Markers become sections on import.
- **The demo song** travels with the app and is copied into the songs folder the first time the app opens (Help > Open the demo song opens a fresh copy).
- **User skills** live in `Documents/Four Hands/Skills`, and can be imported from a ZIP.

## 10. Installing

| Step | Windows | macOS |
|---|---|---|
| Installer | `.exe`, per user, with the engine, the sound banks and the demo ([BUILDING.md](../BUILDING.md), 4) | Not built yet |
| Unsigned | SmartScreen warning: "More info > Run anyway" | The first opening has to be allowed in System Settings > Privacy & Security |
| Connecting the AI | "Connect with Claude" button | The same button; not tested yet |
| MIDI keyboard | Detected automatically; without one, the computer keyboard | Same |

## 11. Code

### 11.1 Repository

One repository with four TypeScript packages and the native engine:

| Folder | Contents |
|---|---|
| `packages/core` | The core: model, commands, undo, authorship, proposals, compact format, MIDI, analysis. Pure TypeScript |
| `packages/mcp-tools` | The MCP tool definitions, shared by the bridge and the app |
| `packages/bridge` | The `.mcpb` bridge |
| `packages/desktop` | The Electron app: main process, window, audio |
| `engine` | The native audio engine (C++, JUCE) |
| `skills` | The skills the app serves to the AI |

The repository needs **Node 24** (npm 11); with npm 10 the install fails because of an npm bug. Continuous integration (`.github/workflows/ci.yml`) runs `npm run check` and builds the bridge on Windows, macOS and Linux.

### 11.2 Automated tests

- **Core:** tests for every command, the authorship rule, deviation when moving, conflicts and proposals, and the MIDI round trip of `Dilatacion.mid`.
- **MCP tools:** a simulated MCP client walks the main user journeys against the core, without the interface.
- **End to end:** Playwright drives the real Electron app (`npm run arranque`, `npm run puente`, `npm run interaccion`), including a real MCP client talking to the packed bridge.

### 11.3 Tools

TypeScript, React, esbuild, Vitest, Playwright, Electron and `@anthropic-ai/mcpb`, plus CMake and JUCE for the engine. Licences are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## 12. How it was built

| Milestone | Contents |
|---|---|
| **S0. Sound and latency test** | A minimal Electron app with SpessaSynth in an AudioWorklet, the computer keyboard as a piano and Web MIDI |
| **S1. Permissions test** | A test bridge to learn how Claude Desktop asks for tool permissions |
| **H1. Core** | Model, commands, undo, authorship, MIDI, `.fourhands`, compact format. Closed when `Dilatacion.mid` went in and out identical |
| **H2. Editing** | Arrangement, piano roll, transport, sound, recording and autosave, with the visual design |
| **H3. The AI's hand** | The complete bridge, reading and writing tools, shared context, several clients |
| **H4. Collaboration** | Interventions, signed history, With / Without, proposal mode, analysis, skills, tempo and key changes, expression curves, MIDI output |
| **S2 → F2.3. Phase 2** | The native engine: VST3 instruments, mixing console, insert effects, buses and sends, and the AI's ears (loudness and spectrum measured per track) ([audio-engine.md](audio-engine.md)) |
| **Installer** | A per-user Windows installer with the engine, the sound banks and the demo, built on CI (version 0.1.0) |
| **Next** | Automation and audio export (F2.4), a signed installer, macOS |

## 13. Risks

| Risk | Response |
|---|---|
| Keyboard latency too high | Measure on each system; the engine's audio path is native |
| A plugin crashes or hangs | The engine runs in its own process; the app restarts it and says which plugin brought it down |
| Claude Desktop changes the extension or permission model | The bridge is small and isolated; the installation test is repeated with each version |
| macOS untested | CI on macOS; testers with a Mac |
| Recording from a MIDI keyboard untested with hardware | Virtual MIDI keyboard day to day, automated MIDI tests, testers with keyboards |

## 14. Phase 2

Phase 2 does **not** rewrite the app. Electron and the core stay; a **native audio engine in C++ with JUCE**, in a separate process, hosts VST3 plugins, mixes, measures and (next) exports. The goal is a DAW for composing, without audio recording or audio editing for now. See [audio-engine.md](audio-engine.md).

## 15. Key decisions

| # | Decision | Discarded alternative |
|---|---|---|
| 1 | **Electron** | Browser + Node (Chrome required on macOS, more steps); Tauri (no Web MIDI on macOS) |
| 2 | **The song in the main process**, with the window as a client | The song in the window (the AI would depend on the interface) |
| 3 | **A pure, tested TypeScript core** | Logic spread between interface and server |
| 4 | **960 ticks per quarter; deviation computed, not stored** | Storing the deviation (two truths that can contradict each other) |
| 5 | **A native engine for audio** (JUCE), with SpessaSynth as fallback in the window | Audio only in the browser (no plugins); rewriting the app natively |
| 6 | **Several AI clients**, "connected" and "working" states, **compact text only**, bridge version control | One client; JSON answers |
| 7 | **Tools stay separate;** permissions are grouped by Claude Desktop through annotations | Merging tools to reduce permission prompts |
| 8 | **The computer keyboard as a piano** | Depending on a MIDI keyboard |
| 9 | **No tool composes** | "Smart" variation or harmonization tools inside the app |

## Sources

- [SpessaSynth core (Apache-2.0)](https://github.com/spessasus/spessasynth_core)
- [MuseScore: SoundFonts (MuseScore_General, MIT)](https://musescore.org/en/handbook/soundfonts)
- [WebKit bug 107250: Web MIDI not implemented in Safari](https://bugs.webkit.org/show_bug.cgi?id=107250)
- [Claude: building a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb.md)
