/**
 * When something happened, the way people say it: "now", "12 min ago", "3 h ago" today; "yesterday,
 * 18:40"; "Monday, 18:40" within the week; "12 Nov" this year; "12 Nov 2025" before. Days are
 * calendar days in the user's time zone, so "yesterday" is yesterday even if it was 2 hours ago.
 */
import type { Lang, Translate } from "./i18n.js";

const LOCALE: Record<Lang, string> = { es: "es-ES", en: "en-GB" };
const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days between two moments (0 = same day), robust to daylight saving changes. */
function daysBetween(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY);
}

function time(lang: Lang, at: number): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** "12 nov" / "12 Nov", with the year when it is not this one; no trailing dot on the month. */
function date(lang: Lang, at: number, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value.replace(/\.$/, "") ?? "";
  return [get("day"), get("month"), withYear ? get("year") : ""].filter(Boolean).join(" ");
}

export function relativeTime(lang: Lang, t: Translate, at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return t("now");
  const days = daysBetween(at, now);
  if (min < 60 && days === 0) return t("minutesAgo", { n: min });
  if (days === 0) return t("hoursAgo", { n: Math.floor(min / 60) });
  if (days === 1) return t("yesterdayAt", { time: time(lang, at) });
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long" }).format(at);
    return `${weekday}, ${time(lang, at)}`;
  }
  return date(lang, at, new Date(at).getFullYear() !== new Date(now).getFullYear());
}

/** The full date and time, for a tooltip: "lunes, 23 de noviembre de 2026, 18:40". */
export function fullTime(lang: Lang, at: number): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "full", timeStyle: "short", hour12: false }).format(at);
}
