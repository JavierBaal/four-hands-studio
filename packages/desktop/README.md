# @fourhands/desktop

La app de escritorio (Electron): proceso principal con el núcleo, guardado y conexión con los puentes; ventana con la interfaz, el audio y el teclado.

**Estado:** vacío. Lo primero que entra aquí es la prueba de sonido y latencia **S0** (`ARQUITECTURA.md`, secciones 7 y 12):

- Electron mínimo.
- SpessaSynth dentro de un AudioWorklet propio, con MuseScore_General (SF3).
- El teclado del ordenador como piano (`ESPEC_PIANO_ROLL.md`, 8.2) y Web MIDI (probado con VMPK y loopMIDI).
- Pantalla de diagnóstico de latencia.
