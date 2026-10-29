import { describe, expect, it } from "vitest";
import { NO_SOUND_PREFS, buildCatalog, categoryFromName, filterCatalog, groupCatalog, pluginCategory, pluginKey, withRecent } from "./sound-catalog.js";

const plugin = (name: string, category: string, vendor = "") => ({ id: `VST3-${name}`, name, vendor, category, format: "VST3", instrument: true });

// The instruments the engine found on Fran's computer (prueba S2, 28/10/2026), with their real names.
const FRAN = [
  plugin("Kontakt 8", "Instrument|Sampler", "Native Instruments"),
  plugin("Omnisphere", "Instrument|Synth", "Spectrasonics"),
  plugin("Serum 2", "Instrument|Synth", "Xfer Records"),
  plugin("EZdrummer 3", "Instrument|Drum", "Toontrack"),
  plugin("EZkeys 2", "Instrument", "Toontrack"),
  plugin("Grand Rhapsody Piano Stereo", "Instrument", "Waves"),
  plugin("Captain Chords Epic", "Instrument", "Mixed In Key"),
  plugin("Bass Slapper Stereo", "Instrument", "Waves"),
  { ...plugin("Ozone 11", "Fx|Mastering", "iZotope"), instrument: false },
];

const catalog = (prefs = NO_SOUND_PREFS) =>
  buildCatalog({ lang: "es", banks: [{ id: "Sonatina.sf2", name: "Sonatina", presets: [{ name: "1st Violins Sustain", program: 0, bankMSB: 0 }, { name: "Concert Harp", program: 1, bankMSB: 0 }] }], plugins: FRAN, prefs, builtInLabel: "de serie" });

describe("the sound catalog (ESTUDIO_INTERFAZ_2.md, 5.3)", () => {
  it("joins Four Hands's sounds, the banks and the instrument plugins (not the effects)", () => {
    const items = catalog();
    expect(items.filter((i) => i.origin === "builtin")).toHaveLength(22);
    expect(items.filter((i) => i.origin === "bank").map((i) => i.name)).toEqual(["1st Violins Sustain", "Concert Harp"]);
    expect(items.filter((i) => i.origin === "plugin").map((i) => i.name)).not.toContain("Ozone 11");
  });

  it("puts each plugin in a category: its own, its name, or Muestreadores for Kontakt", () => {
    const cat = (name: string) => catalog().find((i) => i.name === name)!.category;
    expect(cat("Kontakt 8")).toBe("samplers");
    expect(cat("Omnisphere")).toBe("synths");
    expect(cat("EZdrummer 3")).toBe("perc");
    expect(cat("EZkeys 2")).toBe("keys");
    expect(cat("Grand Rhapsody Piano Stereo")).toBe("keys");
    expect(cat("Captain Chords Epic")).toBe("ideas");
    expect(cat("1st Violins Sustain")).toBe("strings");
    expect(cat("Trompa")).toBe("brass");
    expect(cat("Percusión")).toBe("perc");
    expect(pluginCategory({ name: "Mystery", category: "Instrument" })).toBe("other");
    expect(categoryFromName("Órgano")).toBe("keys");
  });

  it("lets the user move a sound to another category and hide a plugin", () => {
    const items = catalog({ ...NO_SOUND_PREFS, categories: { [pluginKey("VST3-Kontakt 8")]: "strings" }, hidden: [pluginKey("VST3-Serum 2")] });
    expect(items.find((i) => i.name === "Kontakt 8")!.category).toBe("strings");
    expect(items.find((i) => i.name === "Serum 2")).toBeUndefined();
  });

  it("finds by name or source, without caring about accents or case", () => {
    const items = catalog();
    expect(filterCatalog(items, "all", "organo", NO_SOUND_PREFS).map((i) => i.name)).toEqual(["Órgano"]);
    expect(filterCatalog(items, "all", "toontrack", NO_SOUND_PREFS).map((i) => i.name)).toEqual(["EZdrummer 3", "EZkeys 2"]);
    expect(filterCatalog(items, "plugins", "piano", NO_SOUND_PREFS).map((i) => i.name)).toEqual(["Grand Rhapsody Piano Stereo"]);
    expect(filterCatalog(items, "fourHands", "", NO_SOUND_PREFS).every((i) => i.origin !== "plugin")).toBe(true);
  });

  it("keeps favourites and the ten most recent, newest first", () => {
    let prefs = { ...NO_SOUND_PREFS, favorites: [pluginKey("VST3-Kontakt 8")] };
    const items = catalog(prefs);
    expect(filterCatalog(items, "favorites", "", prefs).map((i) => i.name)).toEqual(["Kontakt 8"]);
    for (const p of FRAN.slice(0, 3)) prefs = withRecent(prefs, pluginKey(p.id));
    prefs = withRecent(prefs, pluginKey("VST3-Kontakt 8"));
    expect(filterCatalog(items, "recents", "", prefs).map((i) => i.name)).toEqual(["Kontakt 8", "Serum 2", "Omnisphere"]);
    for (let n = 0; n < 20; n++) prefs = withRecent(prefs, `fh:${n}`);
    expect(prefs.recents).toHaveLength(10);
  });

  it("groups by category in a fixed order, or by vendor with Four Hands first", () => {
    const items = catalog();
    expect(groupCatalog(items, "category", "es", "?").map((g) => g.label)).toEqual(["Teclados", "Cuerdas", "Viento y voces", "Metales", "Percusión", "Sintes", "Muestreadores", "Generadores de ideas"]);
    const vendors = groupCatalog(items, "vendor", "es", "?").map((g) => g.label);
    expect(vendors[0]).toBe("de serie");
    expect(vendors).toContain("Toontrack");
  });
});
