/**
 * S0 window: sound, computer keyboard as piano, Web MIDI and latency diagnostics.
 * Runs inside Electron (window.fh from the preload) or in a plain browser for automated tests.
 */
import type { WorkletStats } from "../shared/messages.js";
import { Engine, INSTRUMENTS, LookaheadPlayer, listeningDemo, loadTest, tempoTest, type Instrument, type LatencySample } from "../audio/engine.js";
import { INITIAL_KEYBOARD, isPianoToggle, keyAction, noteNameEs, NOTE_KEYS, type KeyboardState } from "../audio/keyboard.js";

interface FhApi {
  info(): Promise<{ soundFont: string | null; logFile: string; versions: Record<string, string>; platform: string; arch: string }>;
  soundFont(): Promise<ArrayBuffer | null>;
  log(entry: Record<string, unknown>): void;
}
const fh: FhApi | undefined = (window as unknown as { fh?: FhApi }).fh;
const log = (entry: Record<string, unknown>) => (fh ? fh.log(entry) : console.log("[s0]", JSON.stringify(entry)));

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

const engine = new Engine();
const player = new LookaheadPlayer(engine);
let current: Instrument = INSTRUMENTS[0]!;
let piano = true;
let kb: KeyboardState = { ...INITIAL_KEYBOARD };
const held = new Map<string, { ch: number; note: number }>(); // physical key -> sounding note
let ready = false;

// ---------- measurements ----------
const latency: Record<LatencySample["source"], number[]> = { keyboard: [], midi: [] };
let lastStats: WorkletStats | null = null;
let worstLoad = 0;
let worstBlockMs = 0;
let lateTotal = 0;
let currentTest: { name: string; late: number; worstLoad: number; stress: boolean } | null = null;
let startup: Record<string, unknown> = {};

function stat(values: number[]) {
  if (!values.length) return { n: 0, avg: NaN, min: NaN, max: NaN, p90: NaN };
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length, min: s[0]!, max: s.at(-1)!, p90: s[Math.floor(s.length * 0.9)]! };
}

// ---------- chips ----------
function setChip(id: string, cls: "" | "ok" | "on" | "err", text: string) {
  const el = $(id);
  el.classList.remove("ok", "on", "err");
  if (cls) el.classList.add(cls);
  (el.lastElementChild as HTMLElement).textContent = text;
}

function updatePianoChip() {
  setChip("chipPiano", piano ? "on" : "", piano ? `Teclado como piano · ${noteNameEs(kb.base)} · intensidad ${kb.velocity}` : "Teclado como piano: apagado");
  $("kbd").classList.toggle("off", !piano);
  $("kbdState").textContent = piano
    ? `La tecla A es ${noteNameEs(kb.base)}. Suena en: ${current.name}.`
    : "Apagado. Pulsa Ctrl + K para tocar con el teclado del ordenador.";
}

// ---------- instruments ----------
function renderInstruments() {
  const box = $("instruments");
  box.innerHTML = "";
  for (const inst of INSTRUMENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn inst" + (inst === current ? " sel" : "");
    b.textContent = inst.name;
    b.onclick = () => {
      releaseAll();
      current = inst;
      renderInstruments();
      updatePianoChip();
    };
    box.appendChild(b);
  }
}

// ---------- on-screen keyboard ----------
const KEY_LETTER = Object.fromEntries(Object.entries(NOTE_KEYS).map(([code, off]) => [off, code.replace("Key", "")]));
// E5 (16) has no key of its own; it is drawn so that P (D#) sits between two white keys.
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
const BLACK = [1, 3, 6, 8, 10, 13, 15];
function renderKeyboard() {
  const box = $("kbd");
  box.innerHTML = "";
  const whiteW = 100 / WHITE.length;
  WHITE.forEach((off) => {
    const k = document.createElement("div");
    k.className = "w";
    k.dataset.off = String(off);
    k.innerHTML = `<span class="letter">${KEY_LETTER[off] ?? "&nbsp;"}</span><span>${noteNameEs(kb.base + off)}</span>`;
    if (KEY_LETTER[off] === undefined) k.classList.add("nokey");
    box.appendChild(k);
  });
  BLACK.forEach((off) => {
    const whitesBefore = WHITE.filter((w) => w < off).length;
    const k = document.createElement("div");
    k.className = "b";
    k.dataset.off = String(off);
    k.style.left = `calc(${whitesBefore * whiteW}% - ${whiteW * 0.3}%)`;
    k.style.width = `${whiteW * 0.6}%`;
    k.innerHTML = `<span class="letter">${KEY_LETTER[off]}</span>`;
    box.appendChild(k);
  });
}
function markKey(note: number, down: boolean) {
  const off = note - kb.base;
  const el = $("kbd").querySelector(`[data-off="${off}"]`);
  el?.classList.toggle("down", down);
}

// ---------- playing ----------
function noteOn(note: number, vel: number, inputTime: number, source: LatencySample["source"], ch = current.ch) {
  if (!ready) return;
  engine.now({ kind: "on", ch, note, vel }, inputTime, source);
}
function noteOff(note: number, ch = current.ch) {
  if (!ready) return;
  engine.now({ kind: "off", ch, note });
}
function releaseAll() {
  for (const [, h] of held) {
    noteOff(h.note, h.ch);
    markKey(h.note, false);
  }
  held.clear();
}

window.addEventListener(
  "keydown",
  (e) => {
    if (isPianoToggle(e)) {
      e.preventDefault();
      piano = !piano;
      if (!piano) releaseAll();
      updatePianoChip();
      return;
    }
    if (!piano) return;
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
    const action = keyAction(e.code, kb, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return; // the system's auto-repeat never retriggers a held note
    if (action.type === "note") {
      if (held.has(e.code)) return;
      held.set(e.code, { ch: current.ch, note: action.note });
      markKey(action.note, true);
      noteOn(action.note, kb.velocity, e.timeStamp, "keyboard");
    } else {
      releaseAll();
      kb = action.state;
      if (action.type === "octave") renderKeyboard();
      updatePianoChip();
    }
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    const h = held.get(e.code);
    if (!h) return;
    held.delete(e.code);
    markKey(h.note, false);
    noteOff(h.note, h.ch);
  },
  true,
);
window.addEventListener("blur", releaseAll);

// ---------- Web MIDI ----------
async function initMidi() {
  const list = $("midiList");
  if (!("requestMIDIAccess" in navigator)) {
    list.innerHTML = `<li class="dim">Este entorno no tiene Web MIDI.</li>`;
    setChip("chipMidi", "err", "MIDI: no disponible");
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const refresh = () => {
      const inputs = [...access.inputs.values()];
      list.innerHTML = inputs.length ? "" : `<li class="dim">No hay dispositivos MIDI conectados.</li>`;
      for (const input of inputs) {
        const li = document.createElement("li");
        li.textContent = `${input.name ?? "Sin nombre"}${input.manufacturer ? " · " + input.manufacturer : ""}`;
        list.appendChild(li);
        input.onmidimessage = onMidi;
      }
      setChip("chipMidi", inputs.length ? "ok" : "", inputs.length ? `MIDI: ${inputs.length} dispositivo${inputs.length > 1 ? "s" : ""}` : "MIDI: sin dispositivos");
      log({ type: "midi_devices", inputs: inputs.map((i) => i.name) });
    };
    access.onstatechange = refresh;
    refresh();
  } catch (err) {
    list.innerHTML = `<li class="dim">No se ha podido abrir MIDI: ${String(err)}</li>`;
    setChip("chipMidi", "err", "MIDI: error");
  }
}
function onMidi(e: MIDIMessageEvent) {
  const d = e.data;
  if (!d || d.length < 2) return;
  const status = d[0]! & 0xf0;
  const a = d[1]!;
  const b = d[2] ?? 0;
  $("midiLast").textContent = `Último mensaje: ${[...d].map((x) => x.toString(16).padStart(2, "0")).join(" ")}`;
  // All input goes to the selected instrument's channel, as the active track will in the app.
  if (status === 0x90 && b > 0) noteOn(a, b, e.timeStamp, "midi");
  else if (status === 0x80 || (status === 0x90 && b === 0)) noteOff(a);
  else if (status === 0xb0) engine.now({ kind: "cc", ch: current.ch, cc: a, value: b });
}

// ---------- tests ----------
let stressTimer: ReturnType<typeof setInterval> | null = null;
function setStress(on: boolean) {
  if (stressTimer) clearInterval(stressTimer);
  stressTimer = null;
  if (on) {
    // Blocks the window thread 150 ms out of every 400 ms: much worse than a heavy redraw.
    stressTimer = setInterval(() => {
      const t = performance.now();
      while (performance.now() - t < 150) {
        /* busy */
      }
    }, 400);
  }
  $("btnStress").setAttribute("aria-pressed", String(on));
  if (currentTest) currentTest.stress = currentTest.stress || on;
}

function runTest(name: string, events: ReturnType<typeof tempoTest>, label: string) {
  if (!ready) return;
  engine.panic();
  currentTest = { name, late: 0, worstLoad: 0, stress: !!stressTimer };
  $("testState").textContent = label;
  player.onDone = () => {
    const t = currentTest;
    currentTest = null;
    if (!t) return;
    const msg =
      t.late === 0
        ? `Terminada. Ninguna nota llegó tarde${t.stress ? ", aun con la interfaz estresada" : ""}. Carga máxima del audio: ${fmt(t.worstLoad * 100, 0)} %.`
        : `Terminada. ${t.late} notas llegaron tarde${t.stress ? " con la interfaz estresada" : ""}. Carga máxima del audio: ${fmt(t.worstLoad * 100, 0)} %.`;
    $("testState").textContent = msg;
    log({ type: "test_done", test: t.name, lateEvents: t.late, worstLoad: t.worstLoad, stress: t.stress });
  };
  player.play(events);
}

// ---------- diagnostics ----------
function renderDiag() {
  const k = stat(latency.keyboard);
  const m = stat(latency.midi);
  const rows: Array<[string, string, boolean?]> = [
    ["Frecuencia de muestreo", ready ? `${engine.ctx.sampleRate} Hz` : "—"],
    ["Latencia base del audio", ready ? `${fmt(engine.baseLatencyMs)} ms` : "—"],
    ["Latencia de salida (sistema)", ready ? `${fmt(engine.outputLatencyMs)} ms` : "—"],
    ["Tecla → altavoz, estimada", k.n ? `${fmt(k.avg)} ms de media · ${fmt(k.min)}–${fmt(k.max)} · ${k.n} notas` : "Toca unas notas", k.n > 0 && k.avg > 30],
    ["MIDI → altavoz, estimada", m.n ? `${fmt(m.avg)} ms de media · ${fmt(m.min)}–${fmt(m.max)} · ${m.n} notas` : "—", m.n > 0 && m.avg > 30],
    ["Carga del audio", lastStats ? `${fmt(lastStats.avgLoad * 100, 0)} % media · ${fmt(lastStats.maxLoad * 100, 0)} % pico` : "—", !!lastStats && lastStats.maxLoad > 0.8],
    ["Peor bloque desde el inicio", `${fmt(worstBlockMs, 2)} ms (${fmt(worstLoad * 100, 0)} % del margen)`, worstLoad > 1],
    ["Notas que llegaron tarde", String(lateTotal), lateTotal > 0],
  ];
  $("diag").innerHTML = rows.map(([a, b, warn]) => `<dt>${a}</dt><dd${warn ? ' class="warn"' : ""}>${b}</dd>`).join("");
}
setInterval(renderDiag, 500);

function summary(): Record<string, unknown> {
  return {
    type: "summary",
    ...startup,
    sampleRate: ready ? engine.ctx.sampleRate : null,
    baseLatencyMs: ready ? engine.baseLatencyMs : null,
    outputLatencyMs: ready ? engine.outputLatencyMs : null,
    keyboardToSpeakerMs: stat(latency.keyboard),
    midiToSpeakerMs: stat(latency.midi),
    worstLoad,
    worstBlockMs,
    lateTotal,
    workletClock: lastStats?.clock ?? null,
  };
}

// ---------- startup ----------
async function main() {
  renderInstruments();
  renderKeyboard();
  updatePianoChip();
  renderDiag();

  const info = fh ? await fh.info() : null;
  $("logPath").textContent = info?.logFile ?? "(consola del navegador)";
  $("versions").textContent = info
    ? `Electron ${info.versions.electron} · Chromium ${info.versions.chrome} · ${info.platform} ${info.arch} · ${info.soundFont ?? "sin SoundFont"}`
    : navigator.userAgent;

  engine.onLatency = (s) => {
    latency[s.source].push(s.ms);
    const n = latency.keyboard.length + latency.midi.length;
    if (n % 20 === 0) log(summary());
  };
  engine.onStats = (s) => {
    lastStats = s;
    lateTotal += s.lateEvents;
    if (s.maxLoad > worstLoad) worstLoad = s.maxLoad;
    if (s.maxBlockMs > worstBlockMs) worstBlockMs = s.maxBlockMs;
    if (currentTest) {
      currentTest.late += s.lateEvents;
      if (s.maxLoad > currentTest.worstLoad) currentTest.worstLoad = s.maxLoad;
    }
  };

  try {
    const sf = fh ? await fh.soundFont() : await (await fetch("MuseScore_General.sf3")).arrayBuffer();
    if (!sf) throw new Error("No hay SoundFont.");
    const r = await engine.init(sf, "worklet.js");
    ready = true;
    startup = { parseMs: r.parseMs, initMs: r.initMs, decodeMs: r.decodeMs, samples: r.samples, presets: r.presetCount, userAgent: navigator.userAgent };
    setChip("chipSound", "ok", `Sonido listo · ${fmt((r.parseMs + r.initMs + r.decodeMs) / 1000)} s`);
    log({ type: "ready", ...startup, sampleRate: engine.ctx.sampleRate, baseLatencyMs: engine.baseLatencyMs, outputLatencyMs: engine.outputLatencyMs });
  } catch (err) {
    setChip("chipSound", "err", "Sin sonido");
    $("testState").textContent = `No se ha podido cargar el sonido: ${String(err)}`;
    log({ type: "error", where: "init", message: String(err) });
  }

  $("btnListen").onclick = () => runTest("listen", listeningDemo(), "Sonando: La menor, Fa, Do, Sol, dos vueltas, con cuerdas, chelo y piano.");
  $("btnTempo").onclick = () => runTest("tempo", tempoTest(), "Sonando: semicorcheas a 120 BPM. Escucha si el pulso se tuerce; prueba a estresar la interfaz.");
  $("btnLoad").onclick = () => runTest("load", loadTest(), "Sonando: diez instrumentos a la vez durante 8 segundos.");
  $("btnStop").onclick = () => {
    player.stop();
    engine.panic();
    currentTest = null;
    $("testState").textContent = "Parado.";
  };
  $("btnStress").onclick = () => setStress($("btnStress").getAttribute("aria-pressed") !== "true");
  $("chipPiano").onclick = () => {
    piano = !piano;
    if (!piano) releaseAll();
    updatePianoChip();
  };
  $("btnPhys").onclick = () => {
    const ms = Number(($("physMs") as HTMLInputElement).value);
    if (!ms) return;
    const output = ($("physOut") as HTMLSelectElement).value;
    log({ type: "physical_measurement", ms, output });
    $("physState").textContent = `Guardado: ${ms} ms con ${output.toLowerCase()}.`;
  };
  $("btnSave").onclick = () => {
    log(summary());
    $("saveState").firstChild!.textContent = `Guardado a las ${new Date().toLocaleTimeString("es-ES")} en `;
  };

  await initMidi();
}

void main();
