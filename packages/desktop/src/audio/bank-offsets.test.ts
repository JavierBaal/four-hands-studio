import { describe, expect, it } from "vitest";
import { BANK_OFFSET_FIRST, BANK_OFFSET_STEP, MAX_EXTRA_BANKS } from "./engine.js";

// The banks MuseScore_General uses (both versions, read on 01/11/2026), besides its drums (128).
const MUSESCORE_BANKS = [0, 1, 8, 16, 17, 18, 20, 21, 25, 26, 30, 31, 40, 41, 50, 51];

describe("the user's sound banks get bank selects of their own (F2.1, 01/11/2026)", () => {
  it("never land on a bank of the built-in sounds, where the built-in preset would win", () => {
    for (let i = 0; i < MAX_EXTRA_BANKS; i++) {
      const first = BANK_OFFSET_FIRST + i * BANK_OFFSET_STEP;
      for (let own = 0; own < BANK_OFFSET_STEP; own++) expect(MUSESCORE_BANKS).not.toContain(first + own);
      expect(first + BANK_OFFSET_STEP - 1).toBeLessThan(128);
    }
  });
});
