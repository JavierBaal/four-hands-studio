# Comparar los sonidos de serie: motor nativo frente a SpessaSynth

Herramientas de la prueba de F2.1 (31/10 y 01/11/2026) para comprobar que el motor suena igual que la app.

1. `python3 mkmid.py`: crea `progs.mid` (22 instrumentos y batería, a cuatro velocidades) y `ctrl.mid` (expresión, modulación, pedal y reverb).
2. Motor: `FH_RENDER_BLOCK=128 "Four Hands Engine" --render MuseScore_General.sf3 progs.mid motor.wav`. Con `FH_RENDER_BLOCK=128`, cada evento suena al principio de su bloque de 128 muestras, como en el secuenciador de SpessaSynth, para poder restar las ondas.
3. SpessaSynth (lo que suena en la app): `node spessa-render.mjs MuseScore_General.sf3 progs.mid spessa.wav`.
4. Comparar: `seg.py` (nivel y brillo por instrumento), `null.py` (nivel por segundo y resta), `lag.py` (desfase entre las dos; tras alinear, la resta debería ser 0,000) y `worst.py` (los cuartos de segundo que más difieren).

Resultado del 01/11/2026 con MuseScore_General: los 23 instrumentos a 0,0 dB y con el mismo brillo; tras alinear el bloque de diferencia, la resta da 0,000 (muestra a muestra).
