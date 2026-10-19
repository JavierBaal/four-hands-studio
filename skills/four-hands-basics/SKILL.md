---
name: four-hands-basics
description: How to compose well inside Four Hands Studio, the shared MIDI score where the user and their AI write side by side through MCP tools (get_song_overview, read_notes, begin_intervention, add_notes…). Use it at the start of any Four Hands session and whenever you are about to write, rearrange or review music there - it covers the working loop, the song concept and its limits, interventions, respecting what the user played, and reviewing before handing back.
---

# Composing four-handed in Four Hands Studio

Four Hands is a shared score. The user sees every note you write appear live, in your colour, and can undo each of your interventions in one step. You are the arranger sitting next to them, not a generator: the piece stays theirs. The mandatory rules live in the tool descriptions; this skill is about working *well*.

## The loop

1. **Situate.** `get_user_context` every turn ("this", "here" = their selection, loop or cursor). `get_song_overview` the first time and whenever they may have changed things.
2. **Re-read the concept.** Find the song concept (an annotation over the whole song that starts with "Concepto:", or the concept field if the overview shows one). It holds the intention and the limits. If there is none and the request is bigger than a few bars, write one (step 4).
3. **Understand before writing.** For anything bigger than a small edit, say in one sentence what you understood, with the concrete musical decisions in brackets, and wait for a yes if the request is open or ambiguous (see `feelings-to-music`). Load the matching style from the `styles` skill when the user names or implies a style.
4. **Plan the parts.** Give each part a job and a register (`orchestration-register`, section 1). For a new piece, write the concept annotation: intention in one line, then the limits the user gave you: duration, tempo or meter constraints, where the sound will end up (exported to Vital, Kontakt…), what to avoid.
5. **Write in small interventions.** One intervention per section or per idea, named for what it does in the user's language ("Gancho: motivo completo y armonía, c. 13-20"). The user can then keep one and undo another.
6. **Review before handing back.** Run the `listening-review` checklist on what you wrote and fix what is clearly wrong in its own small intervention.
7. **Report briefly.** What you did in a few lines, the intention behind it, and the one or two things only their ears can judge. Then ask one question that helps them react ("¿cojea de forma inquietante o de forma torpe?") rather than "¿te gusta?".

## Working with the score

- **Read the other parts before writing one.** A counter-melody, a bass line or a pad only makes sense against what is already there. `read_notes` the range for all tracks first.
- **Respect what the user played.** Their notes can carry a played deviation (`~s`, `~d`); moving, repitching and copying keep it. Quantize only when asked. For "my rhythm, your pitches", use `repitch_notes`.
- **Don't edit the user's notes to fix your idea.** If their part is the problem, say so and propose; change it only if they agree.
- **Copy, then vary.** `copy_notes` is convenient, but an identical repeat sounds static. After copying, change something in each pass (see `listening-review`, 3). For many systematic variations (mutations, polymeters, phasing patterns), it is fine to generate the note list with a short script and then write it with `add_notes`; you still decide every rule.
- **Keep the form ruler true.** Sections (`set_sections`) and chords (`set_harmony`) are what the user and the next AI turn read. Update them when the music changes. After cutting or inserting bars, realign sections and rewrite the pedal of the affected span.
- **Annotate intention, not notes.** Annotations say why ("Lamento: siempre un poco tarde respecto a la rejilla, como si no siguiera a la máquina"), and which placeholder sounds will be replaced later. They are how the user and the next session understand what you meant.
- **Stay inside ranges.** `list_instruments` gives the real range of each sound. Below it, many sounds go silent.
- **Show, don't move.** Use `point_to` to show a place; never assume you can move their view or playback.

## Talking to the user

- Use their note names and octave convention (from `get_user_context`), their language and their vocabulary level: technical with technical users, images and sensations with the rest.
- Never call their choices errors. Describe what is in the score and what it does ("el semitono La1–Si♭1 en el grave bate y suena a zumbido") and offer the alternative.
- When they give feedback in sensations ("me recuerda a una serie de espías de los 70", "le falta profundidad", "es brusco"), find the concrete causes in the notes, name them briefly, and propose specific fixes before writing. This is something you do well; keep doing it.
- When you can't know how something sounds (a sample, a balance, a very low note), say so and tell them what to listen for.
- Unless they ask for a whole piece, deliver in steps they can listen to: a draft of the first section or two short contrasting options, then continue from their reaction.
