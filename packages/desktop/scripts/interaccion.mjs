// Interface tests of the piano roll gestures (ESPEC_PIANO_ROLL.md), in a real browser against the
// harness. Usage: node build.mjs --harness && node scripts/interaccion.mjs [chromium path]
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "dist", "harness");
const executablePath = process.argv[2] ?? process.env.FH_CHROMIUM ?? undefined;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mid": "audio/midi", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); // H3.2: the arrangement grew (volume and pan in the headers); pitch 57 must stay in sight.
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const BAR = 3840;
// Organ (t1), bars 1–8, 0.025 px per tick (96 px per bar), rows from pitch 84 down.
const view = { startTick: 0, pxPerTick: 0.025, scrollY: (127 - 84) * 15 };
await page.goto(`http://localhost:${port}/index.html?view=${encodeURIComponent(JSON.stringify(view))}`);
await page.waitForFunction(() => window.fhReady && window.fhTest);
await page.waitForTimeout(300);
const grid = await page.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
const vel = await page.locator(".vlane canvas").boundingBox();
const bars = await page.locator(".rrow.bars").boundingBox();
const X = (tick) => grid.x + (tick - view.startTick) * view.pxPerTick;
const Y = (pitch) => grid.y + (127 - pitch) * 15 - view.scrollY + 7;
const song = () => page.evaluate(() => JSON.parse(JSON.stringify(window.fhTest.replica.song)));
const lastLabel = () => page.evaluate(() => window.fhTest.replica.history.at(-1)?.label ?? null);
const settle = () => page.waitForTimeout(80);
let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name} ${detail}`);
}
const notesOf = (s, track = "t1") => Object.values(s.notes).filter((n) => n.trackId === track);
const at = (s, pitch, start) => notesOf(s).find((n) => n.pitch === pitch && n.start === start);

// 1. Double click on an empty spot creates a note on the grid (1/8), one step long, and selects it.
let s0 = await song();
await page.mouse.dblclick(X(BAR + 1000), Y(78));
await settle();
let s1 = await song();
const created = at(s1, 78, BAR + 960);
check("double click creates", created && created.duration === 480 && notesOf(s1).length === notesOf(s0).length + 1, JSON.stringify(created));
check("created note selected", created && s1.context.selection.join() === created.id);
check("history label", (await lastLabel()) === "creaste una nota (c. 2)", await lastLabel());

// 2. Undo and redo.
await page.keyboard.press("Control+z");
await settle();
check("undo", !at(await song(), 78, BAR + 960));
await page.keyboard.press("Control+y");
await settle();
check("redo", !!at(await song(), 78, BAR + 960));

// 3. Drag a note one beat to the right and two semitones up: moves by whole grid steps.
await page.mouse.move(X(BAR + 960 + 200), Y(78));
await page.mouse.down();
await page.mouse.move(X(BAR + 960 + 200 + 960) + 3, Y(80), { steps: 5 });
await page.mouse.up();
await settle();
s1 = await song();
check("drag moves", !!at(s1, 80, BAR + 1920), JSON.stringify(notesOf(s1).filter((n) => n.pitch >= 78)));
check("move label", (await lastLabel()) === "moviste una nota (c. 2)", await lastLabel());

// 4. A tiny jitter is a click, not a drag.
await page.mouse.move(X(BAR + 1920 + 200), Y(80));
await page.mouse.down();
await page.mouse.move(X(BAR + 1920 + 200) + 2, Y(80) + 1);
await page.mouse.up();
await settle();
check("3 px threshold", !!at(await song(), 80, BAR + 1920));

// 5. Alt + drag copies.
await page.keyboard.down("Alt");
await page.mouse.move(X(BAR + 1920 + 200), Y(80));
await page.mouse.down();
await page.mouse.move(X(BAR + 1920 + 200 + 1920), Y(80), { steps: 5 });
await page.mouse.up();
await page.keyboard.up("Alt");
await settle();
s1 = await song();
check("alt copies", !!at(s1, 80, BAR + 1920) && !!at(s1, 80, BAR + 3840));

// 6. Drag the right edge: the end lands on the grid.
const copy = at(s1, 80, BAR + 3840);
await page.mouse.move(X(copy.start + copy.duration) - 2, Y(80));
await page.mouse.down();
await page.mouse.move(X(copy.start + copy.duration + 600), Y(80), { steps: 4 }); // + 680 ticks in all
await page.mouse.up();
await settle();
s1 = await song();
check("resize right", s1.notes[copy.id].duration === 960, JSON.stringify(s1.notes[copy.id]));

// 7. Rubber band selects both, Delete removes them in one step.
await page.mouse.move(X(BAR + 1800), Y(81) - 5);
await page.mouse.down();
await page.mouse.move(X(BAR + 3840 + 1000), Y(79) + 5, { steps: 5 });
await page.mouse.up();
await settle();
s1 = await song();
check("rubber band", s1.context.selection.length === 2, JSON.stringify(s1.context.selection));
await page.keyboard.press("Delete");
await settle();
s1 = await song();
check("delete selection", !at(s1, 80, BAR + 1920) && !at(s1, 80, BAR + 3840));
check("delete label", (await lastLabel()) === "borraste 2 notas (c. 2–3)", await lastLabel());

// 8. Right click opens the menu and deletes nothing; Escape closes it.
const before = notesOf(await song()).length;
const organ = notesOf(s1).find((n) => n.start === 0 && n.pitch === 64);
await page.mouse.click(X(200), Y(64), { button: "right" });
await settle();
check("menu opens", await page.locator(".menu").isVisible());
check("right click never deletes", notesOf(await song()).length === before);
await page.keyboard.press("Escape");
await settle();
check("menu closes", !(await page.locator(".menu").isVisible()));

// 9. Click selects; arrows transpose; Shift + arrow transposes an octave.
await page.mouse.click(X(200), Y(64));
await settle();
await page.keyboard.press("ArrowUp");
await settle();
await page.keyboard.press("Shift+ArrowDown");
await settle();
check("transpose", (await song()).notes[organ.id].pitch === 64 + 1 - 12, (await song()).notes[organ.id].pitch);

// 10. Velocity lane: drag the bar of the selected note to the top.
await page.mouse.move(vel.x + (organ.start - view.startTick) * view.pxPerTick, vel.y + vel.height - 5);
await page.mouse.down();
await page.mouse.move(vel.x + (organ.start - view.startTick) * view.pxPerTick, vel.y + 2, { steps: 3 });
await page.mouse.up();
await settle();
check("velocity bar", (await song()).notes[organ.id].velocity === 127, (await song()).notes[organ.id].velocity);

// 11. Bar ruler: click sets the cursor, drag draws a loop in whole bars.
await page.mouse.click(X(2 * BAR + 500), bars.y + 10);
await settle();
check("cursor", (await song()).context.cursor === 2 * BAR + 480, (await song()).context.cursor);
await page.mouse.move(X(BAR + 100), bars.y + 10);
await page.mouse.down();
await page.mouse.move(X(3 * BAR + 100), bars.y + 10, { steps: 4 });
await page.mouse.up();
await settle();
check("loop", JSON.stringify((await song()).context.loop) === JSON.stringify({ start: BAR, end: 4 * BAR }), JSON.stringify((await song()).context.loop));
check("drawing a loop turns the loop button on", (await page.locator('.topbar button[aria-label="Loop"]').getAttribute("aria-pressed")) === "true");
await page.locator('.topbar button[aria-label="Loop"]').click();
await settle();
check("loop button off removes the loop", (await song()).context.loop === null);
await page.keyboard.press("Escape"); // no selection: the loop takes the section under the cursor
await page.locator('.topbar button[aria-label="Loop"]').click();
await settle();
check("loop button on creates one (section under the cursor)", JSON.stringify((await song()).context.loop) === JSON.stringify({ start: 0, end: 8 * BAR }), JSON.stringify((await song()).context.loop));
await page.locator('.topbar button[aria-label="Loop"]').click();
await settle();

// 11b. Velocity lane: a freehand curve over the organ's bars of bar 1–2 (no selection).
await page.keyboard.press("Escape");
await settle();
const organNotes = notesOf(await song()).filter((n) => n.start < 2 * BAR).sort((a, b) => a.start - b.start);
const xs = [...new Set(organNotes.map((n) => n.start))];
await page.mouse.move(vel.x + (240 - view.startTick) * view.pxPerTick, vel.y + 50);
await page.mouse.down();
await page.mouse.move(vel.x + (xs[0] - view.startTick) * view.pxPerTick, vel.y + 50, { steps: 2 });
await page.mouse.move(vel.x + (BAR - view.startTick) * view.pxPerTick, vel.y + 10, { steps: 6 });
await page.mouse.move(vel.x + (2 * BAR - view.startTick) * view.pxPerTick - 2, vel.y + 50, { steps: 6 });
check("stroke is drawn while dragging", await page.evaluate(() => (window.fhTest.editor.overlay.stroke ?? []).length > 3));
await page.mouse.up();
await settle();
const curved = notesOf(await song()).filter((n) => n.start < 2 * BAR);
const atStart = curved.find((n) => n.start === xs[0]).velocity;
const atMiddle = curved.find((n) => n.start === BAR)?.velocity;
check("freehand curve: high in the middle, low at the ends", atMiddle > atStart + 30, JSON.stringify(curved.map((n) => [n.start, n.velocity])));

// 11c. Pedal tab: draw a pressed stretch in bar 3, then remove it with a double click.
await page.getByRole("tab", { name: "Pedal" }).click();
await settle();
await page.mouse.move(vel.x + (2 * BAR + 100 - view.startTick) * view.pxPerTick, vel.y + 30);
await page.mouse.down();
await page.mouse.move(vel.x + (3 * BAR - 100 - view.startTick) * view.pxPerTick, vel.y + 30, { steps: 5 });
await page.mouse.up();
await settle();
check("pedal drawn on the grid", JSON.stringify((await song()).tracks.t1.pedal) === JSON.stringify([{ start: 2 * BAR, end: 3 * BAR }]), JSON.stringify((await song()).tracks.t1.pedal));
await page.mouse.dblclick(vel.x + (2 * BAR + 1900 - view.startTick) * view.pxPerTick, vel.y + 30);
await settle();
check("pedal removed with a double click", (await song()).tracks.t1.pedal.length === 0);
// The eraser lifts the pedal where it passes, and the lane menu clears it all.
const PX = (tick) => vel.x + (tick - view.startTick) * view.pxPerTick;
await page.mouse.move(PX(2 * BAR + 100), vel.y + 30);
await page.mouse.down();
await page.mouse.move(PX(4 * BAR - 100), vel.y + 30, { steps: 5 });
await page.mouse.up();
await settle();
await page.keyboard.press("3");
await page.mouse.move(PX(2 * BAR + 960), vel.y + 30);
await page.mouse.down();
await page.mouse.move(PX(3 * BAR), vel.y + 30, { steps: 5 });
await page.mouse.up();
await settle();
check("eraser lifts the pedal", JSON.stringify((await song()).tracks.t1.pedal.map((p) => [p.start, p.end])) === JSON.stringify([[2 * BAR, 2 * BAR + 960], [3 * BAR, 4 * BAR]]), JSON.stringify((await song()).tracks.t1.pedal));
await page.mouse.click(PX(3 * BAR + 500), vel.y + 30, { button: "right" });
await page.locator(".menu [role=menuitem]", { hasText: "Borrar todo el pedal de la pista" }).click();
await settle();
check("lane menu clears the pedal", (await song()).tracks.t1.pedal.length === 0);
await page.getByRole("tab", { name: "Velocidad" }).click();
// The eraser in the velocity lane gives the notes it passes their default velocity back.
await page.mouse.move(PX(xs[0]) + 1, vel.y + 30); // the first bars sit at the lane's left edge
await page.mouse.down();
await page.mouse.move(PX(BAR) + 3, vel.y + 30, { steps: 6 });
await page.mouse.up();
await settle();
const erased = notesOf(await song()).filter((n) => n.start >= xs[0] && n.start <= BAR);
check("velocity eraser resets to 80", erased.length > 0 && erased.every((n) => n.velocity === 80), JSON.stringify(erased.map((n) => [n.start, n.velocity])));
await page.keyboard.press("1");

// 12. Pencil (2) creates with a click and grows with a drag; eraser (3) deletes with a click.
await page.keyboard.press("2");
await page.mouse.move(X(5 * BAR + 100), Y(79));
await page.mouse.down();
await page.mouse.move(X(5 * BAR + 1500), Y(79), { steps: 4 });
await page.mouse.up();
await settle();
const penciled = at(await song(), 79, 5 * BAR);
check("pencil drag", penciled && penciled.duration === 1440, JSON.stringify(penciled));
await page.keyboard.press("3");
await page.mouse.click(X(5 * BAR + 300), Y(79));
await settle();
check("eraser", !at(await song(), 79, 5 * BAR));
await page.keyboard.press("1");

// 13. Copy and paste at the cursor; duplicate right after the selection.
await page.mouse.click(X(200), Y(57));
await page.keyboard.press("Control+c");
await page.keyboard.press("Control+v");
await settle();
check("paste at cursor", !!at(await song(), 57, 2 * BAR + 480));
await page.keyboard.press("Control+d");
await settle();
s1 = await song();
const pasted = at(s1, 57, 2 * BAR + 480);
check("duplicate", !!at(s1, 57, 2 * BAR + 480 + pasted.duration), JSON.stringify(notesOf(s1).filter((n) => n.pitch === 57 && n.start > 2 * BAR)));

// 14. N toggles the grid, H zooms in, Ctrl held shows the pencil.
await page.keyboard.press("n");
check("grid toggle", (await page.evaluate(() => window.fhTest.view.state.gridOn)) === false);
await page.keyboard.press("n");
const z0 = await page.evaluate(() => window.fhTest.view.state.pxPerTick);
await page.keyboard.press("h");
check("zoom glides", (await page.evaluate(() => window.fhTest.view.moving)) === true);
await page.waitForTimeout(400);
check("zoom in", Math.abs((await page.evaluate(() => window.fhTest.view.state.pxPerTick)) / z0 - 1.25) < 0.001);
await page.evaluate((v) => window.fhTest.view.set(v), view);
await page.keyboard.down("Control");
check("ctrl pencil", await page.evaluate(() => window.fhTest.view.state.pencilHeld));
await page.keyboard.up("Control");

// 15. Quantize with strength from the dialog.
await page.evaluate(() => window.fhTest.editor.setQuantizeSettings({ grid: "1/4", strength: 0.5, ends: false }));
await page.mouse.dblclick(X(6 * BAR + 120), Y(76));
await settle();
const loose = at(await song(), 76, 6 * BAR);
await page.keyboard.press("n"); // grid off: move it 100 ticks freely
await page.keyboard.press("n");
await page.evaluate((id) => window.fhTest.replica.run("x", [{ type: "updateNotes", changes: [{ id, start: 6 * 3840 + 100 }] }]), loose.id);
await settle();
await page.keyboard.press("q");
await settle();
check("quantize 50 %", (await song()).notes[loose.id].start === 6 * BAR + 50, (await song()).notes[loose.id].start);

// 16. Space plays and stops; the cursor stays where playback started.
await page.mouse.click(X(200), bars.y + 10); // cursor at bar 1
await settle();
const cursor = (await song()).context.cursor;
await page.keyboard.press("Space");
await page.waitForTimeout(400);
check("play", await page.evaluate(() => window.fhTest.audio.player.playing));
check("playhead moves", (await page.evaluate(() => window.fhTest.audio.player.position())) > cursor);
// The arrangement shows the same playhead, where the player is (Fran, 19/10/2026).
const arrHead = await page.evaluate(() => {
  const c = document.querySelector(".lanes canvas.arrhead");
  const ctx = c.getContext("2d");
  const { width, height } = c;
  const data = ctx.getImageData(0, 0, width, height).data;
  const y = Math.floor(height * 0.6);
  let lit = -1;
  for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 0) { lit = x; break; }
  return { lit: lit / (window.devicePixelRatio || 1), width: c.clientWidth, pos: window.fhTest.audio.player.position() };
});
check("arrangement playhead drawn", arrHead.lit >= 0, arrHead);
await page.keyboard.press("Space");
await settle();
check("stop", !(await page.evaluate(() => window.fhTest.audio.player.playing)));
check("cursor kept", (await song()).context.cursor === cursor);

// 17. Ctrl+K: the computer keyboard plays notes; its letters stop being shortcuts.
await page.keyboard.press("Control+k");
check("piano mode", await page.evaluate(() => window.fhTest.audio.pianoMode));
check("key guide shown", (await page.locator(".kguide").count()) === 1);
await page.keyboard.down("s");
check("key guide lights the key", (await page.locator(".kguide .kw.on").innerText()).includes("S"));
await page.keyboard.up("s");
await page.locator(".kgclose").click();
check("key guide hides", (await page.locator(".kguide").count()) === 0);
await page.locator(".chipbtn", { hasText: "Guía" }).click();
check("key guide shows again", (await page.locator(".kguide").count()) === 1);
await page.waitForTimeout(250); // the guide has finished appearing
const kg = await page.locator(".kghead").boundingBox();
await page.mouse.move(kg.x + 60, kg.y + 8);
await page.mouse.down();
await page.mouse.move(kg.x - 40, kg.y - 92, { steps: 6 });
await page.mouse.up();
const kg2 = await page.locator(".kghead").boundingBox();
check("key guide moves with its header", Math.abs(kg2.x - (kg.x - 100)) < 2 && Math.abs(kg2.y - (kg.y - 100)) < 2, JSON.stringify([kg, kg2]));
const z1 = await page.evaluate(() => window.fhTest.view.state.pxPerTick);
await page.keyboard.press("h");
check("letters are notes", (await page.evaluate(() => window.fhTest.view.state.pxPerTick)) === z1);
await page.keyboard.press("x"); // octave up
check("octave up", (await page.evaluate(() => window.fhTest.audio.keyboard.base)) === 72);
await page.keyboard.press("z");

// 18. Record a take: one bar of count-in, two notes, R to stop; the take undoes in one step.
await page.evaluate(() => window.fhTest.replica.run("tempo", [{ type: "setSongProperties", props: { tempo: 250000 } }])); // 240 BPM: a bar lasts 1 s
await page.mouse.click(X(8 * BAR + 10), bars.y + 10);
await settle();
const countBefore = notesOf(await song()).length;
await page.keyboard.press("r");
await page.waitForTimeout(400);
check("count-in", await page.evaluate(() => window.fhTest.audio.player.countInBeatsLeft() > 0));
await page.waitForTimeout(800);
await page.keyboard.down("a");
await page.waitForTimeout(250);
await page.keyboard.up("a");
await page.keyboard.down("d");
await page.waitForTimeout(250);
await page.keyboard.up("d");
await page.waitForTimeout(100);
await page.keyboard.press("r");
await page.waitForTimeout(200);
s1 = await song();
const recorded = notesOf(s1).filter((n) => n.start >= 8 * BAR - 480 && (n.pitch === 60 || n.pitch === 64) && n.velocity === 90);
check("take recorded", notesOf(s1).length === countBefore + 2 && recorded.length === 2, JSON.stringify(recorded));
check("not quantized", recorded.some((n) => n.start % 240 !== 0 || n.duration % 240 !== 0), JSON.stringify(recorded.map((n) => [n.start, n.duration])));
check("take label", /^grabaste 2 notas en Organo \(c\. 9/.test(await lastLabel()), await lastLabel());
await page.keyboard.press("Control+z");
await settle();
check("take undoes in one step", notesOf(await song()).length === countBefore);
await page.keyboard.press("Control+k");

// 19. Tracks: add from the palette (it becomes the active one), change its instrument, rename, reorder.
await page.keyboard.press("Escape");
const menuItem = (label) => page.locator(".menu [role=menuitem]", { hasText: new RegExp(`^${label}$`) }).first();
let tracksBefore = (await song()).trackOrder.length;
await page.locator(".addtrack button").click();
await menuItem("Chelos").click();
await settle();
s1 = await song();
const added = s1.tracks[s1.trackOrder.at(-1)];
check("track added", s1.trackOrder.length === tracksBefore + 1 && added.program === 42 && added.name === "Chelos", JSON.stringify(added));
check("new track active", s1.context.activeTrackId === added.id);
check("add label", (await lastLabel()) === "añadiste la pista Chelos", await lastLabel());
await page.locator(".rsubb").click();
await menuItem("Violas").click();
await settle();
check("instrument changed", (await song()).tracks[added.id].program === 41);
check("instrument label", (await lastLabel()) === "cambiaste el instrumento de Chelos a Violas", await lastLabel());
const lastHeader = page.locator(".thdr").last();
await lastHeader.locator(".tname").dblclick();
await page.locator("input.inline.track").fill("Contracanto");
await page.keyboard.press("Enter");
await settle();
check("track renamed", (await song()).tracks[added.id].name === "Contracanto");
const hb = await lastHeader.boundingBox();
await page.mouse.move(hb.x + 30, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(hb.x + 30, hb.y + hb.height / 2 - 26 - 4, { steps: 6 });
await page.mouse.up();
await settle();
s1 = await song();
check("track reordered", s1.trackOrder.indexOf(added.id) === s1.trackOrder.length - 2, JSON.stringify(s1.trackOrder));
await page.locator(".thdr").first().click({ button: "right" });
await menuItem("Volumen y panorama…").click();
check("mixer opens", (await page.locator(".qdialog[role=dialog]").count()) === 1);
await page.keyboard.press("Escape");
check("mixer closes with Esc", (await page.locator(".qdialog[role=dialog]").count()) === 0);

// 20. Tempo typed in place; meter and key from their menus.
await page.locator(".fbtn[title=Tempo]").click();
await page.locator("input.inline.field").fill("90");
await page.keyboard.press("Enter");
await settle();
check("tempo", (await song()).tempo === Math.round(60_000_000 / 90), (await song()).tempo);
await page.locator("[title=Compás]").click();
await menuItem("3/4").click();
await settle();
check("meter", JSON.stringify((await song()).meter) === JSON.stringify({ numerator: 3, denominator: 4 }));
await page.keyboard.press("Control+z");
await settle();
check("meter undo", (await song()).meter.numerator === 4);
await page.locator("[title=Tonalidad]").click();
await page.locator(".menu [role=menuitem]").filter({ hasText: /^Re menor$|^D minor$/ }).first().click();
await settle();
check("key", JSON.stringify((await song()).key) === JSON.stringify({ fifths: -1, mode: "minor" }), JSON.stringify((await song()).key));
await page.evaluate((v) => window.fhTest.view.set(v), view);

// 21. Sections: drag across the form ruler creates one over whole bars and asks its name; edges resize it.
await page.evaluate(() => {
  const s = window.fhTest.replica.song;
  const cmds = [
    ...Object.keys(s.sections).map((id) => ({ type: "removeSection", id })),
    ...Object.keys(s.annotations).map((id) => ({ type: "removeAnnotation", id })),
    ...Object.keys(s.harmony).map((tick) => ({ type: "setChord", tick: Number(tick), symbol: null })),
  ];
  return window.fhTest.replica.run("clear", cmds);
});
await settle();
let form = await page.locator(".rrow.form").boundingBox();
await page.mouse.move(X(4 * BAR - 300), form.y + form.height / 2); // right to left, clear of the empty state's button
await page.mouse.down();
await page.mouse.move(X(BAR + 300), form.y + form.height / 2, { steps: 6 });
check("section ghost", (await page.locator(".sec.ghost").count()) === 1);
await page.mouse.up();
await settle();
s1 = await song();
let sec = Object.values(s1.sections)[0];
check("section created", sec && sec.startBar === 2 && sec.endBar === 4, JSON.stringify(sec));
check("section name asked", (await page.locator(".rrow.form input.inline").count()) === 1);
await page.keyboard.type("Tema");
await page.keyboard.press("Enter");
await settle();
check("section named", (await song()).sections[sec.id].name === "Tema");
form = await page.locator(".rrow.form").boundingBox();
await page.mouse.move(X(4 * BAR) - 2, form.y + form.height / 2);
await page.mouse.down();
await page.mouse.move(X(5 * BAR) + 10, form.y + form.height / 2, { steps: 6 });
await page.mouse.up();
await settle();
check("section resized", (await song()).sections[sec.id].endBar === 5, JSON.stringify((await song()).sections[sec.id]));
check("resize label", (await lastLabel()) === "cambiaste la sección Tema (c. 2–5)", await lastLabel());
await page.locator(".sec", { hasText: "Tema" }).dblclick({ position: { x: 40, y: 8 } });
await page.locator(".rrow.form input.inline").fill("Puente");
await page.keyboard.press("Enter");
await settle();
check("section renamed", (await song()).sections[sec.id].name === "Puente");

// 22. Annotation from the form ruler's menu.
await page.mouse.click(X(7 * BAR + 500), form.y + form.height / 2, { button: "right" });
await menuItem("Añadir anotación aquí").click();
await page.keyboard.type("más aire");
await page.keyboard.press("Enter");
await settle();
const note = Object.values((await song()).annotations)[0];
check("annotation", note && note.text === "más aire" && note.start === 7 * BAR, JSON.stringify(note));

// 23. Chords: the empty state's button types at the cursor's bar; Tab goes on to the next bar.
const barsNow = await page.locator(".rrow.bars").boundingBox(); // the empty rulers are taller
await page.mouse.click(X(BAR + 100), barsNow.y + 10); // cursor at bar 2
await settle();
await page.locator(".rrow.harmony .empty button").click();
await page.keyboard.type("Am");
await page.keyboard.press("Tab");
await page.keyboard.type("F/A");
await page.keyboard.press("Enter");
await settle();
s1 = await song();
check("chords typed", s1.harmony[String(BAR)] === "Am" && s1.harmony[String(2 * BAR)] === "F/A", JSON.stringify(s1.harmony));
const harm = await page.locator(".rrow.harmony").boundingBox();
await page.mouse.dblclick(X(BAR + 960 * 2 + 100), harm.y + harm.height / 2); // beat 3 of bar 2
await page.keyboard.type("E7");
await page.keyboard.press("Enter");
await settle();
check("chord on a beat", (await song()).harmony[String(BAR + 1920)] === "E7", JSON.stringify((await song()).harmony));
await page.locator(".chord", { hasText: "E7" }).click({ button: "right" });
await menuItem("Quitar acorde").click();
await settle();
check("chord removed", (await song()).harmony[String(BAR + 1920)] === undefined);

// 26. Sound banks: the palette lists the installed banks; a bank opens its presets; the track takes
// one (its General MIDI program stays); going back to the default bank clears it.
await page.keyboard.press("Escape");
await page.locator(".rsubb").click();
const sonatinaItem = page.locator(".menu [role=menuitem]", { hasText: "Sonatina Symphonic Orchestra" }); // with its "5 ›"
check("palette lists installed banks", (await menuItem("YDP Grand Piano").count()) === 1 && (await sonatinaItem.count()) === 1);
await sonatinaItem.click();
await menuItem("1st Violins Sustain").click();
await settle();
const active = (await song()).context.activeTrackId;
let tr = (await song()).tracks[active];
check("track takes a bank preset", tr.sound && tr.sound.bank === "Sonatina_Symphonic_Orchestra.sf2" && tr.sound.program === 2, JSON.stringify(tr.sound));
check("instrument label shows the preset", (await page.locator(".rsubb").innerText()).includes("1st Violins Sustain"), await page.locator(".rsubb").innerText());
check("bank label in history", (await lastLabel()).endsWith("a 1st Violins Sustain"), await lastLabel());
await page.locator(".rsubb").click();
await menuItem("Violines").click();
await settle();
tr = (await song()).tracks[active];
check("default bank clears the sound", !tr.sound && tr.program === 40, JSON.stringify(tr));
await page.locator(".rsubb").click();
await menuItem("Conseguir más sonidos…").click();
check("help card", (await page.locator(".soundshelp a").count()) === 3);
await page.keyboard.press("Escape");
check("help card closes", (await page.locator(".soundshelp").count()) === 0);

// 25. Back to the start (Home), and the tools are icons with their name for screen readers.
await page.evaluate(() => window.fhTest.replica.setContext({ cursor: 3840 * 5 }));
await settle();
await page.keyboard.press("Home");
await settle();
check("Home goes back to the start", (await song()).context.cursor === 0);
check("tools are icon buttons", (await page.locator(".tool.icon svg").count()) === 4 && (await page.getByRole("button", { name: "Goma" }).count()) === 1);

// 24. Fluid movement: a dragged note follows the mouse (drift) with its snapped place as target, and
// lands there after release; the wheel glides to where its steps add up.
await page.evaluate(() => window.fhTest.replica.setContext({ activeTrackId: "t1", selection: [] }));
await settle();
await page.evaluate((v) => window.fhTest.view.set(v), view); // after the track change, which recentres
await settle();
// The piano roll moved down when a track was added: measure it again.
const grid2 = await page.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
const X2 = (tick) => grid2.x + (tick - view.startTick) * view.pxPerTick;
const Y2 = (pitch) => grid2.y + (127 - pitch) * 15 - view.scrollY + 7;
await page.mouse.dblclick(X2(11 * BAR + 100), Y2(76));
await settle();
const fluid = at(await song(), 76, 11 * BAR);
await page.mouse.move(X2(11 * BAR + 200), Y2(76));
await page.mouse.down();
await page.mouse.move(X2(11 * BAR + 200 + 700), Y2(76) - 5, { steps: 6 });
const drift = await page.evaluate((id) => { const d = window.fhTest.editor.overlay.drift?.get(id); return d ? [d.left, d.dy] : null; }, fluid.id);
check("note follows the mouse", drift && Math.abs(drift[0] - (700 - 480) * view.pxPerTick) < 1 && Math.abs(drift[1] + 5) < 0.6, JSON.stringify(drift));
await page.mouse.up();
await page.waitForTimeout(250);
check("note lands on the grid", (await page.evaluate(() => window.fhTest.editor.overlay.drift)) === null && (await song()).notes[fluid.id].start === 11 * BAR + 480);
const sy0 = await page.evaluate(() => window.fhTest.view.state.scrollY);
await page.mouse.move(X2(11 * BAR), Y2(76));
await page.mouse.wheel(0, 100);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(30);
const mid = await page.evaluate(() => window.fhTest.view.state.scrollY);
await page.waitForTimeout(400);
const end = await page.evaluate(() => window.fhTest.view.state.scrollY);
check("wheel glides", mid > sy0 && mid < sy0 + 200 && Math.abs(end - (sy0 + 200)) < 0.5, JSON.stringify([sy0, mid, end]));

// 27. A list taller than the window scrolls and stays inside it, also when a bank's list replaces the
// palette at the same point (Fran, 14/10/2026: the last presets were out of reach).
await page.setViewportSize({ width: 1440, height: 520 });
await page.waitForTimeout(200);
await page.locator(".rsubb").click();
const inside = async () => {
  const box = await page.locator(".menu").boundingBox();
  return box.y >= 0 && box.y + box.height <= 520;
};
check("palette fits a short window", await inside(), JSON.stringify(await page.locator(".menu").boundingBox()));
await page.locator(".menu [role=menuitem]", { hasText: "Sonatina Symphonic Orchestra" }).scrollIntoViewIfNeeded();
await page.locator(".menu [role=menuitem]", { hasText: "Sonatina Symphonic Orchestra" }).click();
check("bank list fits the window too", await inside(), JSON.stringify(await page.locator(".menu").boundingBox()));
const lastPreset = page.locator(".menu [role=menuitem]").last();
await lastPreset.scrollIntoViewIfNeeded();
await lastPreset.click();
await settle();
check("the last preset can be reached", (await song()).tracks[(await song()).context.activeTrackId].sound?.name === "Cello Section Sustai", JSON.stringify((await song()).tracks[(await song()).context.activeTrackId].sound));
// The palette opened from a track's menu (a short list) used to keep the short list's place and
// run off the bottom.
await page.keyboard.press("Escape");
const hdr = await page.locator(".thdr").first().boundingBox();
await page.mouse.click(hdr.x + 40, hdr.y + 10, { button: "right" });
await page.locator(".menu [role=menuitem]", { hasText: "Instrumento…" }).click();
check("palette from the track menu fits the window", await inside(), JSON.stringify(await page.locator(".menu").boundingBox()));
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1440, height: 1000 });

// H3.2: volume and pan in the track header, typed values, colours and the label over a note.
await page.keyboard.press("Escape");
const firstId = (await song()).trackOrder[0];
const vol0 = (await song()).tracks[firstId].volume;
const fader = await page.locator(".tmix .fvol").first().boundingBox();
const undoDepth = async () => page.evaluate(() => window.fhTest.replica.history.length);
const h0 = await undoDepth();
await page.mouse.move(fader.x + fader.width * vol0, fader.y + fader.height / 2);
await page.mouse.down();
await page.mouse.move(fader.x + fader.width * 0.3, fader.y + fader.height / 2, { steps: 6 });
check("fader does not change the song while dragging", (await song()).tracks[firstId].volume === vol0);
await page.mouse.up();
await settle();
const vol1 = (await song()).tracks[firstId].volume;
check("fader sets the volume on release, in one step", Math.abs(vol1 - 0.3) < 0.05 && (await undoDepth()) === h0 + 1, `${vol1} ${h0} ${await undoDepth()}`);
await page.locator(".tmix .mixval").first().dblclick();
await page.keyboard.type("-6");
await page.keyboard.press("Enter");
await settle();
const vol2 = (await song()).tracks[firstId].volume;
check("typed volume in dB", Math.round(vol2 * 127) === Math.round(Math.pow(10, -6 / 40) * 127), String(vol2));
check("volume shown in dB", (await page.locator(".tmix .mixval").first().textContent()) === "−6,0", await page.locator(".tmix .mixval").first().textContent());
await page.locator(".tmix .mixval.pan").first().dblclick();
await page.keyboard.type("L30");
await page.keyboard.press("Enter");
await settle();
check("typed pan", (await song()).tracks[firstId].pan === -0.3, String((await song()).tracks[firstId].pan));
await page.locator(".tmix .fpan").first().dblclick();
await settle();
check("double click centres the pan", (await song()).tracks[firstId].pan === 0);
const hdr2 = await page.locator(".thdr").first().boundingBox();
await page.mouse.click(hdr2.x + 60, hdr2.y + 10, { button: "right" });
await page.locator(".menu [role=menuitem]", { hasText: "Color" }).click();
await page.locator(".menu [role=menuitem]", { hasText: "Musgo" }).click();
await settle();
check("colour from the track menu", (await song()).tracks[firstId].color === 7 && (await lastLabel())?.includes("color musgo"), `${(await song()).tracks[firstId].color} ${await lastLabel()}`);
const chip = await page.locator(".thdr .tchip").first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("the header chip follows the colour", chip === "rgb(126, 145, 89)", chip);
// Label over a note: hover one of the active track's notes and wait.
const someNote = await page.evaluate(() => {
  const s = window.fhTest.replica.song;
  const id = s.context.activeTrackId ?? s.trackOrder[0];
  return Object.values(s.notes).filter((n) => n.trackId === id).sort((a, b) => a.start - b.start)[0];
});
const viewNow = await page.evaluate(() => window.fhTest.view.state);
const gridH32 = await page.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
const nx = gridH32.x + (someNote.start - viewNow.startTick) * viewNow.pxPerTick + 3;
const ny = gridH32.y + (127 - someNote.pitch) * 15 - viewNow.scrollY + 7;
if (nx > gridH32.x && nx < gridH32.x + gridH32.width && ny > gridH32.y && ny < gridH32.y + gridH32.height) {
  await page.mouse.move(nx, ny);
  await page.mouse.move(nx + 1, ny);
  await page.waitForTimeout(600);
  const tip = await page.locator(".notetip").textContent().catch(() => null);
  check("label over a note", !!tip && tip.includes(`velocidad ${someNote.velocity}`), String(tip));
} else check("label over a note (note in sight)", false, JSON.stringify({ nx, ny, gridH32 }));

// 15/10/2026: save state, splitters, vertical zoom and the zoom tool.
// (In the harness there is no SoundFont, so the label shows that; the tooltip carries the save time.)
check("save time in the tooltip", /^Último guardado: \d\d:\d\d:\d\d · /.test((await page.locator(".saved").getAttribute("title")) ?? ""), await page.locator(".saved").getAttribute("title"));
// Splitter between arrangement and piano roll: drag down 80 px, the arrangement grows; double click resets.
const arrBox0 = await page.locator(".arr").boundingBox();
const sp = await page.locator(".split.arrsplit").boundingBox();
await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2);
await page.mouse.down();
await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2 - 80, { steps: 5 });
await page.mouse.up();
await settle();
const arrBox1 = await page.locator(".arr").boundingBox();
check("splitter makes the arrangement shorter (it scrolls)", Math.abs(arrBox1.height - (arrBox0.height - 80)) < 3, `${arrBox0.height} → ${arrBox1.height}`);
await page.locator(".split.arrsplit").dblclick();
await settle();
check("double click on the splitter resets it", Math.abs((await page.locator(".arr").boundingBox()).height - arrBox0.height) < 2);
// Header width.
const hs = await page.locator(".split.hdrsplit").boundingBox();
await page.mouse.move(hs.x + 3, hs.y + 40);
await page.mouse.down();
await page.mouse.move(hs.x + 103, hs.y + 40, { steps: 5 });
await page.mouse.up();
await settle();
check("track names widen", Math.abs((await page.locator(".thdrs").boundingBox()).width - 296) < 3, String((await page.locator(".thdrs").boundingBox()).width));
const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem("fh.layout") ?? "{}"));
await page.waitForTimeout(500);
check("the layout is remembered", (await page.evaluate(() => JSON.parse(localStorage.getItem("fh.layout") ?? "{}"))).headerWidth === 296, JSON.stringify(remembered));
await page.locator(".split.hdrsplit").dblclick();
// Vertical zoom: Shift+H makes rows taller, by a step.
const row0 = await page.evaluate(() => window.fhTest.view.state.rowHeight);
await page.mouse.move(gridH32.x + 200, gridH32.y + 100);
await page.keyboard.press("Shift+H");
await page.waitForTimeout(700);
check("Shift+H: taller rows", (await page.evaluate(() => window.fhTest.view.state.rowHeight)) === 18 && row0 === 15, String(await page.evaluate(() => window.fhTest.view.state.rowHeight)));
await page.keyboard.press("Shift+G");
await page.waitForTimeout(700);
// Zoom tool: 4, then a rectangle over two bars frames them.
await page.keyboard.press("4");
const vz = await page.evaluate(() => window.fhTest.view.state);
const gz = await page.locator(".pgrid canvas:not(.playhead-layer)").boundingBox();
const bx0 = gz.x + (2 * BAR - vz.startTick) * vz.pxPerTick;
const bx1 = gz.x + (4 * BAR - vz.startTick) * vz.pxPerTick;
await page.mouse.move(bx0, gz.y + 40);
await page.mouse.down();
await page.mouse.move(bx1, gz.y + 160, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
const vz2 = await page.evaluate(() => window.fhTest.view.state);
check("zoom rectangle frames two bars", Math.abs(vz2.startTick - 2 * BAR) < 40 && Math.abs(vz2.pxPerTick * 2 * BAR - gz.width) < 4, JSON.stringify({ s: vz2.startTick, w: vz2.pxPerTick * 2 * BAR, gw: gz.width, r: vz2.rowHeight }));
await page.keyboard.down("Alt");
await page.mouse.click(gz.x + 300, gz.y + 100);
await page.keyboard.up("Alt");
await page.waitForTimeout(500);
check("Alt+click zooms out", (await page.evaluate(() => window.fhTest.view.state.pxPerTick)) < vz2.pxPerTick);
// Zoom tool over the arrangement: a click shows half of the song.
const lanes = await page.locator(".lanes canvas:not(.arrhead)").boundingBox();
await page.mouse.click(lanes.x + lanes.width / 2, lanes.y + 40);
await settle();
const az = await page.evaluate(() => window.fhTest.view.state.arrZoom);
check("zoom tool on the arrangement", !!az && az.span > 0, JSON.stringify(az));
await page.keyboard.press("1");

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("FAIL", f);
if (errors.length) console.log("page errors", errors);
await browser.close();
server.close();
process.exit(failures.length || errors.length ? 1 : 0);
