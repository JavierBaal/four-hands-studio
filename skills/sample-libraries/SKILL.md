---
name: sample-libraries
description: Work with sampled instruments in plugins (Kontakt, Spitfire, BBC Symphony Orchestra, Native Instruments and the like) in Four Hands Studio. Load it when a track plays through a plugin and you are about to write dynamics (crescendos, swells, accents, rolls), when the user loads a new library ("he cargado…"), when notes do not sound or sound cut, or when a velocity or CC change "does nothing". Covers velocity vs CC11 vs CC1, the 5-minute dynamics test, ranges and keyswitches, repeated notes, internal reverb and levels.
---

# Sample libraries

A track that plays through a plugin (the overview says "plays through the plugin…") is not the built-in sound: its library decides how it answers velocity and controllers, which keys sound and which switch articulations. You cannot hear it and you cannot see its panel, so **ask and test before you write**, and remember what the user tells you about each library for the rest of the conversation.

## Three controls, three jobs

| Control | What it does | Use it for |
| --- | --- | --- |
| Velocity | How hard each note starts; in many libraries mostly the attack, and mostly above v80 | Accents, differences between single notes |
| CC11, expression (`write_expression`, curve `expression`) | The volume inside the notes while they sound; it multiplies the velocity | Crescendos, rolls, phrases that grow or fade. The reliable control |
| CC1, modulation (curve `modulation`) | In many orchestral libraries, the dynamics (volume and timbre together); in others, vibrato or nothing | Only when the test says the library uses it |

- **Shape phrases with CC11, accents with velocity.** Use both together: velocity for each note's weight, CC11 for the line.
- **A value holds until the next point.** After a ramp, put the curve back where it belongs (`9 127`), or the rest of the song stays at the ramp's last value.
- **Where nothing is written, CC11 is 127 and CC1 is 0.** Writing CC1 in one place on a library that uses it for dynamics can leave the rest of the song at its quietest. Write CC1 only after the test, and then for the whole track.

## The 5-minute dynamics test (each new library)

Propose it when the user loads a library, before writing any ramp. The user listens; you write and ask.

1. **Take compression out.** Check the track's effects in the overview: a compressor must be at 1:1 or bypassed during the test, or every result is false.
2. **Velocity.** Write two notes in an empty bar, v127 then v30, and ask whether the difference is clear. If it is, velocity works for accents.
3. **CC11.** Write expression 50 for one bar of an existing part and ask whether that bar is quieter. If it is, CC11 works for crescendos.
4. **CC1.** Ask the user to move the modulation wheel in the plugin's window while a note sounds: does the volume or the timbre change?
5. **The dynamics control.** Ask the user to right-click the library's "Dynamics" or "Expression" knob: the plugin shows which CC it listens to.
6. **Say what you learned in one line** ("Trompas: velocity weak under v50, CC11 yes, CC1 untested") and keep it in mind. The user may keep a table of their libraries: ask for it.

## Recipes that worked

| Effect | How | Curve |
| --- | --- | --- |
| A roll that grows into a climax | Timpani, two bars | `35-36 30>127`, then `37 127` |
| A short roll before a hit | Half a bar | `44.3-44.4 35>127`, then `45 127` |
| A motif that appears from far away | Horns, four bars, velocities v16 to v30 | `5-8 40>75`, then `9 127` |
| A final hit that dies away | The last timpani note | `60 70` |
| Low and high registers even | Velocity only: −10 on the high notes, +6 on the low ones, no compressor | No curve |

A human roll does not climb in a straight line: vary the velocity steps (+2, +7, −1, +9…) instead of adding the same each time.

## When notes do not sound, or sound wrong

| Problem | Sign | What to do |
| --- | --- | --- |
| Out of range | A note does not sound. Kontakt calls middle C "C3"; Four Hands and you call it C4: same key, different name | Ask the user for the playable range (the blue keys in Kontakt) in Four Hands' names, and move the part by an octave if needed. Write the range in an annotation on the track so it is not lost |
| Keyswitches | Red keys in Kontakt: a note there does not sound and changes the articulation | Ask where they are; never write a note on one unless the user wants that articulation change |
| Repeated notes cut | The same note again with no gap: some libraries take the "release" and the new "press" together and cut the new note | Shorten the previous note slightly (about 25 ms) and say why |
| Two rooms | The library's own reverb plus the song's reverb bus | Ask the user to switch the library's reverb off |
| Very different levels | Each library comes out at its own level (16 dB louder, 10 dB lower) | Measure with `analyze_mix` and set the faders; not EQ, not compression |
| Dull after changing library | High cuts set for the built-in sounds remove a sampled library's air | Check and raise or remove those cuts |
| "I changed it and nothing changed" | A velocity or CC change is not heard | First a compressor on the track; then the library (velocity barely heard: use CC11; CC1 not used) |

## How to work

- **Ask before guessing**: "¿Qué librería tienes cargada en Trompas, y responde a la expresión?" costs one line and saves a wrong ramp.
- **One test, one change, then listen.** After each change, ask the user to play it and, for levels, measure with `analyze_mix`.
- **Tracks that sound in the user's DAW** (MIDI out) follow the same rules, but you cannot measure them.
