---
name: mixing
description: Mix and master the song in Four Hands Studio by measuring, not guessing. Load it whenever the user asks to mix, balance, master, make it louder or clearer, fix mud or harshness, prepare it for Spotify, YouTube, film or TV, or asks how the mix sounds ("¿cómo suena la mezcla?", "mézclalo", "masterízalo", "que suene más claro"). Measure with analyze_mix, fix from the score first, then with set_mix, buses and effects, and measure again.
---

# Mixing by measuring

You cannot hear. Four Hands gives you an ear on the audio instead: `analyze_mix` measures the last playback in the engine, after every fader, and reads it with the score. Use it like a meter in a studio: it tells you how loud, where the energy is and who fights whom, in which bars. It does not tell you whether it sounds beautiful. Say that when you base an opinion on it, and let the user's ears decide.

## The loop

1. **Ask what it is for.** A destination sets the loudness: streaming (−14 LUFS, true peak −1), cinema or TV (−23 LUFS, −1; −24 in the US), or none (balance only). The user may want their own ("−16 and −1.5"): pass `lufs` and `true_peak`. If they do not say, mix for balance and ask before chasing loudness.
2. **Ask the user to play** the song (or the section) through Four Hands and stop. Only what was played is measured.
3. **Read `analyze_mix`** with the target. Read the overview (`get_song_overview`) too: tracks, buses, effects and where each track goes.
4. **Fix one thing at a time, biggest first,** in one intervention, and say what and why in a sentence each.
5. **Ask the user to play again and measure again.** Compare with the previous reading. Undo what did not help.
6. **Deliver with `export_audio`** when the user asks for the file ("pásamelo en MP3", "expórtalo"): WAV and MP3 by default, `quality: "cd"` for a CD or a distributor. It renders offline with every plugin and reports the file's LUFS and true peak: tell the user whether that meets the destination. It never normalises; reaching the target is the mix's job.

## What to fix, in this order

1. **Balance first, with faders** (`set_mix`). Melody on top, accompaniment under it. A part 10 dB under the master while it plays is background; within 3 dB, it competes.
2. **Masking: from the score before the EQ.** When two parts fight in the same band in some bars, you wrote them: you can move one an octave, thin a chord, give the line to another instrument, or leave one out in those bars. Only when the notes must stay, cut the band in the less important part with Four Hands' EQ (a bell, −2 to −4 dB, Q around 1–2, at the band's centre) and, if needed, lift it a little in the other.
3. **Tonal balance of the master.** More than 4 dB over the reference is a problem: low-mids "muddy" (cut 250–500 Hz on the parts that crowd them, or a subgroup), high-mids "harsh" (cut 2–4 kHz on the brightest parts). Under the reference in sub is normal for orchestral music; dull air may just be the style. Fix on the parts, not on the master, unless everything shares it.
4. **Space: one room.** Reverb goes on a bus (add_bus with `reverb: true`) and the tracks send to it (`send Reverb 30`): pads, strings and choir further back, bass, drums and fast figures drier. A delay return the same way (`delay: true`), in time with the song. A track with its own reverb or delay effect sounds pasted on: prefer the shared bus.
5. **Groups.** Parts that move together (strings, choir, drums) go into a subgroup bus (add_bus with `tracks`): one fader, one compressor, one EQ for all of them.
6. **Dynamics: compress only what really jumps.** Do not put compressors on tracks by default, least of all on sampled orchestral parts (strings, brass, timpani, choir): a compressor erases the dynamics written in the score with velocity and CC11 (in Dilatación, 2:1 compressors on the double bass, the strings and the horns made velocity changes and a horn crescendo inaudible). Before compressing, ask whether the part really jumps when it should not; if it does, threshold where it peaks, ratio 2–3:1, attack 10–30 ms, and listen that the phrasing survives. Loudness range over 15 LU is fine for film, a lot for streaming: lower it with faders and the Master's limiter, not by squashing every track.
7. **Loudness last, on the Master.** A limiter at the end of the Master's chain: ceiling at the target's true peak (−1 dBTP), input gain until the integrated loudness reaches the target. If it needs more than 6 dB of gain, the mix is too quiet: raise the faders first. If the true peak is over the ceiling, the limiter is missing or its ceiling is too high.

## When a change does not show

- **"I changed the velocity and nothing changed":** first suspect a compressor on the track (set its ratio to 1:1 or bypass it); then the library (many respond to velocity mostly above v80, some barely at all: use CC11). The `sample-libraries` skill has the test.
- **Levels very different between libraries** (one comes out 16 dB louder than another) are normal: measure and set the faders; do not EQ or compress to fix a level.
- **Two rooms at once:** a library's own reverb plus the Reverb bus. Ask the user to switch the library's reverb off.

## Honesty

- Say "the meter says", not "it sounds". Numbers are facts; taste is the user's.
- Check the stereo: a correlation below 0 means phase problems (it will sound thin in mono, on a phone).
- Tracks that sound in the user's DAW are not measured: say so if they matter.
- Do not chase a number at the cost of the music: a quiet intro is not a mistake.
