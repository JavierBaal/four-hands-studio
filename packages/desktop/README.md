# @fourhands/desktop

La app de escritorio (Electron). De momento contiene la **prueba de sonido y latencia S0** (`ARQUITECTURA.md`, secciones 7 y 12).

## Qué hace S0

- **Sonido:** SpessaSynth (`spessasynth_core`, Apache-2.0) dentro de un AudioWorklet propio (`src/worklet`), con una cola de eventos que dispara cada nota en la muestra exacta. Los sonidos del SF3 se descomprimen al arrancar para que la primera nota de cada instrumento no corte el audio.
- **Teclado del ordenador como piano** (`ESPEC_PIANO_ROLL.md`, 8.2): Ctrl + K, teclas físicas, Z/X octava, C/V intensidad.
- **Web MIDI:** cualquier teclado MIDI, o VMPK con loopMIDI.
- **Pruebas:** escucha (piano, cuerdas y chelo), tempo a 120 BPM con la interfaz estresada a propósito, y carga con diez instrumentos a la vez.
- **Diagnóstico:** latencias del sistema, estimación tecla → altavoz, carga del hilo de audio y notas tardías.
- **Registro:** `registro-s0.jsonl` en la carpeta del proyecto (junto a `recursos/`), o en la carpeta de datos de la app si no la encuentra.

## Cómo se arranca

En el ordenador de Fran: doble clic en `Abrir prueba de sonido.bat`, en la carpeta del proyecto.

Desde el código:

```bash
npm install
npm run s0
```

El SoundFont se busca en `../recursos/soundfonts/MuseScore_General.sf3` (relativo a la raíz del repositorio) o en la ruta de la variable `FH_SOUNDFONT`. Si no aparece, la app pide elegirlo.

## Estructura

| Carpeta | Contenido |
|---|---|
| `src/main` | Proceso principal y preload (busca el SoundFont, da permiso a MIDI, escribe el registro) |
| `src/renderer` | La ventana: interfaz, motor de audio con programación anticipada, teclado y MIDI |
| `src/worklet` | El sintetizador en el hilo de audio y su cola de eventos |
| `src/shared` | Mensajes entre la ventana y el worklet |
