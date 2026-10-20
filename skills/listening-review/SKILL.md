---
name: listening-review
description: Review your own music before handing it back, as a critic with fresh ears, because you cannot hear what you wrote. Load it automatically right after every substantial write in Four Hands Studio - a whole piece or draft, a new section, an arrangement pass, several tracks at once, a structural change like tempo or cutting bars - without waiting to be asked, and whenever the user asks for feedback, an honest opinion, "analiza", "qué te parece" or "revísalo". Catches mud in the low register, crowded middle, copy-pasted blocks, formula dynamics, genre clichés, broken limits and side effects of your own fixes.
---

# Listening review

You compose blind. In practice, the problems users hear are rarely about harmony theory; they are about things a composer notices only when listening back: mud in the bass, five parts in the same octave, a block that repeats identically, a crescendo that is a straight ramp, a fix that left a bar empty. You *can* catch most of them by reading the score as a critic. When you reviewed a finished piece in earlier sessions, you found exactly these problems in material you had written yourself while composing. So switch roles on purpose: write as a composer, then review as a critic before you hand the turn back.

## When

- After any intervention that writes more than a few bars or touches several tracks.
- After any structural change: tempo, meter, cutting or inserting bars, removing a track, a big mix change.
- When the user asks for your opinion. Then do the full review and be honest; describe what you find in the score, not judgements of the person.

Small, surgical edits (one note, one velocity) don't need a full review, but still check what is around them.

## How

1. **Start with `analyze`** on the range you touched (or `all` after a whole draft). Read its shape line first: if notes per bar and tracks stay the same for most of the piece, it has no arc, whatever else is right. Then its leftovers: clean them before anything else.
2. **Read what you touched and its surroundings.** `read_notes` over the bars you wrote plus one bar before and after, all tracks. If `analyze` exists in the tool list, run it on the same range first and use its findings as a checklist; it measures what you would otherwise estimate.
3. **Go through the checklist below.** For each item, look at the actual notes.
4. **Fix what is clearly wrong** in a new, small intervention named for what it fixes ("Limpiar el grave, c. 29-36"). Don't silently rewrite the music; fix mechanics.
5. **Tell the user in two or three short lines** what you checked, what you fixed, and the one or two things only their ears can judge (a sound you don't know, a balance you can't hear). Don't list everything that was fine.

## Checklist

### 1. Low register
- No two notes a 2nd apart below roughly F3, no 3rd below C3, no 5th below Bb1. Close intervals down there stop sounding like harmony and start sounding like a buzz (A1 and Bb1 are 55 and 58 Hz: they beat). The `orchestration-register` skill has the full low-interval table.
- Count the notes below C3 at any moment. More than two or three sustained notes there is usually mud, even if the idea is "brutal".
- If you want a dissonance in the bass, open it: put one of the two notes an octave higher (a minor 9th instead of a minor 2nd keeps the clash and loses the mud).

### 2. Middle register
- List the range of every track in the passage. If three or more parts with similar rhythm live in the same octave and a half, at least one will be masked. Move one up or down, thin it, or give it different rhythm.
- A pad or organ in close position in the middle register glues everything but erases character. Use it on purpose (intro, one hit), not as a permanent carpet.

### 3. Repetition
- Find blocks you copied (`copy_notes`). A pattern repeated identically more than twice in a row sounds static. Vary each pass: drop a note, displace one by a sixteenth, change a velocity contour, add a ghost note, move one voice. Evolution is what reads as "depth".
- Same for motifs across sections: a returning motif should come back changed (register, orchestration, harmony under it).

### 4. Dynamics and timing
- Look at velocities along a phrase. A perfectly linear ramp ("+2 per beat") or identical velocities sound programmed. A musical crescendo rises slowly and accelerates near the arrival, and individual notes vary a little around the line.
- Played deviations (`~s`, `~d`) that follow a formula (every half note -0.10) sound mechanical too. Vary them, and only use them where a player would.

### 5. Shape and arrivals
- One real climax per short piece. Two build-ups to the same peak in a minute steal each other's strength.
- Look at the bar after every peak: if several tracks drop out or fall in velocity at the same instant, the exit will sound abrupt. Stagger exits over a bar or two, leave tails (a held note, a softer echo).

### 6. Side effects of your own changes
- Compare with what was there before your intervention. Removing a part can leave a bar bare that it used to cushion. Changing tempo changes the duration. Moving a section shifts pedal, sections and annotations.
- Re-read the song concept and its limits (the concept annotation or field in `get_song_overview`: intention, target duration, where the sound will go). After a tempo or structural change, compute the new duration and compare it with the target.

### 7. Style and clichés
- Ask: does this sound like the style the user asked for, or like its neighbour? Check the neighbours listed in `feelings-to-music`, section 5 (spy theme, creepy circus, romantic sadness, Spanish colour from a flat 2nd over a major triad, trailer). Each style in the `styles` skill lists the clichés that pull it towards the wrong genre (Latin percussion and octave-jumping bass turn an unsettling title into a 70s spy theme). Check yours against that list.
- If you used a sound for its name, check that its nature fits the gesture (a slow-attack choir cannot do short hits; an electric piano is not a piano).

### 8. Ranges and sounds
- Every part inside its instrument's range (`list_instruments` gives the real range). Below the range, many sounds go silent or wrong.
- Mention the sounds whose behaviour you can't predict (GM breath and sound effects change colour with pitch; some bank sounds have slow attacks).

## How to report

Keep it short and concrete, in the user's language and with their note names:

> He revisado lo que acabo de escribir. He abierto el grave del clímax (los trombones estaban a un semitono en Do2 y zumbaban) y he escalonado la salida del compás 37 para que no caiga todo a la vez. Lo que tienes que juzgar tú: si el coro de Sonatina ataca a tiempo en los golpes cortos.

If the user asked for a full critique, structure it as: what works (specific), what fails (ordered by impact, each with the bars and a concrete fix), and a short verdict. Be honest; a clear diagnosis is more useful than reassurance.
