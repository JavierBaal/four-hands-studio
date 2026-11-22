import { describe, expect, it } from "vitest";
import { changesText } from "./changes.js";
import { addTrack } from "./commands.js";
import { SongDocument } from "./document.js";
import { NOTE_VALUES, OWN_EFFECTS, addInsert, parseParamValue, chainOf, defaultParams, findInsert, insertName, moveInsert, paramText, removeInsert, updateInsert } from "./effects.js";
import { parseSongFile, serializeSong } from "./file.js";
import { USER, ai, emptySong } from "./model.js";

const CLAUDE = ai("claude-ai");

function doc() {
  const d = new SongDocument(emptySong("Efectos"), { now: () => 0 });
  d.transact({ actor: USER, label: "pistas" }, (tx) => {
    addTrack(tx, { name: "Piano" });
    addTrack(tx, { name: "Cuerdas" });
  });
  return d;
}

describe("insert effects (F2.2 part C)", () => {
  it("adds own effects with every parameter at its default, each one undo step", () => {
    const d = doc();
    let eq = "";
    d.transact({ actor: USER, label: "eq" }, (tx) => (eq = addInsert(tx, "t1", { kind: "eq" })));
    expect(eq).toBe("x1");
    expect(d.song.tracks.t1!.inserts).toEqual([{ id: "x1", kind: "eq", params: defaultParams("eq") }]);
    d.transact({ actor: CLAUDE, label: "comp" }, (tx) => addInsert(tx, "t1", { kind: "compressor", params: { threshold: -24 } }, 0));
    expect(chainOf(d.song, "t1").map((x) => x.kind)).toEqual(["compressor", "eq"]);
    expect(chainOf(d.song, "t1")[0]!.params!.threshold).toBe(-24);
    d.undo(CLAUDE);
    expect(chainOf(d.song, "t1").map((x) => x.id)).toEqual(["x1"]);
    d.undo(USER);
    expect("inserts" in d.song.tracks.t1!).toBe(false);
  });

  it("never reuses an id, even after undo", () => {
    const d = doc();
    d.transact({ actor: USER, label: "a" }, (tx) => addInsert(tx, "t1", { kind: "eq" }));
    d.undo(USER);
    let id = "";
    d.transact({ actor: USER, label: "b" }, (tx) => (id = addInsert(tx, "master", { kind: "limiter" })));
    expect(id).toBe("x2");
    expect(chainOf(d.song, "master").map((x) => x.kind)).toEqual(["limiter"]);
  });

  it("moves an effect inside its chain and to another track, and removes it", () => {
    const d = doc();
    d.transact({ actor: USER, label: "fx" }, (tx) => {
      addInsert(tx, "t1", { kind: "eq" });
      addInsert(tx, "t1", { kind: "compressor" });
      addInsert(tx, "t1", { kind: "limiter" });
    });
    d.transact({ actor: USER, label: "mover" }, (tx) => moveInsert(tx, "x3", 0));
    expect(chainOf(d.song, "t1").map((x) => x.id)).toEqual(["x3", "x1", "x2"]);
    d.transact({ actor: USER, label: "a cuerdas" }, (tx) => moveInsert(tx, "x1", 0, "t2"));
    expect(chainOf(d.song, "t1").map((x) => x.id)).toEqual(["x3", "x2"]);
    expect(chainOf(d.song, "t2").map((x) => x.id)).toEqual(["x1"]);
    expect(findInsert(d.song, "x1")?.target).toBe("t2");
    d.transact({ actor: USER, label: "quitar" }, (tx) => removeInsert(tx, "x1"));
    expect("inserts" in d.song.tracks.t2!).toBe(false);
    d.undo(USER);
    d.undo(USER);
    expect(chainOf(d.song, "t1").map((x) => x.id)).toEqual(["x3", "x1", "x2"]);
  });

  it("sets parameters within their range, bypasses, and refuses what does not exist", () => {
    const d = doc();
    d.transact({ actor: USER, label: "comp" }, (tx) => addInsert(tx, "t1", { kind: "compressor" }));
    d.transact({ actor: CLAUDE, label: "ajuste" }, (tx) => updateInsert(tx, "x1", { params: { ratio: 50, attack: 3 }, bypass: true }));
    const comp = chainOf(d.song, "t1")[0]!;
    expect(comp.params!.ratio).toBe(20);
    expect(comp.params!.attack).toBe(3);
    expect(comp.bypass).toBe(true);
    d.transact({ actor: USER, label: "on" }, (tx) => updateInsert(tx, "x1", { bypass: false }));
    expect("bypass" in chainOf(d.song, "t1")[0]!).toBe(false);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => updateInsert(tx, "x1", { params: { cutoff: 3 } }))).toThrow(/no parameter 'cutoff'/);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => updateInsert(tx, "x9", { bypass: true }))).toThrow(/Unknown effect/);
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => addInsert(tx, "t9", { kind: "eq" }))).toThrow(/Unknown track/);
  });

  it("takes a name of the user's, and goes back to what it is with an empty one (04/11/2026)", () => {
    const d = doc();
    d.transact({ actor: USER, label: "eq" }, (tx) => {
      addInsert(tx, "t1", { kind: "eq" });
      addInsert(tx, "t1", { kind: "eq" });
    });
    d.transact({ actor: USER, label: "nombre" }, (tx) => updateInsert(tx, "x1", { name: "  EQ graves " }));
    expect(chainOf(d.song, "t1")[0]!.name).toBe("EQ graves");
    expect(insertName(chainOf(d.song, "t1")[0]!)).toBe("EQ graves");
    expect(insertName(chainOf(d.song, "t1")[1]!, "es")).toBe("EQ");
    d.transact({ actor: USER, label: "sin nombre" }, (tx) => updateInsert(tx, "x1", { name: "" }));
    expect("name" in chainOf(d.song, "t1")[0]!).toBe(false);
    d.undo(USER);
    expect(chainOf(d.song, "t1")[0]!.name).toBe("EQ graves");
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => updateInsert(tx, "x1", { name: "a".repeat(61) }))).toThrow(/at most 60/);
    const back = parseSongFile(serializeSong({ song: d.song, history: [], proposals: [] }));
    expect(back.song.tracks.t1!.inserts![0]!.name).toBe("EQ graves");
  });

  it("keeps only which plugin it is for a VST3 effect, whose parameters live in the engine", () => {
    const d = doc();
    d.transact({ actor: USER, label: "pro-q" }, (tx) => addInsert(tx, "t1", { kind: "plugin", plugin: { id: "VST3-Pro-Q 3-1", name: "Pro-Q 3" } }));
    expect(chainOf(d.song, "t1")[0]).toEqual({ id: "x1", kind: "plugin", plugin: { id: "VST3-Pro-Q 3-1", name: "Pro-Q 3" } });
    expect(() => d.transact({ actor: USER, label: "x" }, (tx) => updateInsert(tx, "x1", { params: { gain: 1 } }))).toThrow(/through the engine/);
  });

  it("keeps the plugin parameters the AI set and what they were, so undo can put them back", () => {
    const d = doc();
    d.transact({ actor: USER, label: "pro-l" }, (tx) => addInsert(tx, "t1", { kind: "plugin", plugin: { id: "VST3-Pro-L 2-1", name: "Pro-L 2" } }));
    d.transact({ actor: CLAUDE, label: "techo" }, (tx) => updateInsert(tx, "x1", { pluginParams: { "4": { value: 0.8, base: 0.5 } } }));
    d.transact({ actor: CLAUDE, label: "techo otra vez" }, (tx) => updateInsert(tx, "x1", { pluginParams: { "4": { value: 0.9, base: 0.8 } } }));
    const x = chainOf(d.song, "t1")[0]!;
    expect(x.pluginParams).toEqual({ "4": 0.9 });
    expect(x.pluginBase).toEqual({ "4": 0.5 });
    d.undo(CLAUDE);
    expect(chainOf(d.song, "t1")[0]!.pluginParams).toEqual({ "4": 0.8 });
    d.undo(CLAUDE);
    expect(chainOf(d.song, "t1")[0]!.pluginParams).toBeUndefined();
    const round = parseSongFile(serializeSong({ song: d.song, history: [], proposals: [] }));
    expect(round.song.tracks.t1!.inserts![0]!.kind).toBe("plugin");
  });

  it("travels in the .fourhands file; old songs without effects still open", () => {
    const d = doc();
    d.transact({ actor: USER, label: "fx" }, (tx) => {
      addInsert(tx, "t2", { kind: "eq", params: { lowCut: 1, lowCutFreq: 120 } });
      addInsert(tx, "master", { kind: "limiter" });
    });
    const back = parseSongFile(serializeSong({ song: d.song, history: d.history, proposals: [] }));
    expect(back.song.tracks.t2!.inserts![0]!.params!.lowCutFreq).toBe(120);
    expect(back.song.masterInserts![0]!.kind).toBe("limiter");
    expect(back.song.counters.x).toBe(3);
    // A song saved before effects existed: no `x` counter.
    const old = JSON.parse(serializeSong({ song: doc().song, history: [], proposals: [] }));
    delete old.song.counters.x;
    expect(parseSongFile(JSON.stringify(old)).song.counters.x).toBe(1);
  });

  it("refuses a file where two effects share an id", () => {
    const d = doc();
    d.transact({ actor: USER, label: "fx" }, (tx) => {
      addInsert(tx, "t1", { kind: "eq" });
      addInsert(tx, "t2", { kind: "eq" });
    });
    const data = JSON.parse(serializeSong({ song: d.song, history: [], proposals: [] }));
    data.song.tracks.t2.inserts[0].id = "x1";
    expect(() => parseSongFile(JSON.stringify(data))).toThrow(/share an id/);
  });

  it("shows what changed in the changes the AI reads", () => {
    const d = doc();
    d.transact({ actor: USER, label: "comp" }, (tx) => addInsert(tx, "t1", { kind: "compressor" }));
    const before = structuredClone(d.song);
    d.transact({ actor: CLAUDE, label: "ajuste" }, (tx) => {
      updateInsert(tx, "x1", { params: { threshold: -24 } });
      addInsert(tx, "master", { kind: "limiter" });
    });
    const text = changesText(before, d.song, { since: "r1", history: [] });
    expect(text).toContain("effects: Compressor (x1) threshold −18.0 dB → −24.0 dB");
    expect(text).toContain("master effects: + Limiter (x2)");
  });

  it("the delay follows the tempo with note values people write in either language (04/11/2026)", () => {
    const note = OWN_EFFECTS.delay.params.find((p) => p.id === "note")!;
    expect(paramText(note, defaultParams("delay").note!)).toBe("1/4");
    expect(paramText(note, NOTE_VALUES.findIndex((n) => n.id === "1/8D"), "es")).toBe("Corchea con puntillo");
    for (const [text, id] of [["1/8 dotted", "1/8D"], ["1/8d", "1/8D"], ["1/8.", "1/8D"], ["1/4 triplet", "1/4T"], ["1/16t", "1/16T"], ["negra", "1/4"], ["Corchea con puntillo", "1/8D"], ["1/2", "1/2"]] as const)
      expect(NOTE_VALUES[parseParamValue(note, text)!]!.id).toBe(id);
    expect(parseParamValue(note, "1/7")).toBeNull();
    const d = doc();
    d.transact({ actor: CLAUDE, label: "delay" }, (tx) => addInsert(tx, "t1", { kind: "delay", params: { note: 6, feedback: 50, pingPong: 1 } }));
    expect(chainOf(d.song, "t1")[0]!.params).toMatchObject({ sync: 1, note: 6, feedback: 50, pingPong: 1, mix: 100 });
    // Out of range: kept inside it.
    d.transact({ actor: CLAUDE, label: "x" }, (tx) => updateInsert(tx, chainOf(d.song, "t1")[0]!.id, { params: { feedback: 140, note: 40 } }));
    expect(chainOf(d.song, "t1")[0]!.params).toMatchObject({ feedback: 95, note: NOTE_VALUES.length - 1 });
  });

  it("writes values the way people read them", () => {
    const def = (kind: "eq" | "compressor" | "limiter", id: string) => OWN_EFFECTS[kind].params.find((p) => p.id === id)!;
    expect(paramText(def("eq", "lowCutFreq"), 80)).toBe("80 Hz");
    expect(paramText(def("eq", "highMidFreq"), 2500, "es")).toBe("2,5 kHz");
    expect(paramText(def("eq", "highCutFreq"), 16000)).toBe("16 kHz");
    expect(paramText(def("compressor", "threshold"), -18, "es")).toBe("−18,0 dB");
    expect(paramText(def("compressor", "ratio"), 3)).toBe("3:1");
    expect(paramText(def("compressor", "attack"), 0.5)).toBe("0.5 ms");
    expect(paramText(def("eq", "lowCut"), 1)).toBe("on");
  });
});
