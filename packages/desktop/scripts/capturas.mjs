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
/** Claude writes four cello notes in c. 21–22 as one intervention, and ends it. */
async function aiIntervention(page) {
  await page.evaluate((bar) => {
    const doc = window.fhTest.ai.doc;
    const claude = { by: "ai", client: "claude-ai" };
    const cello = doc.song.trackOrder.find((id) => /chelo|cello/i.test(doc.song.tracks[id].name)) ?? doc.song.trackOrder[0];
    doc.transact({ actor: claude, label: "Contracanto del chelo, c. 21–22", group: "i7" }, (tx) => {
      [50, 52, 53, 55].forEach((pitch, i) => {
        const id = `n${9000 + i}`;
        tx.set(["notes", id], { id, trackId: cello, pitch, start: 20 * bar + i * 1920, duration: 1800, velocity: 76, createdBy: claude, shapedBy: claude });
      });
    });
    doc.closeGroup("i7");
  }, BAR);
  await page.waitForTimeout(400);
}

/** The active track gets a crescendo over c. 17–20 and a swell on the long note of c. 23–24. */
async function expressionCurve(page) {
  await page.evaluate((bar) => {
    const r = window.fhTest.replica;
    const t = r.song.context.activeTrackId ?? r.song.trackOrder[0];
    const ramp = (from, to, a, b) => {
      const n = (to - from) / 240;
      return Array.from({ length: n }, (_, k) => ({ tick: from + k * 240, value: Math.round(a + ((b - a) * k) / (n - 1)) }));
    };
    return r.run("x", [
      { type: "setCurve", trackId: t, kind: "expression", from: 16 * bar, to: 20 * bar, points: ramp(16 * bar, 20 * bar, 45, 110) },
      { type: "setCurve", trackId: t, kind: "expression", from: 22 * bar, to: 24 * bar, points: [...ramp(22 * bar, 23 * bar, 70, 118), ...ramp(23 * bar, 24 * bar, 118, 60)] },
    ]);
  }, BAR);
  await page.waitForTimeout(300);
}

async function openMidiOutCard(page) {
  await page.locator(".thdr").nth(0).click({ button: "right", position: { x: 120, y: 12 } });
  await page.getByRole("menuitem", { name: /^Suena en/ }).click();
  await page.getByRole("menuitem", { name: /Configurar la salida MIDI/ }).click();
  await page.waitForTimeout(300);
}

/** Two tracks (strings and cello) sound in the DAW; the harness pretends loopMIDI has a port. */
async function midiOutSetup(page, port) {
  await page.evaluate(async (port) => {
    const { replica, audio } = window.fhTest;
    audio.outPorts = port ? [port, "Microsoft GS Wavetable Synth"] : [];
    audio.outName = port;
    if (port) audio.outPort = () => ({ send() {} });
    const ids = replica.song.trackOrder.filter((id) => /melod|chelo|cuerdas/i.test(replica.song.tracks[id].name));
    await replica.run("x", ids.map((id) => ({ type: "updateTrack", id, changes: { output: "external" } })));
    audio.changed();
  }, port);
  await page.waitForTimeout(300);
}

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
    const b = await page.locator(".lanes canvas:not(.arrhead)").boundingBox();
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
  { name: "notas_en_carriles", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.evaluate((bar) => window.fhTest.replica.run("x", [
      { type: "addAnnotation", spec: { start: 0, end: 40 * bar, trackIds: [], text: "Concepto: dos mitades que no se conocen; dura 1:20" } },
      { type: "addAnnotation", spec: { start: 17 * bar, end: 21 * bar, trackIds: [], text: "Lumon: el ostinato cojea contra el compás" } },
      { type: "addAnnotation", spec: { start: 18 * bar, end: 19 * bar, trackIds: [], text: "Hueco antes del bajo" } },
      { type: "addAnnotation", spec: { start: 18 * bar + 1920, end: 19 * bar, trackIds: [], text: "aquí entra el innie" } },
      { type: "addAnnotation", spec: { start: 24 * bar, end: 28 * bar, trackIds: [], text: "Disolución" } },
    ]), BAR);
    await page.waitForTimeout(300);
  } },
  // 20/10/2026: Skills de la IA, from the link next to the AI chip; Claude has used two of them.
  // 20/10/2026: the song concept at the top of the activity panel: empty, written by the AI, editing.
  { name: "concepto_vacio", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}` },
  { name: "concepto_de_la_ia", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.evaluate(() => window.fhTest.ai.doc.transact({ actor: { by: "ai", client: "claude-ai" }, label: "Concepto" }, (tx) =>
      tx.set(["concept"], { text: "Dilatación: el tiempo se estira sin romperse. Piano y cuerdas, sin percusión hasta el puente. Dura unos 3 minutos; se exportará a Kontakt.", author: { by: "ai", client: "claude-ai" } })));
    await page.waitForTimeout(300);
  } },
  { name: "concepto_editando", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".concept .dashbtn").click();
    await page.keyboard.type("Dilatación: el tiempo se estira sin romperse. Dura unos 3 minutos");
    await page.waitForTimeout(200);
  } },
  // 20/10/2026: Skills activas in the activity panel (sketch 01) and the card from "Gestionar skills…".
  { name: "skills_activas", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.evaluate(() => window.fhTest.ai.setAi({ clients: [{ client: "claude-ai", name: "Claude" }], reading: null, writing: [], mark: null, skillsUsed: ["four-hands-basics", "jury"] }));
    await page.waitForTimeout(200);
  } },
  { name: "skills_panel", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.evaluate(() => window.fhTest.ai.setAi({ clients: [{ client: "claude-ai", name: "Claude" }], reading: null, writing: [], mark: null, skillsUsed: ["four-hands-basics", "jury"] }));
    await page.locator(".askmanage").click();
    await page.waitForSelector(".skillspanel .skill");
    await page.locator('.skillspanel [data-skill="orchestration-register"] input').click();
    await page.waitForTimeout(300);
  } },
  { name: "skills_panel_ingles", q: `?song=boceto&lang=en&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".askmanage").click();
    await page.waitForSelector(".skillspanel .skill");
    await page.waitForTimeout(200);
  } },
  // H4 (20/10/2026): the AI's changes go straight in; Con / Sin to hear the last intervention without it.
  { name: "con_sin_barra", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: aiIntervention },
  { name: "con_sin_escuchando_sin", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await aiIntervention(page);
    await page.keyboard.press("b");
    await page.waitForTimeout(300);
  } },
  { name: "lo_que_ha_escrito_la_ia", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await aiIntervention(page);
    await page.evaluate((bar) => {
      const now = Date.now();
      const s = window.fhTest.replica.song;
      const id = (re) => s.trackOrder.find((t) => re.test(s.tracks[t].name));
      window.fhTest.ai.setAi({ clients: [{ client: "claude-ai", name: "Claude" }], reading: null, writing: [], mark: null, recent: [
        { id: "i7", name: "Claude", description: "Contracanto del chelo, c. 21–22", added: 4, changed: 0, removed: 0, trackIds: [id(/chelo/i)], start: 20 * bar, end: 22 * bar, at: now - 20_000 },
        { id: "i6", name: "Claude", description: "Respiro antes del coro: quito el bajo", added: 0, changed: 2, removed: 6, trackIds: [id(/contrabajo/i)], start: 31 * bar, end: 33 * bar, at: now - 6 * 60_000 },
        { id: "i5", name: "Claude", description: "Coro: cuerdas más abiertas", added: 18, changed: 9, removed: 4, trackIds: [id(/melod/i), id(/chelo/i), id(/órgano/i)], start: 36 * bar, end: 44 * bar, at: now - 14 * 60_000 },
      ] });
    }, BAR);
    await page.waitForTimeout(300);
  } },
  { name: "con_sin_compacta_880", w: 880, h: 800, q: `?song=boceto&ai=conectada&view=${sketchView(880 - 48 - 56, 8)}`, act: aiIntervention },
  // H4 (20/10/2026): Tu IA > Sus opiniones, direct by default; honesty is never optional.
  { name: "tu_ia_opiniones", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".askmanage").click();
    await page.waitForSelector(".skillspanel .skill");
    await page.waitForTimeout(200);
  } },
  { name: "tu_ia_con_tacto", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".askmanage").click();
    await page.waitForSelector(".skillspanel .skill");
    await page.locator('.skillspanel [data-tone="gentle"]').click();
    await page.waitForTimeout(200);
  } },
  // H4 (20/10/2026): expression and modulation lanes next to Velocidad and Pedal.
  { name: "curvas_expresion", q: `?song=boceto&view=${view({ lane: "expression", startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: expressionCurve },
  { name: "curvas_dibujando", q: `?song=boceto&view=${view({ lane: "expression", startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: async (page) => {
    await expressionCurve(page);
    const lane = await page.locator(".vlane canvas").boundingBox();
    await page.mouse.move(lane.x + 560, lane.y + lane.height - 12);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(lane.x + 560 + i * 18, lane.y + lane.height - 12 - Math.sin((i / 12) * Math.PI) * 50);
  } },
  { name: "curvas_modulacion_vacia", q: `?song=boceto&view=${view({ lane: "modulation", startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}` },
  { name: "curvas_compacta_880", w: 880, h: 800, q: `?song=boceto&view=${view({ lane: "expression", startTick: 16 * BAR, pxPerTick: (880 - 48 - 56) / 8 / BAR, scrollY: (127 - 86) * 15 })}`, act: expressionCurve },
  // H4 (20/10/2026): MIDI out to the user's DAW (Studio One with loopMIDI).
  { name: "salida_midi_tarjeta", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await midiOutSetup(page, "loopMIDI Port");
    await openMidiOutCard(page);
  } },
  { name: "salida_midi_sin_puerto", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await midiOutSetup(page, null);
    await openMidiOutCard(page);
  } },
  { name: "salida_midi_menu_pista", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await midiOutSetup(page, "loopMIDI Port");
    await page.locator(".thdr").nth(2).click({ button: "right", position: { x: 120, y: 12 } });
    await page.getByRole("menuitem", { name: /^Suena en/ }).click();
    await page.waitForTimeout(200);
  } },
  { name: "linea_reproduccion_arreglo", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.keyboard.press("Space");
    await page.waitForTimeout(2500);
  } },
  { name: "linea_reproduccion_arreglo_parado", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    const b = await page.locator(".rrow.bars").boundingBox().catch(() => null);
    if (b) await page.mouse.click(b.x + b.width * 0.45, b.y + 6);
    await page.waitForTimeout(300);
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
// FH_SHOTS=name1,name2 takes only those shots (names start with the given text).
const only = process.env.FH_SHOTS?.split(",").filter(Boolean);
for (const s of SHOTS.filter((x) => !only || only.some((o) => x.name.startsWith(o)))) {
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
