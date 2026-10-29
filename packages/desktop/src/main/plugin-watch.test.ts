import { describe, expect, it } from "vitest";
import { PluginWatch, SHOWN_WATCH_MS, packState, packStates, unpackState, unpackStates } from "./plugin-watch.js";

// Like the engine's text for Kontakt: JUCE's base64 of a state that is mostly settings.
const juce = "48211." + "Hd1HiBmZgAhEZkP.tVQo7X+R9kR.CBQ4.MDBAKz.".repeat(400);

describe("plugin states in the file, kept small (29/10/2026)", () => {
  it("packs the engine's text and gives it back exactly", () => {
    const packed = packState(juce);
    expect(packed.startsWith("z")).toBe(true);
    expect(packed).toMatch(/^[A-Za-z0-9+/=.]*$/);
    expect(packed.length).toBeLessThan(juce.length / 10);
    expect(unpackState(packed)).toBe(juce);
  });

  it("reads a state saved before packing as it is", () => {
    expect(unpackState("1234.AbC.d")).toBe("1234.AbC.d");
    expect(packState("")).toBe("");
  });

  it("leaves out a state it cannot unpack", () => {
    const states = { t1: { id: "k", data: packState(juce) }, t2: { id: "k", data: "z!!!not deflate" } };
    expect(unpackStates(packStates(unpackStates(states)))).toEqual({ t1: { id: "k", data: juce } });
  });
});

describe("watching only the plugins whose window is open", () => {
  it("asks the open windows, and once more the one that just closed", () => {
    const w = new PluginWatch();
    expect([...w.slotsToCheck([], 0)]).toEqual([]);
    expect([...w.slotsToCheck([1], 0)]).toEqual([1]);
    expect([...w.slotsToCheck([], 0)]).toEqual([1]);
    expect([...w.slotsToCheck([], 0)]).toEqual([]);
  });

  it("with an engine that cannot tell, watches a slot for a while after showing it", () => {
    const w = new PluginWatch();
    expect(w.slotsToCheck(null, 0).size).toBe(0);
    w.shown(3, 1000);
    expect([...w.slotsToCheck(null, 1000 + SHOWN_WATCH_MS - 1)]).toEqual([3]);
    expect(w.slotsToCheck(null, 1000 + SHOWN_WATCH_MS).size).toBe(0);
  });
});
