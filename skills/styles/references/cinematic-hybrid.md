# Cinematic and hybrid

Emotional orchestral score and orchestra subverted by electronics: drama, science fiction, intimate stories with a big frame. Builds in long arcs; the emotion comes from restraint and one well-placed arrival.

## What defines it

- **One idea carries everything.** A short motif or a single interval (a semitone, a rising fourth) that every layer refers to, so the whole piece tells one story. Example of the method: a "foreign" note a semitone above the tonic enters softly, grows across the piece and becomes the final cadence, unresolved.
- **Pedals and slow harmony.** Long pedal tones, modal progressions (i–bVI–bIII–bVII, i–iv, Lydian or Dorian colour), slow harmonic rhythm. Functional V–i with leading tone used sparingly, for the big moments only.
- **Ostinato engine.** Repeating figures in piano or strings (often in groups of 3 against 4) that drive the piece while harmony moves slowly.
- **Solo colours.** Piano (often soft, with pedal) and a solo string (cello, violin) as the emotional voices against the ensemble.
- **Arc, not blocks.** One rise to one climax, then release. Layers enter one by one and drop out before the peak so the peak has room.
- **Hybrid layer.** Analog-style synth pulses, sub drops, filtered textures under the orchestra: the electronics represent what is foreign, technological or inhuman.

## Typical moves in Four Hands

- **Build with layers:** plan entries by section in an annotation ("5: pedal de chelos; 9: ostinato de piano; 13: violines; 17: pulso de sinte; 25: tutti"). Use `shape_velocities` from/to for the growth, then vary single notes so it isn't a straight ramp.
- **Ostinato 3 against 4:** an eighth-note figure accented every three eighths over 4/4 (violas, piano right hand).
- **Open voicings:** basses on roots, cellos on 5ths and 10ths, violas and violins in close position higher up (see `orchestration-register`).
- **The arrival:** one bar earlier, thin out (silence or a single sustained note), then the full orchestra on beat 1. Afterwards, release in stages over two or three bars: never everything at once.
- **The ending:** leave something unresolved (a pedal of the foreign note, a suspension, a bare fifth) rather than a perfect cadence, unless the user wants closure.
- **Hybrid:** a synth pulse (eighths or sixteenths on one or two notes) entering at the midpoint; a sub hit on the climax downbeat.

## Clichés to avoid

- **Generic trailer:** braams on every downbeat, constant 16th-note string ostinato plus taikos, huge risers into every section. Keep one big moment.
- **Harmonic-minor drama of the 19th century:** i–VI–iv–V with leading tone repeatedly. Prefer modal motion; save the dominant.
- **Two fake climaxes in a short piece:** one rise, one peak.
- **Everything in the middle register:** organ pad + piano + violas + choir + horns in the same octave and a half. Spread the layers.
- **Church organ as permanent glue:** it turns sci-fi into a hymn. Use strings that breathe; keep organ for a specific moment.
- **Programmed dynamics:** straight velocity ramps and every track at the same volume. Shape phrases and set a real mix (violins left, cellos and basses right, timpani and choir centre is a classic seating), with depth from the reverb send: strings and choir further back, basses and percussion drier.

## How users ask for it

"Cinematográfico", "épico pero contenido", "emotivo", "banda sonora", "ciencia ficción", "orquesta con electrónica", "que crezca", "que emocione", "tipo trailer", or a reference to a film or series score.

## Sound

- **With built-in sounds:** orchestral bank sections (strings, horns, trombones, choir, timpani), a real acoustic piano (not an electric piano program), sustain pedal on the piano (`write_pedal`), a GM synth for the pulse as a placeholder.
- **For the user's libraries (annotate):** strings and brass → Kontakt orchestral libraries; piano → a felt or soft piano; synth pulse and sub → Vital or Serum (analog-style saw or square, low-pass filter, slow attack for pads).
- Long notes in strings will later benefit from expression curves (CC1/CC11); until then, shape with velocities and note lengths.
