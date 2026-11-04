// A stand-in for the native engine in tests: same command line, same link, a few requests.
// "load" of the id "crash" ends the process, like a plugin bringing the engine down.
import net from "node:net";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const token = arg("--token");
const MAGIC = 0xf2b49e2c;
let midi = 0;
// Plugins talk a lot (Kontakt's memory messages): only the first lines may reach the log.
for (let i = 0; i < 20; i++) console.log(`plugin noise ${i}`);

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let greeted = false;
  const send = (m) => {
    const body = Buffer.from(JSON.stringify(m));
    const head = Buffer.alloc(8);
    head.writeUInt32LE(MAGIC, 0);
    head.writeUInt32LE(body.length, 4);
    // Split in two writes: the reader must join them.
    socket.write(head);
    socket.write(body);
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32LE(4)) {
      const size = buffer.readUInt32LE(4);
      const m = JSON.parse(buffer.subarray(8, 8 + size).toString());
      buffer = buffer.subarray(8 + size);
      if (!greeted) {
        if (m.type !== "hello" || m.token !== token) {
          send({ type: "error", request: "hello", message: "Wrong or missing token" });
          socket.destroy();
          return;
        }
        greeted = true;
      }
      switch (m.type) {
        case "hello":
          send({ type: "hello", version: 1, device: "Fake · 48000 Hz", sampleRate: 48000, latency: 0.02, sounds: true, soundsSlot: 512, strips: 512 });
          break;
        case "scan":
          send({ type: "scanning", file: "/vst3/Fake.vst3", progress: 0.5 });
          send({ type: "plugins", list: [{ id: "VST3-Fake", name: "Fake", vendor: "FH", category: "Instrument", format: "VST3", instrument: true }] });
          break;
        case "load":
          if (m.id === "crash") process.exit(3);
          if (m.id !== "VST3-Fake") send({ type: "error", request: "load", message: `Unknown plugin: ${m.id}` });
          else send({ type: "loaded", slot: m.slot, name: "Fake" });
          break;
        case "midi":
          midi += m.events.length;
          break;
        case "sounds":
          // F2.1: the reply at once, the load later as an event (a missing file fails).
          send({ type: "soundsLoading", id: m.id, offset: m.offset });
          setTimeout(() => {
            const ok = typeof m.path === "string" && !m.path.includes("missing");
            send({ type: "event", event: "soundsLoaded", id: m.id, offset: m.offset, ok, error: ok ? "" : "Sound bank not found", presets: ok ? 3 : 0, ms: 5 });
          }, 30);
          break;
        case "device":
          // Test only: as if Windows had switched its output.
          send({ type: "event", event: "deviceChanged", device: "Fake · Auriculares · 48000 Hz", latency: 0.015, deviceError: "" });
          break;
        case "stats":
          send({ type: "stats", blocks: midi, maxLoad: 0.3, avgLoad: 0.2, late: 0, overruns: 0, xruns: -1 });
          break;
        case "inserts":
          // F2.2 parte C: a chain; an unknown plugin is reported, own effects always load.
          send({ type: "insertsSet", strip: m.strip, latency: (m.chain ?? []).some((x) => x.kind === "limiter") ? 240 : 0, compensation: 0, errors: (m.chain ?? []).filter((x) => x.kind === "plugin" && x.plugin !== "VST3-Fake").map((x) => ({ id: x.id, error: `Unknown plugin: ${x.plugin}` })) });
          break;
        case "params":
          send({ type: "params", params: [{ index: 0, name: "Gain", text: "0.0 dB", label: "dB", value: 0.5 }] });
          break;
        case "setParam":
          send({ type: "paramSet", ok: true, text: String(m.text ?? m.value), value: 0.5 });
          break;
        case "insertWindows":
          send({ type: "insertWindows", ids: [] });
          break;
        case "meters":
        case "levels":
          send({ type: m.type, channels: [{ peak: 0.5, rms: 0.1, clips: 0 }], master: { peak: 0.5, rms: 0.1, clips: 0 } });
          break;
        case "quit":
          process.exit(0);
      }
    }
  });
});
// Like the real one on Windows, it may be slow to open the port: Four Hands has to knock again.
setTimeout(() => server.listen(Number(arg("--port")), "127.0.0.1", () => console.log(`FH_ENGINE_READY ${server.address().port}`)), 250);
