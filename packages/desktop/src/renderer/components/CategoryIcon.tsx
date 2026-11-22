/** The icon of each category in the Sonidos browser, same trace as the rest. */
import type { SoundCategory } from "../../shared/sound-catalog.js";

const svg = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const PATHS: Record<SoundCategory, string> = {
  keys: "M2 3.5h12v9H2zM5.5 3.5V9M8 3.5v9M10.5 3.5V9",
  strings: "M8 2v12M5.5 4.5c-1.8 1-1.8 3 0 3.5-1.8.5-1.8 3 0 3.5M10.5 4.5c1.8 1 1.8 3 0 3.5 1.8.5 1.8 3 0 3.5",
  winds: "M2 8c2-3 4-3 6 0s4 3 6 0M2 11.5c2-2 4-2 6 0s4 2 6 0",
  brass: "M2.5 7v2h3l5 3.5v-9L5.5 7zM12.5 6.5a2.5 2.5 0 0 1 0 3",
  perc: "M2.5 6c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2-2.5 2-5.5 2-5.5-.9-5.5-2zM2.5 6v4.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V6",
  synths: "M1.5 8c1.6-5 3.2-5 4.8 0s3.2 5 4.8 0 1.6-5 3.4-1",
  samplers: "M2 3h12v10H2zM4.5 8h1l1-2.5 1.5 5 1.5-4 1 1.5h1",
  ideas: "M5.5 10.5a4 4 0 1 1 5 0V12h-5zM6.5 14h3",
  other: "M4 8h.01M8 8h.01M12 8h.01",
};

export function CategoryIcon({ category }: { category: SoundCategory }) {
  return (
    <svg {...svg} className="cat">
      <path d={PATHS[category]} {...line} strokeWidth={category === "other" ? 2.5 : 1.5} />
    </svg>
  );
}
