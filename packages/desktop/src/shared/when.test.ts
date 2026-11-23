import { describe, expect, it } from "vitest";
import { translator } from "./i18n.js";
import { fullTime, relativeTime } from "./when.js";

// Local dates, so the tests hold in any time zone. Monday 23 November 2026, 18:40.
const now = new Date(2026, 10, 23, 18, 40).getTime();
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const es = (t: number) => relativeTime("es", translator("es"), t, now);
const en = (t: number) => relativeTime("en", translator("en"), t, now);

describe("when something happened", () => {
  it("is now, minutes or hours on the same day", () => {
    expect(es(now - 20_000)).toBe("ahora");
    expect(es(now - 12 * 60_000)).toBe("hace 12 min");
    expect(en(now - 12 * 60_000)).toBe("12 min ago");
    expect(es(at(2026, 11, 23, 15, 10))).toBe("hace 3 h");
    expect(en(at(2026, 11, 23, 0, 5))).toBe("18 h ago");
  });

  it("is yesterday by the calendar, with the time, even if it was minutes ago", () => {
    const late = new Date(2026, 10, 24, 0, 10).getTime();
    expect(relativeTime("es", translator("es"), at(2026, 11, 23, 23, 55), late)).toBe("ayer, 23:55");
    expect(es(at(2026, 11, 22, 9, 5))).toBe("ayer, 09:05");
    expect(en(at(2026, 11, 22, 21, 30))).toBe("yesterday, 21:30");
  });

  it("is the weekday within the week", () => {
    expect(es(at(2026, 11, 19, 18, 40))).toBe("jueves, 18:40");
    expect(en(at(2026, 11, 17, 8, 0))).toBe("Tuesday, 08:00");
  });

  it("is a date after a week, with the year only when it is another one", () => {
    expect(es(at(2026, 10, 18, 12, 0))).toBe("18 oct");
    expect(en(at(2026, 10, 18, 12, 0))).toBe("18 Oct");
    expect(es(at(2025, 12, 31, 12, 0))).toBe("31 dic 2025");
    expect(en(at(2025, 12, 31, 12, 0))).toBe("31 Dec 2025");
  });

  it("has the full date for a tooltip", () => {
    expect(fullTime("es", at(2026, 11, 19, 18, 40))).toMatch(/jueves, 19 de noviembre de 2026.*18:40/);
    expect(fullTime("en", at(2026, 11, 19, 18, 40))).toMatch(/Thursday.*19 November 2026.*18:40/);
  });
});
