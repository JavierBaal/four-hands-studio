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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
check("zoom in", (await page.evaluate(() => window.fhTest.view.state.pxPerTick)) > z0);
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
await page.keyboard.press("Space");
await settle();
check("stop", !(await page.evaluate(() => window.fhTest.audio.player.playing)));
check("cursor kept", (await song()).context.cursor === cursor);

// 17. Ctrl+K: the computer keyboard plays notes; its letters stop being shortcuts.
await page.keyboard.press("Control+k");
check("piano mode", await page.evaluate(() => window.fhTest.audio.pianoMode));
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

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("FAIL", f);
if (errors.length) console.log("page errors", errors);
await browser.close();
server.close();
process.exit(failures.length || errors.length ? 1 : 0);
