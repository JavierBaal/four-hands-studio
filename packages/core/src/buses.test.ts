import { describe, expect, it } from "vitest";
import { addBus, audible, busList, moveBus, processingOrder, removeBus, removeSend, reverbBus, setOutput, setSend, updateBus, withDefaultBuses } from "./buses.js";
import { changesText } from "./changes.js";
import { addTrack, updateTrack } from "./commands.js";
import { SongDocument } from "./document.js";
import { addInsert, chainOf, findInsert } from "./effects.js";
import { USER, ai, emptySong, starterSong } from "./model.js";

const CLAUDE = ai("claude-ai");

/** A song with the «Reverb» bus (b1) and three tracks: Voz, Coro, Bajo. */
function doc() {
  const d = new SongDocument(withDefaultBuses(emptySong("Buses")), { now: () => 0 });
  d.transact({ actor: USER, label: "pistas" }, (tx) => {
    addTrack(tx, { name: "Voz" });
    addTrack(tx, { name: "Coro" });
    addTrack(tx, { name: "Bajo" });
  });
  return d;
}

describe("buses and sends (F2.2 parte D, Fran 04/11/2026)", () => {
  it("every song the app makes starts with the «Reverb» bus and Four Hands' reverb on it", () => {
    const song = starterSong();
    expect(busList(song).map((b) => b.name)).toEqual(["Reverb"]);
    expect(song.buses!.b1!.inserts).toEqual([{ id: "x1", kind: "reverb", params: { mix: 100, time: 50, tone: 100, preDelay: 0 } }]);
    expect(reverbBus(song)?.id).toBe("b1");
    // Not twice.
    withDefaultBuses(song);
    expect(song.busOrder).toEqual(["b1"]);
  });

  it("adds buses, chains them and sends tracks through them, each one undo step", () => {
    const d = doc();
    let voces = "";
    let mix = "";
    d.transact({ actor: USER, label: "buses" }, (tx) => {
      voces = addBus(tx, { name: "Voces" });
      mix = addBus(tx, { name: "Mix bus", index: 0 });
    });
    expect([voces, mix]).toEqual(["b2", "b3"]);
    expect(d.song.busOrder).toEqual(["b3", "b1", "b2"]);
    d.transact({ actor: USER, label: "rutas" }, (tx) => {
      setOutput(tx, "t1", voces);
      setOutput(tx, "t2", voces);
      setOutput(tx, voces, mix);
    });
    expect(d.song.tracks.t1!.bus).toBe("b2");
    expect(d.song.buses!.b2!.bus).toBe("b3");
    expect(processingOrder(d.song).indexOf("b2")).toBeLessThan(processingOrder(d.song).indexOf("b3"));
    d.undo(USER);
    expect("bus" in d.song.tracks.t1!).toBe(false);
    d.undo(USER);
    expect(d.song.busOrder).toEqual(["b1"]);
  });

  it("never loops: a bus cannot go into itself nor into one that already goes into it", () => {
    const d = doc();
    d.transact({ actor: USER, label: "buses" }, (tx) => {
      addBus(tx, { name: "A" });
      addBus(tx, { name: "B" });
      setOutput(tx, "b2", "b3");
    });
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setOutput(tx, "b3", "b2"))).toThrow(/loop/);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setSend(tx, "b3", "b2", { level: 0.5 }))).toThrow(/loop/);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setOutput(tx, "b2", "b2"))).toThrow(/itself/);
    // A track can go anywhere.
    d.transact({ actor: USER, label: "ok" }, (tx) => setSend(tx, "t1", "b2", { level: 0.2 }));
  });

  it("sends after the fader by default, before it when asked, one per bus", () => {
    const d = doc();
    d.transact({ actor: USER, label: "bus" }, (tx) => addBus(tx, { name: "Delay" }));
    d.transact({ actor: CLAUDE, label: "envíos" }, (tx) => {
      setSend(tx, "t1", "b1", { level: 0.3 });
      setSend(tx, "t1", "b2", { level: 0.5, pre: true });
      setSend(tx, "t1", "b1", { level: 0.4 });
    });
    expect(d.song.tracks.t1!.sends).toEqual([
      { bus: "b1", level: 0.4 },
      { bus: "b2", level: 0.5, pre: true },
    ]);
    d.transact({ actor: USER, label: "post" }, (tx) => setSend(tx, "t1", "b2", { pre: false }));
    expect(d.song.tracks.t1!.sends![1]).toEqual({ bus: "b2", level: 0.5 });
    d.transact({ actor: USER, label: "quitar" }, (tx) => removeSend(tx, "t1", "b2"));
    expect(d.song.tracks.t1!.sends).toEqual([{ bus: "b1", level: 0.4 }]);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setSend(tx, "t1", "b2", { level: 2 }))).toThrow(/0 to 1/);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => setSend(tx, "t1", "b9", { level: 0.2 }))).toThrow(/Unknown bus/);
  });

  it("deleting a bus sends what went through it on to its own output and drops the sends to it, with undo", () => {
    const d = doc();
    d.transact({ actor: USER, label: "buses" }, (tx) => {
      addBus(tx, { name: "Voces" }); // b2
      addBus(tx, { name: "Mix bus" }); // b3
      setOutput(tx, "b2", "b3");
      setOutput(tx, "t1", "b2");
      setOutput(tx, "t2", "b2");
      setSend(tx, "t3", "b2", { level: 0.3 });
      addInsert(tx, "b2", { kind: "compressor" });
    });
    const before = structuredClone(d.song);
    let result: ReturnType<typeof removeBus> | undefined;
    d.transact({ actor: USER, label: "borrar" }, (tx) => (result = removeBus(tx, "b2")));
    expect(result).toEqual({ rerouted: ["t1", "t2"], to: "b3", sendsDropped: ["t3"] });
    expect(d.song.tracks.t1!.bus).toBe("b3");
    expect("sends" in d.song.tracks.t3!).toBe(false);
    expect(d.song.busOrder).toEqual(["b1", "b3"]);
    expect(findInsert(d.song, "x2")).toBeNull();
    d.transact({ actor: USER, label: "borrar mix" }, (tx) => (result = removeBus(tx, "b3")));
    expect(result!.to).toBe("master");
    expect("bus" in d.song.tracks.t1!).toBe(false);
    d.undo(USER);
    d.undo(USER);
    expect(d.song).toEqual({ ...before, revision: d.song.revision });
  });

  it("has its own effects, fader, pan, mute, solo, name and colour", () => {
    const d = doc();
    d.transact({ actor: USER, label: "bus" }, (tx) => addBus(tx, { name: "Voces", color: 2 }));
    d.transact({ actor: USER, label: "fx" }, (tx) => addInsert(tx, "b2", { kind: "eq" }));
    expect(chainOf(d.song, "b2").map((x) => x.kind)).toEqual(["eq"]);
    expect(findInsert(d.song, "x2")?.target).toBe("b2");
    d.transact({ actor: USER, label: "mezcla" }, (tx) => updateBus(tx, "b2", { volume: 0.7, pan: -0.2, mute: true, name: " Coros ", color: 5 }));
    expect(d.song.buses!.b2).toMatchObject({ name: "Coros", volume: 0.7, pan: -0.2, mute: true, color: 5 });
    d.transact({ actor: USER, label: "on" }, (tx) => updateBus(tx, "b2", { mute: false }));
    expect("mute" in d.song.buses!.b2!).toBe(false);
    d.transact({ actor: USER, label: "orden" }, (tx) => moveBus(tx, "b2", 0));
    expect(d.song.busOrder).toEqual(["b2", "b1"]);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => updateBus(tx, "b2", { name: "  " }))).toThrow(/needs a name/);
  });

  it("solo keeps on what a soloed channel needs: the buses it goes through and sends to", () => {
    const d = doc();
    d.transact({ actor: USER, label: "buses" }, (tx) => {
      addBus(tx, { name: "Voces" }); // b2
      setOutput(tx, "t1", "b2");
      setOutput(tx, "t2", "b2");
      setSend(tx, "t1", "b1", { level: 0.3 });
      setSend(tx, "t3", "b1", { level: 0.3 });
    });
    expect([...audible(d.song)].sort()).toEqual(["b1", "b2", "t1", "t2", "t3"]);
    d.transact({ actor: USER, label: "solo voz" }, (tx) => updateTrack(tx, "t1", { solo: true }));
    // Voz, its bus and the reverb it sends to; not Coro nor Bajo.
    expect([...audible(d.song)].sort()).toEqual(["b1", "b2", "t1"]);
    d.transact({ actor: USER, label: "solo bus" }, (tx) => {
      updateTrack(tx, "t1", { solo: false });
      updateBus(tx, "b2", { solo: true });
    });
    // The bus and what feeds it.
    expect([...audible(d.song)].sort()).toEqual(["b2", "t1", "t2"]);
    d.transact({ actor: USER, label: "mute" }, (tx) => updateTrack(tx, "t2", { mute: true }));
    expect(audible(d.song).has("t2")).toBe(false);
  });

  it("tells the AI what changed in the buses and the routing", () => {
    const d = doc();
    const before = structuredClone(d.song);
    d.transact({ actor: CLAUDE, label: "buses" }, (tx) => {
      addBus(tx, { name: "Voces" });
      setOutput(tx, "t1", "b2");
      setSend(tx, "t1", "b1", { level: 0.25 });
      updateBus(tx, "b1", { volume: 0.8 });
    });
    const text = changesText(before, d.song, { since: "r1", history: [] });
    expect(text).toContain("Voz (t1): → Voces, + send Reverb 25");
    expect(text).toContain("Buses:");
    expect(text).toContain("+ Voces (b2)");
    expect(text).toContain("Reverb (b1): vol 100 → 80");
  });
});
