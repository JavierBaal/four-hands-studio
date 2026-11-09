/**
 * Visual tokens from DIRECCION_ARTISTICA.md (sections 2–5). The single source for CSS and canvas:
 * `installTheme()` writes them as CSS variables; the canvas code reads `T` directly.
 * Nothing visual changes without Fran's approval (DIRECCION_ARTISTICA.md, 0).
 */
export const T = {
  // 2.1 Surfaces
  bgPage: "#171513",
  bgApp: "#1b1916",
  bgBar: "#211e1a",
  bgPanel: "#201d19",
  bgLane: "#1e1b18",
  bgCard: "#24211d",
  bgControl: "#2a2622",
  bgControlHover: "#332e29",
  bgControlOn: "#3a352f",
  bgChip: "#26231f",
  bgMenu: "#2a2622",
  bgSection: "#2b2722",
  // 2.2 Lines
  line: "#35302a",
  lineControl: "#3a352f",
  lineSoft: "#2e2a25",
  lineStrong: "#4a443c",
  lineOn: "#5a5248",
  lineSectionMini: "#3e3832",
  laneRow: "#2a2622",
  // 2.3 Text
  text: "#ece6dc",
  text2: "#a89f92",
  textOnLight: "#1b1916",
  link: "#e3b36a",
  linkHover: "#f0c88a",
  // 2.4 The two hands
  authorUser: "#e3b36a",
  authorAi: "#6f97cc",
  authorOff: "#bdb4a6",
  // 2.5 The AI
  aiSurface: "#1f2430",
  aiSurface2: "#1f2633",
  aiLine: "#33435a",
  aiLine2: "#3b4a60",
  aiLineBtn: "#4a5a72",
  aiText: "#c7d6ea",
  aiText2: "#a9bbd3",
  aiToggle: "#5a7fae",
  // 2.6 Proposal
  proposalLine: "#9cc0ee",
  proposalFill: "rgba(111,151,204,.22)",
  // 2.8 Other functional colours
  rec: "#d77a6a",
  flag: "#d9c9a3",
  loop: "#7fa196",
  viewport: "#cfc6b8",
  viewportFill: "rgba(236,230,220,.05)",
  playhead: "#ece6dc",
  selectBand: "rgba(111,151,204,.08)",
  selectBandLine: "#6f97cc",
  selectNote: "#ece6dc",
  aiOff: "#6b645b",
  warnSurface: "#2a2420",
  warnLine: "#5a4a36",
  toggleOn: "#2f2a25",
  // 2.9 Grid and keyboard
  rowWhite: "#25221e",
  rowBlack: "#1d1a17",
  rowC: "#3a352f",
  gridBeat: "#2f2b26",
  gridBar: "#4a443c",
  keyWhite: "#d6cfc3",
  keyWhiteLine: "#b9b1a3",
  keyWhiteText: "#2a2622",
  keyBlack: "#2c2824",
  keyBlackLine: "#1b1916",
  // Library cards (Fran, 05/11/2026): keyswitch keys and keys outside the library's range.
  keyswitch: "#c9826f",
  keyswitchText: "#7a3e30",
  keyswitchTextOnBlack: "#e8c3b8",
  keyOutOfRange: "rgba(23,21,19,.62)",
} as const;

export { TRACK_PALETTE, type TrackColor } from "../shared/track-colors.js";
import { TRACK_PALETTE } from "../shared/track-colors.js";

export const TRACK_COLORS = TRACK_PALETTE.map((c) => c.hex);

export function trackColorIndex(index: number): number {
  const n = TRACK_PALETTE.length;
  return ((Math.trunc(index) % n) + n) % n;
}

export function trackColor(index: number): string {
  return TRACK_PALETTE[trackColorIndex(index)]!.hex;
}

/** Section 4: sizes, in CSS pixels. */
export const SIZE = {
  topBar: 52,
  trackHeader: 196,
  trackHeaderCompact: 44,
  /** H3.2: 26 → 40 so volume and pan fit under the name (pending Fran's approval). */
  arrangeLane: 54,
  arrangeLaneCompact: 14,
  arrangeStrip: 22,
  rulerLabel: 72,
  rulerLabelCompact: 56,
  rulerRow: 24,
  row: 15,
  note: 13,
  ghost: 9,
  velocityLane: 64,
  velocityMax: 56,
  velocityBar: 4,
  activity: 288,
  rail: 48,
  /** Black keys leave this much of the row uncovered on the right. */
  blackKeyGap: 24,
  /** Below this app width the compact layout applies (DIRECCION_ARTISTICA.md, 6.3). */
  compactBelow: 1000,
} as const;

export const FONT = {
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** Note opacity from velocity (DIRECCION_ARTISTICA.md, 5). */
export function velocityOpacity(velocity: number): number {
  return 0.55 + (0.45 * velocity) / 127;
}

function kebab(name: string): string {
  return name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);
}

/** Writes every token as a CSS variable on :root (`bgApp` → `--bg-app`). */
export function installTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(T)) root.style.setProperty(`--${kebab(name)}`, value);
  TRACK_COLORS.forEach((c, i) => root.style.setProperty(`--track-${i + 1}`, c));
}
