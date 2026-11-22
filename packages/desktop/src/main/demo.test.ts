import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSongFile } from "@fourhands/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_FILE, DEMO_NAME, copyDemo } from "./demo.js";

const BUNDLED = path.resolve(__dirname, "../../demo", DEMO_FILE);
/** The banks the Windows installer ships (README, "Sounds"). */
const SHIPPED_BANKS = ["Sonatina_Symphonic_Orchestra.sf2", "YDP-GrandPiano-20160804.sf2"];

describe("the demo song", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-demo-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is a valid song that plays with what the installer ships: no plugins, only its banks", () => {
    const { song } = parseSongFile(fs.readFileSync(BUNDLED, "utf8"));
    const tracks = Object.values(song.tracks);
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) {
      expect(t.output, t.name).toBeUndefined();
      expect(t.plugin, t.name).toBeUndefined();
      if (t.sound) expect(SHIPPED_BANKS, t.name).toContain(t.sound.bank);
    }
  });

  it("is copied into the songs folder, never opened in place, and a second copy keeps the first", () => {
    const songs = path.join(dir, "Four Hands");
    const first = copyDemo(BUNDLED, songs);
    const second = copyDemo(BUNDLED, songs);
    expect(first).toBe(path.join(songs, `${DEMO_NAME}.fourhands`));
    expect(second).toBe(path.join(songs, `${DEMO_NAME} 2.fourhands`));
    expect(fs.readFileSync(first!, "utf8")).toBe(fs.readFileSync(BUNDLED, "utf8"));
  });

  it("is nothing when the app has no demo", () => {
    expect(copyDemo(path.join(dir, "missing.fourhands"), dir)).toBeNull();
  });
});
