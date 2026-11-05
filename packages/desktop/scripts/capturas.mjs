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
/** Tempo and key changes for the H4 shots: 72 at 41.3, accel. to 80 at 43, 72 at 45, rit. to 58 at 49, fermata at 50.3, C major from 45. */
async function tempoSong(page) {
  await page.evaluate((bar) => {
    const us = (b) => Math.round(60_000_000 / b);
    window.fhTest.replica.run("x", [
      { type: "setTempoChanges", points: [
        { tick: 40 * bar + 1920, tempo: us(72) },
        { tick: 42 * bar, tempo: us(80), ramp: true },
        { tick: 44 * bar, tempo: us(72) },
        { tick: 48 * bar, tempo: us(58), ramp: true },
        { tick: 49 * bar + 1920, tempo: us(58) * 2 },
        { tick: 49 * bar + 2880, tempo: us(58) },
      ] },
      { type: "setKeyChanges", changes: [{ tick: 44 * bar, key: { fifths: 0, mode: "major" } }] },
    ]);
  }, BAR);
  await page.waitForTimeout(300);
}

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

/** Proposal mode (H4): Claude's counter-line on the active track, c. 21–22, ends as a proposal. */
async function aiProposal(page) {
  await page.evaluate((bar) => {
    const doc = window.fhTest.ai.doc;
    const claude = { by: "ai", client: "claude-ai" };
    const t = doc.song.context.activeTrackId ?? doc.song.trackOrder[0];
    doc.transact({ actor: claude, label: "Respuesta a la melodía, c. 21–22", group: "i8" }, (tx) => {
      [76, 74, 72, 71, 69].forEach((pitch, i) => {
        const id = `n${9100 + i}`;
        tx.set(["notes", id], { id, trackId: t, pitch, start: 20 * bar + 1920 + i * 960, duration: 900, velocity: 70, createdBy: claude, shapedBy: claude });
      });
    });
    doc.closeGroup("i8");
    doc.liftLastStep("i8");
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
    await page.getByRole("menuitem", { name: /^Mezcla/ }).click();
  } },
  // H4: tempo and key changes. Bars 41–52 of the sketch: an accelerando, a jump, a ritardando, a fermata and a key change.
  { name: "tempo_reglas", q: `?song=boceto&view=${view({ startTick: 40 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: tempoSong },
  { name: "tempo_escribir", q: `?song=boceto&view=${view({ startTick: 40 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: async (page) => {
    await tempoSong(page);
    await page.locator(".rrow.tempo .rfill").dblclick({ position: { x: 300, y: 12 } });
    await page.keyboard.type("rit 60");
  } },
  { name: "tempo_menu_regla", q: `?song=boceto&view=${view({ startTick: 40 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: async (page) => {
    await tempoSong(page);
    await page.locator(".tmark.tramp").first().click({ button: "right" });
  } },
  { name: "tempo_menu_compases", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".rrow.bars").click({ button: "right", position: { x: 420, y: 12 } });
  } },
  { name: "tempo_barra_superior", q: `?song=boceto&view=${view({ startTick: 40 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - 86) * 15 })}`, act: async (page) => {
    await tempoSong(page);
    await page.evaluate((bar) => window.fhTest.replica.setContext({ cursor: 50 * bar }), BAR);
    await page.waitForTimeout(300);
    await page.locator(".topbar .fbtn").first().hover();
    await page.waitForTimeout(900);
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
  // H4 (26/10/2026): proposal mode, off by default. The setting, the proposal bar and its notes.
  { name: "propuesta_ajuste", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.locator(".askmanage").click();
    await page.waitForSelector(".skillspanel .skill");
    await page.locator('.skillspanel [data-apply="proposal"]').click();
    await page.waitForTimeout(200);
  } },
  { name: "propuesta_barra", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: aiProposal },
  { name: "propuesta_sin", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await aiProposal(page);
    await page.keyboard.press("b");
    await page.waitForTimeout(200);
  } },
  { name: "propuesta_desactualizada", q: `?song=boceto&ai=conectada&view=${sketchView(1440 - 288 - 72, 12)}`, act: async (page) => {
    await page.evaluate(() => {
      const doc = window.fhTest.ai.doc;
      const claude = { by: "ai", client: "claude-ai" };
      const t = doc.song.context.activeTrackId ?? doc.song.trackOrder[0];
      const first = Object.values(doc.song.notes).filter((n) => n.trackId === t).sort((a, b) => a.start - b.start)[0];
      doc.transact({ actor: claude, label: "Más presencia en la melodía", group: "i9" }, (tx) => tx.set(["notes", first.id, "velocity"], 110));
      doc.closeGroup("i9");
      doc.liftLastStep("i9");
      window.fhTest.replica.run("x", [{ type: "updateNotes", changes: [{ id: first.id, velocity: 60 }] }]);
    });
    await page.waitForTimeout(400);
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
  // F2.2 parte B (03/11/2026): the console, with the sketch's levels (the pretend engine gives the
  // same reading every time) and the engine's load, as mezcla_1 to mezcla_4 of the approved sketch.
  { name: "mezcla_1_consola", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: consoleLevels },
  { name: "mezcla_2_ampliada", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: consoleLevels },
  { name: "mezcla_3_compacta_880", w: 880, h: 800, q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: consoleLevels },
  { name: "mezcla_4_estrecha", q: `?song=boceto&view=${view({ bottom: "mix", mixNarrow: true })}`, act: consoleLevels },
  { name: "mezcla_5_carga_alta", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: (page) => consoleLevels(page, { avgLoad: 0.78, maxLoad: 0.93, dropouts: 0 }) },
  { name: "mezcla_6_audio_cortado", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: (page) => consoleLevels(page, { avgLoad: 0.96, maxLoad: 1.4, dropouts: 2 }) },
  { name: "mezcla_7_solo_y_master", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => {
    await page.evaluate(() => {
      const r = window.fhTest.replica;
      r.run("x", [{ type: "updateTrack", id: r.song.trackOrder[2], changes: { solo: true } }, { type: "updateTrack", id: r.song.trackOrder[4], changes: { mute: true } }, { type: "setSongProperties", props: { masterVolume: 0.9 } }]);
    });
    await consoleLevels(page);
  } },
  // F2.2 parte C1 (03/11/2026): effects in the slots, one bypassed, one plugin that failed, the Master's limiter.
  { name: "efectos_1_consola", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => { await withEffects(page); await consoleLevels(page); } },
  { name: "efectos_2_estrecha", q: `?song=boceto&view=${view({ bottom: "mix", mixNarrow: true })}`, act: async (page) => { await withEffects(page); await consoleLevels(page); } },
  { name: "efectos_3_menu_anadir", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => {
    await withEffects(page);
    await consoleLevels(page);
    await page.locator('.cstrip[data-track]').nth(1).locator("button.cslot.add").click();
    await page.waitForTimeout(200);
  } },
  { name: "efectos_4_menu_efecto", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => {
    await withEffects(page);
    await consoleLevels(page);
    await page.locator(".cslot[data-fx]").nth(1).click({ button: "right" });
    await page.waitForTimeout(200);
  } },
  // Fran, 04/11/2026: many plugins, organised. The short «+» menu, and the effects in Sonidos.
  { name: "efectos_5_menu_corto", q: `?song=boceto&plugins=fran&view=${view({ bottom: "mix" })}`, act: async (page) => {
    await page.evaluate(async () => {
      const { audio } = window.fhTest;
      audio.updateSoundPrefs((p) => ({ ...p, favorites: ["plugin:VST3-Pro-Q 3-40", "plugin:VST3-ValhallaVintageVerb-45"], recents: ["plugin:VST3-Decapitator-48", "plugin:VST3-CLA-76 Stereo-51"] }));
    });
    await consoleLevels(page);
    await page.locator('.cstrip[data-track]').nth(1).locator("button.cslot.add").click();
    await page.waitForTimeout(200);
  } },
  { name: "efectos_6_sonidos_tipo", q: `?song=boceto&plugins=fran&view=${view({ bottom: "mix", panelOpen: true, panelTab: "sounds" })}`, act: async (page) => {
    await page.evaluate(() => window.fhTest.audio.updateSoundPrefs((p) => ({ ...p, favorites: ["plugin:VST3-Pro-Q 3-40"] })));
    await page.getByRole("radio", { name: "Efectos" }).click();
    await page.locator(".sndgh", { hasText: "Reverbs" }).click();
    await page.waitForTimeout(300);
  } },
  { name: "efectos_7_sonidos_fabricante", q: `?song=boceto&plugins=fran&view=${view({ bottom: "mix", panelOpen: true, panelTab: "sounds" })}`, act: async (page) => {
    await page.getByRole("radio", { name: "Efectos" }).click();
    await page.getByRole("radio", { name: "Fabricante" }).click();
    await page.locator(".sndgh", { hasText: "FabFilter" }).click();
    await page.waitForTimeout(300);
  } },
  { name: "efectos_8_nombre", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => {
    await page.evaluate(async () => {
      const { replica } = window.fhTest;
      const t2 = replica.song.trackOrder[2];
      await replica.run("x", [{ type: "addInsert", target: t2, spec: { kind: "eq" } }, { type: "addInsert", target: t2, spec: { kind: "eq" } }, { type: "addInsert", target: t2, spec: { kind: "eq" } }]);
      const [a, b, c] = replica.song.tracks[t2].inserts.map((x) => x.id);
      await replica.run("x", [{ type: "updateInsert", id: a, changes: { name: "EQ graves" } }, { type: "updateInsert", id: b, changes: { name: "EQ medios" } }, { type: "updateInsert", id: c, changes: { name: "EQ efectos" } }]);
    });
    await consoleLevels(page);
  } },
  // F2.2 parte C2 (04/11/2026): the window of Four Hands' own effects.
  ...[
    ["ventana_eq", { kind: "eq", params: { lowCut: 1, lowCutFreq: 90, lowGain: -2, lowMidFreq: 320, lowMidGain: -3.5, lowMidQ: 1.4, highMidFreq: 3200, highMidGain: 2.5, highMidQ: 0.8, highGain: 3, highFreq: 9000 } }, "EQ medios"],
    ["ventana_compresor", { kind: "compressor", params: { threshold: -24, ratio: 4, attack: 8, release: 140, knee: 6, makeup: 4 } }, null],
    ["ventana_limitador", { kind: "limiter", params: { gain: 4, ceiling: -1, release: 60 } }, null],
    // Fran, 04/11/2026: the delay, in time with the song, and in ms.
    ["ventana_delay", { kind: "delay", params: { note: 6, feedback: 45, pingPong: 1 } }, null],
    ["ventana_delay_ms", { kind: "delay", params: { sync: 0, time: 320, feedback: 30, mix: 25 } }, null],
  ].map(([name, spec, rename]) => ({
    name,
    q: `?song=boceto&view=${view({ bottom: "mix" })}`,
    act: async (page) => {
      const id = await page.evaluate(async ([spec, rename]) => {
        const { replica, ai } = window.fhTest;
        ai.engine.reduction = spec.kind === "eq" ? undefined : spec.kind === "compressor" ? 5.2 : 2.4;
        const target = spec.kind === "limiter" ? "master" : replica.song.trackOrder[2];
        await replica.run("x", [{ type: "addInsert", target, spec }]);
        const chain = target === "master" ? replica.song.masterInserts : replica.song.tracks[target].inserts;
        const id = chain.at(-1).id;
        if (rename) await replica.run("x", [{ type: "updateInsert", id, changes: { name: rename } }]);
        return id;
      }, [spec, rename]);
      await consoleLevels(page);
      await page.locator(`.cslot[data-fx="${id}"]`).dblclick();
      await page.waitForTimeout(500);
    },
  })),
  // F2.2 parte D (04/11/2026): buses and sends, as the approved sketch: Cuerdas (a subgroup of the
  // melody and the countermelody) into Mix bus, a Delay return, the «Reverb» bus every song has.
  { name: "buses_1_consola", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => { await withBuses(page); await consoleLevels(page); } },
  { name: "buses_2_con_arreglo", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: async (page) => { await withBuses(page); await consoleLevels(page); } },
  { name: "buses_3_estrecha", q: `?song=boceto&view=${view({ bottom: "mix", mixNarrow: true, mixMax: true })}`, act: async (page) => { await withBuses(page); await consoleLevels(page); } },
  { name: "buses_4_menu_salida", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => {
    await withBuses(page);
    await consoleLevels(page);
    await page.locator('.cstrip[data-track]').nth(1).locator("button.cout").click();
    await page.waitForTimeout(200);
  } },
  { name: "buses_5_menu_envio", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => {
    await withBuses(page);
    await consoleLevels(page);
    await page.locator('.cstrip[data-track]').nth(4).locator("button.csend.add").click();
    await page.waitForTimeout(200);
  } },
  { name: "buses_6_menu_bus", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => {
    await withBuses(page);
    await consoleLevels(page);
    await page.locator('.cstrip.bus .cname').nth(1).click({ button: "right" });
    await page.waitForTimeout(200);
  } },
  { name: "buses_7_ventana_reverb", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => {
    await withBuses(page);
    await consoleLevels(page);
    await page.locator('.cstrip.bus[data-bus="b1"] .cslot[data-fx]').first().dblclick();
    await page.waitForTimeout(500);
  } },
  { name: "buses_8_borrado", q: `?song=boceto&view=${view({ bottom: "mix", mixMax: true })}`, act: async (page) => {
    await withBuses(page);
    await consoleLevels(page);
    await page.locator('.cstrip.bus .cname').nth(1).click();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(500);
  } },
  // The Mezcla / Editor button (Fran, 03/11/2026: at the start of the bar).
  // Library cards (Fran, 05/11/2026): the violas in Kontakt with their card, without one, editing it.
  ...[
    ["ficha_1_llena", true, 52, null],
    ["ficha_2_vacia", false, 52, null],
    ["ficha_3_editar", true, 52, "Editar ficha"],
    ["ficha_4_rango_agudo", true, 92, null],
    ["ficha_5_articulaciones", true, 39, null],
    ["ficha_6_otra", true, 52, "Usar otra ficha…"],
  ].map(([name, linked, top, click]) => ({
    name,
    q: `?song=boceto&plugins=fran&fichas=1&view=${view({ startTick: 16 * BAR, pxPerTick: (1440 - 288 - 72) / 12 / BAR, scrollY: (127 - top) * 15, panelOpen: true, panelTab: "track" })}`,
    act: async (page) => {
      await page.evaluate(async (linked) => {
        const r = window.fhTest.replica;
        const id = r.song.trackOrder[3];
        const changes = { name: "Violas", output: "plugin", plugin: { id: "VST3-Kontakt 8-1", name: "Kontakt 8" } };
        if (linked) changes.library = { id: "libviolas", name: "Symphonic Strings · Violas" };
        await r.run("x", [{ type: "updateTrack", id, changes }]);
        r.setContext({ activeTrackId: id });
      }, linked);
      await page.waitForTimeout(400);
      await page.evaluate((top) => window.fhTest.view.set({ scrollY: (127 - top) * 15 }), top);
      if (click) await page.getByRole("button", { name: click }).click();
      await page.waitForTimeout(400);
    },
  })),
  { name: "boton_mezcla_editor", q: `?song=boceto&view=${sketchView(1440 - 288 - 72, 12)}` },
  { name: "boton_mezcla_consola", q: `?song=boceto&view=${view({ bottom: "mix" })}`, act: consoleLevels },
  { name: "boton_mezcla_editor_880", w: 880, h: 800, q: `?song=boceto&view=${sketchView(880 - 48 - 56, 8)}` },
];

/** Buses like a real mix (F2.2 parte D): Cuerdas → Mix bus, a Delay return, sends to the reverb. */
async function withBuses(page) {
  await page.evaluate(async () => {
    const { replica } = window.fhTest;
    const [t0, t1, t2, t3, t4] = replica.song.trackOrder;
    await replica.run("x", [
      { type: "addBus", spec: { name: "Reverb", color: 4 } }, // b1
      { type: "addBus", spec: { name: "Cuerdas", color: 2 } }, // b2
      { type: "addBus", spec: { name: "Delay", color: 6 } }, // b3
      { type: "addBus", spec: { name: "Mix bus", color: 8 } }, // b4
    ]);
    await replica.run("x", [
      { type: "addInsert", target: "b1", spec: { kind: "reverb" } },
      { type: "addInsert", target: "b2", spec: { kind: "eq" } },
      { type: "addInsert", target: "b2", spec: { kind: "compressor" } },
      { type: "addInsert", target: "b3", spec: { kind: "plugin", plugin: { id: "VST3-ValhallaDelay-1", name: "ValhallaDelay" } } },
      { type: "addInsert", target: "b4", spec: { kind: "compressor" } },
      { type: "setOutput", source: "b2", bus: "b4" },
      { type: "setOutput", source: "b3", bus: "b4" },
      { type: "setOutput", source: "b1", bus: "b4" },
      { type: "setOutput", source: t2, bus: "b2" },
      { type: "setOutput", source: t3, bus: "b2" },
      { type: "setOutput", source: t0, bus: "b4" },
      { type: "setOutput", source: t1, bus: "b4" },
      { type: "setSend", source: t0, bus: "b1", changes: { level: 0.35 } },
      { type: "setSend", source: t1, bus: "b1", changes: { level: 0.2 } },
      { type: "setSend", source: t2, bus: "b1", changes: { level: 0.45 } },
      { type: "setSend", source: t3, bus: "b1", changes: { level: 0.4 } },
      { type: "setSend", source: t2, bus: "b3", changes: { level: 0.25, pre: true } },
      { type: "setSend", source: t4, bus: "b1", changes: { level: 0.1 } },
      { type: "updateBus", id: "b3", changes: { volume: 0.85 } },
    ]);
  });
}

/** Effects like a real mix: EQ and compressor on the melody, Pro-Q on the piano, an EQ bypassed, a limiter on the Master. */
async function withEffects(page) {
  await page.evaluate(async () => {
    const { replica, ai } = window.fhTest;
    const [t0, t1, t2, t3] = replica.song.trackOrder;
    ai.engine.failPlugin = "VST3-Ozone 11-3";
    await replica.run("x", [
      { type: "addInsert", target: t1, spec: { kind: "plugin", plugin: { id: "VST3-Pro-Q 3-9", name: "Pro-Q 3" } } },
      { type: "addInsert", target: t2, spec: { kind: "eq" } },
      { type: "addInsert", target: t2, spec: { kind: "compressor" } },
      { type: "addInsert", target: t2, spec: { kind: "plugin", plugin: { id: "VST3-Ozone 11-3", name: "Ozone 11" } } },
      { type: "addInsert", target: t3, spec: { kind: "eq" } },
      { type: "addInsert", target: "master", spec: { kind: "limiter" } },
    ]);
    const eq = replica.song.tracks[t3].inserts[0].id;
    await replica.run("x", [{ type: "updateInsert", id: eq, changes: { bypass: true } }]);
    void t0;
  });
  await page.waitForTimeout(300);
}

/** Steady levels on every track's strip (peak a few dB over the RMS), the master, and the engine's load. */
async function consoleLevels(page, load = { avgLoad: 0.23, maxLoad: 0.31, dropouts: 0 }) {
  await page.evaluate((load) => {
    const { replica, audio, ai } = window.fhTest;
    const dbs = [[-23.1, -40], [-16.8, -34], [-11.2, -27.4], [-19.2, -35.1], [-21.7, -37.5], [-15.4, -41.4], [-20.3, -42.6], [-24, -44]];
    const lin = (db) => Math.pow(10, db / 20);
    const channels = Array.from({ length: 64 }, () => ({ peak: 0, rms: 0, clips: 0 }));
    replica.song.trackOrder.forEach((id, i) => {
      const [peak, rms] = dbs[i % dbs.length];
      channels[audio.stripOf(replica.song.tracks[id])] = { peak: lin(peak), rms: lin(rms), clips: i === 2 ? 1 : 0 };
    });
    // Parte D: the buses' meters too.
    const buses = Array.from({ length: 16 }, (_, i) => ({ peak: lin(-14 - i * 4), rms: lin(-30 - i * 4), clips: 0 }));
    ai.engine.meters = { channels, master: { peak: lin(-9.6), rms: lin(-27.9), clips: 0 }, buses };
    ai.engine.load = load;
  }, load);
  // The meters settle and the load is read (every second).
  await page.waitForTimeout(1600);
}

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
