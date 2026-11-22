# Comparing the built-in sounds: native engine against SpessaSynth

Tools to check that the native engine plays the built-in SoundFont sounds the same as the window's synthesizer (SpessaSynth).

1. `python3 mkmid.py` creates `progs.mid` (22 instruments and drums, at four velocities) and `ctrl.mid` (expression, modulation, pedal and reverb).
2. Engine: `FH_RENDER_BLOCK=128 "Four Hands Engine" --render MuseScore_General.sf3 progs.mid engine.wav`. With `FH_RENDER_BLOCK=128`, each event plays at the start of its 128-sample block, like SpessaSynth's sequencer, so the waveforms can be subtracted.
3. SpessaSynth (what plays in the window): `node spessa-render.mjs MuseScore_General.sf3 progs.mid spessa.wav`.
4. Compare: `seg.py` (level and brightness per instrument), `null.py` (level per second and the difference), `lag.py` (the offset between the two; once aligned, the difference should be 0.000) and `worst.py` (the quarter seconds that differ most).

Result with MuseScore_General: all 23 instruments at 0.0 dB with the same brightness; after aligning the one-block offset, the difference is 0.000, sample by sample.
