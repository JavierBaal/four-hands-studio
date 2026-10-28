// A stand-in for the native engine in tests: same command line, same link, a few requests.
// "load" of the id "crash" ends the process, like a plugin bringing the engine down.
import net from "node:net";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const token = arg("--token");
const MAGIC = 0xf2b49e2c;
let midi = 0;

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
          send({ type: "hello", version: 1, device: "Fake · 48000 Hz", sampleRate: 48000, latency: 0.02 });
          break;
        case "scan":
          send({ type: "scanning", file: "/vst3/Fake.vst3" });
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
        case "stats":
          send({ type: "stats", blocks: midi, maxLoad: 0, late: 0 });
          break;
        case "quit":
          process.exit(0);
      }
    }
  });
});
// Like the real one on Windows, it may be slow to open the port: Four Hands has to knock again.
setTimeout(() => server.listen(Number(arg("--port")), "127.0.0.1", () => console.log(`FH_ENGINE_READY ${server.address().port}`)), 250);
