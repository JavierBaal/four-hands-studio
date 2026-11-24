// F2.4: exporting audio in the real app. Starts Electron with the engine and a clean home (it opens
// the demo song), exports Invasion to WAV and MP3 from File › Exportar audio… (Ctrl+E), and reads
// the files back: format, length, that they sound, the title and the artist. Then a second export
// gets a new name, and a cancelled one leaves nothing.
// Usage: node build.mjs && FH_ENGINE=<engine> xvfb-run -a node scripts/exportar.mjs [SoundFont path]
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-home-"));
const electronPath = path.join(appDir, "..", "..", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), FH_LANG: "es" };
if (process.argv[2]) env.FH_SOUNDFONT = process.argv[2];
if (!env.FH_ENGINE) console.log("note: no FH_ENGINE, the app looks for the engine where it usually is");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(ok ? "ok  " : "FAIL", name, ok ? "" : detail);
  if (!ok) failures.push(name);
};

/** A WAV's format, length and loudness, and its INFO title and artist. */
function readWav(file) {
  const b = fs.readFileSync(file);
  const info = {};
  let at = 12;
  let fmt = null;
  let data = null;
  while (at + 8 <= b.length) {
    const id = b.toString("latin1", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === "data") data = { at: at + 8, size };
    if (id === "LIST" && b.toString("latin1", at + 8, at + 12) === "INFO") {
      for (let i = at + 12; i < at + 8 + size; ) {
        const key = b.toString("latin1", i, i + 4);
        const len = b.readUInt32LE(i + 4);
        info[key] = b.toString("utf8", i + 8, i + 8 + len).replace(/\0+$/, "");
        i += 8 + len + (len & 1);
      }
    }
    at += 8 + size + (size & 1);
  }
  const step = (fmt.bits / 8) * fmt.channels;
  const frames = Math.floor(data.size / step);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < frames; i += 7) {
    const p = data.at + i * step;
    const v = fmt.bits === 16 ? b.readInt16LE(p) / 32768 : b.readIntLE(p, 3) / 8388608;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return { ...fmt, seconds: frames / fmt.rate, rms: Math.sqrt(sum / Math.ceil(frames / 7)), peak, title: info.INAM, artist: info.IART };
}

const app = await electron.launch({ executablePath: electronPath, args: [".", "--no-sandbox"], cwd: appDir, env });
const win = await app.firstWindow();
const errors = [];
win.on("pageerror", (e) => errors.push(String(e)));
await win.waitForSelector(".topbar", { timeout: 30000 });
// The demo's built-in sounds load in the engine (it starts for them).
const started = Date.now();
while (Date.now() - started < 60000) {
  const ready = await win.evaluate(() => document.querySelector(".topbar")?.textContent ?? "").catch(() => "");
  if (!/Arrancando|Cargando/i.test(ready)) {
    const ok = await win.evaluate(() => window.fh.engineStatus()).catch(() => null);
    if (ok?.state === "ready") break;
  }
  await win.waitForTimeout(500);
}
await win.waitForTimeout(4000);

// The window is driven from its DOM: under xvfb Electron may not paint, and clicks and waits that
// need a frame would hang.
const clickButton = (name) =>
  win.evaluate((name) => {
    const b = [...document.querySelectorAll(".expdlg button")].find((x) => x.textContent.trim() === name && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, name);
const stageNow = () => win.evaluate(() => document.querySelector(".expdlg")?.getAttribute("data-stage") ?? null);
async function until(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function exportOnce({ artist, cancel = false } = {}) {
  await win.keyboard.press("Control+e");
  if (!(await until(async () => (await stageNow()) === "choose", 5000))) return { stage: "not opened", text: "" };
  if (artist !== undefined) {
    await win.evaluate((artist) => {
      const input = document.querySelectorAll(".expdlg input")[1];
      // React listens to the native setter's input event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, artist);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, artist);
  }
  // The engine and its sounds may still be loading: "Exportar" says so and can be pressed again.
  await until(async () => (await clickButton("Exportar")) && (await stageNow()) === "running", 30000);
  if (cancel) {
    await until(async () => (await stageNow()) === "running", 10000);
    await clickButton("Cancelar exportación");
  }
  await until(async () => ["done", "failed"].includes(await stageNow()), 300000);
  const stage = await stageNow();
  const text = await win.evaluate(() => document.querySelector(".expdlg")?.textContent ?? "");
  await win.keyboard.press("Escape");
  await until(async () => (await stageNow()) === null, 3000);
  return { stage, text };
}

const exportsDir = [path.join(home, "Documents", "Four Hands", "Exportaciones"), path.join(home, "Four Hands", "Exportaciones")];
const t0 = Date.now();
const first = await exportOnce({ artist: "Fran Barbero" });
console.log(`     first export in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check("the export ends with the files", first.stage === "done", first.text);
const dir = exportsDir.find((d) => fs.existsSync(d));
check("in Documents/Four Hands/Exportaciones", !!dir, exportsDir.join(" or "));
if (dir && first.stage === "done") {
  const files = fs.readdirSync(dir).sort();
  check("a WAV and an MP3 named after the song", JSON.stringify(files) === JSON.stringify(["Invasion.mp3", "Invasion.wav"]), files.join(", "));
  const w = readWav(path.join(dir, "Invasion.wav"));
  console.log("     wav:", JSON.stringify({ ...w, rms: +w.rms.toFixed(4), peak: +w.peak.toFixed(3) }));
  check("WAV at 48 kHz, 24 bit, stereo", w.rate === 48000 && w.bits === 24 && w.channels === 2);
  // Invasion: 1:12 and the tail.
  check("WAV as long as the song and its tail", w.seconds >= 72 && w.seconds <= 83, String(w.seconds));
  check("the WAV sounds", w.rms > 0.005 && w.peak > 0.05, `rms ${w.rms}, peak ${w.peak}`);
  check("the WAV does not clip", w.peak <= 1.0);
  check("title and artist in the WAV", w.title === "Invasion" && w.artist === "Fran Barbero", `${w.title} / ${w.artist}`);
  const mp3 = fs.readFileSync(path.join(dir, "Invasion.mp3"));
  check("an MP3 with its ID3 tag", mp3.toString("latin1", 0, 3) === "ID3" && mp3.includes(Buffer.from("Fran Barbero", "utf16le")));
  // 320 kbps: 40 KB a second.
  check("MP3 at 320 kbps", Math.abs(mp3.length / w.seconds / 40000 - 1) < 0.1, `${mp3.length} bytes`);
  check("loudness and true peak shown", /LUFS/.test(first.text) && /dBTP/.test(first.text), first.text);
  const settings = JSON.parse(fs.readFileSync(path.join(home, ".config", "Four Hands Studio", "ajustes.json"), "utf8"));
  check("your name is kept", settings.userName === "Fran Barbero", JSON.stringify(settings));

  const second = await exportOnce();
  check("a second export does not overwrite the first", second.stage === "done" && fs.existsSync(path.join(dir, "Invasion (2).wav")) && fs.existsSync(path.join(dir, "Invasion (2).mp3")), fs.readdirSync(dir).join(", "));
  const before = fs.readdirSync(dir).length;
  const cancelled = await exportOnce({ cancel: true });
  check("a cancelled export leaves nothing", cancelled.stage === "failed" && fs.readdirSync(dir).length === before, `${cancelled.stage}: ${fs.readdirSync(dir).join(", ")}`);
}

// The engine plays again after exporting.
const status = await win.evaluate(() => window.fh.engineStatus());
check("the engine is still running", status.state === "ready", JSON.stringify(status));
const log = fs.readdirSync(path.join(home, ".config", "Four Hands Studio")).find((f) => /registro|log/i.test(f));
if (log) {
  const lines = fs.readFileSync(path.join(home, ".config", "Four Hands Studio", log), "utf8").split("\n").filter((l) => l.includes('"export"'));
  console.log("     log:", lines.at(0)?.slice(0, 400));
}
check("no errors in the window", errors.length === 0, errors.join("\n"));
await app.close();
fs.rmSync(home, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nexport: all ok");
