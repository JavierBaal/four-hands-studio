# The MCP interface

What the AI can see and do inside Four Hands Studio: how it connects, the musical language it speaks with the app, its tools and the rules they follow. Code comments cite this document by section (`docs/mcp.md, 5.2`), so the numbering is stable.

The tool definitions themselves (names, descriptions, parameters and annotations) live in [`packages/mcp-tools/src/index.ts`](../packages/mcp-tools/src/index.ts); that file is the source of truth, and this document explains it.

---

## Summary

1. **A local bridge.** Claude Desktop (or any MCP client that supports stdio) starts a small process, the bridge, and the bridge talks to the app already open on the same computer. A local stdio server is what desktop clients accept without extra software, and a remote connector could not reach the user's computer.
2. **Everything the AI needs to read is a tool.** Not every client lets the model read MCP resources by itself.
3. **A compact text format** for notes, readable for a language model and cheap in context: pitch by name, position in bar and beat, duration in note values, and the played deviation only when there is one.
4. **Every AI intervention is explicit:** it begins, writes and ends. What it does in between becomes one undo step. MCP has no sessions, so the intervention is identified by an id the AI carries from one call to the next.
5. **No tool composes.** The tools read, write, analyze and transform mechanically. Composing is done by the user's own AI, never by the app.

---

## 1. Principles

1. **The AI sees what the user sees, and more:** the song, the shared context, the selection, recent changes, analysis and measurements.
2. **Musical language, not MIDI:** no note numbers or ticks on the surface.
3. **Read before writing:** every write starts from a known revision of the song.
4. **The same rules as the mouse** ([piano-roll.md](piano-roll.md)): moving keeps each note's deviation; quantizing is an explicit decision.
5. **The AI never moves the user's view, selection or playback.** To show something, it points.
6. **Cheap in context:** summaries and reading by ranges before dumping the whole song.
7. **Errors in musical language** that the AI can correct by itself ("bar 90 does not exist: the song has 52").

## 2. Connection

```
┌──────────────────┐   stdio    ┌──────────────────┐  local WebSocket  ┌─────────────────────────┐
│  Claude Desktop  │ ─────────► │ MCP bridge       │ ────────────────► │ Four Hands (app)        │
│  (or another MCP │            │ "fourhands-mcp"  │   127.0.0.1       │ · song model            │
│   client)        │ ◄───────── │ (Node process)   │ ◄──────────────── │ · command layer         │
└──────────────────┘            └──────────────────┘   + token         │ · interface             │
                                                                       └─────────────────────────┘
```

| Piece | What it does |
|---|---|
| **App** | Holds the song model and the command layer. The interface and the MCP tools go through the same layer (single source of truth). Listens on 127.0.0.1 only |
| **Bridge** | A minimal MCP server that the client starts over stdio. It turns each MCP call into a message for the app and returns the answer. It keeps no musical state |
| **Token** | The app creates a token when it starts and writes it, with the port, to `bridge.json` in the user's configuration folder. The bridge reads it, so no other program on the computer can write to the song |

**If the app is not open,** every tool answers with a clear error: "Four Hands is not open. Open it and try again."

**Installation.** The bridge is distributed as a desktop extension (`.mcpb`) that travels inside the app. The app's "Connect with Claude" button installs it ([architecture.md](architecture.md), 6.1); it can also be installed from Claude Desktop's *Settings > Extensions*. Claude Desktop ships its own Node, so nothing else is needed.

**Other clients.** Any MCP client that runs local stdio servers can use the same bridge: point it at the bridge's `server/index.mjs` with Node.

**claude.ai linked to the computer.** When a claude.ai session is linked to the computer through the desktop app, the local extensions reach that session too: the user can talk to their AI from the browser while the score is open on their computer. That session starts its own bridge, which is one reason the app accepts several AI clients at once.

**Permissions.** Claude Desktop asks for permission the first time each tool is used, and groups the tools into read-only and write/delete by their `readOnlyHint` annotation ([architecture.md](architecture.md), 6.3). Every tool is marked read-only, write or destructive.

## 3. Musical representation

### 3.1 Elements

| Element | Format | Examples |
|---|---|---|
| **Pitch** | Scientific name, middle C = C4. Sharps and flats accepted; the app spells them for the key | `C4`, `Eb5`, `F#3` |
| **Position** | `bar.beat`, plus a fraction of a beat when needed. The beat is the meter's denominator (a quarter in 4/4, an eighth in 6/8) | `17.1`, `17.3+1/2` (an eighth after beat 3), `17.2+1/3` (second note of a triplet) |
| **Duration** | A fraction of a whole note; `.` dotted, `t` triplet, `+` tie | `1/4`, `1/8.`, `1/8t`, `1/2+1/8` |
| **Velocity** | `v` and a number from 1 to 127 | `v72` |
| **Author** | `@u` (user) or `@ai` | `@u` |
| **Deviation** | Only if the note is off the nominal grid (the nearest sixteenth or eighth-note triplet). `~s` for the start and `~d` for the duration, in beats with two decimals; positive is late or longer | `~s+0.03`, `~s-0.02 ~d+0.05` |
| **Identifiers** | Short and stable: `n` note, `t` track, `s` section, `a` annotation, `i` intervention, `p` proposal, `x` effect, `b` bus, `r` revision | `n482`, `t3`, `i12`, `r1532` |

### 3.2 Ranges and targets

- Bars: `17-24`, or with beats: `17.3-18.2`.
- Shared-context shortcuts: `selection`, `loop`, `section:Chorus`, `all`.
- Tracks by id or by name: `t3`, `Violins`.

### 3.3 Reading format (compact text)

One line per note, grouped by track and bar, with the harmony at the head of each bar:

```
Four Hands · r1532 · Violins (t3) · bars 17–18
b17 · Am
n482 E5 17.1 1/4 v72 @u
n483 D5 17.2 1/8 v65 @u ~s+0.03
n484 C5 17.2+1/2 1/8 v63 @u ~s-0.02 ~d+0.04
n485 B4 17.3 1/2 v70 @ai
b18 · F
n486 A4 18.1 1/1 v68 @u
```

Answers carry this text only, with no `structuredContent` ([architecture.md](architecture.md), 6.2).

### 3.4 Writing format

The same lines, without id or author (the app sets the author):

```
E5 17.1 1/4 v72
D5 17.2 1/8 v65 ~s+0.03
```

If a line is ambiguous or cannot be read, the tool rejects the whole call and explains why (section 11). It never writes half.

## 4. Reading

All read-only; none needs an intervention.

| Tool | Returns |
|---|---|
| `get_song_overview` | Title, concept, tempo, meter, key, length, form (sections with bars), tracks (instrument, sound, range, note count, share of each author, mix), harmony, annotations, revision. Small on purpose: it is the first thing the AI reads |
| `get_user_context` | Selection, loop, cursor, active track, visible bars, view preferences (note names, middle C octave), how the user wants the AI to work (straight into the song or as proposals; opinions direct or with tact) and whether the user changed something since the AI's last call. It is what makes "this" and "here" work |
| `read_notes` | The notes of a range and some tracks in the format of 3.3, with expression curves. Paged, about 800 notes per call |
| `summarize` | By section (or blocks of 8 bars) and track: note density, range and where most notes sit, usual rhythm and how much falls on the beat, the top line's contour, velocity and author, and the written chords |
| `analyze` | The AI's substitute for ears: findings with their place and their notes. Shape (notes per bar, tracks and loudness by section), then intervals too close in the bass, too many notes below C3, four or more parts in one octave, identical repetitions, formula dynamics, abrupt cuts at a bar line, out of range, out of key, long notes outside the chord, and the song's length and tempo against its concept. Describes, never judges |
| `get_changes_since` | What changed since the AI's last call or since a revision: the signed history in between and the differences by kind (notes per track, harmony, form, tempo, meter, key, concept, tracks and mix, annotations) |
| `get_history` | The signed history, newest first |
| `list_instruments` | The sounds a track can use: the built-in palette with each instrument's real range and how each sound behaves (attack, whether it sustains, release), the user's banks, and the plugin instruments the engine hosts |
| `get_levels` | The levels each track and bus reached in the last playback, measured in the engine after its fader |
| `analyze_mix` | What the last playback sounded like, read together with the score: loudness towards a destination (LUFS), true peak, tonal balance, stereo width, sections, and which parts mask each other in which bars |
| `list_effect_parameters` | An effect's parameters and current values: Four Hands' own effects with their ranges, or a plugin's own list from the engine |
| `list_skills` | Name, description and origin (built-in or the user's) of the active skills. Cheap: metadata only |
| `load_skill` | A skill's instructions and its list of reference files; with `file`, one reference |

## 5. Interventions and proposals

### 5.1 The life of an intervention

1. **`begin_intervention(description)`** returns an id (`i12`). The description is what the user sees in the history ("Reharmonize the chorus, bars 17–20"), written in the user's language.
2. **Write tools** with that id. Every change appears live on the user's screen, in the AI's colour.
3. **`end_intervention(intervention_id)`** closes it. Everything written becomes **one undo step**. In proposal mode, it is lifted out of the song and kept as a proposal for the user to accept or discard.

**Automatic close:** an intervention with no activity for **5 minutes** closes by itself. Every call resets the timer, so a long section with the AI thinking between calls is not split in two.

**The user sees it and can close it:** while an intervention is open, the app shows "Claude is writing: …" and the user can close it themselves.

### 5.2 Conflicts with the user

The user can keep editing while the AI works.

- **When writing:** if the AI tries to change a note the user changed after the revision the AI read, the tool refuses and says what changed ("n482 is now F5 at 17.2; read again").
- **With a pending proposal:** if the user edits notes the proposal would change, the proposal becomes out of date and can only be discarded.

### 5.3 Accepting and discarding

Only the user accepts or discards a proposal, in the app. There is no tool for it.

## 6. Writing

All need `intervention_id`.

**Notes and performance**

| Tool | What it does |
|---|---|
| `add_notes` | Adds notes to a track (format of 3.4). Returns their ids |
| `edit_notes` | Changes only the given fields of some notes; the rest, deviation included, stays |
| `repitch_notes` | Changes only the pitches and keeps rhythm, duration, velocity and deviation: "your rhythm, its pitches" |
| `move_notes` | Shifts notes in time (`+1 bar`, `-2 beats`) and/or pitch (semitones, or scale degrees to transpose within the key). **Keeps each note's deviation** |
| `copy_notes` | Copies notes as they are to another place or track |
| `delete_notes` | Deletes notes by id or by range and track (destructive) |
| `quantize_notes` | Pulls notes towards a grid with a strength from 0 to 100 %, start only or start and end. Only when the user asks or clearly wants it |
| `shape_velocities` | Sets velocities: one value, a crescendo or diminuendo between two, or an accent every so many beats |
| `write_pedal` | Writes sustain pedal spans |
| `write_expression` | Writes expression (CC11) or modulation (CC1) curves: ramps, levels or clearing, one range per line |

**Form, harmony and song**

| Tool | What it does |
|---|---|
| `set_harmony` | Writes or changes chord symbols per bar or per beat (`Am`, `F/A`, `E7sus4`) |
| `set_sections` | Creates, renames, moves or removes sections of the form |
| `set_song_properties` | Title, concept, and the tempo, meter and key at the start. The concept (intention and limits) is the second line of `get_song_overview`, and `analyze` checks the music against it |
| `set_tempo_changes` | The tempo changes after the start: jumps, `rit.` and `accel.` ramps and fermatas. Answers with the new length of the music |
| `set_key_changes` | The key changes, each from a bar line on. Note names, degrees in `move_notes` and `analyze` follow the key at each moment |
| `annotate` | Leaves a short text annotation over some bars |
| `remove_annotations` | Removes the AI's own annotations that no longer describe the music (destructive) |

**Tracks and mix**

| Tool | What it does |
|---|---|
| `add_track` / `update_track` | Creates a track, or changes its name, instrument, sound (built-in, a user bank or `plugin / <name>`), volume, pan, mute or colour |
| `move_track` | Reorders a track |
| `remove_track` | Removes a track and its notes (destructive; only when the user asks or agrees) |
| `set_mix` | Volume, pan, mute, output and sends of several tracks and buses, and the master volume, in one step |
| `add_bus` / `remove_bus` | Creates a bus (a channel with its own effects, fader and output) or removes one; what went through it goes on to where the bus went |
| `add_effect` / `set_effect` / `move_effect` / `remove_effect` | Insert effects on a track, bus or the master: Four Hands' own (EQ, compressor, limiter, reverb, delay) or plugin effects, with their parameters |
| `set_library_card` | Fills the library card of a plugin track: what the sample library responds to (velocity, CC11, CC1), its range and keyswitches. The card lives in the user's catalog and serves every song |

## 7. Without an intervention

| Tool | What it does |
|---|---|
| `point_to` | Points the user to a place (range, tracks, notes) with a short reason. A mark appears on their screen; if they click it, the app takes them there. It changes nothing and does not move the view |
| `export_audio` | Writes the mix of the song or its loop to WAV, MP3 or both in the user's Exportaciones folder, rendered offline in the engine, as File › Export audio does (docs/audio-engine.md, 10). Answers where the files are and their loudness and true peak. It changes nothing in the song, never overwrites a file and never normalises |

## 8. What is missing on purpose

- **No tool composes, harmonizes, varies or orchestrates by itself.** A variation is written by the user's AI: it reads the section, thinks and writes. A "make a variation" tool would be a generator inside the app.
- **What there is are mechanical, deterministic transformations** (move, transpose within the scale, quantize, copy, shape velocities) that always do the same thing with the same input.
- **No tools to accept or discard proposals,** or to move the view, the selection or playback.

## 9. Server instructions

The MCP server sends general instructions that the client gives to the model. Not every client uses them, so everything essential is repeated in the description of each tool it affects: interventions, the revision read, keeping the deviation and never moving the view. The current text is `SERVER_INSTRUCTIONS` in [`packages/mcp-tools/src/index.ts`](../packages/mcp-tools/src/index.ts). In short, it asks the AI to:

- start each turn with `get_user_context` (and `get_changes_since` when the user changed something), and `get_song_overview` the first time;
- load the `four-hands-basics` skill by name at the start of every conversation, then the skills that fit the request;
- write inside interventions with short descriptions in the user's language;
- respect what the user played, and quantize only when asked;
- never move the user's view; point instead;
- talk to the user with their note-name and octave convention, although the tools always use scientific pitch;
- use `analyze` as its ears before handing back;
- **give honest opinions:** every opinion comes from the score, the good with the same evidence as the bad, never giving in just because the user insists, never praising its own work. The user can choose the tone ("direct" or "with tact"), never the honesty.

The tool names and the instructions are in English, the language models work best with; the AI talks to the user in the user's language.

## 10. MCP prompts

Optional shortcuts the user can pick in their client, if the client shows them. They are not modes.

| Prompt | What for |
|---|---|
| `compose_from_feelings` | Describe what you want to convey and the AI proposes it in notes, explaining its choices |
| `review_my_harmony` | The AI reads the harmony of your selection and talks through options, without writing until you ask |
| `continue_my_idea` | The AI continues the selected phrase, respecting its style |
| `call_the_jury` | Three judges (craft, brief, destination) assess the piece with scores, a verdict and the three changes that matter most. Nothing changes unless you ask |

## 11. Errors

Execution errors come back as results with `isError`, in musical language and with the way out in sight. They are written in English for the AI, which talks to the user in their language.

| Situation | Example |
|---|---|
| App closed | "Four Hands is not open. Open it and try again." |
| Range that does not exist | "Bar 90 does not exist: the song has 52 bars." |
| A badly written line | "Line 3: 'E#9' is outside the MIDI range. Nothing was written." |
| A note the user changed | "n482 changed since r1532 (now F5 at 17.2). Read it again with read_notes." |
| Closed intervention | "Intervention i12 was closed after 5 minutes without activity. Start another with begin_intervention." |
| Outside the instrument's range | Not an error: it is written, and `analyze` reports it |

## 12. Context budget

Measured with *Dilatación* (6 tracks, 52 bars, 1,024 notes): the whole song in the compact format takes about 33,000 characters, roughly 10,000 tokens, ids and deviations included. Reading it whole is affordable; longer songs are better read by ranges.

- `get_song_overview` and `get_user_context` together should fit in about 2,000 words for a normal song.
- `read_notes` returns at most about 800 notes per call and says how to ask for the next page.
- The deviation only appears when it exists: a part drawn with the mouse does not pay for it.
- For long songs, the AI works with `summarize` and reads in detail only what it is going to touch.

## 13. Design decisions

| # | Decision | Discarded alternative |
|---|---|---|
| 1 | **A stdio bridge** distributed as a desktop extension, talking to the app over a local WebSocket with a token | A local HTTP server behind `mcp-remote` (more steps); a remote connector (cannot reach localhost) |
| 2 | **Everything needed is read with tools** | Relying on resources, which not every client lets the model read |
| 3 | **Compact text with the deviation only when it exists** | JSON: about 100 characters per note against about 27 |
| 4 | **Explicit interventions** with an id and an automatic close after 5 minutes (the user can close them too) | Grouping by time without the AI knowing (a turn's end is invisible: the conversation happens in another app) |
| 5 | **No tool composes;** only mechanical transformations | "Smart" variation or harmonization tools in the server |
| 6 | **Tool names and instructions in English;** the AI speaks the user's language | Names in Spanish (worse for other models and other users) |
| 7 | **Skills served with `list_skills` and `load_skill`** | Waiting for clients to support an official skills extension |
| 8 | **Mandatory rules in the tools and the instructions, not in a skill** | Rules only in a skill the AI might not load |

## 14. Verified behaviour

Checked with Claude Desktop on Windows:

- Personal plans can install the `.mcpb`; with the "Connect with Claude" button it takes two clicks and no restart.
- The Microsoft Store version of Claude Desktop does not associate `.mcpb` files; passing the file to the `claude-desktop.exe` alias works.
- "Allow always" is remembered per tool and can be given per group (read-only, write/delete).
- The tools appear in a claude.ai session linked to the computer.
- Claude Desktop identifies itself as `claude-ai`; a linked session as `local-agent-mode-<extension name>`.

Still to verify: installing with the button on macOS (`open -a Claude` with the file), and how long a composing session lasts on a free Claude plan.

## 15. Later

- **An official MCP skills extension:** serve the same skills as resources to clients that support it.
- **MCP Apps:** show a fragment of the piano roll with a proposal inside the conversation.
- **A local Streamable HTTP endpoint** for clients that prefer it.
- **Keyswitch writing** for orchestral libraries, and automation of plugin parameters.

## Sources

- [MCP specification](https://modelcontextprotocol.io/specification/latest)
- [Claude: local MCP servers and desktop extensions in Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
