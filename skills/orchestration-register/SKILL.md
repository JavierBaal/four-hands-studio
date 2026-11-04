---
name: orchestration-register
description: Orchestration and register craft for writing parts that sound clear instead of muddy - where each instrument sits, low-interval limits, doubling, spacing, giving the melody room and keeping the bass clean. Load it before writing any piece or section with three or more tracks in Four Hands Studio or any MIDI score, and whenever analyze reports crowded or low-register findings - strings, orchestra, hybrid orchestra with synths, choir, piano with ensemble - and whenever the user says it sounds muddy, crowded, thin, flat, "sin profundidad", "empastado" or "le falta aire".
---

# Orchestration and register

Most of what makes an arrangement sound "amateur" when you can't hear it is register: everything in the same octave and a half, close intervals in the bass, every part doubled. These are the rules of thumb orchestrators use; they are guides, not laws, but break them on purpose.

## 1. Think in layers, not tracks

Before writing, give every part a job and a register:

| Layer | Job | Typical register |
|---|---|---|
| Sub / foundation | Root, weight | E1–C3, one note at a time, rarely two |
| Bass line / ostinato | Motion at the bottom | C2–C3 |
| Harmony / pad | Colour, glue | C3–C5, open spacing |
| Inner motion | Rhythm, ostinatos, arpeggios | G3–G5 |
| Melody | The thing you follow | Wherever it is clearest, with an octave of air around it |
| Air / sparkle | Space at the top | C6 and up, sparse |

Write one sentence per part before you start ("chelos: pedal de Re y armonía lenta; violas: ostinato 3 contra 4 en Re4–Re5…") and keep it as an annotation. If two parts have the same job and the same register, one is redundant.

## 2. Low-interval limits

Below these pitches the interval stops sounding as harmony and becomes a muddy buzz. Lowest comfortable bottom note for each interval (approximate, sounding pitch):

| Interval | Lowest bottom note |
|---|---|
| minor 2nd | E3 |
| major 2nd | Eb3 |
| minor 3rd | C3 |
| major 3rd | Bb2 |
| perfect 4th | Bb2 |
| tritone | B2 |
| perfect 5th | Bb1 |
| minor 6th | F2 |
| major 6th | F2 |
| minor 7th | F2 |
| major 7th | F2 |

- Below C2, write single notes or octaves only.
- To keep a dissonance in the bass, open it: the clash survives as a 9th or a 7th an octave up, without the mud.
- A sustained pedal and a moving bass in the same octave fight. Separate them by an octave or give the pedal to a quieter, darker sound.

## 3. Spacing

- **Wide at the bottom, close at the top.** Harmonic-series spacing: big intervals low (octave, 5th), smaller ones higher (3rds, 4ths). Close position low sounds thick; open position high sounds thin.
- **Avoid gaps of more than an octave between adjacent upper voices**, unless you want a hollow, cold sound on purpose.
- **Leave room around the melody.** Accompaniment should not sit in the same octave as the melody with similar rhythm. Move it down, or make it rhythmically very different.

## 4. Doubling

- Doubling the melody an octave below thickens it; doubling it at the unison with a different instrument changes its colour. Choose one; doing everything at once flattens the mix.
- Doubling a whole passage in octaves across many instruments sounds like a wall. Save full octave doublings for the one moment that should hit hardest.
- In a big tutti, don't double the 3rd of the chord in the bass; double roots and 5ths.

## 4b. Depth

Register and pan place a part up and down and left and right; the send to a reverb bus (`set_mix 't2 send Reverb 30'`) places it near or far. With no reverb bus in the song, make one (`add_bus` with `reverb: true`) and send to it: one room for every track.

- **Far for what holds, near for what moves.** Pads, string sections, choir and slow solo lines take more reverb (around 25–45); bass, drums, piano ostinatos and fast figures stay drier (0–15), or they blur.
- **One room.** Give related parts similar values so they sound in the same space; a single very wet part sounds pasted on.
- **The front voice slightly drier than its accompaniment**, so it stays close to the listener.
- Tracks that sound in the user's DAW get the same send; their own reverb may already be on there. Ask before adding much.

## 5. Density across the piece

- Arrangements breathe by adding and removing layers. Plan an arc: which layers enter where, which drop out before the climax so the climax has somewhere to go.
- Never let all layers enter or leave on the same beat unless that is the effect (a cut, a hit). Stagger entrances and exits by a beat or a bar.
- One sustained carpet (pad, organ, long strings) under the whole piece removes contrast. Let it come and go.

## 6. Instruments: comfortable ranges (sounding pitch)

Use `list_instruments` for the real range of each sound; these are the ranges where each instrument sounds good, not just where it can play.

| Instrument | Comfortable | Notes |
|---|---|---|
| Violins | G3–C7 | Expressive on the G string (G3–D4) and above A5; high harmonics for "air" |
| Violas | C3–A5 | Dark and veiled; great for inner ostinatos |
| Cellos | C2–A4 | Singing above D3; lyrical solo A3–E5 |
| Double basses | E1–G3 | Usually doubles cellos an octave below; alone they are heavy |
| Horns | F2–F5 | Warm in the middle; fanfare above C5 |
| Trumpets | E3–C6 | Bright; muted for distance |
| Trombones | E2–F4 | Heavy chords from Bb2 up; close voicings below are mud |
| Tuba | D1–C4 | Foundation, not melody |
| Flute | C4–C7 | Weak at the bottom, piercing at the top |
| Oboe | Bb3–F6 | Penetrating, plaintive |
| Clarinet | E3–C6 | Dark low register (chalumeau), clear above |
| Bassoon | Bb1–Eb5 | Bass of the woodwinds, comic or sad |
| Choir (SATB) | Bass E2–D4, tenor C3–A4, alto F3–D5, soprano C4–A5 | Sustained vowels; short hits need fast-attack samples |
| Harp | C1–G7 | Plucked, decays; good for arpeggios and sparkle |
| Celesta / glockenspiel | C4–C8 | Bell-like, childlike; few notes go far |
| Timpani | D2–A3 | Tuned pulse, rolls; one or two pitches per passage |
| Piano | A0–C8 | Whole range; the middle is where everything else lives |

## 7. Synths in an orchestra (hybrid)

- A sub-bass synth takes the job of the double basses: then thin the basses or move them up.
- Pulses and arpeggiated synths sit in the inner-motion layer; keep them out of the melody's octave.
- Write synth parts for the sound they will have later (the user often exports to Vital, Serum or Kontakt): say so in an annotation ("Vital: square wave, a bit of bitcrush") so the placeholder sound doesn't mislead.

## 8. Before you hand it back

Run the `listening-review` checklist on what you wrote. Most register problems are visible in the numbers: list each track's lowest and highest note in the passage and look for overlaps and close intervals at the bottom.
