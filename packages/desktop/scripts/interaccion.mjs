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
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); // H3.2 and interfaz 2: the arrangement grew (volume, pan and sound in the headers); pitch 57 must stay in sight.
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
// The sound in the piano roll bar opens Sonidos (interfaz 2, parte 3): a double click picks it.
await page.locator(".rsubb").click();
await page.locator(".sndsearch input").fill("violas");
await page.locator(".sndit", { hasText: /^Violas/ }).dblclick();
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
// Grabbed by its name (the sound line under it is a button).
await page.mouse.move(hb.x + 30, hb.y + 10);
await page.mouse.down();
await page.mouse.move(hb.x + 30, hb.y + 10 - hb.height / 2 - 4, { steps: 6 });
await page.mouse.up();
await settle();
s1 = await song();
check("track reordered", s1.trackOrder.indexOf(added.id) === s1.trackOrder.length - 2, JSON.stringify(s1.trackOrder));
await page.locator(".thdr").first().click({ button: "right" });
await menuItem("Mezcla…").click();
check("mixer opens", (await page.locator(".qdialog[role=dialog]").count()) === 1);
// Fran, 04/11/2026: no reverb row any more (reverb is a bus or an effect): volume and pan only.
check("the mixer card has volume and pan, and no reverb", (await page.locator(".qdialog .mixtype").count()) === 2);
await page.keyboard.press("Escape");
check("mixer closes with Esc", (await page.locator(".qdialog[role=dialog]").count()) === 0);

// 20. Tempo typed in place; meter and key from their menus.
await page.locator(".field", { has: page.locator(".flabel", { hasText: /^Tempo$/ }) }).locator(".fbtn").click();
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
// Annotations live in their own ruler, in lanes: never on top of each other or of the sections (20/10/2026).
check("annotation ruler shows", await page.locator(".rrow.notes .anote", { hasText: "más aire" }).count() === 1);
await page.evaluate((bar) => window.fhTest.replica.run("x", [
  { type: "addAnnotation", spec: { start: 7 * bar, end: 9 * bar, trackIds: [], text: "una nota larga que se cruza con la otra" } },
  { type: "addAnnotation", spec: { start: 7 * bar + 960, end: 8 * bar, trackIds: [], text: "y otra más" } },
]), BAR);
await settle();
const boxes = await page.locator(".rrow.notes .anote").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
const overlap = boxes.some((a, i) => boxes.some((b, j) => i !== j && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b));
check("annotations never overlap", boxes.length === 3 && !overlap, JSON.stringify(boxes));
const secBox = await page.locator(".rrow.form").boundingBox();
check("annotations are off the form ruler", boxes.every((b) => b.t >= secBox.y + secBox.height - 1));
await page.evaluate(() => {
  const s = window.fhTest.replica.song;
  const extra = Object.values(s.annotations).filter((a) => a.text !== "más aire").map((a) => ({ type: "removeAnnotation", id: a.id }));
  return window.fhTest.replica.run("x", extra);
});
await settle();

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
// Interfaz 2, parte 3: the banks are in the Sonidos browser, with Four Hands's sounds.
await page.locator(".rsubb").click();
await page.locator(".sndsearch input").fill("");
await page.getByRole("radio", { name: "Fabricante" }).click();
await settle();
check("Sonidos lists the installed banks", (await page.locator(".sndgh .sndgname", { hasText: "YDP Grand Piano" }).count()) === 1 && (await page.locator(".sndgh .sndgname", { hasText: "Sonatina Symphonic Orchestra" }).count()) === 1);
await page.getByRole("radio", { name: "Categoría" }).click();
await page.locator(".sndsearch input").fill("1st violins");
await page.locator(".sndit", { hasText: "1st Violins Sustain" }).dblclick();
await settle();
const active = (await song()).context.activeTrackId;
let tr = (await song()).tracks[active];
check("track takes a bank preset", tr.sound && tr.sound.bank === "Sonatina_Symphonic_Orchestra.sf2" && tr.sound.program === 2, JSON.stringify(tr.sound));
check("instrument label shows the preset", (await page.locator(".rsubb").innerText()).includes("1st Violins Sustain"), await page.locator(".rsubb").innerText());
check("bank label in history", (await lastLabel()).endsWith("a 1st Violins Sustain"), await lastLabel());
await page.locator(".sndsearch input").fill("violines");
await page.locator(".sndit", { hasText: /^Violines/ }).dblclick();
await settle();
tr = (await song()).tracks[active];
check("default bank clears the sound", !tr.sound && tr.program === 40, JSON.stringify(tr));
await page.locator(".sndsearch input").fill("");
await page.getByRole("button", { name: "Ajustes", exact: true }).click();
await page.locator('.setnavb[data-section="sound"]').click();
await settle();
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
// The palette of «Añadir pista» is still a menu.
const activeBeforeAdd = (await song()).context.activeTrackId;
await page.locator(".addtrack button").click();
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
// That added a track: take it away and go back to the track we were on.
await page.evaluate(() => window.fhTest.replica.undoLast());
await page.evaluate((id) => window.fhTest.replica.setContext({ activeTrackId: id }), activeBeforeAdd);
await settle();
// Sonidos in a short window: the list scrolls inside the panel.
await page.keyboard.press("Escape");
await page.locator(".rsubb").click();
await settle();
const panelBox = await page.locator(".pbody").boundingBox();
check("Sonidos fits a short window", panelBox.y + panelBox.height <= 520, JSON.stringify(panelBox));
await page.setViewportSize({ width: 1440, height: 1100 });

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
// The note in the middle of the grid, whatever the rulers above take (H4 added Tempo and Key).
await page.evaluate((pitch) => window.fhTest.view.set({ scrollY: Math.max(0, (127 - pitch) * 15 - 150) }), someNote.pitch);
await page.waitForTimeout(150);
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

// The song concept (20/10/2026): written in the activity panel, one undo step, signed by the user.
await page.getByRole("tab", { name: "IA" }).click(); // the concept lives in the IA tab
await page.locator(".concept .dashbtn").click();
await page.keyboard.type("Dura 1:12, como los créditos");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("Sin percusión");
await page.keyboard.press("Enter");
await settle();
const concept = await page.evaluate(() => window.fhTest.replica.song.concept);
check("the concept is written from the panel, with Shift+Enter for a new line", concept?.text === "Dura 1:12, como los créditos\nSin percusión" && concept.author.by === "user", JSON.stringify(concept));
check("the panel shows it as yours", /tuyo/.test(await page.locator(".concept .cmeta").innerText()));
check("the history says you wrote it", /escribiste el concepto/.test(await page.locator(".activity").innerText()));
await page.locator(".concept .cmeta .linkbtn").click();
await page.keyboard.type(" (rehecho)");
await page.keyboard.press("Escape");
await settle();
check("Esc leaves the concept as it was", (await page.evaluate(() => window.fhTest.replica.song.concept?.text)) === "Dura 1:12, como los créditos\nSin percusión");
await page.locator(".pgrid canvas").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press("Control+z");
await settle();
check("Ctrl+Z takes the concept away", (await page.evaluate(() => window.fhTest.replica.song.concept)) === undefined && (await page.locator(".concept .dashbtn").count()) === 1);

// Skills de la IA (20/10/2026): the active list in the panel, the card, turning one off, a dropped ZIP.
const activeNames = () => page.locator(".actskills .askill .askname").allInnerTexts();
check("Skills activas lists the skills that are on, with their origin", (await activeNames()).length === 7 && (await page.locator(".actskills .src").allInnerTexts()).includes("mía"));
await page.locator(".askmanage").click();
await page.waitForSelector(".skillspanel .skill");
check("Gestionar skills opens the card with every skill", (await page.locator(".skillspanel .skill").count()) === 7);
await page.locator('.skillspanel [data-skill="styles"] input').click();
await settle();
check("turning a skill off takes it out of Skills activas", !(await activeNames()).some((n) => n.includes("Atlas")) && (await page.locator('.skillspanel [data-skill="styles"].off').count()) === 1);
await page.locator('.skillspanel [data-skill="styles"] input').click();
await settle();
await page.keyboard.press("Escape");
await settle();
check("Esc closes the card", (await page.locator(".skillspanel").count()) === 0);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(["zip"], "mi-cuarteto.zip"));
  document.querySelector(".app").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await settle();
await page.waitForTimeout(200);
check("a dropped ZIP becomes a skill and the window says so", (await activeNames()).includes("mi-cuarteto") && /Skill añadida: mi-cuarteto/.test(await page.locator(".notice").innerText()));

// H4 (20/10/2026): expression and modulation lanes: draw a crescendo, a straight line with Shift, erase.
await page.locator('.vtab [role="tab"]', { hasText: "Expresión" }).click();
await settle();
const lane = await page.locator(".vlane canvas").boundingBox();
const activeId = (await song()).context.activeTrackId;
await page.mouse.move(lane.x + 100, lane.y + lane.height - 10);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(lane.x + 100 + i * 20, lane.y + lane.height - 10 - i * 5);
await page.mouse.up();
await settle();
let curve = (await song()).tracks[activeId].curves?.expression ?? [];
check("drawing in the Expresión lane writes a rising curve", curve.length >= 4 && curve[0].value < curve.at(-1).value, JSON.stringify(curve.slice(0, 3)));
check("the curve's history label", /^dibujaste la expresión de .* \(c\. \d/.test(await lastLabel()), await lastLabel());
await page.keyboard.down("Shift");
await page.mouse.move(lane.x + 500, lane.y + 10);
await page.mouse.down();
await page.mouse.move(lane.x + 650, lane.y + lane.height - 10);
await page.mouse.up();
await page.keyboard.up("Shift");
await settle();
curve = (await song()).tracks[activeId].curves?.expression ?? [];
const lineFrom = await page.evaluate((x) => window.fhTest.view.state.startTick + x / window.fhTest.view.state.pxPerTick, 500 - 2);
const line = curve.filter((p) => p.tick >= lineFrom);
check("Shift draws a straight falling line", line.length >= 4 && line[0].value > line.at(-1).value, JSON.stringify(line.map((p) => p.value)));
await page.keyboard.press("3");
await page.mouse.move(lane.x + 60, lane.y + 30);
await page.mouse.down();
await page.mouse.move(lane.x + 720, lane.y + 30);
await page.mouse.up();
await page.keyboard.press("1");
await settle();
check("the eraser clears the curve it passes over", !(await song()).tracks[activeId].curves, JSON.stringify((await song()).tracks[activeId].curves));
await page.evaluate(() => window.fhTest.replica.undoLast());
await settle();
await page.locator(".vlane canvas").click({ button: "right", position: { x: 200, y: 30 } });
await page.getByRole("menuitem", { name: "Borrar toda la curva de la pista" }).click();
await settle();
check("the lane menu deletes the whole curve", !(await song()).tracks[activeId].curves);
await page.locator('.vtab [role="tab"]', { hasText: "Velocidad" }).click();

// H4 (20/10/2026): MIDI out: a track set to "Tu DAW" from its menu, the card, back from the card.
await page.locator(".thdr").nth(1).click({ button: "right", position: { x: 120, y: 12 } });
await page.getByRole("menuitem", { name: /^Suena en/ }).click();
await page.getByRole("menuitem", { name: /^Tu DAW \(salida MIDI, canal \d+\)/ }).click();
await settle();
const secondId = (await song()).trackOrder[1];
check("a track goes out to the DAW from its menu, and its header says so", (await song()).tracks[secondId].output === "external" && /Tu DAW \(canal \d+\)/.test(await page.locator(".thdr").nth(1).locator(".tsnd").innerText()));
check("its history label names the channel", /suena en tu DAW \(canal \d+\)/.test(await lastLabel()), await lastLabel());
check("the external channel goes to the router, not the synth", await page.evaluate((id) => window.fhTest.audio.externalStrips().has(window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])), secondId));
await page.locator(".thdr").nth(1).click({ button: "right", position: { x: 120, y: 12 } });
await page.getByRole("menuitem", { name: /^Suena en/ }).click();
await page.getByRole("menuitem", { name: /Configurar la salida MIDI/ }).click();
await settle();
check("the MIDI out card lists every track with its channel", (await page.locator(".midiout .mochans li").count()) === (await song()).trackOrder.length);
await page.locator(".midiout .mochans li").nth(1).getByRole("radio", { name: "Four Hands" }).click();
await settle();
check("the card brings it back to Four Hands", !(await song()).tracks[secondId].output);
await page.keyboard.press("Escape");
await settle();

// Fase 2, prueba S2 and interfaz 2: a track sounds through a plugin, chosen in its Sonido menu; its window opens.
await page.locator(".thdr").nth(1).click({ button: "right", position: { x: 120, y: 12 } });
await page.getByRole("menuitem", { name: /^Sonido…/ }).click();
await page.waitForSelector(".snd .sndsearch input");
await settle();
check("Sonido… opens the Sonidos tab for that track", (await page.getByRole("tab", { name: "Sonidos" }).getAttribute("aria-selected")) === "true" && (await page.locator(".sndfor b").innerText()) === (await song()).tracks[(await song()).trackOrder[1]].name);
await page.locator(".sndsearch input").fill("kontakt");
await page.waitForSelector('.sndit[data-sound^="plugin:"]');
check("the browser finds the plugin, not the effects", (await page.locator(".sndit .nm", { hasText: "Ozone" }).count()) === 0 && (await page.locator(".sndit").count()) === 1);
await page.locator(".sndit", { hasText: "Kontakt 8" }).dblclick();
await settle();
const pluginId = (await song()).trackOrder[1];
check("the track sounds through Kontakt", (await song()).tracks[pluginId].output === "plugin" && (await song()).tracks[pluginId].plugin?.name === "Kontakt 8");
check("its history label names the plugin", /suena con Kontakt 8/.test(await lastLabel()), await lastLabel());
check("its header shows the plugin", /Kontakt 8/.test(await page.locator(".thdr").nth(1).locator(".tsnd").innerText()));
check(
  "the plugin is loaded in the track's slot and its channel leaves the built-in sound",
  await page.evaluate((id) => {
    const ch = window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id]);
    return window.fhTest.ai.engine.loaded.get(ch) === "VST3-Kontakt 8-1" && window.fhTest.audio.pluginStrips().has(ch);
  }, pluginId),
);
await page.locator(".thdr").nth(1).click({ button: "right", position: { x: 120, y: 12 } });
await page.getByRole("menuitem", { name: "Abrir ventana de Kontakt 8" }).click();
await settle();
check("the track menu opens the plugin's window", await page.evaluate((id) => window.fhTest.ai.engine.shown.includes(window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])), pluginId));

// Interfaz 2, parte 2: the Pista tab, the card of the active track.
await page.locator(".thdr").nth(1).click({ position: { x: 60, y: 10 } });
await page.getByRole("tab", { name: "Pista" }).click();
await settle();
check("the Pista tab shows the active track and its plugin", (await page.locator(".tcard .tcname").innerText()) === (await song()).tracks[pluginId].name && /Kontakt 8/.test(await page.locator(".tcard .tcsoundname").innerText()));
await page.locator(".tcard").getByRole("button", { name: "Abrir ventana" }).click();
await settle();
check("the card opens the plugin's window too", await page.evaluate((id) => window.fhTest.ai.engine.shown.filter((s) => s === window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])).length === 2, pluginId));
check("only the plugin track has the window button in its header", (await page.locator(".thdr .plugb").count()) === 1);
await page.locator(".thdr .plugb").click();
await settle();
check("the header's button opens the plugin's window in one click", await page.evaluate((id) => window.fhTest.ai.engine.shown.filter((s) => s === window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])).length === 3, pluginId) && (await page.locator(".thdr .plugb").getAttribute("title")) === "Abrir Kontakt 8");
const colorBefore = (await song()).tracks[pluginId].color;
await page.locator(".tcswatches .sw").nth((colorBefore + 3) % 10).click();
await settle();
check("a swatch changes the track colour", (await song()).tracks[pluginId].color === (colorBefore + 3) % 10);
await page.locator(".tcard .tcout").getByRole("radio", { name: /Tu DAW/ }).click();
await settle();
check("the card sends the track to the DAW", (await song()).tracks[pluginId].output === "external");
await page.locator(".tcard .tcout").getByRole("radio", { name: "Four Hands" }).click();
await settle();
check("…and back to Four Hands, to its plugin", (await song()).tracks[pluginId].output === "plugin");
await page.locator(".tcard").getByRole("button", { name: "Cambiar…" }).click();
await settle();
check("Cambiar… opens Sonidos", (await page.locator(".snd").count()) === 1);
await page.locator(".sndsearch input").fill("piano");
await page.locator(".sndit").filter({ has: page.locator(".nm", { hasText: /^Piano$/ }) }).first().dblclick();
await settle();
await page.getByRole("tab", { name: "Pista" }).click();
await settle();
check("a Four Hands sound replaces the plugin: one sound per track", !(await song()).tracks[pluginId].output && !(await song()).tracks[pluginId].plugin && /Piano/.test(await page.locator(".tcard .tcsoundname").innerText()));
await page.locator(".thdr").nth(1).locator(".tsnd").click();
await settle();
check("the sound in the header opens Sonidos", (await page.getByRole("tab", { name: "Sonidos" }).getAttribute("aria-selected")) === "true");
await page.getByRole("tab", { name: "Pista" }).click();
const upBefore = (await song()).trackOrder.indexOf(pluginId);
await page.locator(".tcfoot").getByRole("button", { name: /Bajar/ }).click();
await settle();
check("the card moves the track", (await song()).trackOrder.indexOf(pluginId) === upBefore + 1);
await page.evaluate(() => window.fhTest.replica.undoLast());
await settle();
// Interfaz 2, parte 3: the Sonidos browser.
await page.getByRole("tab", { name: "Sonidos" }).click();
await page.locator(".sndsearch input").fill("");
await settle();
check("by category, the group of the current sound is open", (await page.locator(".sndgh:not(.closed)").count()) === 1 && (await page.locator(".sndit.cur").count()) === 1);
await page.locator(".sndsearch input").fill("ORGANO");
await settle();
check("search ignores accents and case", (await page.locator(".sndit .nm").allInnerTexts()).join() === "Órgano");
await page.locator(".sndsearch input").fill("");
await page.getByRole("radio", { name: "Plugins" }).click();
await settle();
check("the Plugins filter shows only plugins", (await page.locator(".sndit").count()) === 2 && (await page.locator('.sndit:not([data-sound^="plugin:"])').count()) === 0);
await page.locator(".sndit", { hasText: "Kontakt 8" }).locator(".st").click();
await settle();
await page.getByRole("radio", { name: "Favoritos" }).click();
await settle();
check("a star makes a favourite, and it is kept", (await page.locator(".sndit").count()) === 1 && (await page.evaluate(() => window.fhTest.ai.soundPrefs())).favorites.includes("plugin:VST3-Kontakt 8-1"));
await page.getByRole("radio", { name: "Todo" }).click();
await page.getByRole("radio", { name: "Fabricante" }).click();
await settle();
check("grouped by vendor, Four Hands's own first", /de serie/.test(await page.locator(".sndgh .sndgname").first().innerText()));
await page.getByRole("radio", { name: "Categoría" }).click();
await page.locator(".sndsearch input").fill("synth");
await settle();
const dropTo = (await song()).trackOrder[3];
await page.locator(".sndit", { hasText: "Four Hands Test Synth" }).dragTo(page.locator(".thdr").nth(3), { targetPosition: { x: 100, y: 12 } });
await settle();
check("dragged onto a header, the sound goes to that track", (await song()).tracks[dropTo].plugin?.name === "Four Hands Test Synth");
const countBeforeDrop = (await song()).trackOrder.length;
await page.locator(".sndsearch input").fill("arpa");
await settle();
await page.locator(".sndit", { hasText: "Arpa" }).dragTo(page.locator(".addtrack"));
await settle();
check("dragged under the tracks, it makes a new track with it", (await song()).trackOrder.length === countBeforeDrop + 1 && /Arpa/.test((await song()).tracks[(await song()).trackOrder.at(-1)].name));
await page.evaluate(() => window.fhTest.replica.undoLast());
await page.evaluate(() => window.fhTest.replica.undoLast());
await settle();
await page.locator(".sndsearch input").fill("test synth");
await settle();
await page.locator(".sndit", { hasText: "Four Hands Test Synth" }).click({ button: "right" });
await page.getByRole("menuitem", { name: "Esconder este plugin" }).click();
await settle();
check("a plugin can be hidden", (await page.locator(".sndit").count()) === 0);
await page.getByRole("button", { name: "Ajustes", exact: true }).click();
await page.locator('.setnavb[data-section="plugins"]').click();
await settle();
check("Ajustes › Plugins lists it and brings it back", (await page.locator(".sethidden li").count()) === 1);
await page.locator(".sethidden").getByRole("button", { name: "Mostrar" }).click();
await page.keyboard.press("Escape");
await settle();
check("…shown again", (await page.locator(".sndit").count()) === 1);
await page.locator(".sndsearch input").fill("");

await page.getByRole("tab", { name: "IA" }).click();
await settle();
check("the IA tab is the activity panel", (await page.locator(".pbody .concept").count()) === 1);

// Fran, 29/10/2026: the side column folds away and comes back when needed.
await page.locator(".pbody").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("F6");
await settle();
check("F6 on the IA tab folds the column, and the rail stays", (await page.locator(".activity.side").count()) === 0 && (await page.locator(".rail").isVisible()));
await page.waitForTimeout(450);
check("folded is remembered", await page.evaluate(() => JSON.parse(localStorage.getItem("fh.layout") ?? "{}").panelOpen === false));
await page.keyboard.press("F5");
await settle();
check("F5 opens it on Sonidos", (await page.getByRole("tab", { name: "Sonidos" }).getAttribute("aria-selected")) === "true");
await page.keyboard.press("F5");
await settle();
check("F5 again folds it", (await page.locator(".activity.side").count()) === 0);
await page.locator(".thdr").nth(0).locator(".tsnd").click();
await settle();
check("folded, a track's sound opens Sonidos for a moment", (await page.locator(".snd").count()) === 1);
await page.locator(".sndsearch input").fill("celesta");
await page.locator(".sndit", { hasText: "Celesta" }).dblclick();
await settle();
check("…and once the sound is chosen it folds again", (await page.locator(".activity.side").count()) === 0 && (await song()).tracks[(await song()).trackOrder[0]].program === 8);
await page.evaluate(() => window.fhTest.replica.undoLast());
await page.locator(".rail").getByRole("button", { name: "IA" }).click();
await settle();
check("the rail opens it on a tab, and it stays open", (await page.locator(".pbody .concept").count()) === 1);

// H4 (20/10/2026): Tu IA > Sus opiniones, direct by default and remembered.
await page.locator(".askmanage").click();
await page.waitForSelector(".skillspanel .skill");
await settle();
check("opinions are direct by default", (await page.locator('.skillspanel [data-tone="direct"][aria-checked="true"]').count()) === 1);
await page.locator('.skillspanel [data-tone="gentle"]').click();
await settle();
check("with tact is chosen and kept", (await page.evaluate(() => window.fhTest.ai.aiTone())) === "gentle" && /empieza por lo que funciona/.test(await page.locator(".skillspanel .tonebox").first().innerText()));
await page.locator('.skillspanel [data-tone="direct"]').click();
await page.keyboard.press("Escape");
await settle();

// ESTUDIO_INTERFAZ_2 (28/10/2026): Ajustes, with what the Help menu used to hold.
await page.getByRole("button", { name: "Ajustes", exact: true }).click();
await settle();
check("the gear opens Ajustes on Tu IA", (await page.locator('.settings[data-section="ai"]').count()) === 1 && (await page.locator(".settings .tonebox").count()) === 2);
await page.locator('.setnavb[data-section="plugins"]').click();
await page.waitForSelector(".setplugins .setbig");
await settle();
check("Plugins says what the engine found", /3 plugins · 2 instrumentos/.test(await page.locator(".setplugins .setbig").innerText()), await page.locator(".setplugins .setbig").innerText());
await page.getByRole("button", { name: "Añadir carpeta…" }).click();
await settle();
check("a plugin folder can be added and removed", (await page.locator(".setplugins .setlist li", { hasText: "D:\\VST3" }).count()) === 1);
await page.locator(".setplugins .setlist li", { hasText: "D:\\VST3" }).getByRole("button", { name: "Quitar" }).click();
await settle();
check("…and it is gone", (await page.locator(".setplugins .setlist li", { hasText: "D:\\VST3" }).count()) === 0);
await page.locator('.setnavb[data-section="folders"]').click();
await settle();
check("Carpetas lists songs, backups, sounds and skills", (await page.locator(".setfolders li").count()) === 4);
await page.keyboard.press("Escape");
await settle();
check("Esc closes Ajustes", (await page.locator(".settings").count()) === 0);
await page.keyboard.press("Control+Comma");
await settle();
check("Ctrl + , opens Ajustes", (await page.locator(".settings").count()) === 1);
await page.locator(".setveil").click({ position: { x: 5, y: 5 } });
await settle();
check("a click outside closes it", (await page.locator(".settings").count()) === 0);
await page.locator(".aichip .chipbtn").click();
await settle();
check("the AI chip, when no AI is connected, opens Tu IA", (await page.locator('.settings[data-section="ai"] .setconnect').count()) === 1);
await page.keyboard.press("Escape");
await settle();

// H4 (20/10/2026): Con / Sin of the last AI intervention, applied straight into the song.
const aiWrites = (label, group) =>
  page.evaluate(([label, group, bar]) => {
    const doc = window.fhTest.ai.doc;
    const claude = { by: "ai", client: "claude-ai" };
    doc.transact({ actor: claude, label, group }, (tx) => {
      const id = `n${8000 + Math.floor(Math.random() * 900)}`;
      tx.set(["notes", id], { id, trackId: doc.song.trackOrder[0], pitch: 72, start: 6 * bar, duration: 960, velocity: 80, createdBy: claude, shapedBy: claude });
    });
  }, [label, group, BAR]);
await aiWrites("Una nota de prueba", "i90");
await settle();
check("no Con / Sin bar while the intervention is open", (await page.locator(".cmpbar").count()) === 0);
await page.evaluate(() => window.fhTest.ai.doc.closeGroup("i90"));
await settle();
check("the bar appears when the intervention ends", (await page.locator(".cmpbar").count()) === 1 && /Una nota de prueba/.test(await page.locator(".cmpbar").innerText()));
await page.keyboard.press("b");
await page.waitForTimeout(150);
const heardWithout = await page.evaluate(() => window.fhTest.audio.compare);
check("B plays the song without it", heardWithout === "without" && (await page.locator(".cmpbar.sin").count()) === 1, heardWithout);
check("the song itself keeps the AI's note", Object.values((await song()).notes).some((n) => n.createdBy.by === "ai" && n.pitch === 72 && n.start === 6 * BAR));
await page.keyboard.press("b");
await page.waitForTimeout(150);
check("B again plays it with it", (await page.evaluate(() => window.fhTest.audio.compare)) === "with");
await page.keyboard.press("b");
await page.waitForTimeout(150);
await page.evaluate(() => window.fhTest.replica.run("tu cambio", [{ type: "setSongProperties", props: { title: "Prueba Con Sin" } }]));
await settle();
check("anything else on top hides the bar and plays the song as it is", (await page.locator(".cmpbar").count()) === 0 && (await page.evaluate(() => window.fhTest.audio.compare)) === "with");
await page.evaluate(() => window.fhTest.replica.undoLast());
await settle();
check("undoing the user's change brings the bar back", (await page.locator(".cmpbar").count()) === 1);
await page.locator(".cmpbar .btn.aibtn").click();
await settle();
check("Deshacer undoes the intervention", (await page.locator(".cmpbar").count()) === 0 && !Object.values((await song()).notes).some((n) => n.createdBy.by === "ai" && n.pitch === 72 && n.start === 6 * BAR));

// 30. Tempo and key along the song (H4): from the bar numbers, the Tempo and Key rulers appear.
await page.keyboard.press("Escape");
await page.evaluate(() => window.fhTest.replica.run("x", [{ type: "setTempoChanges", points: [] }, { type: "setKeyChanges", changes: [] }]));
await settle();
check("no Tempo ruler without changes", (await page.locator(".rrow.tempo").count()) === 0);
await page.locator(".rrow.bars").click({ button: "right", position: { x: 300, y: 12 } });
await page.locator(".menu [role=menuitem]", { hasText: /^Calderón aquí$/ }).click();
await settle();
check("a fermata from the bar numbers: two points and the Tempo ruler", ((await song()).tempoChanges ?? []).length === 2 && (await page.locator(".rrow.tempo .tferm").count()) === 1);
await page.locator(".rrow.tempo .rfill").dblclick({ position: { x: 40, y: 12 } });
await page.keyboard.type("90");
await page.keyboard.press("Enter");
await settle();
check("a tempo typed on the Tempo ruler", ((await song()).tempoChanges ?? []).some((p) => p.tempo === Math.round(60_000_000 / 90)), JSON.stringify((await song()).tempoChanges));
await page.locator(".rrow.tempo .tmark.tjump").first().click({ button: "right" });
await page.locator(".menu [role=menuitem]", { hasText: /^Llegar poco a poco/ }).click();
await settle();
check("a jump becomes a ramp from its menu", ((await song()).tempoChanges ?? []).some((p) => p.ramp && p.tempo === Math.round(60_000_000 / 90)));
await page.locator(".rrow.bars").click({ button: "right", position: { x: 600, y: 12 } });
await page.locator(".menu [role=menuitem]", { hasText: /^Cambio de tonalidad aquí/ }).click();
await page.locator(".menu [role=menuitem]", { hasText: /^Re mayor$/ }).click();
await settle();
check("a key change from the bar numbers shows on the Key ruler", ((await song()).keyChanges ?? []).length === 1 && (await page.locator(".rrow.keys .kchange").count()) === 1);
await page.keyboard.press("Control+z");
await settle();
check("undo removes the key change", ((await song()).keyChanges ?? []).length === 0 && (await page.locator(".rrow.keys").count()) === 0);

// 31. Proposal mode (H4): the setting, the bar, its notes, Con / Sin, Aceptar and Descartar.
await page.keyboard.press("Escape");
const propose = async (group, label) => {
  await page.evaluate(([g, l]) => {
    const doc = window.fhTest.ai.doc;
    const claude = { by: "ai", client: "claude-ai" };
    const t = doc.song.context.activeTrackId ?? doc.song.trackOrder[0];
    doc.transact({ actor: claude, label: l, group: g }, (tx) => {
      const id = `n${doc.song.counters.n++}`;
      tx.set(["notes", id], { id, trackId: t, pitch: 79, start: 3840, duration: 900, velocity: 70, createdBy: claude, shapedBy: claude });
    });
    doc.closeGroup(g);
    doc.liftLastStep(g);
  }, [group, label]);
  await settle();
};
const g5 = () => Object.values(window.fhTest?.replica?.song?.notes ?? {});
void g5;
const has79 = async () => (await page.evaluate(() => Object.values(window.fhTest.replica.song.notes).some((n) => n.pitch === 79 && n.start === 3840)));
await propose("i90", "Una nota arriba");
check("the proposal bar shows, the note is not in the song", (await page.locator(".propbar").count()) === 1 && !(await has79()));
check("the proposal is heard by default", (await page.evaluate(() => window.fhTest.audio.proposalListen)) === "with");
await page.keyboard.press("b");
await page.waitForTimeout(150);
check("B plays the song without the proposal", (await page.evaluate(() => window.fhTest.audio.proposalListen)) === "without");
await page.locator(".propbar .btn.pri").click();
await settle();
check("Aceptar puts it in the song as the user's step", (await has79()) && (await page.locator(".propbar").count()) === 0);
await page.keyboard.press("Control+z");
await settle();
await propose("i91", "Otra nota arriba");
await page.locator(".propbar .btn", { hasText: /^Descartar$/ }).click();
await settle();
check("Descartar drops it and leaves the song", !(await has79()) && (await page.locator(".propbar").count()) === 0);
await page.locator(".askmanage").click().catch(() => {});
const hasPanel = (await page.locator(".skillspanel").count()) === 1;
if (hasPanel) {
  await page.locator('.skillspanel [data-apply="proposal"]').click();
  await page.waitForTimeout(100);
  check("Tu IA > Lo que escribe: como propuesta", (await page.evaluate(() => window.fhTest.ai.aiApply())) === "proposal");
  await page.keyboard.press("Escape");
}

// The history (ESTUDIO_INTERFAZ_2.md, 9): its own box with a scroll, and a click goes back to a step.
if ((await page.locator(".ptab.ai").count()) === 0) await page.keyboard.press("F6");
await page.locator(".ptab.ai").click();
await settle();
const userWrites = (label, pitch) =>
  page.evaluate(([label, pitch, bar]) => {
    const doc = window.fhTest.ai.doc;
    const you = { by: "user" };
    doc.transact({ actor: you, label }, (tx) => {
      const id = `n${9000 + pitch}`;
      tx.set(["notes", id], { id, trackId: doc.song.trackOrder[0], pitch, start: 7 * bar, duration: 960, velocity: 80, createdBy: you, shapedBy: you });
    });
  }, [label, pitch, BAR]);
for (let n = 0; n < 9; n++) await userWrites(`paso de prueba ${n}`, 40 + n);
await settle();
const box = await page.locator(".histbox").evaluate((el) => ({ h: el.getBoundingClientRect().height, scroll: el.scrollHeight, oy: getComputedStyle(el).overflowY, os: getComputedStyle(el).overscrollBehaviorY }));
check("the history scrolls in its own box, about six entries high", box.oy === "auto" && box.h <= 280 && box.scroll > box.h && box.os === "auto", JSON.stringify(box));
check("the newest step is marked as where you are", /paso de prueba 8/.test(await page.locator(".hi.cur").innerText()));
const has = (pitch) => page.evaluate((p) => `n${9000 + p}` in window.fhTest.replica.song.notes, pitch);
await page.locator(".hi .hgo", { hasText: "paso de prueba 5" }).click();
await settle();
check("a click on a step goes back to right after it", (await has(45)) && !(await has(46)) && !(await has(48)));
check("the steps after it are in grey and it is where you are", (await page.locator(".hi.undone").count()) === 3 && /paso de prueba 5/.test(await page.locator(".hi.cur").innerText()));
check("going back leaves no undo entries in the list", !/deshiciste/.test(await page.locator(".histbox").innerText()));
await page.locator(".hi.undone .hgo", { hasText: "paso de prueba 7" }).click();
await settle();
check("a click on a grey step redoes up to it", (await has(47)) && !(await has(48)) && (await page.locator(".hi.undone").count()) === 1);
await userWrites("otra cosa", 60);
await settle();
check("a new change drops the grey steps", (await page.locator(".hi.undone").count()) === 0 && !/paso de prueba 8/.test(await page.locator(".histbox").innerText()));
await page.evaluate(() => window.fhTest.ai.setAi({ clients: [], reading: null, writing: [{ id: "i95", name: "Claude", description: "Bajo", notes: 0, trackIds: [], start: null, end: null }], mark: null }));
await settle();
check("while the AI writes, going back waits", (await page.locator(".hi .hgo:disabled").count()) > 0 && (await page.locator(".hi .hgo:not(:disabled)").count()) === 0);
await page.evaluate(() => window.fhTest.ai.setAi({ clients: [], reading: null, writing: [], mark: null }));
await settle();

// A2 (03/11/2026): no 15-track limit. Past 15 the button still adds, and every track has its own strip.
await page.keyboard.press("Escape");
while ((await song()).trackOrder.length < 18) {
  await page.locator(".addtrack button").click();
  await menuItem("Chelos").click();
  await settle();
}
check("«Añadir pista» still adds past 15 tracks", (await song()).trackOrder.length === 18 && (await page.locator(".addtrack button").isEnabled()));
const strips = await page.evaluate(() => window.fhTest.replica.song.trackOrder.map((id) => window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])));
check("each of the 18 tracks plays on a strip of its own", new Set(strips).size === 18, JSON.stringify(strips));

// F2.2 parte B (03/11/2026): the console in the piano roll's place, F2 / F3.
await page.locator(".arrangement, .work").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press("F3");
await settle();
check("F3 opens the console where the piano roll was", (await page.locator(".console").count()) === 1 && (await page.locator("section.roll").count()) === 0);
const cStripCount = await page.locator(".console .cstrip.track").count();
check("the console has a strip per track and the Master", cStripCount === (await song()).trackOrder.length && (await page.locator(".console .cstrip.master").count()) === 1, String(cStripCount));
const ct0 = (await song()).trackOrder[0];
const cVol0 = (await song()).tracks[ct0].volume;
const cFader = page.locator(`.cstrip[data-track="${ct0}"] .cvfader`);
const cfb = await cFader.boundingBox();
await page.mouse.move(cfb.x + cfb.width / 2, cfb.y + cfb.height * 0.5);
await page.mouse.down();
await page.mouse.move(cfb.x + cfb.width / 2, cfb.y + cfb.height * 0.7, { steps: 4 });
await page.mouse.up();
await settle();
const cVol1 = (await song()).tracks[ct0].volume;
check("dragging a fader down lowers the track's volume", cVol1 < cVol0, `${cVol0} → ${cVol1}`);
await page.keyboard.press("Control+z");
await settle();
check("one undo puts the fader back", (await song()).tracks[ct0].volume === cVol0);
await cFader.focus();
await page.keyboard.press("ArrowUp");
await settle();
const cUp = (await song()).tracks[ct0].volume;
check("an arrow on the fader moves it 1 dB", Math.abs(40 * Math.log10(Math.round(cUp * 127) / 127) - 40 * Math.log10(Math.round(cVol0 * 127) / 127) - 1) < 0.35, `${cVol0} → ${cUp}`);
await page.locator(`.cstrip[data-track="${ct0}"] .msb`, { hasText: "M" }).click();
await settle();
const cMixMuted = await page.evaluate((id) => window.fhTest.ai.engine.mix.find((m) => m.track === id), ct0);
check("M in the console mutes the track and turns its engine strip off", (await song()).tracks[ct0].mute === true && cMixMuted?.on === false, JSON.stringify(cMixMuted));
await page.locator(`.cstrip[data-track="${ct0}"] .msb`, { hasText: "M" }).click();
const ct1 = (await song()).trackOrder[1];
await page.locator(`.cstrip[data-track="${ct1}"] .msb`, { hasText: "S" }).click();
await settle();
const cOffs = await page.evaluate(() => window.fhTest.ai.engine.mix.filter((m) => m.on === false).map((m) => m.track));
check("S turns every other track's strip off, and dims them", cOffs.length === (await song()).trackOrder.length - 1 && !cOffs.includes(ct1) && (await page.locator(".cstrip.track.muted").count()) === cOffs.length, JSON.stringify(cOffs));
await page.locator(`.cstrip[data-track="${ct1}"] .msb`, { hasText: "S" }).click();
await settle();
const cMf = page.locator(`.cstrip.master .cvfader`);
await cMf.focus();
await page.keyboard.press("ArrowDown");
await settle();
const cMv = (await song()).masterVolume;
check("the Master's fader writes the song's master volume and the engine gets its gain", typeof cMv === "number" && cMv < 1 && Math.abs(await page.evaluate(() => window.fhTest.ai.engine.master) - Math.pow(10, (40 * Math.log10(Math.round(cMv * 127) / 127)) / 20)) < 1e-9, String(cMv));
await page.locator(".cstrip.master .cvfader").dblclick();
await settle();
check("double click puts the Master back at 0 dB", (await song()).masterVolume === undefined);
await page.getByRole("button", { name: "Estrecho" }).click();
await settle();
check("«Estrecho» narrows every track strip", (await page.locator(".cstrip.track.narrow").count()) === cStripCount);
await page.getByRole("button", { name: "Normal" }).click();
await page.getByRole("button", { name: "Ampliar" }).click();
await settle();
check("«Ampliar» hides the arrangement and «Reducir» brings it back", (await page.locator(".arrsplit").count()) === 0 && (await page.getByRole("button", { name: "Reducir" }).count()) === 1);
await page.getByRole("button", { name: "Reducir" }).click();
await settle();
const cLoadShown = await page.locator(".load").count();
check("«Carga» shows only while the engine gives its load", cLoadShown === 0 || (await page.locator(".load").innerText()).includes("Carga"));
await page.evaluate(() => (window.fhTest.ai.engine.load = { avgLoad: 0.8, maxLoad: 0.9, dropouts: 0 }));
await page.waitForTimeout(1300);
check("«Carga» turns amber from 70 %", (await page.locator(".load.hot").count()) === 1 && /80 %/.test(await page.locator(".load").innerText()));
// Typed values (Fran, 03/11/2026): one click on the dB or the pan opens the field.
await page.locator(`.cstrip[data-track="${ct0}"] button.cdb`).click();
await page.keyboard.type("-6");
await page.keyboard.press("Enter");
await settle();
check("a click on the dB lets you type the volume", Math.abs(40 * Math.log10(Math.round((await song()).tracks[ct0].volume * 127) / 127) + 6) < 0.35, String((await song()).tracks[ct0].volume));
await page.locator(`.cstrip[data-track="${ct0}"] button.cval`).click();
await page.keyboard.type("L30");
await page.keyboard.press("Enter");
await settle();
check("a click on the pan lets you type it", (await song()).tracks[ct0].pan === -0.3);
await page.locator(".cstrip.master button.cdb").click();
await page.keyboard.type("-3");
await page.keyboard.press("Enter");
await settle();
check("the Master's dB can be typed too", Math.abs(40 * Math.log10(Math.round((await song()).masterVolume * 127) / 127) + 3) < 0.35);
await page.locator(".cstrip.master button.cdb").click();
await page.keyboard.type("hola");
await page.keyboard.press("Enter");
await settle();
check("text that is not a volume leaves it as it was", Math.abs(40 * Math.log10(Math.round((await song()).masterVolume * 127) / 127) + 3) < 0.35);
await page.keyboard.press("F2");
await settle();
check("F2 goes back to the editor", (await page.locator(".console").count()) === 0 && (await page.locator("section.roll").count()) === 1);

// One Mezcla / Editor button (proposal, 03/11/2026): it says where it takes you, in both bars.
await page.locator(".rtools .modeb").click();
await settle();
check("«Mezcla» in the piano roll's bar opens the console", (await page.locator(".console").count()) === 1);
check("in the console the same button says «Editor»", /Editor/.test(await page.locator(".ctoolbar .modeb").innerText()));
await page.locator(".ctoolbar .modeb").click();
await settle();
check("«Editor» goes back to the piano roll", (await page.locator("section.roll").count()) === 1);

// A shorter arrangement that scrolls (Fran, 03/11/2026): the lanes follow, nothing goes black.
await page.evaluate(() => window.fhTest.view.set({ arrHeight: 170 }));
await settle();
await page.evaluate(() => (document.querySelector(".arr").scrollTop = 140));
await page.waitForTimeout(200);
const arrScroll = await page.evaluate(() => {
  const a = document.querySelector(".arr");
  const c = document.querySelector(".lanes canvas");
  return { scroll: a.scrollTop, top: c.getBoundingClientRect().top - a.getBoundingClientRect().top, h: c.getBoundingClientRect().height, view: a.clientHeight };
});
check("the lanes' canvas stays in view when the arrangement scrolls", arrScroll.scroll > 0 && Math.abs(arrScroll.top) < 1 && Math.abs(arrScroll.h - arrScroll.view) < 2, JSON.stringify(arrScroll));
const laneBox = await page.locator(".lanes canvas").first().boundingBox();
await page.mouse.click(laneBox.x + 30, laneBox.y + laneBox.height - 12);
await settle();
const picked = await page.evaluate(() => {
  const s = window.fhTest.replica.song;
  const a = document.querySelector(".arr");
  const lane = Math.floor((a.clientHeight - 12 + a.scrollTop - 22) / (document.querySelector(".thdr").getBoundingClientRect().height + 0 || 54));
  return { active: s.context.activeTrackId, under: s.trackOrder[Math.min(lane, s.trackOrder.length - 1)] };
});
check("a click on a scrolled lane picks the track under the mouse", picked.active === picked.under, JSON.stringify(picked));
await page.evaluate(() => window.fhTest.view.set({ arrHeight: null }));

// F2.2 parte C1: effects in the console. Ozone is a favourite, so the short «+» menu has it.
await page.evaluate(() => window.fhTest.audio.updateSoundPrefs((p) => ({ ...p, favorites: [...p.favorites, "plugin:VST3-Ozone 11-3"] })));
await page.evaluate(() => window.fhTest.view.set({ bottom: "mix", mixNarrow: false, mixMax: false }));
await settle();
const fxTrack = (await song()).trackOrder[0];
const fxStrip = page.locator(`.cstrip[data-track="${fxTrack}"]`);
await fxStrip.locator("button.cslot.add").click();
await menuItem("EQ").click();
await settle();
let fxChain = (await song()).tracks[fxTrack].inserts ?? [];
check("«+» › EQ adds an EQ to the track, with its parameters", fxChain.length === 1 && fxChain[0].kind === "eq" && fxChain[0].params.lowMidFreq === 400, JSON.stringify(fxChain));
const fxSent = await page.evaluate((id) => window.fhTest.ai.engine.inserts.get(window.fhTest.audio.stripOf(window.fhTest.replica.song.tracks[id])), fxTrack);
check("the engine gets the track's chain", fxSent?.length === 1 && fxSent[0].kind === "eq" && fxSent[0].params.lowMidFreq === 400, JSON.stringify(fxSent));
await fxStrip.locator("button.cslot.add").click();
await menuItem("Compresor").click();
await settle();
await fxStrip.locator("button.cslot.add").click();
await page.locator(".menu [role=menuitem]", { hasText: "Ozone 11" }).first().click();
await settle();
fxChain = (await song()).tracks[fxTrack].inserts;
check("a plugin effect goes in the chain as which plugin it is", fxChain.length === 3 && fxChain[2].kind === "plugin" && fxChain[2].plugin.name === "Ozone 11");
await fxStrip.locator(".cslot[data-fx]").nth(2).dblclick();
await settle();
check("double click on a plugin effect opens its window", await page.evaluate((id) => window.fhTest.ai.engine.shownInserts.includes(id), fxChain[2].id));
// Drag the compressor before the EQ.
await fxStrip.locator(".cslot[data-fx]").nth(1).dragTo(fxStrip.locator(".cslot[data-fx]").nth(0));
await settle();
check("dragging a slot reorders the chain", (await song()).tracks[fxTrack].inserts.map((x) => x.kind).join() === "compressor,eq,plugin", (await song()).tracks[fxTrack].inserts.map((x) => x.kind).join());
// Down (Fran, 04/11/2026): the first one onto the lower half of the second goes after it.
{
  const second = fxStrip.locator(".cslot[data-fx]").nth(1);
  const box = await second.boundingBox();
  await fxStrip.locator(".cslot[data-fx]").nth(0).dragTo(second, { targetPosition: { x: box.width / 2, y: box.height - 3 } });
  await settle();
  check("dragging a slot down onto the next one puts it after it", (await song()).tracks[fxTrack].inserts.map((x) => x.kind).join() === "eq,compressor,plugin", (await song()).tracks[fxTrack].inserts.map((x) => x.kind).join());
  await page.keyboard.press("Control+z");
  await settle();
}
// To another strip.
const fxOther = (await song()).trackOrder[1];
await fxStrip.locator(".cslot[data-fx]").nth(0).dragTo(page.locator(`.cstrip[data-track="${fxOther}"] button.cslot.add`));
await settle();
check("dragging a slot onto another strip moves the effect there", (await song()).tracks[fxOther].inserts?.[0]?.kind === "compressor" && (await song()).tracks[fxTrack].inserts.length === 2);
await page.keyboard.press("Control+z");
await settle();
check("one undo brings it back", (await song()).tracks[fxTrack].inserts.length === 3 && !(await song()).tracks[fxOther].inserts);
// Bypass from the menu.
await fxStrip.locator(".cslot[data-fx]").nth(1).click({ button: "right" });
await menuItem("Anular").click();
await settle();
check("«Anular» bypasses the effect and the slot shows it", (await song()).tracks[fxTrack].inserts[1].bypass === true && (await fxStrip.locator(".cslot.byp").count()) === 1);
// A name of the user's (Fran, 04/11/2026).
await fxStrip.locator(".cslot[data-fx]").nth(0).click({ button: "right" });
await menuItem("Cambiar nombre").click();
await page.keyboard.press("Control+a");
await page.keyboard.type("Compresor voces");
await page.keyboard.press("Enter");
await settle();
check("«Cambiar nombre» gives the effect the user's name, shown in its slot", (await song()).tracks[fxTrack].inserts[0].name === "Compresor voces" && /Compresor voces/.test(await fxStrip.locator(".cslot[data-fx]").nth(0).innerText()));
check("its tooltip still says what it is", /Compresor voces · Compresor/.test(await fxStrip.locator(".cslot[data-fx]").nth(0).getAttribute("title")));
await fxStrip.locator(".cslot[data-fx]").nth(0).click({ button: "right" });
await menuItem("Volver a llamarlo Compresor").click();
await settle();
check("and it can go back to its own name", !("name" in (await song()).tracks[fxTrack].inserts[0]));
// Supr removes the selected effect, not notes.
const notesBefore = Object.keys((await song()).notes).length;
await fxStrip.locator(".cslot[data-fx]").nth(0).click();
await page.keyboard.press("Delete");
await settle();
check("Supr removes the selected effect and no notes", (await song()).tracks[fxTrack].inserts.length === 2 && Object.keys((await song()).notes).length === notesBefore);
// The Master's chain.
await page.locator(".cstrip.master button.cslot.add").click();
await menuItem("Limitador").click();
await settle();
check("the Master takes effects too", (await song()).masterInserts?.[0]?.kind === "limiter" && (await page.evaluate(() => window.fhTest.ai.engine.inserts.get(-1)?.[0]?.kind)) === "limiter");
// A plugin that fails is marked.
await page.evaluate(() => (window.fhTest.ai.engine.failPlugin = "VST3-Ozone 11-3"));
await fxStrip.locator("button.cslot.add").click();
await page.locator(".menu [role=menuitem]", { hasText: "Ozone 11" }).first().click();
await settle();
check("a plugin effect that cannot load is marked in amber with why", (await fxStrip.locator(".cslot.bad").count()) >= 1 && /no se pudo cargar/.test(await fxStrip.locator(".cslot.bad").last().getAttribute("title")));
// Fran, 04/11/2026: the «+» menu stays short; the whole list is in Sonidos › Efectos, folded.
await fxStrip.locator("button.cslot.add").click();
const plusItems = await page.locator(".menu [role=menuitem]").allInnerTexts();
check("«+» lists Four Hands' effects, the favourites and «Todos los efectos…», not every plugin", plusItems.some((x) => /^EQ$/.test(x)) && plusItems.some((x) => /Ozone 11/.test(x)) && plusItems.some((x) => /Todos los efectos/.test(x)), JSON.stringify(plusItems));
await page.locator(".menu [role=menuitem]", { hasText: "Todos los efectos" }).click();
await settle();
check("«Todos los efectos…» opens Sonidos with the effects", (await page.getByRole("radio", { name: "Efectos" }).getAttribute("aria-checked")) === "true" && (await page.locator("[data-effect]").count()) === 0 && (await page.locator(".sndgh").count()) > 0);
await page.locator(".sndgh", { hasText: "Ecualizadores" }).click();
await settle();
const fxBefore = (await song()).tracks[fxTrack].inserts.length;
await page.locator('[data-effect="fx:eq"]').dblclick();
await settle();
check("double click on an effect in Sonidos adds it to the active track", (await song()).tracks[fxTrack].inserts.length === fxBefore + 1 && (await song()).tracks[fxTrack].inserts.at(-1).kind === "eq");
await page.locator('[data-effect="fx:eq"]').dragTo(fxStrip.locator(".cslot[data-fx]").nth(0));
await settle();
check("dragging an effect from Sonidos onto a slot puts it there", (await song()).tracks[fxTrack].inserts.length === fxBefore + 2 && (await song()).tracks[fxTrack].inserts[0].kind === "eq");
await page.locator(".sndfor .linkbtn").click();
await settle();
const masterBefore = (await song()).masterInserts?.length ?? 0;
await page.locator('[data-effect="fx:eq"]').dblclick();
await settle();
check("«al Máster» sends the effects there", ((await song()).masterInserts?.length ?? 0) === masterBefore + 1);
await page.getByRole("radio", { name: "Instrumentos" }).click();
await page.evaluate(() => window.fhTest.view.set({ bottom: "editor" }));

// F2.2 parte C2: the window of Four Hands' own effects.
await page.evaluate(() => window.fhTest.view.set({ bottom: "mix" }));
await settle();
const winTrack = (await song()).trackOrder[3];
await page.evaluate(async (t) => {
  await window.fhTest.replica.run("x", [{ type: "addInsert", target: t, spec: { kind: "eq" } }, { type: "addInsert", target: t, spec: { kind: "compressor" } }]);
}, winTrack);
await settle();
const [eqId, compId] = (await song()).tracks[winTrack].inserts.map((x) => x.id);
await page.locator(`.cslot[data-fx="${eqId}"]`).dblclick();
await settle();
check("double click on an own effect opens its window", (await page.locator(".fxwin.eq").count()) === 1 && /EQ/.test(await page.locator(".fxtitle").innerText()));
// Drag band 4 (high-mid) up: its gain rises, one undo step.
{
  const box = await page.locator(".fxcurve canvas").boundingBox();
  const pt = await page.locator(".fxpt").nth(3).boundingBox();
  await page.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2);
  await page.mouse.down();
  await page.mouse.move(pt.x + pt.width / 2, box.y + box.height * 0.25, { steps: 4 });
  await page.mouse.up();
  await settle();
  const eq = (await song()).tracks[winTrack].inserts[0];
  check("dragging an EQ point up raises that band's gain", eq.params.highMidGain > 3, String(eq.params.highMidGain));
  const sent = await page.evaluate((id) => [...window.fhTest.ai.engine.inserts.values()].flat().find((x) => x.id === id)?.params.highMidGain, eqId);
  check("the engine gets the new gain", sent === eq.params.highMidGain, String(sent));
  await page.keyboard.press("Control+z");
  await settle();
  check("one undo puts the band back", (await song()).tracks[winTrack].inserts[0].params.highMidGain === 0);
}
// A typed value in a band.
await page.locator(".fxband").nth(2).locator("button.fxval").first().click();
await page.keyboard.press("Control+a");
await page.keyboard.type("250");
await page.keyboard.press("Enter");
await settle();
check("a frequency can be typed in its band", (await song()).tracks[winTrack].inserts[0].params.lowMidFreq === 250);
// The AI changes it: the window follows.
await page.evaluate(async (id) => window.fhTest.replica.run("x", [{ type: "updateInsert", id, changes: { params: { highGain: 4 } } }]), eqId);
await settle();
check("what changes in the song shows in the window at once", /\+4,0 dB/.test(await page.locator(".fxband").nth(4).innerText()));
await page.locator(".fxhead .tgl").click();
await settle();
check("«Activo» in the header bypasses the effect", (await song()).tracks[winTrack].inserts[0].bypass === true && (await page.locator(".fxwin.byp").count()) === 1);
await page.keyboard.press("Escape");
await settle();
check("Esc closes the window", (await page.locator(".fxwin").count()) === 0);
// The compressor: its faders, and its reduction meter.
await page.evaluate(() => (window.fhTest.ai.engine.reduction = 6));
await page.locator(`.cslot[data-fx="${compId}"]`).dblclick();
await settle();
await page.waitForTimeout(200);
check("the compressor's window shows how much it reduces", (await page.locator(".fxwin.compressor").count()) === 1 && /6,0/.test(await page.locator(".fxgrval").innerText()));
await page.locator(".fxrow").nth(1).locator(".fader").focus();
await page.keyboard.press("ArrowRight");
await settle();
check("a fader in the window changes its parameter (ratio)", (await song()).tracks[winTrack].inserts[1].params.ratio > 3, String((await song()).tracks[winTrack].inserts[1].params.ratio));
await page.locator(".fxhead .ibtn").click();

// F2.2 parte D (04/11/2026): buses and sends in the console. A song starts without buses; the user
// makes a «Reverb» bus with Four Hands' reverb (b1).
await page.evaluate(() => window.fhTest.view.set({ bottom: "mix", mixNarrow: false, mixMax: true }));
await settle();
check("a song starts without buses: no divider", (await song()).buses === undefined && (await page.locator(".cdivider").count()) === 0);
check("without buses the engine gets an empty routing", JSON.stringify((await page.evaluate(() => window.fhTest.ai.engine.routing))?.order) === "[]");
await page.evaluate(async () => {
  const r = window.fhTest.replica;
  await r.run("x", [{ type: "addBus", spec: { name: "Reverb" } }]);
  await r.run("x", [{ type: "addInsert", target: "b1", spec: { kind: "reverb" } }]);
});
await settle();
// A track with no sends yet.
const bTrack = await page.evaluate(() => { const s = window.fhTest.replica.song; return s.trackOrder.find((id) => !s.tracks[id].sends && !s.tracks[id].output); });
const bStrip = page.locator(`.cstrip[data-track="${bTrack}"]`);
check("the console has the «Buses» divider and the «Reverb» bus with its reverb", (await page.locator(".cdivider", { hasText: "Buses" }).count()) === 1 && (await page.locator('.cstrip.bus[data-bus="b1"] .cslot', { hasText: "Reverb" }).count()) === 1);
let routing = await page.evaluate(() => window.fhTest.ai.engine.routing);
check("the engine gets the routing: the Reverb bus; the instruments' own reverb stays in the engine", routing?.order?.length === 1 && routing.buses[0].out === -1 && routing.instrumentReverb === -1, JSON.stringify(routing));
await bStrip.locator("button.csend.add").click();
await menuItem("Reverb").click();
await settle();
check("«+ envío» › Reverb sends the track to the Reverb bus at half", JSON.stringify((await song()).tracks[bTrack].sends) === JSON.stringify([{ bus: "b1", level: 0.5 }]), JSON.stringify((await song()).tracks[bTrack].sends));
routing = await page.evaluate(() => window.fhTest.ai.engine.routing);
check("and the engine gets the send", routing.strips.some((r) => r.sends.length === 1 && r.sends[0].level === 0.5 && !r.sends[0].pre), JSON.stringify(routing.strips));
const sendBar = bStrip.locator('.csend[data-send="b1"]');
const sbb = await sendBar.boundingBox();
await page.mouse.move(sbb.x + sbb.width / 2, sbb.y + sbb.height / 2);
await page.mouse.down();
await page.mouse.move(sbb.x + sbb.width * 0.25, sbb.y + sbb.height / 2, { steps: 4 });
await page.mouse.up();
await settle();
const lowered = (await song()).tracks[bTrack].sends[0].level;
check("dragging the send to the left lowers it", lowered < 0.5 && lowered > 0.1, String(lowered));
await page.keyboard.press("Control+z");
await settle();
check("one undo puts the send back", (await song()).tracks[bTrack].sends[0].level === 0.5);
await sendBar.click({ button: "right" });
await menuItem("Antes del fader").click();
await settle();
check("right click › Antes del fader makes it pre-fader", (await song()).tracks[bTrack].sends[0].pre === true && (await page.locator('.csend.pre[data-send="b1"]').count()) === 1);
// The output: a new bus for the track, named in place.
await bStrip.locator("button.cout").click();
await menuItem("Nuevo bus…").click();
await settle();
check("the output › Nuevo bus… makes a bus and sends the track into it", (await song()).tracks[bTrack].bus === "b2" && (await song()).buses.b2 !== undefined);
await page.keyboard.press("Control+a");
await page.keyboard.type("Voces");
await page.keyboard.press("Enter");
await settle();
check("the new bus's name is typed in place", (await song()).buses.b2.name === "Voces" && /→ Voces/.test(await bStrip.locator("button.cout").innerText()));
check("a bus with tracks going in says it is a subgroup", /Subgrupo/.test(await page.locator('.cstrip.bus[data-bus="b2"] .cinst').innerText()));
await page.locator('.cstrip.bus[data-bus="b2"] .cvfader').focus();
await page.keyboard.press("ArrowDown");
await settle();
const vBus = (await song()).buses.b2.volume;
const vSent = await page.evaluate(() => window.fhTest.ai.engine.buses.find((b) => b.id === "b2"));
check("the bus's fader writes its volume and the engine gets the gain", vBus < 1 && vSent && Math.abs(vSent.gain - Math.pow(10, (40 * Math.log10(Math.round(vBus * 127) / 127)) / 20)) < 1e-9, JSON.stringify(vSent));
await page.locator('.cstrip.bus[data-bus="b2"] .msb', { hasText: "S" }).click();
await settle();
const soloOn = await page.evaluate(() => window.fhTest.ai.engine.mix.filter((m) => m.on !== false && m.track).map((m) => m.track));
check("S on a bus keeps on only what goes into it", JSON.stringify(soloOn) === JSON.stringify([bTrack]), JSON.stringify(soloOn));
await page.locator('.cstrip.bus[data-bus="b2"] .msb', { hasText: "S" }).click();
await settle();
// A bus cannot go into one that already goes into it.
await page.locator('.cstrip.bus[data-bus="b1"] button.cout').click();
await menuItem("Voces").click();
await settle();
await page.locator('.cstrip.bus[data-bus="b2"] button.cout').click();
check("a bus's output menu leaves out the buses that would loop", (await page.locator(".menu [role=menuitem]", { hasText: "Reverb" }).count()) === 0);
await page.keyboard.press("Escape");
await page.keyboard.press("Control+z");
await settle();
// Supr deletes the selected bus: the track goes back to the Master, with a notice.
await page.locator('.cstrip.bus[data-bus="b2"] .cname').click();
await page.keyboard.press("Delete");
await settle();
check("Supr deletes the selected bus and its track goes back to the Master", (await song()).buses.b2 === undefined && (await song()).tracks[bTrack].bus === undefined);
check("a notice says where its tracks went", /Voces.*Máster/.test(await page.locator(".notice").first().innerText().catch(() => "")), await page.locator(".notice").first().innerText().catch(() => "none"));
await page.keyboard.press("Control+z");
await settle();
check("one undo brings the bus back, with its track", (await song()).buses.b2?.name === "Voces" && (await song()).tracks[bTrack].bus === "b2");
await page.getByRole("button", { name: "Añadir bus" }).click();
await settle();
check("«Añadir bus» adds a bus after the others", JSON.stringify((await song()).busOrder) === JSON.stringify(["b1", "b2", "b3"]));
await page.keyboard.press("Escape");
// Fran, 04/11/2026: Four Hands' delay, in time with the song or in ms.
await page.locator('.cstrip.bus[data-bus="b1"] button.cslot.add').click();
await menuItem("Delay").click();
await settle();
const dly = (await song()).buses.b1.inserts.find((x) => x.kind === "delay");
check("«+» › Delay adds the delay, in time with the song (a quarter note)", dly?.params.sync === 1 && dly.params.note === 8, JSON.stringify(dly));
await page.locator(`.cslot[data-fx="${dly.id}"]`).dblclick();
await settle();
check("its window shows the note value", (await page.locator(".fxwin.delay").count()) === 1 && /Negra/.test(await page.locator(".fxwin.delay").innerText()));
await page.locator(".fxwin.delay .fxrow", { hasText: "Al tempo" }).locator("button.tgl").click();
await settle();
check("«Al tempo» off: the time in ms instead of the note", (await song()).buses.b1.inserts.find((x) => x.id === dly.id).params.sync === 0 && /375 ms/.test(await page.locator(".fxwin.delay").innerText()));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.evaluate(() => window.fhTest.view.set({ bottom: "editor", mixMax: false }));

// Library cards (Fran, 05/11/2026): a plugin track gets a card in the user's catalog, edits it in Pista,
// and the same card links to another track from «Usar otra ficha…».
const libTrack = (await song()).trackOrder[0];
await page.evaluate(async (id) => {
  const r = window.fhTest.replica;
  await r.run("x", [{ type: "updateTrack", id, changes: { output: "plugin", plugin: { id: "VST3-Kontakt 8-1", name: "Kontakt 8" } } }]);
  r.setContext({ activeTrackId: id });
  window.fhTest.view.set({ panelOpen: true, panelTab: "track" });
}, libTrack);
await settle();
check("a plugin track without a card shows «Sin ficha» in Pista", /Sin ficha/.test(await page.locator(".tclibsec").innerText().catch(() => "")));
await page.getByRole("button", { name: "Crear ficha" }).click();
await settle();
check("«Crear ficha» links a new card (one undo step) and opens it to edit", !!(await song()).tracks[libTrack].library && (await page.locator(".tclib.edit").count()) === 1, JSON.stringify((await song()).tracks[libTrack].library));
await page.getByRole("radiogroup", { name: "Velocidad" }).getByRole("radio", { name: "Débil" }).click();
await page.getByLabel("Rango 1").fill("Do2");
await page.getByLabel("Rango 2").fill("Do6");
await page.locator(".tclib .lchip.add").click();
await page.getByLabel("Nota", { exact: true }).fill("Do1");
await page.getByLabel("Articulación", { exact: true }).fill("Sustain");
await page.getByLabel("Articulación", { exact: true }).press("Enter");
await page.getByRole("button", { name: "Guardar" }).click();
await settle();
const libText = await page.locator(".tclibsec .tclib").innerText().catch(() => "");
check("«Guardar» keeps the card: velocity, range and articulations, filled by the user", /Débil/.test(libText) && /Do2\s*–\s*Do6/.test(libText) && /Do1 Sustain/.test(libText) && /en Kontakt, C1\s*–\s*C5/.test(libText) && /Rellenada por ti/.test(libText), libText);
await page.keyboard.press("Control+z");
await settle();
check("undo unlinks the card from the track (the card stays in the catalog)", !(await song()).tracks[libTrack].library && /Sin ficha/.test(await page.locator(".tclibsec").innerText()));
await page.getByRole("button", { name: "Usar otra ficha…" }).click();
await menuItem((await page.evaluate(() => window.fhTest.replica.song.tracks[window.fhTest.replica.song.trackOrder[0]].name))).click();
await settle();
check("«Usar otra ficha…» lists the catalog's cards and links the chosen one", !!(await song()).tracks[libTrack].library && /Do1 Sustain/.test(await page.locator(".tclibsec").innerText()));

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("FAIL", f);
if (errors.length) console.log("page errors", errors);
await browser.close();
server.close();
process.exit(failures.length || errors.length ? 1 : 0);
