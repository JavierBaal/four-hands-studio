# Experimental title music

Openings and title sequences that feel strange rather than grand: unsettling, sick, obsessive, playful-menacing. 30 to 90 seconds, built to be remembered from one hook and to cut to the title card.

## What defines it

- **One cell, obsessed over.** A short motif (3–5 notes) or rhythmic cell repeated and mutated, not a developed melody.
- **Non-musical sounds as music.** Breaths, gasps, vocal fragments, clicks, objects, detuned toys. They carry rhythm, not decoration.
- **Rhythm that limps.** Groupings that fight the bar (3+3+3+3+4 sixteenths in 4/4), polymeters (a 5- or 7-step loop phasing against 4/4), displaced accents, silences in uncomfortable places. The repetition is mechanical, but never square.
- **Minimal harmony.** Drones and pedals, semitone rubs (tonic against flat 2nd), tritones, Phrygian or Locrian colour. Few or no chord progressions.
- **Contrast of innocence and threat.** Childlike timbres (celesta, music box, glockenspiel, high pizzicato) over something wrong underneath.
- **Degradation.** The material gets "infected" as it goes: notes drop out, shift, detune by a semitone, noise takes over.
- **Hard cuts.** Sudden silence, a breath, then a final hit on the title card.

## Typical moves in Four Hands

- **Limping ostinato:** write one bar with uneven groupings in `add_notes`, keep velocities uneven, add small `~s` deviations to a few notes only.
- **Polymeter:** a loop of 5 sixteenths (e.g. D–A–rest–Eb–rest) written across the 4/4 bars so it lands on beat 1 only every 5 bars. Generate the positions with a short script; check it doesn't sound like a mistake by keeping it quiet at first and growing.
- **Mutation instead of copy:** after the first statement, each repeat loses a note, gains a ghost note, shifts one onset by a sixteenth, or stutters (32nd-note repeats). Plan it as "clean → contaminated" across the piece and annotate the plan.
- **Infected motif:** in the second half, a layer plays the motif a semitone off while another keeps the clean version. The clash is the point; annotate it so the user knows it is intentional.
- **Breath as percussion:** a breath/noise sound on off-beats, with uneven velocities. Its colour changes with pitch: tell the user which octave to try.
- **The cut:** one empty bar (or two beats), one inhale, then a short tutti cluster (tonic + flat 2nd + 5th) on beat 1 for the title card.
- **A human line against the machine:** a slow, sad solo line (solo cello or violin), always slightly late against the grid, gives the depth that pure mechanism lacks.

## Form (about 60 s)

Intro (2–4 bars: breaths, the motif alone) → infection (the limping base enters) → hook (full motif, all layers) → delirium (stutter, growing to the peak) → cut → hit. Shorter versions keep intro, hook, cut.

## Clichés to avoid

- **70s spy/detective theme:** Latin percussion (claves, cuíca, cabasa, bongos), bass jumping in octaves, brass-like hits on the accents, handclaps on 2 and 4, question-and-answer phrases. The spy is cool and in control; this style is sick and out of control.
- **Horror stings:** constant violin screeches and jump-scare hits. Unease here comes from obsession and wrongness, not shocks.
- **Trailer build:** braams and huge risers. Keep it small and strange.
- **Copy-paste loops:** identical repeats make it static. It must mutate.

## How users ask for it

"Inquietante", "enfermizo", "raro", "que cojee", "como una máquina que falla", "infectado", "obsesivo", "opening de serie", "cabecera", "títulos de crédito", "experimental", "glitch", "voces raras", or a reference to a series opening known for unusual sound.

## Sound

- **With built-in sounds:** celesta or music box for the innocent layer, breath noise and choir for voices, pizzicato strings, solo cello, timpani or low toms for the pulse, a sub on low strings, synth bass for the limping line.
- **For the user's libraries (annotate):** breaths → real vocal samples (Kontakt); choir → chopped vocals; synth bass and leads → distorted patches in Vital or Serum with bitcrush; percussion → found-object kits.
- Mark tracks that are placeholders clearly, so the user hears the writing, not the sound.
