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
  // H3.2: mix in the track headers, track colours, notes in the track colour, label over a note.
  // 15/10/2026: taller rows, wider names with a shorter arrangement, the zoom tool on both.
  { name: "zoom_filas_21", q: `?song=boceto&view=${view({ rowHeight: 21, startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 21 })}` },
  { name: "paneles_nombres_anchos", q: `?song=boceto&view=${view({ headerWidth: 300, arrHeight: 170, panelWidth: 340, startTick: 16 * BAR, pxPerTick: (1440 - 340 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: async (page) => {
    await page.locator(".split.arrsplit").hover();
  } },
  { name: "lupa_arreglo", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.keyboard.press("4");
    const b = await page.locator(".lanes canvas").boundingBox();
    await page.mouse.click(b.x + b.width * 0.4, b.y + 60);
    await page.waitForTimeout(300);
    await page.mouse.move(b.x + 200, b.y + 300);
  } },
  { name: "h32_autoria_apagada", q: `?song=boceto&view=${view({ authorship: false, startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}` },
  { name: "h32_etiqueta_nota", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.mouse.move(385, 620);
    await page.mouse.move(386, 620);
    await page.waitForTimeout(600);
  } },
  { name: "h32_menu_color", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".thdr").nth(3).click({ button: "right", position: { x: 120, y: 12 } });
    await page.getByRole("menuitem", { name: /^Color/ }).click();
  } },
  { name: "h32_escribir_volumen", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".tmix .mixval").nth(4).dblclick();
    await page.keyboard.type("-6,5");
  } },
  { name: "h32_tarjeta_mezcla", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".thdr").nth(1).click({ button: "right", position: { x: 120, y: 12 } });
    await page.getByRole("menuitem", { name: /Volumen/ }).click();
  } },
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
  if (s.act) await s.act(page).catch((e) => errors.push(String(e)));
  const file = path.join(outDir, `${s.name}.png`);
  await page.screenshot({ path: file });
  if (errors.length) failed = true;
  console.log(file, errors.length ? errors : "ok");
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
