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
