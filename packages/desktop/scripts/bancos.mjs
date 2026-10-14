// Sound banks in the real Electron app (H2.12): a bank in the sounds folder shows up in the
// palette, a track takes it, it loads and plays; the blind listening asks each bank for its own
// instruments. Usage: node build.mjs && xvfb-run -a node scripts/bancos.mjs <default .sf3> <extra .sf2>
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [defaultBank, extraBank] = process.argv.slice(2);
if (!defaultBank || !extraBank) throw new Error("Usage: bancos.mjs <default .sf3> <extra .sf2>");
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-banks-"));
const sounds = path.join(home, "Documents", "Four Hands", "Sonidos");
fs.mkdirSync(sounds, { recursive: true });
fs.symlinkSync(path.resolve(extraBank), path.join(sounds, path.basename(extraBank)));
const electronPath = path.join(appDir, "..", "..", "node_modules", "electron", "dist", "electron");
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), FH_LANG: "es", FH_SOUNDFONT: path.resolve(defaultBank) };
const launch = (extra = []) => electron.launch({ executablePath: electronPath, args: [".", "--no-sandbox", ...extra], cwd: appDir, env });
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail);
  if (!ok) failures.push(name);
};
const logEntries = () => {
  const file = path.join(home, ".config", "Four Hands Studio", "registro-app.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
};

let app = await launch();
let win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
await win.waitForFunction(() => !document.body.textContent.includes("Cargando el sonido"), null, { timeout: 60000 });
await win.waitForTimeout(500);

await win.locator(".rsubb").click();
const bankItem = win.locator(".menu [role=menuitem]", { hasText: "YDP Grand Piano" });
check("installed bank in the palette", (await bankItem.count()) === 1);
await bankItem.click();
await win.waitForFunction(() => /^Grand Piano/.test(document.querySelector(".rsubb")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
check("track takes the bank's preset", /^Grand Piano/.test(await win.locator(".rsubb").innerText()), await win.locator(".rsubb").innerText());
let loaded = null;
for (let i = 0; i < 60 && !loaded; i++) {
  await win.waitForTimeout(500);
  loaded = logEntries().find((e) => e.type === "bank_loaded");
}
check("the bank loads", !!loaded, JSON.stringify(logEntries().filter((e) => e.type.startsWith("bank"))));
if (loaded) console.log("     loaded in", loaded.ms, "ms");
await win.keyboard.press("Space");
await win.waitForTimeout(2500);
await win.keyboard.press("Space");
await win.waitForTimeout(300);
const stats = logEntries().filter((e) => e.type === "playback_stats").at(-1);
check("plays with no late notes", stats && stats.lateEvents === 0, JSON.stringify(stats));
await win.locator(".rsubb").click();
await win.locator(".menu [role=menuitem]", { hasText: "Conseguir más sonidos" }).click();
check("help card opens", (await win.locator(".soundshelp").count()) === 1);
await win.keyboard.press("Escape");
check("no page errors", errors.length === 0, errors.join("\n"));
await app.close();

// Reopen: the track keeps its bank and loads it again.
app = await launch();
win = await app.firstWindow();
await win.waitForSelector(".topbar", { timeout: 30000 });
let again = false;
for (let i = 0; i < 60 && !again; i++) {
  await win.waitForTimeout(500);
  again = logEntries().filter((e) => e.type === "bank_loaded").length >= 2;
}
check("reopened song loads its bank again", again);
await app.close();

// Blind listening: the piano-only bank plays the piano passage and sits out the strings.
app = await launch(["--escucha"]);
win = await app.firstWindow();
await win.waitForSelector(".card", { timeout: 30000 });
const pianoRows = await win.locator(".card .row .letter").count();
check("both banks in the piano passage", pianoRows === 2, String(pianoRows));
for (const row of await win.locator(".card .row").filter({ has: win.locator(".stars") }).all()) await row.locator(".star").nth(2).click();
await win.locator(".btn.pri").click();
const stringRows = await win.locator(".card .row .letter").count();
check("piano-only bank sits out the strings", stringRows === 1 && (await win.locator(".card .hint").first().innerText()).includes("1"), String(stringRows));
await app.close();

console.log(failures.length ? `${failures.length} failed` : "all ok");
process.exit(failures.length ? 1 : 0);
