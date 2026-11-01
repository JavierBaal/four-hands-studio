import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EngineStatus } from "../../shared/engine.js";
import { FrameReader, frame } from "./framing.js";
import { EngineHost } from "./host.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-engine.mjs");
const cache = path.join(os.tmpdir(), "fh-engine-test-plugins.xml");

function host(command: string[] | null = [process.execPath, fake]) {
  const statuses: EngineStatus[] = [];
  const log: Record<string, unknown>[] = [];
  const h = new EngineHost({ command: () => command, cacheFile: cache, log: (e) => log.push(e), onStatus: (s) => statuses.push(s), startTimeoutMs: 5000 });
  return { h, statuses, log };
}

describe("engine framing", () => {
  it("reads messages split anywhere and joined together", () => {
    const bytes = Buffer.concat([frame({ type: "a", n: 1 }), frame({ type: "b", text: "ñandú" })]);
    const reader = new FrameReader();
    const got: unknown[] = [];
    for (let i = 0; i < bytes.length; i += 3) got.push(...reader.push(bytes.subarray(i, i + 3)));
    expect(got).toEqual([{ type: "a", n: 1 }, { type: "b", text: "ñandú" }]);
  });

  it("refuses a stream that is not the engine's", () => {
    expect(() => new FrameReader().push(Buffer.from("GET / HTTP/1.1\r\n\r\n"))).toThrow(/not a message/);
  });
});

describe("engine host (prueba S2)", () => {
  it("says the engine is missing when it is not built", async () => {
    const { h } = host(null);
    await expect(h.request({ type: "plugins" })).rejects.toThrow(/not built/);
    expect(h.current.state).toBe("missing");
  });

  it("starts the engine, greets it with the token and matches replies in order", async () => {
    const { h, statuses, log } = host();
    const scanned: string[] = [];
    (h as unknown as { options: { onScanning: (f: string, p: number) => void } }).options.onScanning = (f, p) => scanned.push(`${f} ${p}`);
    const [list, loaded, wrong] = await Promise.allSettled([h.request({ type: "scan" }), h.request({ type: "load", slot: 0, id: "VST3-Fake" }), h.request({ type: "load", slot: 1, id: "nope" })]);
    expect(h.current).toMatchObject({ state: "ready", device: "Fake · 48000 Hz", latency: 0.02, generation: 1 });
    expect(statuses.map((s) => s.state)).toEqual(["starting", "ready"]);
    expect(scanned).toEqual(["/vst3/Fake.vst3 0.5"]);
    expect(list.status === "fulfilled" && (list.value.list as unknown[]).length).toBe(1);
    expect(loaded.status === "fulfilled" && loaded.value.name).toBe("Fake");
    expect(wrong.status === "rejected" && String(wrong.reason)).toMatch(/Unknown plugin/);
    // MIDI has no reply: what comes next is still matched to its own request.
    h.send({ type: "midi", events: [{ slot: 0, delay: 0, data: [0x90, 60, 100] }] });
    h.send({ type: "midi", events: [{ slot: 0, delay: 0.5, data: [0x80, 60, 0] }] });
    expect((await h.request({ type: "stats" })).blocks).toBe(2);
    h.stop();
    await new Promise((r) => setTimeout(r, 300));
    expect(h.current.state).toBe("off");
    expect(log.filter((e) => e.type === "engine_out")).toHaveLength(5);
    expect(log.find((e) => e.type === "engine_chatter")).toMatchObject({ lines: 20, logged: 5 });
  });

  it("passes on what the engine says by itself without taking it for a reply (F2.1, sound banks)", async () => {
    const { h } = host();
    const events: Record<string, unknown>[] = [];
    (h as unknown as { options: { onEvent: (e: Record<string, unknown>) => void } }).options.onEvent = (e) => events.push(e);
    const loading = await h.request({ type: "sounds", id: "main", offset: 0, path: "/sf/MuseScore_General.sf3" });
    expect(loading).toMatchObject({ type: "soundsLoading", id: "main", offset: 0 });
    // The bank's event arrives between a request and its reply: the reply still matches.
    await new Promise((r) => setTimeout(r, 10));
    const stats = h.request({ type: "stats" });
    await new Promise((r) => setTimeout(r, 80));
    expect((await stats).type).toBe("stats");
    expect(events).toEqual([{ type: "event", event: "soundsLoaded", id: "main", offset: 0, ok: true, error: "", presets: 3, ms: 5 }]);
    expect((await h.request({ type: "stats" })).type).toBe("stats");
    h.stop();
    await new Promise((r) => setTimeout(r, 300));
  });

  it("survives the engine crashing: the request fails, Four Hands goes on, the next one restarts it", async () => {
    const { h, log } = host();
    await expect(h.request({ type: "load", slot: 0, id: "crash" })).rejects.toThrow(/closed|stopped/);
    await new Promise((r) => setTimeout(r, 200));
    expect(h.current.state).toBe("failed");
    expect(log.some((e) => e.type === "engine_exit")).toBe(true);
    expect((await h.request({ type: "load", slot: 0, id: "VST3-Fake" })).name).toBe("Fake");
    expect(h.current.generation).toBe(2);
    h.stop();
  });

  // The real engine, when it has been built here (engine/build or FH_ENGINE).
  const real = process.env.FH_ENGINE ?? path.resolve(here, "../../../../../engine/build/FourHandsEngine_artefacts/Release/Four Hands Engine");
  it.skipIf(!fs.existsSync(real))("talks to the real engine", async () => {
    const { h } = host([real]);
    const list = await h.request({ type: "plugins" });
    expect(Array.isArray(list.list)).toBe(true);
    expect(h.current.state).toBe("ready");
    // With the test synth (engine/test-synth), a whole round: scan, load, play, window state.
    const dir = process.env.FH_TEST_VST3_DIR;
    if (dir) {
      const found = (await h.request({ type: "scan", paths: [dir] })).list as Array<{ id: string; instrument: boolean }>;
      const synth = found.find((p) => p.instrument)!;
      expect((await h.request({ type: "load", slot: 3, id: synth.id })).name).toBe("Four Hands Test Synth");
      h.send({ type: "midi", events: [{ slot: 3, delay: 0.05, data: [0x90, 60, 100] }, { slot: 3, delay: 0.3, data: [0x80, 60, 0] }] });
      const state = await h.request({ type: "getState", slot: 3 });
      expect(String(state.data).length).toBeGreaterThan(0);
      // F2.1: a state put back comes out the same (what a song restores on opening).
      const other = await h.request({ type: "load", slot: 4, id: synth.id });
      expect(other.name).toBe("Four Hands Test Synth");
      expect((await h.request({ type: "setState", slot: 4, data: state.data })).ok).toBe(true);
      expect((await h.request({ type: "getState", slot: 4 })).data).toBe(state.data);
    }
    h.stop();
  });
});
