# Visual design

The look of Four Hands Studio: character, colour tokens, type, measurements, how notes are drawn, layout, components and motion. Code comments cite this document by section (`docs/design.md, 6.1`), so the numbering is stable.

The tokens live in code in `packages/desktop/src/renderer/theme.ts` and `styles.css`; this document explains them.

---

## 0. How to use this document

1. **Every interface change follows this document.** Colours, type, measurements, note encoding, layout and components come from here; they are not reinvented.
2. **A new screen without a precedent** is built with the same tokens and components, as if it had always been there.
3. **Visual changes are proposed, not slipped in.** A pull request that changes a colour, a font, a measurement or the layout says so, with before and after screenshots, and updates this document.
4. **If something clashes with another document,** this one rules on looks; [piano-roll.md](piano-roll.md) and [mcp.md](mcp.md) rule on behaviour.

---

## 1. Character

**A chamber music room in low light.** Dark wood, scores, a warm lamp. Calm, craft and control: the tool of someone who composes slowly, not a production console.

- **Warm dark.** Greys with a touch of brown, never bluish black or pure black.
- **Sober.** No flashy gradients, no glow, no neon, no colourful icons. Colour is reserved for what means something: who wrote each note, the AI's proposal, recording.
- **Two hands, the same calm.** The user's amber and the AI's blue weigh the same. The AI's blue never looks like a warning or an error: it is the other hand.
- **Describes, never judges.** No visual element marks something as "wrong" (no red error notes, no strikethroughs). "Outside the harmony" is a neutral dot, not an alarm.
- **Its own.** Nothing that recalls Cubase, Logic, Studio One or FL Studio: not their colours, icons or layout. We take behaviour from them, not looks.

---

## 2. Colour

Every colour is a variable (token). The names in the "Variable" column are the ones the code uses.

### 2.1 Surfaces

| Variable | Value | Use |
|---|---|---|
| `--bg-page` | `#171513` | Page background, behind the app |
| `--bg-app` | `#1b1916` | General app background |
| `--bg-bar` | `#211e1a` | Top bar |
| `--bg-panel` | `#201d19` | Piano roll toolbar, side panel, rail |
| `--bg-lane` | `#1e1b18` | Arrangement and velocity lane |
| `--bg-card` | `#24211d` | Cards; the active track's lane in the arrangement |
| `--bg-control` | `#2a2622` | Icon buttons and tools |
| `--bg-control-hover` | `#332e29` | Button on hover |
| `--bg-control-on` | `#3a352f` | Active tool, active menu item |
| `--bg-chip` | `#26231f` | Chips (AI status, recording) |
| `--bg-menu` | `#2a2622` | Context menu |
| `--bg-section` | `#2b2722` | Section blocks on the form ruler |

### 2.2 Borders and lines

| Variable | Value | Use |
|---|---|---|
| `--line` | `#35302a` | Main border between areas |
| `--line-control` | `#3a352f` | Border of buttons, chips and cards |
| `--line-soft` | `#2e2a25` | Thin separators (ruler rows, lists) |
| `--line-strong` | `#4a443c` | Bar lines, strong separators, menu border |
| `--line-on` | `#5a5248` | Border of an active tool or toggle; dashed empty-state button |
| `--line-section-mini` | `#3e3832` | Section separator in the arrangement strip |

### 2.3 Text

| Variable | Value | Use | Contrast on `--bg-app` |
|---|---|---|---|
| `--text` | `#ece6dc` | Main text | 14.1:1 |
| `--text-2` | `#a89f92` | Secondary text, labels, bar numbers | 6.7:1 (5.6:1 on `#2c2824`, the worst background) |
| `--text-on-light` | `#1b1916` | Text on a primary button, a flag or a note | — |

**Links:** `#e3b36a`, on hover `#f0c88a`.

### 2.4 The two hands (authorship)

| Variable | Value | Use |
|---|---|---|
| `--author-user` | `#e3b36a` | Amber: the user's notes and marks ("You") |
| `--author-ai` | `#6f97cc` | Blue: the AI's notes and marks |
| `--author-off` | `#bdb4a6` | Neutral: the pedal lane and curves |

- Distinguishable with red-green colour blindness (amber against blue) and by lightness too: the dark note text contrasts 9.1:1 on amber and 5.8:1 on blue.
- With the authorship layer turned off, notes and velocity bars take **their track's colour** (2.7), and the "You / Claude" legend disappears. Ghost notes are still told apart by their shape (9 px tall, opacity .28).

### 2.5 The AI in the interface

| Variable | Value | Use |
|---|---|---|
| `--ai-surface` | `#1f2430` | Proposal and With / Without bars, the AI's cards in the side panel |
| `--ai-surface-2` | `#1f2633` | "The AI sees" chip, pointing mark, edge notice |
| `--ai-line` | `#33435a` | Border of AI surfaces; "1 pending" badge; active With / Without segment |
| `--ai-line-2` | `#3b4a60` | Border of the With / Without control |
| `--ai-line-btn` | `#4a5a72` | Border of secondary buttons on the proposal bar |
| `--ai-text` | `#c7d6ea` | Text on AI surfaces (10.3:1) |
| `--ai-text-2` | `#a9bbd3` | Secondary text on AI surfaces (7.9:1) |
| `--ai-toggle` | `#5a7fae` | Switch turned on (skills) |

### 2.6 Pending proposal

| Variable | Value | Use |
|---|---|---|
| `--proposal-line` | `#9cc0ee` | 1.5 px dashed outline |
| `--proposal-fill` | `rgba(111,151,204,.22)` | Translucent fill of a proposed note (`.20` in the arrangement) |

A proposal is recognized **by its shape** (dashed outline and translucent fill), never by colour alone.

### 2.7 Tracks

A closed palette of ten named tones, used in the arrangement, track chips, ghost notes and notes with authorship off. They have body but do not compete with the two author colours: **no amber and no blue**. Each track stores its colour (`Track.color`, the index in this table) and keeps it when reordered; a new track takes the first one no other track uses. It is chosen in the track menu or the Track tab, and the AI sets it by name (English or Spanish).

| # | Name | Spanish | Value |
|---|---|---|---|
| 0 | lavender | lavanda | `#aea8e3` |
| 1 | sand | arena | `#c3ae79` |
| 2 | sage | salvia | `#79bea0` |
| 3 | clay | arcilla | `#d18b79` |
| 4 | slate | pizarra | `#7f9cb3` |
| 5 | stone | piedra | `#888674` |
| 6 | plum | ciruela | `#a57596` |
| 7 | moss | musgo | `#7e9159` |
| 8 | water | agua | `#53bcb9` |
| 9 | heather | brezo | `#b58b96` |

- **Checked with colour-blindness simulators:** any pair is at least 5.5 apart (CIEDE2000) with deuteranopia, protanopia and tritanopia. Sand and slate are less saturated so they stay away from amber and blue.
- **The colour has surface in the arrangement:** a faint block of the track's colour (opacity .16, 2 px left border at .7) in each section where the track plays, or from its first to its last bar if there are no sections; and in the header, a 4 px vertical bar.
- The dark note text (`#1b1916`) contrasts at least 4.7:1 on all of them.
- The order never changes (files store the index): a new colour goes at the end. No free colour picker for now.

### 2.8 Other colours with a function

| Variable | Value | Use |
|---|---|---|
| `--rec` | `#d77a6a` | Recording: the dot of the button and of the "Recording" chip (the only red in the interface); also "Remove track" |
| `--flag` | `#d9c9a3` | Library card state "weak" |
| `--loop` | `#7fa196` | Loop band on the bar ruler (opacity .7) and loop icon; MIDI output "sending" |
| `--viewport` | `#cfc6b8` | Rectangle of the visible area in the arrangement, filled `rgba(236,230,220,.05)` |
| `--playhead` | `#ece6dc` | Playback cursor, 2 px, opacity .85 |
| `--select-band` | `rgba(111,151,204,.08)` with dashed `#6f97cc` edges | Time selection band |
| `--select-note` | 2 px ring `#ece6dc` | Selected note |
| `--ai-off` | `#6b645b` | "AI not connected" dot |
| `--warn-surface` | `#2a2420` with border `#5a4a36` | Out-of-date proposal (warm, not red) |
| `--meter` | `#7fa196` | Level meters in the mixing console |
| `--meter-peak` | `#ece6dc` | Peak hold on the meters |
| `--clip` | `#d9a35a` | Clipping (no red) |
| `--keyswitch` | `#c9826f` | Articulation keys on the piano roll keyboard and library cards |
| `--key-out-of-range` | `rgba(23,21,19,.62)` | Cover over the keys outside a library's range |

### 2.9 Grid and keyboard

| Element | Value |
|---|---|
| White-key row | `#25221e` |
| Black-key row | `#1d1a17` |
| Line under each C | 1 px `#3a352f` |
| Beat line | 1 px `#2f2b26` |
| Bar line | 1 px `#4a443c` |
| White key | `#d6cfc3`, separator `#b9b1a3`, name `#2a2622` |
| Black key | `#2c2824`, separator `#1b1916`; shorter (leaves 24 px on the right) |

Hierarchy: bar stronger than beat, beat stronger than subdivision. The grid reads from the corner of the eye without competing with the notes.

---

## 3. Type

- **IBM Plex Sans** (400, 500, 600) for the whole interface.
- **IBM Plex Mono** (400, 500) with tabular figures (`font-variant-numeric: tabular-nums`) for positions, tempo, bar numbers, shortcuts and MCP tool names.
- Both under the SIL Open Font Licence, bundled with the app (never loaded from a web font service).

| Use | Size | Weight | Notes |
|---|---|---|---|
| Base | 13 px | 400 | Line height 1.35 |
| Song title | 15 px | 600 | Centred in the top bar |
| Card title ("Connect your AI") | 17 px | 600 | |
| Field value (position, tempo…) | 14 px | 400 | Mono for figures |
| Secondary, metadata, chords | 12 px | 400 | |
| Section and ruler labels | 11 px | 400–500 | UPPERCASE, letter spacing .04–.05em, `--text-2` |
| Note name inside a note | 10 px | 400 | Only if the note is at least a half note long |
| C name on the keyboard | 10 px | 400 | C4, C5, C6 (or Do4, Do5…) |

**Never below 10 px**, and below 11 px only inside notes and keys. Interface scale adjustable from 90 % to 150 %.

---

## 4. Measurements, radii and spacing

| Element | Measurement |
|---|---|
| Top bar | 52 px minimum height, padding 8 × 16 |
| Icon button (transport, panel, rail) | 36 × 36, radius 8 |
| Piano roll tool and toggle | 32 px tall, radius 7 |
| Proposal bar button | 36 px tall, radius 8 |
| Main button of "Connect with Claude" | 44 px tall, full width, radius 8 |
| Chip | full radius, padding 6 × 12, 8 px dot |
| Card | radius 10, padding 12 |
| Floating card, dialog | radius 12–14 |
| Context menu | 280 px, radius 10, 32 px rows |
| Track header (arrangement) | 196 px wide by default (dragged from 140 to 480): name, sound line, volume and pan |
| Dividers | Between arrangement and piano roll, between headers and lanes, and at the side panel's edge. An invisible 6 px grab over the edge that lights up in `--line-on` on hover or drag; double-click returns to the default; they are remembered. When the tracks do not fit, the arrangement scrolls with a thin `--line-strong` bar and the section strip stays fixed at the top, and the piano roll keeps room for notes |
| Track lane (arrangement) | 54 px |
| Volume and pan slider | 12 px tall: 2 px rail `--line-strong`, filled part `--text-2`, 8 px knob `--text`; pan 34 px and filled from the centre; value in Mono 10 px `--text-2` |
| Arrangement section strip | 22 px |
| Ruler label and keyboard column | 72 px |
| Ruler row (Form, Notes, Tempo, Key, Harmony, Bar) | 24 px |
| Piano roll row | 15 px by default; with vertical zoom, 12, 15, 18, 21 or 24 px. A note is the row minus 2 px, a ghost 60 %, and the note name goes to 11 px from 18 and to 12 px from 21 |
| Note | 13 px tall, radius 3 |
| Ghost note | 9 px tall, radius 2 |
| Velocity lane | 64 px (bars up to 56 px, 4 px wide) |
| Side panel | 288 px by default (dragged from 260 to 520), padding 16, 20 px between blocks |
| Icon rail (folded panel) | 48 px |
| Track M and S buttons | 22 × 20, radius 4 |
| Click targets | at least 24 × 24 px |
| Scrollbars | 10 px, 6 px thumb in `--line-strong` (`--line-on` on hover), rounded, no arrows, transparent track |

Spacing in multiples of 2 and 4 (4, 6, 8, 10, 12, 16, 20). Shadows only on floating elements (menu, cards): `0 12–16px 32–40px rgba(0,0,0,.45)`.

---

## 5. How each note looks

One visual channel for each thing:

| What | How |
|---|---|
| **Yours** | Amber fill `#e3b36a` |
| **The AI's** | Blue fill `#6f97cc` |
| **Authorship off** | Its track's colour (2.7) |
| **Pending proposal** | 1.5 px dashed outline `#9cc0ee`, fill `rgba(111,151,204,.22)`, text `#c7d6ea` |
| **Selected** | 2 px ring `#ece6dc` |
| **Velocity** | Note opacity = 0.55 + 0.45 × v/127; a bar in the lane v/127 × 56 px tall, in the author's colour |
| **Outside the harmony** (optional aid) | A 6 px `#1b1916` dot inside the note, on the right |
| **Ghost** (another track) | 9 px tall, its track's colour, opacity .2–.4 |
| **Just written by the AI** | A short fade-in (respects "reduce motion") |

In the piano roll, with authorship visible, **notes are not coloured by track:** only one track is edited, so colour is kept for authorship. In the arrangement: track colour.

**Note tooltip:** resting the mouse 350 ms on a note shows a label with the menu tokens (`--bg-menu`, border `--line-strong`, radius 6, 12 px) giving pitch, velocity and duration in a musician's words: "E5 · velocity 80 · dotted quarter" (or "≈ half" when close to a note value).

---

## 6. Layout

### 6.1 Full screen

Top to bottom, left to right:

1. **Top bar:** transport (back to start, play, stop, loop, record, computer keyboard as piano) · Position · Tempo · Meter · Key · centred title · save state and engine load · settings · AI status chip on the right.
2. **Arrangement:** track headers (colour bar, name, sound, M, S, volume, pan) on the left; section strip on top; one lane per track with miniature notes; rectangle of the piano roll's visible area. The active track in bold on `--bg-card`.
3. **Piano roll toolbar:** Mix button (to the console) · track name and sound · Arrow 1, Pencil 2, Eraser 3, Zoom 4 · Grid 1/8 N · Authorship · Scale · "You / Claude" legend (only with authorship visible) · "The AI sees: …" chip on the right.
4. **Rulers, aligned with the piano roll:** Form (sections), Notes (annotations, only if there are any), Tempo and Key (only if the song changes them), Harmony (one chord per bar), Bar (numbers and loop band).
5. **Piano roll:** keyboard on the left with the C names; grid; notes; ghosts; selection band; cursor.
6. **Lanes:** Velocity · Pedal · Expression · Modulation, as tabs.
7. **Side panel** on the right, foldable, with three tabs: **Track** (colour, sound, where it plays, library card, mix), **Sounds** (the sound browser) and **AI** (concept, what the AI sees, what the AI has written, history, active skills).
8. **The AI's bar** at the bottom, full width: "Claude is writing…", the last intervention's With / Without, or a pending proposal.

The **mixing console** takes the piano roll's place (F3, back with F2): a strip per track and bus with inserts, sends, output, pan, M and S, fader with meter, and the master fixed on the right.

### 6.2 Folded side panel

The panel disappears and a 48 px **rail** of icons remains. The piano roll gains the width.

### 6.3 Compact layout, below 1000 px

Meant for half a screen next to Claude Desktop (for example Claude at 420 px and Four Hands at 880 px). Triggered by a container query on the app's width, not the window's:

- Side panel opens over the piano roll, with icon-only tabs.
- 44 px track headers with only the colour; 14 px lanes; sections without text.
- 56 px keyboard column; ruler labels hidden.
- The title, save state, key and authorship legend are hidden.
- The piano roll toolbar wraps onto two lines if needed.

### 6.4 First time

The first time, the app opens a copy of the demo song. A song without sections, harmony or concept shows each ruler's **empty state** (a line that explains and a dashed button: "Add section", "Write chords", "Write the concept"), and the AI chip says how to connect it.

---

## 7. Components

| Component | Look |
|---|---|
| **AI status chip** | A chip with a dot: grey `#6b645b` not connected (it is a button that explains how to connect), blue `#6f97cc` connected, light blue `#9cc0ee` reading or writing (with "Go there"). The name comes from the AI client |
| **Proposal bar** | `--ai-surface` background, top border `--ai-line`. "**Claude's proposal** · description" and metadata in `--ai-text-2`. With / Without segmented control. Primary button Accept and secondary Discard |
| **With / Without bar** | The same bar for the last intervention, already in the song: With / Without (B), Undo, and × to hide it |
| **Out-of-date proposal** | The same bar in warm (`#2a2420`, border `#5a4a36`) with an explanation and only Discard |
| **AI writing** | The AI's bar with "Claude is writing · …", a note counter and "Close intervention" |
| **Context menu** | Background `#2a2622`, border `#4a443c`, radius 10, shadow. Groups separated by lines; shortcuts in mono on the right. Never deletes on opening |
| **Pointing** | A floating label in `--ai-surface-2` with a `#6f97cc` border: "Claude points you to bar 23: … Go". Does not move the view |
| **Edge notice** | A tab stuck to the right edge, "Claude is writing here →", when the AI writes outside the visible area (mirrored on the left when before it) |
| **Recording chip** | `#d77a6a` dot, "Recording on Piano · count-in 2… 1…", next to "Metronome" |
| **Annotation** | On the Notes ruler, between Form and Harmony: a box spanning its bars, `--bg-section` background, 3 px left border in its author's colour, 11 px text with ellipsis and a thin line below to its end. Up to three 20 px lanes that do not overlap; the rest in a "+N" chip |
| **Concept card** | At the top of the AI tab. Empty: text in `--text-2` and a dashed "Write the concept" button. Written: a `--bg-card` card with 13 px text and, below, its author's dot, "Claude's" or "yours", and "Edit" |
| **History** | A box of about six entries with its own scroll. The current step has a border and "you are here"; clicking a step of the session goes back to right after it and later steps turn grey until a new change discards them |
| **Settings** | A centred 780 × 600 px card with the sections on the left (Your AI, Sounds, Plugins, MIDI output…) and the content on the right |
| **Sound browser** | Search, filters as pills, groups by category with counts, rows with origin icon, name, maker or bank and a star for favourites |
| **Library card** | In the Track tab, for plugin tracks: what the library responds to (states with a 7 px dot), its range, articulations as small chips with a `--keyswitch` mark, and who filled it and why |
| **Mixing console strip** | Colour strip, inserts, sends (bus name over a 4 px level bar; outlined only when pre-fader), output button, pan, M and S, fader with meter and scale (−24 to +6 dB takes the top 70 %), dB, name and sound |
| **Empty ruler state** | Secondary text explaining what is missing and a 24 px button with a dashed `#5a5248` border |

**Primary button:** background `#ece6dc`, text `#1b1916`, weight 600. One per area at most. **Secondary button:** transparent with a border. **Active tool:** background `#3a352f`, border `#5a5248`. **Active toggle:** background `#2f2a25`, border `#5a5248`, main text (off: secondary text).

---

## 8. Icons

- Line SVG icons, 1.4–1.5 px stroke, rounded caps and joins, 16 × 16 inside 36 px buttons.
- Icon colour: `--text`, except those with a function: loop in `--loop`, record with a filled `--rec` circle, AI icons in `--ai-text` or `--proposal-line`.
- **No emoji** anywhere in the interface.
- Important actions carry text (Accept, Add track…). The piano roll tools (arrow, pencil, eraser, zoom) are icons with their key next to them, and the pencil and eraser are also the cursor. Icon-only buttons have `aria-label` and `title`.
- Our own icons or a freely licensed set; never another DAW's.

---

## 9. Motion

- Minimal and functional: a short fade-in for the AI's new notes, a smooth playback cursor.
- **Nothing jumps:** notes follow the mouse when dragged, with their grid place shown as a silhouette, and land on it in about 110 ms on release; the wheel, zoom, arrangement jumps, back to start and the page turn during playback glide (ease-out, 180–260 ms).
- Nothing blinks, nothing bounces. The system's "reduce motion" is respected.
- Opening and folding the panel may be animated (≤ 150 ms) or not; it never moves the piano roll's view.

---

## 10. Accessibility

- Text contrast at least 4.5:1 (checked in section 2).
- Authorship distinguishable with red-green colour blindness and by lightness; proposals by shape.
- Click targets at least 24 × 24 px.
- No pure white on pure black.
- ARIA roles only on real controls (`button`, `aria-pressed`, `role="switch"` on switches that are buttons).
- Note names configurable (C D E or Do Re Mi) and the middle C octave configurable.

---

## 11. Light theme

Desirable, never a replacement. The warm dark theme is the default and the reference. A light theme would use the same tokens with other values and the same character (warm paper, not pure white), with the two author colours checked again for contrast and colour blindness.

---

## 12. Visual work to do

- [ ] Draw the final icon set with these rules.
- [ ] Design, with these tokens, the screens still missing (export, lost connection, shortcut editor).
- [ ] Decide, with users, whether the authorship layer starts visible or off.

---

## 13. How the design grew

The design was fixed from approved sketches before any interface code, and every later change was approved the same way: proposed with screenshots, then built. In order:

- **Editing (H2):** computer-keyboard-as-piano button and chip, recording and metronome chips, grid menu, quantize dialog, "Add track" and instrument palette, track menu, fields edited in place, meter and key menus, velocity and pedal tabs, drag silhouettes, a translucent movable keyboard guide, back to start. Piano roll tools as icons and cursors; "nothing jumps".
- **The AI's hand (H3):** AI status chip, "Claude is writing" bar, pointing mark and edge notices. Volume and pan in the track header, the ten-colour track palette (2.7), track colour when authorship is off, note tooltips. Draggable dividers, stepped vertical zoom, the zoom tool, and a save indicator by state.
- **Collaboration (H4):** the Concept card, active skills and "Your AI" (opinions and skills), the With / Without bar, "What the AI has written", expression and modulation tabs, MIDI output to a DAW, tempo and key rulers, proposal mode, annotations on their own ruler.
- **Interface 2:** Settings, the side panel with Track, Sounds and AI tabs, the sound browser, folding the panel with F4–F6, our own scrollbars, the history box with stepping back, opening a plugin's window from the track header.
- **Phase 2:** the mixing console in the piano roll's place, meters and the engine load indicator, buses and sends, insert effect windows, and library cards with keyswitches on the keyboard.
