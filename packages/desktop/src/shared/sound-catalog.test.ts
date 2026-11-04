import { describe, expect, it } from "vitest";
import { NO_SOUND_PREFS, buildCatalog, categoryFromName, filterCatalog, groupCatalog, pluginCategory, pluginKey, withRecent, buildEffectCatalog, effectCategory, filterEffects, groupEffects, ownEffectKey } from "./sound-catalog.js";

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

  it("keeps favourites and the twenty most recent (instruments and effects together), newest first", () => {
    let prefs = { ...NO_SOUND_PREFS, favorites: [pluginKey("VST3-Kontakt 8")] };
    const items = catalog(prefs);
    expect(filterCatalog(items, "favorites", "", prefs).map((i) => i.name)).toEqual(["Kontakt 8"]);
    for (const p of FRAN.slice(0, 3)) prefs = withRecent(prefs, pluginKey(p.id));
    prefs = withRecent(prefs, pluginKey("VST3-Kontakt 8"));
    expect(filterCatalog(items, "recents", "", prefs).map((i) => i.name)).toEqual(["Kontakt 8", "Serum 2", "Omnisphere"]);
    for (let n = 0; n < 30; n++) prefs = withRecent(prefs, `fh:${n}`);
    expect(prefs.recents).toHaveLength(20);
  });

  it("groups by category in a fixed order, or by vendor with Four Hands first", () => {
    const items = catalog();
    expect(groupCatalog(items, "category", "es", "?").map((g) => g.label)).toEqual(["Teclados", "Cuerdas", "Viento y voces", "Metales", "Percusión", "Sintes", "Muestreadores", "Generadores de ideas"]);
    const vendors = groupCatalog(items, "vendor", "es", "?").map((g) => g.label);
    expect(vendors[0]).toBe("de serie");
    expect(vendors).toContain("Toontrack");
  });
});

describe("the effect catalog (F2.2 parte C, Fran 04/11/2026)", () => {
  const plugins = [
    { id: "VST3-Pro-Q 3", name: "Pro-Q 3", vendor: "FabFilter", category: "Fx|EQ", format: "VST3", instrument: false },
    { id: "VST3-Pro-C 2", name: "Pro-C 2", vendor: "FabFilter", category: "Fx|Dynamics", format: "VST3", instrument: false },
    { id: "VST3-VintageVerb", name: "ValhallaVintageVerb", vendor: "Valhalla DSP, LLC", category: "Fx|Reverb", format: "VST3", instrument: false },
    { id: "VST3-CLA", name: "CLA Effects Stereo", vendor: "Waves", category: "Fx", format: "VST3", instrument: false },
    { id: "VST3-Ozone", name: "Ozone 11", vendor: "iZotope", category: "Fx|Mastering", format: "VST3", instrument: false },
    { id: "VST3-Decap", name: "Decapitator", vendor: "Soundtoys", category: "Fx", format: "VST3", instrument: false },
    { id: "VST3-Kontakt", name: "Kontakt 8", vendor: "Native Instruments", category: "Instrument|Sampler", format: "VST3", instrument: true },
  ];
  const fx = (prefs = NO_SOUND_PREFS) => buildEffectCatalog({ lang: "es", plugins, prefs, ownLabel: "Four Hands", ownNames: { eq: "EQ", compressor: "Compresor", limiter: "Limitador" } });

  it("has Four Hands' own effects first, the effect plugins after, and no instruments", () => {
    const items = fx();
    expect(items.slice(0, 3).map((i) => i.name)).toEqual(["EQ", "Compresor", "Limitador"]);
    expect(items.some((i) => i.name === "Kontakt 8")).toBe(false);
    expect(items).toHaveLength(9);
  });

  it("sorts plugins by type from their own category, else from their name", () => {
    const cat = (name: string) => fx().find((i) => i.name === name)!.category;
    expect(cat("Pro-Q 3")).toBe("eq");
    expect(cat("Pro-C 2")).toBe("dynamics");
    expect(cat("ValhallaVintageVerb")).toBe("reverb");
    expect(cat("Ozone 11")).toBe("mastering");
    expect(cat("Decapitator")).toBe("saturation");
    expect(effectCategory({ name: "H-Delay Stereo", category: "Fx" })).toBe("delay");
    expect(cat("CLA Effects Stereo")).toBe("other");
  });

  it("groups by type or by vendor (Four Hands first) and searches by name or vendor", () => {
    const byType = groupEffects(fx(), "category", "es", "Sin fabricante");
    expect(byType.map((g) => g.label)).toEqual(["Ecualizadores", "Dinámica", "Reverbs", "Saturación y distorsión", "Mastering", "Otros"]);
    expect(byType[0]!.items.map((i) => i.name)).toEqual(["EQ", "Pro-Q 3"]);
    const byVendor = groupEffects(fx(), "vendor", "es", "Sin fabricante");
    expect(byVendor.map((g) => g.label)).toEqual(["Four Hands", "FabFilter", "iZotope", "Soundtoys", "Valhalla DSP, LLC", "Waves"]);
    expect(filterEffects(fx(), "all", "fabfilter", NO_SOUND_PREFS).map((i) => i.name)).toEqual(["Pro-Q 3", "Pro-C 2"]);
    expect(filterEffects(fx(), "fourHands", "", NO_SOUND_PREFS).map((i) => i.name)).toEqual(["EQ", "Compresor", "Limitador"]);
  });

  it("keeps hidden plugins out, and favourites by the same keys", () => {
    const prefs = { ...NO_SOUND_PREFS, hidden: [pluginKey("VST3-Decap")], favorites: [ownEffectKey("eq"), pluginKey("VST3-Pro-Q 3")] };
    expect(fx(prefs).some((i) => i.name === "Decapitator")).toBe(false);
    expect(filterEffects(fx(prefs), "favorites", "", prefs).map((i) => i.name)).toEqual(["EQ", "Pro-Q 3"]);
  });
});
