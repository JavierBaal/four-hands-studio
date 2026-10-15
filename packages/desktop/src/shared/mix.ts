/**
 * Volume and pan as people read them (H3.2): the window shows volume in dB, like the DAWs of the
 * niche; the AI keeps 0–100 (`set_mix`). Pan is C, L30 or R30 everywhere.
 *
 * Volume is CC7 (`round(volume × 127)`), and the General MIDI curve for CC7 is
 * 40 · log10(cc / 127) dB, so 0.8 (CC 102) is −3.8 dB and 1 is 0 dB. Values above 0 dB do not exist.
 */
import type { Lang } from "./i18n.js";

/** Lowest dB that still means a sound (CC7 = 1). Below it, silence. */
export const MIN_DB = 40 * Math.log10(1 / 127);

export function volumeToDb(volume: number): number {
  const cc = Math.round(Math.max(0, Math.min(1, volume)) * 127);
  return cc === 0 ? -Infinity : 40 * Math.log10(cc / 127);
}

export function dbToVolume(db: number): number {
  // Half a CC step of slack under the lowest value, so a shown "−84,2" reads back as CC7 = 1.
  if (!Number.isFinite(db) || db < MIN_DB - 0.5) return 0;
  return Math.max(1 / 127, Math.min(1, Math.pow(10, Math.min(0, db) / 40)));
}

function decimal(value: number, lang: Lang): string {
  const text = value.toFixed(1);
  return lang === "es" ? text.replace(".", ",") : text;
}

/** "−3,8" (es) or "−3.8" (en), with a true minus sign; "−∞" for silence; "0,0" at the top. */
export function formatDb(volume: number, lang: Lang): string {
  const db = volumeToDb(volume);
  if (db === -Infinity) return "−∞";
  const text = decimal(Math.abs(db), lang);
  return db < -0.05 ? `−${text}` : text;
}

/**
 * Reads a typed volume in dB: "-6", "−6", "-6,5", "-6.5 dB", "0", "-inf", "−∞". Positive values
 * are taken as negative (nobody means +6 dB here, and it does not exist). Null if unreadable.
 */
export function parseDb(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/db$/, "").trim().replace("−", "-").replace(",", ".");
  if (t === "-inf" || t === "-∞" || t === "inf" || t === "∞") return 0;
  if (!/^[-+]?\d+(\.\d+)?$|^[-+]?\.\d+$/.test(t)) return null;
  const db = -Math.abs(Number(t));
  return Number.isFinite(db) ? dbToVolume(db) : null;
}

/** "C", "L30", "R25" (pan −1…1 → percent). */
export function formatPan(pan: number): string {
  const p = Math.round(pan * 100);
  return p === 0 ? "C" : p < 0 ? `L${-p}` : `R${p}`;
}

/** Reads "C", "L30", "R 25", "I30" / "D30" (Spanish), "-30", "30". Null if unreadable. */
export function parsePan(text: string): number | null {
  const t = text.trim().toUpperCase().replace("−", "-").replace(/\s+/g, "");
  if (t === "C" || t === "0") return 0;
  const m = /^([LRID])?(-?\d+)$/.exec(t);
  if (!m) return null;
  let p = Number(m[2]);
  if (m[1] === "L" || m[1] === "I") p = -Math.abs(p);
  else if (m[1] === "R" || m[1] === "D") p = Math.abs(p);
  if (!Number.isFinite(p)) return null;
  return Math.max(-100, Math.min(100, p)) / 100;
}
