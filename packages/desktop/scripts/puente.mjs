// End to end, as Claude Desktop would do it (H3): the real Electron app, the packed bridge started
// over stdio by a real MCP client, and routes 1, 3 and 6 of the PRD.
// Usage (Linux without a screen): npm run puente  (builds the app and the bridge, then runs this with xvfb-run)
// Screenshots of the window while the AI writes go to the folder given as first argument (default: puente).
import { _electron as electron } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const repo = path.join(appDir, "..", "..");
const shots = path.resolve(process.argv[2] ?? "puente");
fs.mkdirSync(shots, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-e2e-"));
const electronPath = path.join(repo, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData"), XDG_CONFIG_HOME: path.join(home, ".config"), FH_LANG: "es" };
const bridgeEntry = path.join(repo, "packages", "bridge", "dist", "pkg", "server", "index.mjs");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail);
  if (!ok) failures.push(name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await electron.launch({ executablePath: electronPath, args: [".", "--no-sandbox"], cwd: appDir, env });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForTimeout(1200);
check("chip says the AI is not connected", (await win.locator(".aichip").innerText()).includes("IA sin conectar"));

// --- The bridge, started by a real MCP client over stdio (as Claude Desktop does)
const transport = new StdioClientTransport({ command: process.execPath, args: [bridgeEntry], env, stderr: "pipe" });
const client = new Client({ name: "claude-ai", version: "e2e" });
await client.connect(transport);
const tools = (await client.listTools()).tools;
check("the bridge lists the tools, analyze and the skills included", tools.length === 36 && ["analyze", "get_levels", "remove_annotations", "list_skills", "load_skill", "get_changes_since", "get_history", "summarize"].every((n) => tools.some((t) => t.name === n)), tools.length);
check("read tools are read-only for Claude's permissions", tools.filter((t) => t.annotations?.readOnlyHint).length === 12);
const instructions = client.getInstructions() ?? "";
check("the server instructions ask to load four-hands-basics first", instructions.includes('load_skill("four-hands-basics")'));
await win.waitForFunction(() => document.querySelector(".aichip")?.textContent?.includes("Claude conectado"), null, { timeout: 8000 }).catch(() => {});
check("chip says Claude is connected", (await win.locator(".aichip").innerText()).includes("Claude conectado"));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.map((c) => c.text).join("\n") ?? "";
  if (r.structuredContent) failures.push(`${name} sent structuredContent`);
  return { ok: !r.isError, text };
};

// --- The skills travel with the app (ESTUDIO_SKILLS.md, 3)
const skillList = await call("list_skills");
check("the app serves its built-in skills", skillList.ok && /^- four-hands-basics \(built in\)/m.test(skillList.text) && /- styles \(built in, 3 reference files\)/.test(skillList.text), skillList.text.slice(0, 300));
const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
const juryPrompt = await client.getPrompt({ name: "call_the_jury", arguments: {} });
check("the jury is in Claude's + menu and loads its skill", prompts.includes("call_the_jury") && /load_skill\("jury"\)/.test(juryPrompt.messages[0]?.content?.text ?? "") && /^- jury \(built in\)/m.test(skillList.text), prompts.join(", "));
check("the window lists the app's skills in Skills activas", (await win.locator(".actskills .askill").count()) === 6, await win.locator(".actskills").innerText());
const basics = await call("load_skill", { name: "four-hands-basics" });
const darkSynth = await call("load_skill", { name: "styles", file: "references/dark-synth.md" });
check("load_skill gives the instructions and the references", basics.ok && /^Skill four-hands-basics \(built in\)\. Follow it\./.test(basics.text) && darkSynth.ok, `${basics.text.slice(0, 120)} / ${darkSynth.text.slice(0, 120)}`);
await win.waitForTimeout(300);
check("the window marks the skills Claude loaded", (await win.locator(".actskills .askill .dot.ai").count()) === 2);

// --- Route 1: "lee la canción y dime qué le falta al puente"
const overview = await call("get_song_overview");
check("route 1: overview of Dilatación", overview.ok && /72 BPM · 4\/4 · A minor · 52 bars/.test(overview.text) && /Puente 29-36/.test(overview.text), overview.text.slice(0, 300));
const bridgeNotes = await call("read_notes", { range: "section:Puente" });
check("route 1: reads the bridge section, every track", bridgeNotes.ok && /notes in Puente \(c\. 29–36\)/.test(bridgeNotes.text) && (bridgeNotes.text.match(/^Four Hands · /gm) ?? []).length === 6);
const ears = await call("analyze", { range: "section:Puente" });
check("route 1: analyze the bridge, the AI's ears", ears.ok && /^Analysis of Puente \(c\. 29–36\), all tracks/.test(ears.text) && /cannot hear sounds/.test(ears.text), ears.text.slice(0, 300));
// H4: the big picture of a section, and what changed since the last call.
const summary = await call("summarize", { range: "section:Puente" });
check("summarize the bridge by track", summary.ok && /summary · c\. 29–36/.test(summary.text) && /Puente c\. 29–36 · /.test(summary.text), summary.text.slice(0, 300));
const changes = await call("get_changes_since");
check("get_changes_since answers", changes.ok && /^Four Hands · changes r\d+ → r\d+|first call/.test(changes.text), changes.text.slice(0, 200));
const context = await call("get_user_context");
check("route 1: reads the user's context", context.ok && /Do Re Mi/.test(context.text) && /Visible in the piano roll: c\. 1–/.test(context.text), context.text);

// --- Route 3: the user draws a rhythm, Claude chooses the pitches
const drawn = await win.evaluate(async () => {
  const bar = 52 * 3840; // bar 53, after the song
  const notes = [0, 1, 2, 3].map((i) => ({ pitch: 72, start: bar + i * 960 + [6, -11, 14, 0][i], duration: 900 - i * 40, velocity: 70 + i }));
  const added = await window.fh.request({ type: "run", label: "dibujaste 4 notas", commands: [{ type: "addTrack", spec: { name: "Violines", program: 40, channel: 12 } }] });
  const reply = await window.fh.request({ type: "run", label: "dibujaste 4 notas", commands: [{ type: "addNotes", trackId: added.results[0], notes }] });
  return { track: added.results[0], ids: reply.results[0] };
});
const rhythm = await call("read_notes", { range: "53", tracks: ["Violines"] });
check("route 3: the AI reads the drawn rhythm with its deviations", rhythm.ok && /~s\+0\.01/.test(rhythm.text) && /~s-0\.01/.test(rhythm.text), rhythm.text);
const revision = /r(\d+)/.exec(rhythm.text)[1];
let iv = await call("begin_intervention", { description: "Alturas para tu ritmo", base_revision: `r${revision}` });
const ivId = /Intervention (i\d+)/.exec(iv.text)?.[1];
check("route 3: intervention opens", iv.ok && !!ivId, iv.text);
await win.waitForTimeout(300);
const before = await win.evaluate((ids) => window.fh.snapshot().then((s) => ids.map((id) => s.song.notes[id])), drawn.ids);
const repitch = await call("repitch_notes", { intervention_id: ivId, pitches: drawn.ids.map((id, i) => `${id} ${["E5", "D5", "B4", "A4"][i]}`).join("\n") });
check("route 3: repitch", repitch.ok, repitch.text);
const after = await win.evaluate((ids) => window.fh.snapshot().then((s) => ids.map((id) => s.song.notes[id])), drawn.ids);
check(
  "route 3: rhythm, durations and velocities untouched; pitches changed",
  after.every((n, i) => n.start === before[i].start && n.duration === before[i].duration && n.velocity === before[i].velocity) && after.map((n) => n.pitch).join() === "76,74,71,69",
  JSON.stringify(after),
);
await win.waitForTimeout(300);
await win.screenshot({ path: path.join(shots, "h3_escribiendo.png") });
check("the window shows the writing bar", (await win.locator(".aibar").count()) === 1 && (await win.locator(".aibar").innerText()).includes("Alturas para tu ritmo"));
check("the chip says where Claude writes", /Claude escribe en Violines, c\. 53/.test(await win.locator(".aichip").innerText()), await win.locator(".aichip").innerText());
await call("end_intervention", { intervention_id: ivId });
await win.waitForTimeout(300);
check("the writing bar goes away on end_intervention", (await win.locator(".aibar:not(.cmpbar)").count()) === 0);
// H4: the change is already in the song; the Con / Sin bar offers to hear it without it.
check("the Con / Sin bar offers the intervention that just ended", (await win.locator(".cmpbar").count()) === 1);

// --- Route 6: the user records a rubato piano phrase; Claude writes a cello counter-melody
const played = await win.evaluate(async () => {
  const bar = 54 * 3840; // bar 55
  const offsets = [13, -21, 37, 8, -30, 55];
  const notes = offsets.map((o, i) => ({ pitch: 64 + (i % 3) * 3, start: bar + i * 960 + o, duration: 900 - i * 17, velocity: 58 + i * 3 }));
  const s = await window.fh.snapshot();
  const piano = s.song.trackOrder.find((id) => s.song.tracks[id].program === 0);
  const reply = await window.fh.request({ type: "run", label: "grabaste 6 notas", commands: [{ type: "addNotes", trackId: piano, notes }] });
  const after = await window.fh.snapshot();
  return { ids: reply.results[0], snapshot: JSON.stringify(reply.results[0].map((id) => after.song.notes[id])) };
});
const ctx2 = await call("read_notes", { range: "55-56" });
iv = await call("begin_intervention", { description: "Contramelodía de chelo que respira contigo", base_revision: `r${/r(\d+)/.exec(ctx2.text)[1]}` });
const iv2 = /Intervention (i\d+)/.exec(iv.text)?.[1];
const cello = await call("add_notes", { intervention_id: iv2, track: "Contramelodia (cello)", notes: "A2 55.1 1/2 v56 ~s+0.03\nC3 55.3 1/4. v60\nB2 55.4+1/2 1/8 v54 ~s-0.02\nE3 56.1 1/2 v62 ~d-0.08\nD3 56.3 1/2 v58" });
check("route 6: the counter-melody is written", cello.ok && /Added 5 notes/.test(cello.text), cello.text);
await call("end_intervention", { intervention_id: iv2 });
const playedAfter = await win.evaluate((ids) => window.fh.snapshot().then((s) => JSON.stringify(ids.map((id) => s.song.notes[id]))), played.ids);
check("route 6: what the user played is untouched (not quantized)", playedAfter === played.snapshot);

// --- H3.1: the mix, from Claude
const mixRead = await call("get_song_overview");
check("the overview shows the mix", /mix vol 80 pan C/.test(mixRead.text), mixRead.text.slice(0, 600));
iv = await call("begin_intervention", { description: "Equilibro la mezcla", base_revision: `r${/r(\d+)/.exec(mixRead.text)[1]}` });
const iv3 = /Intervention (i\d+)/.exec(iv.text)?.[1];
const mix = await call("set_mix", { intervention_id: iv3, mix: "Organo vol 60 pan L30\nViolines vol 85 pan R20" });
await call("end_intervention", { intervention_id: iv3 });
const mixed = await win.evaluate(() => window.fh.snapshot().then((s) => Object.values(s.song.tracks).map((t) => `${t.name}:${Math.round(t.volume * 100)}:${Math.round(t.pan * 100)}`)));
check("set_mix changes volume and pan of the real song", mix.ok && mixed.includes("Organo:60:-30") && mixed.includes("Violines:85:20"), `${mix.text} ${mixed}`);
await win.keyboard.press("Control+z");
await win.waitForTimeout(300);
const unmixed = await win.evaluate(() => window.fh.snapshot().then((s) => Object.values(s.song.tracks).map((t) => `${t.name}:${Math.round(t.volume * 100)}`)));
check("Ctrl+Z puts the mix back in one step", unmixed.includes("Organo:80") && unmixed.includes("Violines:80"), unmixed);

// --- H3.2: track colours, from Claude
const colorRead = await call("get_song_overview");
check("the overview names the track colours", /color lavender/.test(colorRead.text), colorRead.text.slice(0, 600));
iv = await call("begin_intervention", { description: "Colores de pista", base_revision: `r${/r(\d+)/.exec(colorRead.text)[1]}` });
const iv4 = /Intervention (i\d+)/.exec(iv.text)?.[1];
const recolor = await call("update_track", { intervention_id: iv4, track: "Organo", color: "musgo" });
await call("end_intervention", { intervention_id: iv4 });
await win.waitForTimeout(300);
const chipColor = await win.locator(".thdr .tchip").first().evaluate((el) => getComputedStyle(el).backgroundColor);
check("update_track colours a track and the header shows it", recolor.ok && /color moss/.test(recolor.text) && chipColor === "rgb(126, 145, 89)", `${recolor.text} ${chipColor}`);
await win.keyboard.press("Control+z");
await win.waitForTimeout(300);

// --- Pointing and protection
const viewBefore = await win.locator(".pgrid").getAttribute("aria-label");
const point = await call("point_to", { range: "55", tracks: ["Contramelodia (cello)"], reason: "aquí entra el chelo" });
await win.waitForTimeout(300);
check("point_to shows a mark", point.ok && (await win.locator(".pflag").innerText()).includes("aquí entra el chelo"));
await win.screenshot({ path: path.join(shots, "h3_senala.png") });
const viewAfter = await win.locator(".pgrid").getAttribute("aria-label");
check("pointing does not move the view", viewAfter === viewBefore, `${viewBefore} → ${viewAfter}`);

// --- One intervention = one undo step, from the window's Ctrl+Z
const notesBefore = await win.evaluate(() => window.fh.snapshot().then((s) => Object.keys(s.song.notes).length));
await win.locator(".pgrid canvas").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
await win.keyboard.press("Control+z");
await win.waitForTimeout(400);
const notesAfterUndo = await win.evaluate(() => window.fh.snapshot().then((s) => Object.keys(s.song.notes).length));
check("Ctrl+Z undoes Claude's whole intervention in one step", notesBefore - notesAfterUndo === 5, `${notesBefore} → ${notesAfterUndo}`);
const history = await win.evaluate(() => window.fh.snapshot().then((s) => s.history.map((h) => `${h.actor.by}:${h.kind}:${h.label}`)));
check("the history is signed by Claude, one entry per intervention", history.filter((h) => h === "ai:edit:Contramelodía de chelo que respira contigo").length === 1, history.join(" | "));

// --- Closing: the bridge says the app is closed, and comes back with it
await client.close();
await win.waitForTimeout(500);
check("chip goes back to not connected", (await win.locator(".aichip").innerText()).includes("IA sin conectar"));
await app.close();
const configFile = path.join(home, ".config", "FourHandsStudio", "bridge.json");
check("bridge.json removed on quit", !fs.existsSync(configFile));
const logFile = path.join(home, ".config", "Four Hands Studio", "registro-app.jsonl");
const log = fs.readFileSync(logFile, "utf8");
const calls = log.split("\n").filter((l) => l.includes('"type":"ai_call"')).map((l) => JSON.parse(l));
check("every call is in the app's log", calls.length === 26, calls.length);
check("calls answer fast (< 200 ms in the app)", calls.every((c) => c.ms < 200), JSON.stringify(calls.map((c) => c.ms)));
check("no page errors", errors.length === 0, errors.join("\n"));
fs.copyFileSync(logFile, path.join(shots, "registro-app.jsonl"));
fs.rmSync(home, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} failed` : "\nAll good");
process.exit(failures.length ? 1 : 0);
