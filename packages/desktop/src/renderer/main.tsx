/** Starts the window: theme, bridge, replica, view, then React. */
import { createRoot } from "react-dom/client";
import { langFrom, translator } from "../shared/i18n.js";
import { App } from "./App.js";
import { type Bridge, memoryBridge, windowBridge } from "./bridge.js";
import { Ctx } from "./context.js";
import { harnessSong } from "./harness.js";
import { Replica } from "./replica.js";
import { installTheme } from "./theme.js";
import { ViewStore, initialView, type ViewState } from "./view.js";

async function start(): Promise<void> {
  installTheme();
  const params = new URLSearchParams(location.search);
  let bridge: Bridge | null = windowBridge();
  if (!bridge) bridge = memoryBridge(await harnessSong(params), { locale: params.get("lang") ?? "es-ES" });
  const info = await bridge.info();
  const lang = langFrom(params.get("lang") ?? info.locale);
  document.documentElement.lang = lang;
  const replica = new Replica(bridge);
  await replica.init();
  const view = new ViewStore(initialView(lang));
  // The harness can open the view the sketch shows: ?view={"startTick":…}
  const preset = params.get("view");
  if (preset) view.set(JSON.parse(preset) as Partial<ViewState>);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <Ctx.Provider value={{ replica, view, bridge, t: translator(lang), lang }}>
      <App />
    </Ctx.Provider>,
  );
  (window as unknown as { fhReady?: boolean }).fhReady = true;
}

void start();
