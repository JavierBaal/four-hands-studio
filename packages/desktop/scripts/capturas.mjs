// Screenshots of the window in a plain browser (the harness), to compare with bocetos/capturas.
// Usage: node build.mjs --harness && node scripts/capturas.mjs <output folder> [chromium path]
// Shots: 01 like capture 01 (sketch data, 1440 × 900), 05 compact at 880, Dilatación as the app
// opens it the first time, an empty song and the English interface.
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "dist", "harness");
const outDir = path.resolve(process.argv[2] ?? "capturas");
const executablePath = process.argv[3] ?? process.env.FH_CHROMIUM ?? undefined;
fs.mkdirSync(outDir, { recursive: true });

const BAR = 3840;
const view = (o) => encodeURIComponent(JSON.stringify(o));
const sketchView = (width, bars) => view({ startTick: 16 * BAR, pxPerTick: width / bars / BAR, scrollY: (127 - 86) * 15 });
export const SHOTS = [
  { name: "01_pantalla_completa", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}` },
  { name: "04_panel_plegado", q: `?song=boceto&view=${view({ panelOpen: false, startTick: 16 * BAR, pxPerTick: (1440 - 48 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}` },
  { name: "05_compacta_880", w: 880, h: 800, q: `?song=boceto&view=${sketchView(880 - 48 - 56, 8)}` },
  { name: "dilatacion_primera_vez", q: "" },
  { name: "cancion_vacia", q: "?song=empty" },
  { name: "ingles", q: "?lang=en" },
  // The AI (H3), to compare with capture 07: chip, writing bar, mark and edge tab.
  { name: "07_ia_escribiendo", q: `?song=boceto&ai=escribiendo&view=${sketchView(1440 - 288 - 72, 12)}` },
  { name: "07_ia_borde", q: `?song=boceto&ai=fuera&view=${sketchView(1440 - 288 - 72, 12)}` },
  { name: "07_ia_conectada_880", w: 880, h: 800, q: `?song=boceto&ai=conectada&view=${sketchView(880 - 48 - 56, 8)}` },
  { name: "07_ia_leyendo", q: `?song=boceto&ai=leyendo&view=${sketchView(1440 - 288 - 72, 12)}` },
];

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mid": "audio/midi", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = http
  .createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  })
  .listen(0);
const port = server.address().port;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let failed = false;
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w ?? 1440, height: s.h ?? 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/index.html${s.q}`);
  await page.waitForFunction(() => window.fhReady === true, null, { timeout: 15000 }).catch(() => errors.push("the window did not start"));
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${s.name}.png`);
  await page.screenshot({ path: file });
  if (errors.length) failed = true;
  console.log(file, errors.length ? errors : "ok");
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
