# Piano roll specification

How the piano roll behaves: tools, mouse gestures, keyboard shortcuts, velocity, recording and how it relates to the AI. Code comments cite this document by section (`docs/piano-roll.md, 5.3`), so the numbering is stable.

Behaviour is based on what Cubase, Logic and Studio One have in common, the DAWs composers already know, taken from their public manuals and observable use. The look and the implementation are Four Hands' own.

**Origin marks:**
- **[common]** the three DAWs agree.
- **[majority]** two of the three agree.
- **[decided]** the DAWs clash, and this is the choice made for Four Hands.
- **[ours]** our own choice where the DAWs disagree or the behaviour is not documented. Every shortcut can be changed (6.4).

---

## 1. Principles

1. **The piano roll is, above all, an editor of what was played.** Composers play on a MIDI keyboard and then correct. Nothing the mouse does should spoil a performance unless the user asks.
2. **The frequent things, without changing tools.** With the arrow, the default tool, you create, select, move, lengthen, copy and delete.
3. **Right-click never deletes.** It opens a menu.
4. **Everything can be undone**, and each gesture is one undo step.
5. **The same gestures on Windows and macOS**, with the equivalences of section 9.

## 2. Concepts

| Concept | Definition |
|---|---|
| **Note** | Pitch, start, duration, velocity, author (who decided its pitch, position and duration) and deviation from the grid |
| **Deviation** | How far the start and end of a played note sit from the nearest grid line. It is kept when moving (5.3) |
| **Grid** | A value (whole note to sixteenth, with quarter, eighth and sixteenth triplets), on or off |
| **Selection** | A set of notes of the active track, or a range of bars. It lives in the shared model: the AI reads it |
| **Active track** | The only one edited in the piano roll. The others show as ghost notes |
| **Cursor** | The playback position. It lives in the shared model |

## 3. Tools

| Tool | Default key | For |
|---|---|---|
| **Arrow** | 1 | The default tool. All the frequent things (section 4) |
| **Pencil** | 2, or hold Ctrl/Cmd with the arrow | Creating several notes in a row, one click each |
| **Eraser** | 3 | Deleting several notes in one gesture |
| **Zoom** | 4 | Zooming into one area: click zooms in one step in time and rows around the point; Alt + click zooms out; dragging a rectangle frames it (its time fills the width and its notes fit at the largest comfortable row height, up to 24 px). In the arrangement, time only |

Keys 1, 2 and 3: **[ours]**. Temporary pencil by holding Ctrl/Cmd: **[majority]** (Studio One and Logic).

The mouse cursor changes with each tool and while Ctrl/Cmd is held, so there is never any doubt about what the next click will do.

## 4. Mouse with the arrow

| Gesture | Result | Origin |
|---|---|---|
| Click a note | Selects it (replacing the selection) and the note sounds | [common] |
| Shift + click a note | Adds it to the selection or removes it | [common] |
| Click empty space | Clears the selection. Creates nothing | [decided] |
| Drag in empty space | Selection rectangle. With Shift, adds to the selection | [common] |
| **Double-click empty space** | **Creates a note:** it starts on the previous grid line (if the grid is on), lasts one grid value, sounds and stays selected | [majority] Cubase and Studio One |
| Double-click a note | Selects it. Nothing destructive | [decided] |
| Drag a note | Moves the note, or the whole selection if the note was selected, in time and pitch (5.3) | [common] |
| Shift while dragging | Limits the movement to the direction of the first move (time only or pitch only) | [decided] |
| Alt/Option + drag | Copies instead of moving | [common] |
| Drag the right edge | Changes the duration | [common] |
| Drag the left edge | Changes the start and keeps the end | [common] |
| Right-click | Context menu (4.1) | [decided] |
| Hold Ctrl/Cmd | The arrow becomes the pencil while held | [majority] |
| Double-click a ghost note | Makes that note's track the active one | [ours] |

**Grab zones.** A note's edge is grabbed in a 6-pixel band on each side. If the note is shorter than 18 pixels on screen, only the right edge can be grabbed and the rest of the note moves it. The cursor changes over the edges.

**Drag threshold.** A gesture does not count as a drag until the mouse moves more than 3 pixels, so a click with a shaky hand does not move notes.

### 4.1 Context menu

Opened with right-click, Control-click on macOS and two-finger click on a trackpad. It never deletes on opening.

- **At the top, the tools:** arrow, pencil and eraser.
- **Below, actions on the selection** (or on the note under the mouse if nothing is selected): cut, copy, paste, duplicate, delete, quantize, transpose an octave up or down, select all notes of this pitch.

Tools and actions in the same menu serve all three audiences: in Cubase right-click gives tools, in Studio One actions, and in Logic it is a choice **[decided]**.

## 5. Pencil, eraser and movement rules

### 5.1 Pencil

| Gesture | Result | Origin |
|---|---|---|
| Click empty space | Creates a note one grid value long | [common] |
| Click and drag right | Creates a note and sets its length (in grid steps if the grid is on) | [common] |
| Click a note | Selects it and lets you move it | [decided] |

### 5.2 Eraser

| Gesture | Result | Origin |
|---|---|---|
| Click a note | Deletes it | [common] |
| Click a selected note | Deletes the whole selection | Logic |
| Drag over several notes | Deletes the ones it touches | Studio One |

### 5.3 The grid when moving, creating and lengthening

- **When moving, the grid is relative.** What snaps to the grid is the displacement, not each note: each note keeps its deviation. Moving a phrase played with rubato by one bar leaves it just as alive **[decided]** (Studio One behaves this way too).
- **When creating, the grid is absolute:** a new note starts on a grid line.
- **When lengthening or shortening, the grid is absolute:** the dragged edge lands on a grid line. It is an explicit correction gesture.
- **With the grid off,** everything moves freely.
- **Bypassing the grid in the middle of a drag** is not implemented; the grid is turned on and off with its key (N).

## 6. Keyboard

### 6.1 Editing

| Shortcut (Windows / macOS) | Action | Origin |
|---|---|---|
| Delete or Backspace | Deletes the selection | [common] |
| Ctrl/Cmd + Z | Undo | [common] |
| Ctrl + Y or Ctrl/Cmd + Shift + Z | Redo | [common] |
| Ctrl/Cmd + C, X, V | Copy, cut, paste. Pastes at the cursor and at the same pitch | [common]; paste position as in Logic |
| Ctrl/Cmd + A | Selects every note of the active track | [common] |
| Ctrl/Cmd + D | Duplicates the selection right after itself | [ours] (each DAW uses a different key) |
| Q | Quantizes the selection with the current settings | [common] |
| Up / Down arrow | Transposes the selection a semitone | Cubase |
| Shift + Up / Down arrow | Transposes an octave | Cubase |
| Left / Right arrow | Selects the previous / next note | Cubase |
| Alt/Option + Left / Right arrow | Moves the selection one grid step, keeping the deviation | [ours] |
| Esc | Cancels the drag in progress or clears the selection | [ours] |

### 6.2 View and transport

| Shortcut | Action | Origin |
|---|---|---|
| Space | Play / stop | [common] |
| N | Grid on / off | Studio One [ours] |
| G / H | Horizontal zoom: out / in | Cubase [ours] |
| Shift + G / H | Vertical zoom: lower / taller rows, in steps of 12, 15, 18, 21 and 24 px (15 by default) | [ours] |
| Alt + wheel | Vertical zoom in steps, around the note under the mouse | Studio One |
| Ctrl/Cmd + S | Save now (the song saves itself a second after each change; if it still has a provisional name, opens "Save as") | [common] |
| Ctrl/Cmd + E | Export audio (WAV and MP3). Export MIDI is Ctrl/Cmd + Shift + E | [ours] |
| Wheel | Vertical scroll | [common] |
| Shift + wheel | Horizontal scroll | [ours] |
| Ctrl/Cmd + wheel, or pinch on a trackpad | Horizontal zoom centred on the mouse | [ours] |
| 1, 2, 3, 4 | Arrow, pencil, eraser, zoom | [ours] |
| Over the arrangement: Ctrl/Cmd + wheel, Shift + wheel | Zoom the arrangement's time and scroll it when zoomed | [ours] |
| F2 / F3 | Editor / mixing console | [ours] |
| F4 / F5 / F6 | Side panel: Track / Sounds / AI (or fold it if it already shows that tab) | [ours] |
| B | With / Without the AI's last intervention | [ours] |

### 6.3 Why G/H and not Ctrl + "+" / "−"

In a browser, Ctrl + "+" and Ctrl + "−" change the zoom of the whole page. Letters avoid that clash, and they are what Cubase users already know.

### 6.4 Changeable shortcuts

All shortcuts live in a single table in the code (`packages/desktop/src/renderer/shortcuts.ts`), so they can be changed. A screen to edit them, and "Cubase style" and "Logic style" sets, are planned.

## 7. Velocity, pedal and curves

- **Velocity lane** under the piano roll: one bar per note.
  - Dragging a bar changes its velocity.
  - Dragging across the lane draws a line that changes every bar it crosses.
  - If notes are selected, only those change.
- **On the note:** its brightness reflects the velocity ([design.md](design.md), 5).
- **Velocity of new notes:** that of the last note created or edited by hand; 80 at the start.
- **Pedal lane** (CC64), in a tab next to velocity: the pencil draws spans of pedal down and up; the arrow moves their edges.
- **Expression (CC11) and modulation (CC1) lanes**, in tabs next to velocity and pedal:
  - **Pencil:** draws freehand, leaving one point per grid step (a thirty-second with the grid off); each value holds until the next. **Shift:** a straight line from where the stroke began. **Eraser:** deletes the curve it touches. A stroke is one undo step.
  - **Right-click:** "Clear the curve in the loop" and "Clear the whole curve of the track".
  - Without a curve, a track plays with expression 127 and modulation 0 (General MIDI). Curves have no author, like the pedal.

## 8. Recording from a MIDI keyboard

- **Record** on the active track with a button and with the R key **[ours]**.
- **Metronome** and **count-in bars** (1 or 2) before starting.
- **Not quantized while recording.** Quantizing is always a later decision (Q).
- **What is recorded is added** to what the track already has; the whole take is undone in one step.
- **The author of what is recorded is the user.**
- **Playing the keyboard always sounds,** recording or not, playing or stopped.
- **The keyboard's sustain pedal** is recorded in the pedal lane.

### 8.1 Quantizing

- **Settings:** grid value, start only or start and end, and **strength** from 0 to 100 %.
- **Strength pulls towards the grid without snapping completely,** to correct without killing the expression. The app remembers the last value; 100 % at the start.

### 8.2 The computer keyboard as a piano

For playing and recording without a MIDI keyboard. Technical detail in [architecture.md](architecture.md), 7.4.

- **Turned on and off** with a button in the transport bar and with **Ctrl/Cmd + K** (as Logic's musical typing). While it is on, an indicator makes it clear. It is a mode, but explicit and always in sight.
- **Layout:** A S D F G H J K L for the white keys (C to the next D), W E T Y U O P for the black keys. Z and X move an octave down and up; C and V lower and raise the velocity. The indicator shows the octave and the velocity.
- **Physical keys, not letters:** read by position, so it works the same on Spanish, English or French keyboards.
- **While it is on,** those letters play notes and their shortcuts pause: G and H stop zooming (it still works with Ctrl/Cmd + wheel). Space, R, Q, the arrows, 1, 2 and 3, Delete and every Ctrl/Cmd shortcut keep working.
- **It plays and records exactly like a MIDI keyboard** (section 8). The velocity is fixed, the one chosen with C and V; it is touched up later in the velocity lane.
- **Holding a key sustains the note** until it is released; the system's key repeat is ignored.

## 9. Windows and macOS

| Windows | macOS |
|---|---|
| Ctrl | Cmd |
| Alt | Option |
| Right-click | Right-click, Control-click or two-finger click on a trackpad |
| Delete and Backspace | The "delete" key (sends Backspace), and Delete if there is one |
| Wheel with Ctrl | Wheel with Cmd, or pinch on a trackpad |

On macOS, **Control-click is right-click**, so the temporary pencil is always Cmd, never Control.

## 10. What sounds

- Creating a note (double-click or pencil): it sounds.
- Clicking a note: it sounds. Can be turned off ("sound on select").
- Dragging in pitch: the grabbed note sounds each time it changes semitone.
- Selection rectangle: no sound.
- The side keyboard: sounds when a key is pressed.
- **What the AI writes does not sound when it appears;** it sounds when playback reaches it, or when listening with and without its last intervention.

## 11. The piano roll and the AI

- **The AI does not change the user's tool, selection, view or playback.**
- **Notes of a pending proposal** (proposal mode) show with a dashed outline and cannot be edited: they are not part of the song until accepted. The proposal bar offers listening, accepting or discarding.
- **If the user edits a note that a pending proposal would change,** the proposal becomes out of date.
- **The MCP tools follow the same rules as the mouse:** when the AI moves notes, each keeps its deviation unless the AI decides to quantize ([mcp.md](mcp.md), 1).

## 12. Not implemented yet

- Bypassing the grid in the middle of a drag (with Ctrl/Cmd, like Logic's fine adjustment).
- A screen to edit shortcuts, and "Cubase style" and "Logic style" sets.
- Splitting and gluing notes, a line tool, a brush, and drag-painting.
- Step input from the MIDI keyboard, and loop recording with takes.
- Editing several tracks at once in the piano roll.

## 13. To verify

1. **In Cubase and Logic:** the behaviours marked as coming from them, especially Q for quantize and the default tool on Cmd-click in Logic.
2. **With users:** that people coming from Cubase and from Logic can edit a played phrase without repeated reflex mistakes.
3. **Computer keyboard as a piano:** that Ctrl/Cmd + K clashes with nothing on Windows and macOS, and that several keys pressed together (chords) all arrive; some computer keyboards do not register certain combinations.
