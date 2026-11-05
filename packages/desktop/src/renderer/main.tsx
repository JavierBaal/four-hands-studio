import type { EnginePlugin } from "../shared/engine.js";
/** Starts the window: theme, bridge, replica, view, then React. */
import { createRoot } from "react-dom/client";
import { langFrom, translator } from "../shared/i18n.js";
import { App } from "./App.js";
import { AiStore } from "./ai.js";
import { AudioLayer } from "./audio-layer.js";
import { type Bridge, memoryBridge, windowBridge } from "./bridge.js";
import { Ctx, activeTrack } from "./context.js";
import { harnessAi, harnessSong } from "./harness.js";
import { Replica } from "./replica.js";
import { installTheme } from "./theme.js";
import { ViewStore, initialView, type ViewState } from "./view.js";

async function start(): Promise<void> {
  installTheme();
  const params = new URLSearchParams(location.search);
  let bridge: Bridge | null = windowBridge();
  const harness = !bridge;
  if (!bridge) {
    // ?sf=<file>: the harness loads a SoundFont served next to it, to test the sound path.
    const sf = params.get("sf");
    const song = await harnessSong(params);
    const fakeAi = harnessAi(params.get("ai"), song);
    const memory = memoryBridge(song, {
      locale: params.get("lang") ?? "es-ES",
      soundFont: async () => (sf ? (await fetch(sf)).arrayBuffer() : null),
      // Two installed banks, by their headers only (their sound does not load in the harness).
      sounds: [
        { id: "YDP-GrandPiano-20160804.sf2", name: "YDP Grand Piano", presets: [{ name: "Grand Piano", program: 0, bankMSB: 0 }], bytes: 118398836, inUserFolder: true },
        {
          id: "Sonatina_Symphonic_Orchestra.sf2",
          name: "Sonatina Symphonic Orchestra",
          presets: ["Steinway Concert Gra", "Concert Harp", "1st Violins Sustain", "1st Violins Pizz.", "Cello Section Sustai"].map((name, program) => ({ name, program, bankMSB: 0 })),
          bytes: 494723490,
          inUserFolder: false,
        },
      ],
      // The built-in skills, one of the user's and one of theirs that replaces a built-in one (off).
      skills: [
        ...["four-hands-basics", "feelings-to-music", "jury", "listening-review", "orchestration-register", "styles"].map((name) => ({
          name,
          description: "",
          origin: "built-in" as const,
          enabled: true,
          replacesBuiltIn: false,
          files: name === "styles" ? 3 : 0,
        })),
        { name: "mi-armonia", description: "Cómo armonizo: pedales largos, nunca doblo la tercera y las cadencias se quedan abiertas.", origin: "user", enabled: true, replacesBuiltIn: false, files: 0 },
      ],
      // ?fichas=1: a library card in the user's catalog (Fran, 05/11/2026), for the captures and tests.
      libraries:
        params.get("fichas") === "1"
          ? [
              {
                id: "libviolas",
                name: "Symphonic Strings · Violas",
                host: "Kontakt 8",
                velocity: { state: "weak", note: "sobre todo de v80 arriba" },
                expression: { state: "yes" },
                modulation: { state: "untested" },
                range: { low: 36, high: 84 },
                keyswitches: [
                  { pitch: 24, name: "Sustain" },
                  { pitch: 25, name: "Staccato" },
                  { pitch: 26, name: "Pizzicato" },
                  { pitch: 27, name: "Trémolo" },
                ],
                ownReverb: "off",
                notes: "Los trémolos suenan unos 3 dB más fuertes.",
                updated: { by: "ai", at: Date.UTC(2026, 10, 5, 12), why: "tras la prueba de dinámica" },
              },
            ]
          : [],
      // A pretend engine with two instruments and an effect (prueba S2); ?engine=0: not built.
      ...(params.get("engine") === "0"
        ? {}
        : {
            enginePlugins: [
              { id: "VST3-Kontakt 8-1", name: "Kontakt 8", vendor: "Native Instruments", category: "Instrument|Sampler", format: "VST3", instrument: true },
              { id: "VST3-Four Hands Test Synth-2", name: "Four Hands Test Synth", vendor: "Four Hands", category: "Instrument|Synth", format: "VST3", instrument: true },
              { id: "VST3-Ozone 11-3", name: "Ozone 11", vendor: "iZotope", category: "Fx|Mastering", format: "VST3", instrument: false },
              // ?plugins=fran: instruments like the ones on Fran's computer (prueba S2), for the captures.
              ...(params.get("plugins") === "fran"
                ? (
                    [
                      ["Omnisphere", "Spectrasonics", "Instrument|Synth"],
                      ["Serum 2", "Xfer Records", "Instrument|Synth"],
                      ["Nexus", "reFX", "Instrument|Synth"],
                      ["EZkeys 2", "Toontrack", "Instrument"],
                      ["EZdrummer 3", "Toontrack", "Instrument|Drum"],
                      ["Grand Rhapsody Piano Stereo", "Waves", "Instrument"],
                      ["Electric88 Stereo", "Waves", "Instrument"],
                      ["CR8 Sampler Stereo", "Waves", "Instrument|Sampler"],
                      ["Bass Slapper Stereo", "Waves", "Instrument"],
                      ["Captain Chords Epic", "Mixed In Key", "Instrument"],
                      ["Serato Sample", "Serato", "Instrument|Sampler"],
                    ] as const
                  )
                    .map(([name, vendor, category], i): EnginePlugin => ({ id: `VST3-${name}-${i + 10}`, name, vendor, category, format: "VST3", instrument: true }))
                    .concat(
                      // Effect plugins like a working studio's (F2.2 parte C: the organised browser).
                      (
                        [
                          ["Pro-Q 3", "FabFilter", "Fx|EQ"], ["Pro-C 2", "FabFilter", "Fx|Dynamics"], ["Pro-L 2", "FabFilter", "Fx|Mastering"], ["Pro-R", "FabFilter", "Fx|Reverb"], ["Saturn 2", "FabFilter", "Fx|Distortion"],
                          ["ValhallaVintageVerb", "Valhalla DSP, LLC", "Fx|Reverb"], ["ValhallaSupermassive", "Valhalla DSP, LLC", "Fx|Reverb"], ["ValhallaDelay", "Valhalla DSP, LLC", "Fx|Delay"],
                          ["Decapitator", "Soundtoys", "Fx"], ["EchoBoy", "Soundtoys", "Fx"], ["MicroShift", "Soundtoys", "Fx"],
                          ["CLA-76 Stereo", "Waves", "Fx"], ["CLA-2A Stereo", "Waves", "Fx"], ["H-Delay Stereo", "Waves", "Fx"], ["Renaissance Reverb Stereo", "Waves", "Fx"], ["SSL G-Master Buss Compressor Stereo", "Waves", "Fx"], ["L2 Stereo", "Waves", "Fx"], ["CLA Effects Stereo", "Waves", "Fx"], ["Classic EQ", "Waves", "Fx"],
                          ["Neutron 4", "iZotope", "Fx|Dynamics"], ["RX 10 De-click", "iZotope", "Fx|Restoration"],
                          ["Pro EQ3", "PreSonus", "Fx|EQ"], ["Room Reverb", "PreSonus", "Fx|Reverb"], ["Analog Delay", "PreSonus", "Fx|Delay"], ["Chorus", "PreSonus", "Fx|Modulation"],
                        ] as const
                      ).map(([name, vendor, category], i): EnginePlugin => ({ id: `VST3-${name}-${i + 40}`, name, vendor, category, format: "VST3", instrument: false })),
                    )
                : []),
            ],
          }),
    });
    if (fakeAi) memory.setAi(fakeAi);
    bridge = memory;
  }
  const info = await bridge.info();
  const lang = langFrom(params.get("lang") ?? info.locale);
  document.documentElement.lang = lang;
  const replica = new Replica(bridge);
  await replica.init();
  const ai = new AiStore(bridge);
  await ai.init();
  const view = new ViewStore(initialView(lang));
  // The harness can open the view the sketch shows: ?view={"startTick":…}
  const preset = params.get("view");
  if (preset) {
    const changes = JSON.parse(preset) as Partial<ViewState>;
    // A preset scroll is kept: no automatic centring on the active track.
    if (changes.scrollY !== undefined) changes.centredTrack = activeTrack(replica.song)?.id ?? null;
    view.set(changes);
  }
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  const root = createRoot(document.getElementById("root")!);
  // The harness exposes the window's state to the interface tests (scripts/interaccion.mjs).
  const t = translator(lang);
  const audio = new AudioLayer(replica, bridge, t);
  const onEditor = harness ? (editor: unknown) => Object.assign(window, { fhTest: { replica, view, editor, audio, ai: bridge } }) : undefined;
  root.render(
    <Ctx.Provider value={{ replica, view, bridge, t, lang, ai }}>
      {onEditor ? <App audio={audio} onEditor={onEditor} /> : <App audio={audio} />}
    </Ctx.Provider>,
  );
  // The SoundFont takes a few seconds: the window works meanwhile.
  void audio.init();
  (window as unknown as { fhReady?: boolean }).fhReady = true;
}

void start();
