/** Starts the window: theme, bridge, replica, view, then React. */
import { createRoot } from "react-dom/client";
import { langFrom, translator } from "../shared/i18n.js";
import { App } from "./App.js";
import { type Bridge, memoryBridge, windowBridge } from "./bridge.js";
import { Ctx, activeTrack } from "./context.js";
import { harnessSong } from "./harness.js";
import { Replica } from "./replica.js";
import { installTheme } from "./theme.js";
import { ViewStore, initialView, type ViewState } from "./view.js";

async function start(): Promise<void> {
  installTheme();
  const params = new URLSearchParams(location.search);
  let bridge: Bridge | null = windowBridge();
  const harness = !bridge;
  if (!bridge) bridge = memoryBridge(await harnessSong(params), { locale: params.get("lang") ?? "es-ES" });
  const info = await bridge.info();
  const lang = langFrom(params.get("lang") ?? info.locale);
  document.documentElement.lang = lang;
  const replica = new Replica(bridge);
  await replica.init();
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
  const onEditor = harness ? (editor: unknown) => Object.assign(window, { fhTest: { replica, view, editor } }) : undefined;
  root.render(
    <Ctx.Provider value={{ replica, view, bridge, t: translator(lang), lang }}>
      <App onEditor={onEditor} />
    </Ctx.Provider>,
  );
  (window as unknown as { fhReady?: boolean }).fhReady = true;
}

void start();
